"""Bill of quantities per project — read the current revision, preview an
import, record a revision (PRD v2 §3.6; decision 2026-10-12, milestone A).

A project's bill is a numbered revision (migration 044). Read: one SQL
statement returns the current revision, its bills with items in sheet
order, and the revision list. Import: the uploaded .xlsx is parsed with
the deterministic BEME parser (no AI, CLAUDE.md rule 8), the file is kept
in the private 'reports' bucket, and the admin sees our Σ per bill against
the sheet's own totals before anything is saved. Record: a new revision is
written in one transaction and becomes current; the previous one is
superseded. Approval by the project manager is the next milestone.

Log phrases: "Bills import previewed", "Bills revision recorded".
"""

from __future__ import annotations

import io
import json
import re
from datetime import date
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Request, UploadFile
from pydantic import BaseModel, Field

from app.api.v1.auth import get_client_ip
from app.core.events import broadcast
from app.core.exceptions import NotFoundError, ValidationError
from app.core.pool import fetchrow, get_pool
from app.core.project_scope import project_scope_guard
from app.core.security import CurrentUser, require_admin, require_projects_read
from app.monitoring.logging import get_logger
from app.services.audit_service import audit_service
from app.services.bills_import import pick_beme_sheet, shape_preview
from app.services.bills_summary import compute_summary, validate_adders
from app.services.weekly_report_sheets import parse_beme

router = APIRouter(dependencies=[Depends(project_scope_guard)])
logger = get_logger(__name__)

MAX_BYTES = 25 * 1024 * 1024
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")

# ── request models ─────────────────────────────────────────────────────────

class BillItemIn(BaseModel):
    item_code: str = ""
    description: str = Field(..., min_length=1, max_length=2000)
    unit: str | None = Field(None, max_length=40)
    contract_qty: float | None = None
    rate: float | None = Field(None, ge=0)
    contract_amount: float | None = None
    sort_order: int | None = None


class BillIn(BaseModel):
    bill_code: str = Field(..., min_length=1, max_length=40)
    bill_no: int | None = None
    sort_order: int | None = None
    name: str | None = Field(None, max_length=500)
    sheet_total: float | None = None
    items: list[BillItemIn] = Field(default_factory=list)


class RevisionIn(BaseModel):
    source: Literal["award_beme", "variation", "correction", "derived_from_weekly"] = "award_beme"
    effective_date: date
    note: str | None = Field(None, max_length=2000)
    source_file_name: str | None = Field(None, max_length=255)
    source_document_path: str | None = Field(None, max_length=500)
    bills: list[BillIn] = Field(..., min_length=1)
    # the ladder under the works total (045); the page copies the current
    # revision's adders forward unless the admin changes them
    adders: list[dict[str, Any]] = Field(default_factory=list)


class AddersIn(BaseModel):
    adders: list[dict[str, Any]] = Field(default_factory=list)


# ── helpers ────────────────────────────────────────────────────────────────

async def _project_or_404(project_id: UUID) -> dict[str, Any]:
    row = await fetchrow(
        "SELECT id, project_name, short_name, current_beme_revision_id FROM projects WHERE id = $1::uuid",
        str(project_id))
    if not row:
        raise NotFoundError("Project", str(project_id))
    return dict(row)


_BILLS_SQL = """
WITH cur AS (
  SELECT r.* FROM project_beme_revisions r
   WHERE r.id = (SELECT current_beme_revision_id FROM projects WHERE id = $1::uuid)
), bills AS (
  SELECT b.id, b.bill_code, b.bill_no, b.sort_order, b.name,
         b.contract_amount AS sheet_total,
         COALESCE((SELECT sum(i.contract_amount) FROM project_beme_items i WHERE i.bill_id = b.id), 0) AS items_total,
         (SELECT count(*) FROM project_beme_items i WHERE i.bill_id = b.id)::int AS item_count,
         COALESCE((SELECT json_agg(json_build_object(
                     'id', i.id, 'item_code', i.item_code, 'description', i.description,
                     'unit', i.unit, 'contract_qty', i.contract_qty, 'rate', i.rate,
                     'contract_amount', i.contract_amount, 'sort_order', i.sort_order)
                   ORDER BY i.sort_order NULLS LAST,
                            (SELECT array_agg(lpad(p, 6, '0'))
                               FROM unnest(string_to_array(COALESCE(i.item_code, ''), '.')) p),
                            i.dup_seq)
                   FROM project_beme_items i WHERE i.bill_id = b.id), '[]'::json) AS items
    FROM project_beme_bills b JOIN cur ON b.revision_id = cur.id
)
SELECT (SELECT row_to_json(cur) FROM cur) AS revision,
       COALESCE((SELECT json_agg(bills ORDER BY sort_order NULLS LAST, bill_code) FROM bills), '[]'::json) AS bills,
       COALESCE((SELECT json_agg(json_build_object(
                   'id', r.id, 'revision_no', r.revision_no, 'source', r.source, 'state', r.state,
                   'effective_date', r.effective_date, 'works_total', r.works_total, 'note', r.note,
                   'source_file_name', r.source_file_name, 'created_at', r.created_at)
                 ORDER BY r.revision_no DESC)
          FROM project_beme_revisions r WHERE r.project_id = $1::uuid), '[]'::json) AS revisions
"""


