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
from app.core.exceptions import AuthorizationError, NotFoundError, ValidationError
from app.core.pool import execute, fetch, fetchrow, get_pool
from app.core.project_scope import project_scope_guard
from app.core.security import CurrentUser, require_admin, require_projects_access, require_projects_read
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
       (SELECT json_build_object('id', r.id, 'revision_no', r.revision_no, 'source', r.source, 'state', r.state,
                                 'effective_date', r.effective_date, 'works_total', r.works_total, 'note', r.note,
                                 'proposed_at', r.proposed_at, 'proposed_by_name', u.full_name,
                                 'proposed_by_email', u.email)
          FROM project_beme_revisions r LEFT JOIN users u ON u.id = r.proposed_by
         WHERE r.project_id = $1::uuid AND r.state = 'pending'
         ORDER BY r.revision_no DESC LIMIT 1) AS pending,
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
        "revision": revision, "bills": bills, "summary": summary,
        "pending": row["pending"], "revisions": row["revisions"]}}


# the same statement for ANY revision of the project (review screen)
_BILLS_SQL_FOR = _BILLS_SQL.replace(
    "(SELECT current_beme_revision_id FROM projects WHERE id = $1::uuid)", "$2::uuid")


async def _pm_user_ids(project_id: UUID) -> list[str]:
    """Who approves: active project managers whose scope covers the project
    (scope 'all' — the General PM — or an open assignment to it)."""
    rows = await fetch(
        """SELECT u.id FROM users u
            WHERE u.role = 'project_manager' AND u.is_active
              AND (u.project_scope = 'all'
                   OR u.id IN (SELECT a.user_id FROM user_project_assignments a
                                WHERE a.project_id = $1::uuid AND a.ended_at IS NULL))""",
        str(project_id))
    return [str(r["id"]) for r in rows]


