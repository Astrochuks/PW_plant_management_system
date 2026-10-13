"""Bill of quantities per project — read the current revision, preview an
import, record a revision (PRD v2 §3.6; decision 2026-10-12, milestone A).

A project's bill is a numbered revision (migration 044). Read: one SQL
statement returns the current revision, its bills with items in sheet
order, and (admin only) the list of every snapshot. Import: the uploaded
.xlsx — or a weekly workbook already in storage — is parsed with the
deterministic BEME parser (no AI, CLAUDE.md rule 8), the file is kept in
the private 'reports' bucket, and the admin sees our Σ per bill against
the sheet's own totals before anything is saved. Record: a new revision
is written in one transaction and becomes the bill everyone sees; the
previous one stays on record, superseded, for the admin to open and
download. No approval step (decision 2026-10-12: only an admin changes a
bill, and every change is a dated snapshot).

Log phrases: "Bills import previewed", "Bills revision recorded", "Bills adders set".
"""

from __future__ import annotations

import io
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
from app.services.bills_diff import diff_bills
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
                   'source_file_name', r.source_file_name, 'created_at', r.created_at,
                   'recorded_by_name', u.full_name, 'recorded_by_email', u.email)
                 ORDER BY r.revision_no DESC)
          FROM project_beme_revisions r LEFT JOIN users u ON u.id = r.proposed_by
         WHERE r.project_id = $1::uuid), '[]'::json) AS revisions