# ── read ───────────────────────────────────────────────────────────────────

@router.get("/{project_id}/bills")
async def project_bills(
    project_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_projects_read)],
) -> dict[str, Any]:
    """The project's current bill of quantities: revision, bills with items
    in sheet order, and the revision list. One statement."""
    await _project_or_404(project_id)
    row = await fetchrow(_BILLS_SQL, str(project_id))
    revision, bills = row["revision"], row["bills"] or []
    # the summary — bills → works total → adders → contract figure — is
    # computed here, once, so page, export and reports agree to the kobo
    adders = (revision or {}).get("adders") or []
    summary = compute_summary(
        [{"bill_code": b["bill_code"], "name": b["name"], "amount": b["items_total"]} for b in bills],
        adders) if revision else None
    return {"success": True, "data": {
        "revision": revision, "bills": bills, "summary": summary, "revisions": row["revisions"]}}


# ── adders on the current revision ─────────────────────────────────────────

@router.patch("/{project_id}/bills/adders")
async def set_bills_adders(
    project_id: UUID,
    body: AddersIn,
    request: Request,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Set the ladder under the works total on the project's current bill.
    Free while the bill is not in use (locked_at IS NULL); once locked this
    becomes a pending revision — next milestone."""
    project = await _project_or_404(project_id)
    rev_id = project["current_beme_revision_id"]
    if rev_id is None:
        raise ValidationError("Record the bill first; adders belong to a bill revision")
    try:
        clean = validate_adders(body.adders)
    except ValueError as e:
        raise ValidationError(str(e)) from e
    before = await fetchrow("SELECT adders, locked_at FROM project_beme_revisions WHERE id = $1::uuid", str(rev_id))
    if before and before["locked_at"] is not None:
        raise ValidationError("This bill is in use; changes to it need the project manager's approval")
    await fetchrow(
        "UPDATE project_beme_revisions SET adders = $2::jsonb WHERE id = $1::uuid RETURNING id",
        str(rev_id), json.dumps(clean))
    await audit_service.log(
        user_id=current_user.id, user_email=current_user.email, action="bills_adders_set",
        table_name="project_beme_revisions", record_id=str(rev_id),
        old_values={"adders": before["adders"] if before else None}, new_values={"adders": clean},
        ip_address=get_client_ip(request),
        description=f"adders set on bill revision for {project['short_name'] or project['project_name']}: "
                    + (", ".join(f"{a['name']} {a['value']}{'%' if a['kind'] != 'amount' else ''}" for a in clean) or "none"))
    logger.info("Bills adders set", project_id=str(project_id), revision_id=str(rev_id),
                adders=len(clean), by=current_user.email)
    broadcast("projects", "bills_adders")
    return {"success": True, "data": {"adders": clean}}


# ── import preview ─────────────────────────────────────────────────────────

@router.post("/{project_id}/bills/import")
async def preview_bills_import(
    project_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """Parse an uploaded bill (.xlsx, the company's BEME sheet layout) and
    return what WOULD be recorded. Nothing is written to the bill tables;
    the file itself is kept so the revision can point at its evidence."""
    project = await _project_or_404(project_id)
    name = file.filename or "bill.xlsx"
    if not name.lower().endswith((".xlsx", ".xlsm")):
        raise ValidationError("Upload the bill as .xlsx — legacy .xls is not read yet")
    content = await file.read()
    if not content:
        raise ValidationError("The file is empty")
    if len(content) > MAX_BYTES:
        raise ValidationError("The file is larger than 25 MB")

    import openpyxl  # local import: keeps the module light for the pure tests
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    except Exception as e:  # noqa: BLE001 — the user needs the real reason
        raise ValidationError(f"Could not open the workbook: {e}") from e

    parsed_by_sheet = {ws.title: parse_beme(ws) for ws in wb.worksheets}
    sheet = pick_beme_sheet(parsed_by_sheet)
    if sheet is None:
        raise ValidationError(
            "No bill of quantities found: no sheet has an Item / Description / Rate "
            "header followed by priced items (bill headers are dotted codes in capitals)")
    preview = shape_preview(parsed_by_sheet[sheet])

    safe = _SAFE_NAME.sub("_", name)[:120]
    storage_path = f"projects/{project_id}/boq/{uuid4().hex}_{safe}"
    from app.core.database import get_supabase_admin_client  # Storage only
    try:
        get_supabase_admin_client().storage.from_("reports").upload(
            storage_path, content,
            {"content-type": file.content_type or "application/octet-stream"})
    except Exception as e:  # noqa: BLE001
        logger.error("Bill file upload failed", path=storage_path, error=f"{type(e).__name__}: {e}")
        raise ValidationError(f"Could not store the file: {e}") from e

    logger.info("Bills import previewed", project_id=str(project_id), sheet=sheet,
                bills=preview["bill_count"], items=preview["item_count"],
                works_total=preview["works_total"], mismatched=len(preview["mismatched_bills"]),
                by=current_user.email)
    return {"success": True, "data": {
        **preview, "sheet": sheet, "file_name": name, "source_document_path": storage_path,
        "project": {"id": project["id"], "short_name": project["short_name"]},
    }}


# ── record a revision ──────────────────────────────────────────────────────

@router.post("/{project_id}/bills/revisions", status_code=201)
async def record_bills_revision(
    project_id: UUID,
    body: RevisionIn,
    request: Request,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Write a new revision (bills + items) in one transaction and make it
    current. The previous approved revision becomes 'superseded'."""
    project = await _project_or_404(project_id)
    if not any(b.items for b in body.bills):
        raise ValidationError("The bill has no items")
    try:
        adders = validate_adders(body.adders)
    except ValueError as e:
        raise ValidationError(str(e)) from e

    works = sum((Decimal(str(i.contract_amount or 0)) for b in body.bills for i in b.items), Decimal("0"))
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            prev = await conn.fetchrow(
                """SELECT id, revision_no FROM project_beme_revisions
                    WHERE project_id = $1::uuid ORDER BY revision_no DESC LIMIT 1""", str(project_id))
            rev_no = (prev["revision_no"] + 1) if prev else 1
            rev_id = await conn.fetchval(
                """INSERT INTO project_beme_revisions
                     (project_id, revision_no, source, state, effective_date, works_total, note,
                      source_file_name, source_document_path, proposed_by, decided_by, decided_at, adders)
                   VALUES ($1::uuid, $2, $3, 'approved', $4, $5, $6, $7, $8, $9::uuid, $9::uuid, now(), $10::jsonb)
                   RETURNING id""",
                str(project_id), rev_no, body.source, body.effective_date, works,
                (body.note or "").strip() or None, body.source_file_name, body.source_document_path,
                current_user.id, json.dumps(adders))
            for b_pos, b in enumerate(body.bills, 1):
                bill_id = await conn.fetchval(
                    """INSERT INTO project_beme_bills
                         (project_id, revision_id, bill_code, bill_no, sort_order, name, contract_amount)
                       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7) RETURNING id""",
                    str(project_id), rev_id, b.bill_code.strip(), b.bill_no, b.sort_order or b_pos,
                    (b.name or "").strip() or None, b.sheet_total)
                seen: dict[tuple[str, str], int] = {}
                rows = []
                for pos, i in enumerate(b.items, 1):
                    key = (i.item_code or "", i.description)
                    dup = seen.get(key, 0)
                    seen[key] = dup + 1
                    rows.append((str(project_id), bill_id, rev_id, i.item_code or "", i.description.strip(),
                                 (i.unit or "").strip() or None, i.contract_qty, i.rate, i.contract_amount,
                                 dup, i.sort_order or pos))
                if rows:
                    await conn.executemany(
                        """INSERT INTO project_beme_items
                             (project_id, bill_id, revision_id, item_code, description, unit,
                              contract_qty, rate, contract_amount, dup_seq, sort_order)
                           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11)""", rows)
            if prev:
                await conn.execute(
                    "UPDATE project_beme_revisions SET state = 'superseded' WHERE id = $1::uuid AND state = 'approved'",
                    prev["id"])
            await conn.execute(
                "UPDATE projects SET current_beme_revision_id = $2::uuid, updated_at = now() WHERE id = $1::uuid",
                str(project_id), rev_id)

    item_count = sum(len(b.items) for b in body.bills)
    await audit_service.log(
        user_id=current_user.id, user_email=current_user.email, action="bills_revision_recorded",
        table_name="project_beme_revisions", record_id=str(rev_id),
        old_values={"previous_revision_id": str(prev["id"]) if prev else None},
        new_values={"project_id": str(project_id), "revision_no": rev_no, "source": body.source,
                    "effective_date": body.effective_date.isoformat(), "bills": len(body.bills),
                    "items": item_count, "works_total": float(works), "file": body.source_file_name},
        ip_address=get_client_ip(request),
        description=f"bill of quantities revision {rev_no} ({body.source}): {len(body.bills)} bills, "
                    f"{item_count} items, works {works:,.2f} on {project['short_name'] or project['project_name']}")
    logger.info("Bills revision recorded", project_id=str(project_id), revision_no=rev_no,
                bills=len(body.bills), items=item_count, works_total=float(works), by=current_user.email)
    broadcast("projects", "bills_revision")
    return {"success": True, "data": {"id": str(rev_id), "revision_no": rev_no,
                                      "works_total": float(works), "bills": len(body.bills), "items": item_count}}