async def _notify(user_ids: list[str], ntype: str, title: str, message: str,
                  project_id: UUID, action_url: str, data: dict[str, Any] | None = None) -> None:
    """One in-app notification per person; never lets a notification failure
    break the action it reports on."""
    for uid in user_ids:
        try:
            await execute(
                """INSERT INTO notifications
                     (target_user_id, type, title, message, entity_type, entity_id, action_url, action_label, data, read)
                   VALUES ($1::uuid, $2, $3, $4, 'project', $5::uuid, $6, 'Open', $7::jsonb, false)""",
                uid, ntype, title, message, str(project_id), action_url, json.dumps(data or {}))
        except Exception as e:  # noqa: BLE001
            logger.warning("Bills notification failed", user_id=uid, type=ntype, error=str(e))


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
    """Write a new revision (bills + items) in one transaction.

    Rule (decision 2026-10-12): while the current bill is not in use
    (locked_at IS NULL) the new revision is approved at once and becomes
    current; the previous one is superseded; project managers get an
    information notice. Once the bill is in use, the new revision is
    PENDING — the project manager is asked to approve it, and the bill in
    force does not change until they do."""
    project = await _project_or_404(project_id)
    if not any(b.items for b in body.bills):
        raise ValidationError("The bill has no items")
    try:
        adders = validate_adders(body.adders)
    except ValueError as e:
        raise ValidationError(str(e)) from e

    cur = await fetchrow(
        "SELECT id, revision_no, locked_at FROM project_beme_revisions WHERE id = $1::uuid",
        str(project["current_beme_revision_id"])) if project["current_beme_revision_id"] else None
    needs_approval = bool(cur and cur["locked_at"] is not None)
    state = "pending" if needs_approval else "approved"

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
                   VALUES ($1::uuid, $2, $3, $11, $4, $5, $6, $7, $8, $9::uuid,
                           CASE WHEN $11 = 'approved' THEN $9::uuid END,
                           CASE WHEN $11 = 'approved' THEN now() END, $10::jsonb)
                   RETURNING id""",
                str(project_id), rev_no, body.source, body.effective_date, works,
                (body.note or "").strip() or None, body.source_file_name, body.source_document_path,
                current_user.id, json.dumps(adders), state)
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
            if not needs_approval:
                if cur:
                    await conn.execute(
                        "UPDATE project_beme_revisions SET state = 'superseded' WHERE id = $1::uuid AND state = 'approved'",
                        cur["id"])
                await conn.execute(
                    "UPDATE projects SET current_beme_revision_id = $2::uuid, updated_at = now() WHERE id = $1::uuid",
                    str(project_id), rev_id)

    item_count = sum(len(b.items) for b in body.bills)
    pname = project["short_name"] or project["project_name"]
    await audit_service.log(
        user_id=current_user.id, user_email=current_user.email,
        action="bills_revision_proposed" if needs_approval else "bills_revision_recorded",
        table_name="project_beme_revisions", record_id=str(rev_id),
        old_values={"current_revision_id": str(cur["id"]) if cur else None},
        new_values={"project_id": str(project_id), "revision_no": rev_no, "source": body.source, "state": state,
                    "effective_date": body.effective_date.isoformat(), "bills": len(body.bills),
                    "items": item_count, "works_total": float(works), "file": body.source_file_name},
        ip_address=get_client_ip(request),
        description=f"bill of quantities revision {rev_no} ({body.source}, {state}): {len(body.bills)} bills, "
                    f"{item_count} items, works {works:,.2f} on {pname}")
    logger.info("Bills revision recorded", project_id=str(project_id), revision_no=rev_no, state=state,
                bills=len(body.bills), items=item_count, works_total=float(works), by=current_user.email)

    approvers = await _pm_user_ids(project_id)
    if needs_approval:
        await _notify(approvers, "approval_requested",
                      f"Bill revision {rev_no} awaits your approval — {pname}",
                      f"{len(body.bills)} bills, {item_count} items, works {works:,.2f}. Proposed by {current_user.email}."
                      + (f" Note: {body.note.strip()}" if body.note and body.note.strip() else ""),
                      project_id, f"/projects/{project_id}/bills/revisions/{rev_id}",
                      {"revision_id": str(rev_id), "revision_no": rev_no})
    else:
        await _notify(approvers, "info",
                      f"Bill recorded — {pname}",
                      f"Revision {rev_no}: {len(body.bills)} bills, {item_count} items, works {works:,.2f}. "
                      f"Recorded by {current_user.email}; no approval needed until the bill is in use.",
                      project_id, f"/projects/{project_id}/bills",
                      {"revision_id": str(rev_id), "revision_no": rev_no})
    broadcast("projects", "bills_revision")
    return {"success": True, "data": {"id": str(rev_id), "revision_no": rev_no, "state": state,
                                      "works_total": float(works), "bills": len(body.bills), "items": item_count}}


# ── review, approve, reject, lock ──────────────────────────────────────────

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
    current_user: Annotated[CurrentUser, Depends(require_projects_read)],
) -> dict[str, Any]:
    """One revision in full — its bills, its summary — and, when it is not
    the current one, the item-level difference against the current bill."""
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
        diff = diff_bills(cur_row["bills"] or [], bills, cur_rev.get("adders") or [], rev.get("adders") or [])
    for k in ("id", "project_id", "proposed_by", "decided_by"):
        if rev.get(k) is not None:
            rev[k] = str(rev[k])
    return {"success": True, "data": {"revision": rev, "bills": bills, "summary": summary,
                                      "diff": diff, "current_revision_no": current_no}}


class DecisionIn(BaseModel):
    note: str | None = Field(None, max_length=2000)


def _approver(current_user: CurrentUser) -> None:
    if not current_user.is_project_manager:
        raise AuthorizationError("Only a project manager approves or rejects a bill revision")


@router.post("/{project_id}/bills/revisions/{revision_id}/approve")
async def approve_bills_revision(
    project_id: UUID,
    revision_id: UUID,
    body: DecisionIn,
    request: Request,
    current_user: Annotated[CurrentUser, Depends(require_projects_access)],
) -> dict[str, Any]:
    """The project manager makes a pending revision the bill in force."""
    _approver(current_user)
    project = await _project_or_404(project_id)
    rev = await _revision_or_404(project_id, revision_id)
    if rev["state"] != "pending":
        raise ValidationError(f"Revision {rev['revision_no']} is {rev['state']}, not pending")
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            prev_id = project["current_beme_revision_id"]
            await conn.execute(
                """UPDATE project_beme_revisions
                      SET state = 'approved', decided_by = $2::uuid, decided_at = now(),
                          decision_note = $3, locked_at = COALESCE(locked_at, now())
                    WHERE id = $1::uuid""",
                str(revision_id), current_user.id, (body.note or "").strip() or None)
            if prev_id:
                await conn.execute(
                    "UPDATE project_beme_revisions SET state = 'superseded' WHERE id = $1::uuid AND state = 'approved'",
                    str(prev_id))
            await conn.execute(
                "UPDATE projects SET current_beme_revision_id = $2::uuid, updated_at = now() WHERE id = $1::uuid",
                str(project_id), str(revision_id))
    pname = project["short_name"] or project["project_name"]
    await audit_service.log(
        user_id=current_user.id, user_email=current_user.email, action="bills_revision_approved",
        table_name="project_beme_revisions", record_id=str(revision_id),
        old_values={"state": "pending", "current_revision_id": str(project["current_beme_revision_id"]) if project["current_beme_revision_id"] else None},
        new_values={"state": "approved", "revision_no": rev["revision_no"], "note": body.note},
        ip_address=get_client_ip(request),
        description=f"bill revision {rev['revision_no']} approved on {pname}")
    logger.info("Bills revision approved", project_id=str(project_id), revision_no=rev["revision_no"], by=current_user.email)
    if rev.get("proposed_by"):
        await _notify([str(rev["proposed_by"])], "approval_decided",
                      f"Bill revision {rev['revision_no']} approved — {pname}",
                      f"Approved by {current_user.email}." + (f" Note: {body.note.strip()}" if body.note and body.note.strip() else ""),
                      project_id, f"/projects/{project_id}/bills", {"revision_id": str(revision_id), "decision": "approved"})
    broadcast("projects", "bills_revision")
    return {"success": True, "data": {"id": str(revision_id), "revision_no": rev["revision_no"], "state": "approved"}}


@router.post("/{project_id}/bills/revisions/{revision_id}/reject")
async def reject_bills_revision(
    project_id: UUID,
    revision_id: UUID,
    body: DecisionIn,
    request: Request,
    current_user: Annotated[CurrentUser, Depends(require_projects_access)],
) -> dict[str, Any]:
    """The project manager sends a pending revision back, with a reason."""
    _approver(current_user)
    project = await _project_or_404(project_id)
    rev = await _revision_or_404(project_id, revision_id)
    if rev["state"] != "pending":
        raise ValidationError(f"Revision {rev['revision_no']} is {rev['state']}, not pending")
    note = (body.note or "").strip()
    if len(note) < 3:
        raise ValidationError("Say why it is rejected — the admin needs the reason to fix it")
    await execute(
        """UPDATE project_beme_revisions
              SET state = 'rejected', decided_by = $2::uuid, decided_at = now(), decision_note = $3
            WHERE id = $1::uuid""",
        str(revision_id), current_user.id, note)
    pname = project["short_name"] or project["project_name"]
    await audit_service.log(
        user_id=current_user.id, user_email=current_user.email, action="bills_revision_rejected",
        table_name="project_beme_revisions", record_id=str(revision_id),
        old_values={"state": "pending"}, new_values={"state": "rejected", "revision_no": rev["revision_no"], "note": note},
        ip_address=get_client_ip(request),
        description=f"bill revision {rev['revision_no']} rejected on {pname}: {note}")
    logger.info("Bills revision rejected", project_id=str(project_id), revision_no=rev["revision_no"], by=current_user.email)
    if rev.get("proposed_by"):
        await _notify([str(rev["proposed_by"])], "approval_decided",
                      f"Bill revision {rev['revision_no']} rejected — {pname}",
                      f"Rejected by {current_user.email}: {note}",
                      project_id, f"/projects/{project_id}/bills/revisions/{revision_id}",
                      {"revision_id": str(revision_id), "decision": "rejected"})
    broadcast("projects", "bills_revision")
    return {"success": True, "data": {"id": str(revision_id), "revision_no": rev["revision_no"], "state": "rejected"}}


@router.post("/{project_id}/bills/lock")
async def lock_bills(
    project_id: UUID,
    request: Request,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Mark the current bill as in use — sites have started measuring
    against it. From now on every change waits for the project manager.
    (Phase C sets this automatically with the first weekly quantity.)"""
    project = await _project_or_404(project_id)
    rev_id = project["current_beme_revision_id"]
    if rev_id is None:
        raise ValidationError("There is no bill to mark as in use")
    row = await fetchrow(
        """UPDATE project_beme_revisions SET locked_at = COALESCE(locked_at, now())
            WHERE id = $1::uuid RETURNING revision_no, locked_at""", str(rev_id))
    pname = project["short_name"] or project["project_name"]
    await audit_service.log(
        user_id=current_user.id, user_email=current_user.email, action="bills_locked",
        table_name="project_beme_revisions", record_id=str(rev_id),
        new_values={"revision_no": row["revision_no"], "locked_at": row["locked_at"].isoformat()},
        ip_address=get_client_ip(request),
        description=f"bill revision {row['revision_no']} marked in use on {pname}")
    logger.info("Bills locked", project_id=str(project_id), revision_no=row["revision_no"], by=current_user.email)
    broadcast("projects", "bills_locked")
    return {"success": True, "data": {"revision_no": row["revision_no"], "locked_at": row["locked_at"].isoformat()}}