"""


# ── read ───────────────────────────────────────────────────────────────────

@router.get("/{project_id}/bills")
async def project_bills(
    project_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_projects_read)],
) -> dict[str, Any]:
    """The project's current bill of quantities: revision, bills with items
    in sheet order, and — for admins only — the list of every snapshot
    (decision 2026-10-12: previous bills are the admin's to see). One
    statement."""
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
        "revision": revision, "bills": bills, "summary": summary,
        "revisions": row["revisions"] if current_user.is_admin else []}}


# the same statement for ANY revision of the project (the admin's history view)
_BILLS_SQL_FOR = _BILLS_SQL.replace(
    "(SELECT current_beme_revision_id FROM projects WHERE id = $1::uuid)", "$2::uuid")


# ── adders on the current revision ─────────────────────────────────────────

@router.patch("/{project_id}/bills/adders")
async def set_bills_adders(
    project_id: UUID,
    body: AddersIn,
    request: Request,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Set the ladder under the works total on the project's current bill.
    Admin only; the change is audited."""
    project = await _project_or_404(project_id)
    rev_id = project["current_beme_revision_id"]
    if rev_id is None:
        raise ValidationError("Record the bill first; adders belong to a bill revision")
    try:
        clean = validate_adders(body.adders)
    except ValueError as e:
        raise ValidationError(str(e)) from e
    before = await fetchrow("SELECT adders FROM project_beme_revisions WHERE id = $1::uuid", str(rev_id))
    await fetchrow(
        "UPDATE project_beme_revisions SET adders = $2::jsonb WHERE id = $1::uuid RETURNING id",
        str(rev_id), clean)  # list, not json.dumps — see record_bills_revision
    await audit_service.log(
        user_id=current_user.id, user_email=current_user.email, action="boq_adders_set",
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

    sheet, preview = _parse_bill_workbook(content)

    # keep the file as the revision's evidence
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

    logger.info("Bills import previewed", project_id=str(project_id), sheet=sheet, origin="upload",
                bills=preview["bill_count"], items=preview["item_count"],
                works_total=preview["works_total"], mismatched=len(preview["mismatched_bills"]),
                by=current_user.email)
    return {"success": True, "data": {
        **preview, "sheet": sheet, "file_name": name, "source_document_path": storage_path,
        "project": {"id": project["id"], "short_name": project["short_name"]},
    }}


def _parse_bill_workbook(content: bytes) -> tuple[str, dict[str, Any]]:
    """Open the workbook, run the deterministic BEME parser on every sheet,
    keep the one that holds the bill. Raises ValidationError with the real
    reason when nothing usable is found."""
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
    return sheet, shape_preview(parsed_by_sheet[sheet])


class FromSubmissionIn(BaseModel):
    submission_id: UUID


@router.post("/{project_id}/bills/import-from-submission")
async def preview_bills_from_submission(
    project_id: UUID,
    body: FromSubmissionIn,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """The second door: read the BEME sheet of a weekly workbook this project
    already uploaded (contract columns only) and return the same preview.
    The revision points at the workbook already in storage — no re-upload."""
    project = await _project_or_404(project_id)
    sub = await fetchrow(
        """SELECT id, file_name, file_path, year, week_number, week_ending_date, status
             FROM project_report_submissions
            WHERE id = $1::uuid AND project_id = $2::uuid""",
        str(body.submission_id), str(project_id))
    if not sub:
        raise NotFoundError("Submission", str(body.submission_id))
    if not sub["file_path"]:
        raise ValidationError("That submission has no file in storage")
    from app.core.database import get_supabase_admin_client  # Storage only
    try:
        content = get_supabase_admin_client().storage.from_("reports").download(sub["file_path"])
    except Exception as e:  # noqa: BLE001
        logger.error("Workbook download failed", path=sub["file_path"], error=f"{type(e).__name__}: {e}")
        raise ValidationError(f"Could not read the workbook from storage: {e}") from e
    if not content:
        raise ValidationError("The stored workbook is empty")

    sheet, preview = _parse_bill_workbook(content)
    week = f"W{int(sub['week_number']):02d} {sub['year']}" if sub["week_number"] else ""
    logger.info("Bills import previewed", project_id=str(project_id), sheet=sheet, origin="submission",
                submission_id=str(sub["id"]), bills=preview["bill_count"], items=preview["item_count"],
                works_total=preview["works_total"], mismatched=len(preview["mismatched_bills"]),
                by=current_user.email)
    return {"success": True, "data": {
        **preview, "sheet": sheet, "file_name": sub["file_name"] or "weekly workbook",
        "source_document_path": sub["file_path"], "from_week": week,
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
    the bill everyone sees. The previous revision stays on record,
    superseded — the admin can open and download it."""
    project = await _project_or_404(project_id)
    if not any(b.items for b in body.bills):
        raise ValidationError("The bill has no items")
    try:
        adders = validate_adders(body.adders)
    except ValueError as e:
        raise ValidationError(str(e)) from e

    cur_id = project["current_beme_revision_id"]
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
                current_user.id, adders)  # the pool's jsonb codec encodes the list; a json.dumps here stores a quoted string
            # all bills in ONE statement, all items in ONE batch — a save is a
            # handful of round trips however many bills it has (from the
            # laptop each round trip to the EU pooler is 0.5–1 s)
            codes = [b.bill_code.strip() for b in body.bills]
            if len(set(codes)) != len(codes):
                raise ValidationError("Two bills carry the same code")
            bill_rows = await conn.fetch(
                """INSERT INTO project_beme_bills
                     (project_id, revision_id, bill_code, bill_no, sort_order, name, contract_amount)
                   SELECT $1::uuid, $2::uuid, c, n, s, nm, t
                     FROM unnest($3::text[], $4::int[], $5::int[], $6::text[], $7::numeric[]) AS u(c, n, s, nm, t)
                   RETURNING id, bill_code""",
                str(project_id), rev_id, codes,
                [b.bill_no for b in body.bills],
                [b.sort_order or pos for pos, b in enumerate(body.bills, 1)],
                [(b.name or "").strip() or None for b in body.bills],
                [None if b.sheet_total is None else Decimal(str(b.sheet_total)) for b in body.bills])
            bill_ids = {r["bill_code"]: r["id"] for r in bill_rows}
            rows = []
            for b in body.bills:
                seen: dict[tuple[str, str], int] = {}
                for pos, i in enumerate(b.items, 1):
                    key = (i.item_code or "", i.description.strip())
                    dup = seen.get(key, 0)
                    seen[key] = dup + 1
                    rows.append((str(project_id), bill_ids[b.bill_code.strip()], rev_id, i.item_code or "",
                                 i.description.strip(), (i.unit or "").strip() or None, i.contract_qty, i.rate,
                                 i.contract_amount, dup, i.sort_order or pos))
            if rows:
                await conn.executemany(
                    """INSERT INTO project_beme_items
                         (project_id, bill_id, revision_id, item_code, description, unit,
                          contract_qty, rate, contract_amount, dup_seq, sort_order)
                       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11)""", rows)
            # the new snapshot is the bill everyone sees; the old one stays on
            # record for the admin (decision 2026-10-12: no approval step)
            if cur_id:
                await conn.execute(
                    "UPDATE project_beme_revisions SET state = 'superseded' WHERE id = $1::uuid AND state = 'approved'",
                    str(cur_id))
            await conn.execute(
                "UPDATE projects SET current_beme_revision_id = $2::uuid, updated_at = now() WHERE id = $1::uuid",
                str(project_id), rev_id)

    item_count = sum(len(b.items) for b in body.bills)
    pname = project["short_name"] or project["project_name"]
    await audit_service.log(
        user_id=current_user.id, user_email=current_user.email, action="boq_revision_saved",
        table_name="project_beme_revisions", record_id=str(rev_id),
        old_values={"current_revision_id": str(cur_id) if cur_id else None},
        new_values={"project_id": str(project_id), "revision_no": rev_no, "source": body.source,
                    "effective_date": body.effective_date.isoformat(), "bills": len(body.bills),
                    "items": item_count, "works_total": float(works), "file": body.source_file_name},
        ip_address=get_client_ip(request),
        description=f"bill of quantities revision {rev_no} ({body.source}): {len(body.bills)} bills, "
                    f"{item_count} items, works {works:,.2f} on {pname}")
    logger.info("Bills revision recorded", project_id=str(project_id), revision_no=rev_no,
                bills=len(body.bills), items=item_count, works_total=float(works), by=current_user.email)
    broadcast("projects", "bills_revision")
    return {"success": True, "data": {"id": str(rev_id), "revision_no": rev_no,
                                      "works_total": float(works), "bills": len(body.bills), "items": item_count}}


# ── a previous snapshot, in full (admin) ───────────────────────────────────

async def _revision_or_404(project_id: UUID, revision_id: UUID) -> dict[str, Any]:
    row = await fetchrow(
        """SELECT r.*, pu.full_name AS proposed_by_name, pu.email AS proposed_by_email,
                  du.full_name AS decided_by_name, du.email AS decided_by_email
             FROM project_beme_revisions r
             LEFT JOIN users pu ON pu.id = r.proposed_by
             LEFT JOIN users du ON du.id = r.decided_by
            WHERE r.id = $1::uuid AND r.project_id = $2::uuid""",
        str(revision_id), str(project_id))
    if not row:
        raise NotFoundError("Bill revision", str(revision_id))
    return dict(row)


@router.get("/{project_id}/bills/revisions/{revision_id}")
async def bills_revision_detail(
    project_id: UUID,
    revision_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """One snapshot in full — its bills, its summary — and, when it is not
    the current one, the item-level difference against the current bill.
    Admin only: previous bills are the admin's to see and download."""
    project = await _project_or_404(project_id)
    rev = await _revision_or_404(project_id, revision_id)
    row = await fetchrow(_BILLS_SQL_FOR, str(project_id), str(revision_id))
    bills = row["bills"] or []
    summary = compute_summary(
        [{"bill_code": b["bill_code"], "name": b["name"], "amount": b["items_total"]} for b in bills],
        rev.get("adders") or [])
    diff = None
    current_no = None
    if project["current_beme_revision_id"] and str(project["current_beme_revision_id"]) != str(revision_id):
        cur_row = await fetchrow(_BILLS_SQL, str(project_id))
        cur_rev = cur_row["revision"] or {}
        current_no = cur_rev.get("revision_no")
        # reading order: FROM this version TO the current bill — 'old' is this
        # version, 'new' is what is in force now, and works_delta is what the
        # current bill added since this version
        diff = diff_bills(bills, cur_row["bills"] or [], rev.get("adders") or [], cur_rev.get("adders") or [])
    for k in ("id", "project_id", "proposed_by", "decided_by"):
        if rev.get(k) is not None:
            rev[k] = str(rev[k])
    return {"success": True, "data": {"revision": rev, "bills": bills, "summary": summary,
                                      "diff": diff, "current_revision_no": current_no}}


# ── progress by bill (the Overview) ────────────────────────────────────────

_PROGRESS_SQL = """
WITH cur AS (SELECT current_beme_revision_id AS rid FROM projects WHERE id = $1::uuid),
weeks AS (
  SELECT id, year, week_number, week_ending_date
    FROM project_weekly_reports WHERE project_id = $1::uuid AND status = 'completed'),
latest AS (SELECT * FROM weeks ORDER BY week_ending_date DESC NULLS LAST LIMIT 1),
per_bill AS (
  SELECT b.bill_code, b.name, b.sort_order,
         COALESCE((SELECT sum(i.contract_amount) FROM project_beme_items i WHERE i.bill_id = b.id), 0) AS amount,
         COALESCE((SELECT sum(p.amount_this_week)
                     FROM project_beme_progress p
                     JOIN project_beme_items i ON i.id = p.item_id
                     JOIN weeks w ON w.id = p.weekly_report_id
                    WHERE i.bill_id = b.id), 0) AS to_date,
         COALESCE((SELECT sum(p.amount_this_week)
                     FROM project_beme_progress p
                     JOIN project_beme_items i ON i.id = p.item_id
                     JOIN latest l ON l.id = p.weekly_report_id
                    WHERE i.bill_id = b.id), 0) AS this_week
    FROM project_beme_bills b JOIN cur ON b.revision_id = cur.rid)
SELECT (SELECT row_to_json(latest) FROM latest) AS latest_week,
       (SELECT count(*) FROM weeks)::int AS weeks_on_file,
       COALESCE((SELECT json_agg(per_bill ORDER BY sort_order NULLS LAST, bill_code) FROM per_bill), '[]'::json) AS bills
"""


@router.get("/{project_id}/bills/progress")
async def bills_progress(
    project_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_projects_read)],
) -> dict[str, Any]:
    """Progress by bill for the Overview: per bill of the current revision,
    the bill amount, what was done in the latest week on file and the sum
    of every week on file (never the workbook's own 'to date'). One
    statement; dashes on the page when there is no bill or no week yet."""
    await _project_or_404(project_id)
    row = await fetchrow(_PROGRESS_SQL, str(project_id))
    return {"success": True, "data": {
        "latest_week": row["latest_week"], "weeks_on_file": row["weeks_on_file"], "bills": row["bills"]}}
