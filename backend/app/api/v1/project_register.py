"""
Project register — history and the ongoing list (PRD v2 §3.2–3.3, §4–5, §8).

Contract sums and status events are append-only facts entered by the
admin; the database caches the current values onto projects (036) and
refuses edits. These routes add rows, read the merged history, read the
project's audit activity, and answer "which projects were ongoing as at a
date". Mounted under /projects BEFORE the main projects router so that
/projects/ongoing is matched before /projects/{project_id}.
"""

from datetime import date
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from pydantic import BaseModel, Field, field_validator

from app.api.v1.auth import get_client_ip
from app.core.exceptions import NotFoundError, ValidationError
from app.core.pool import fetch, fetchrow
from app.core.project_scope import (
    project_scope_guard,
    scope_condition,
    visible_project_ids,
)
from app.core.security import CurrentUser, require_admin, require_projects_read
from app.monitoring.logging import get_logger
from app.services.audit_service import audit_service

router = APIRouter(dependencies=[Depends(project_scope_guard)])
logger = get_logger(__name__)

STATUSES = (
    "awarded", "mobilised", "active", "suspended",
    "substantially_complete", "finally_complete", "closed",
)
# PRD v2 §4 — what may follow what. 'closed' is reachable from anywhere.
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "awarded": {"mobilised", "active", "closed"},
    "mobilised": {"active", "suspended", "closed"},
    "active": {"suspended", "substantially_complete", "closed"},
    "suspended": {"active", "closed"},
    "substantially_complete": {"finally_complete", "active", "closed"},
    "finally_complete": {"closed"},
    "closed": set(),
}
ONGOING = ("mobilised", "active", "suspended")


def transition_allowed(current: str | None, new: str) -> bool:
    """Pure rule, unit-tested: None (no history yet) may become anything."""
    if current is None:
        return new in STATUSES
    return new in ALLOWED_TRANSITIONS.get(current, set())


# ── request models ─────────────────────────────────────────────────────────

class ContractSumIn(BaseModel):
    kind: Literal["original", "variation", "revision", "correction"]
    amount: float = Field(..., ge=0, description="The RESULTING contract sum, not the delta")
    basis: Literal["all_in", "ex_vat", "unknown"] = "all_in"
    effective_date: date
    instrument_ref: str | None = Field(None, max_length=200)
    document_path: str | None = None
    note: str | None = Field(None, max_length=2000)

    @field_validator("note")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None


class StatusEventIn(BaseModel):
    status: Literal[
        "awarded", "mobilised", "active", "suspended",
        "substantially_complete", "finally_complete", "closed",
    ]
    effective_date: date
    note: str | None = Field(None, max_length=2000)


# ── helpers ────────────────────────────────────────────────────────────────

async def _project_or_404(project_id: UUID) -> dict[str, Any]:
    row = await fetchrow(
        "SELECT id, project_name, short_name, status, status_since, current_contract_sum "
        "FROM projects WHERE id = $1::uuid",
        str(project_id),
    )
    if not row:
        raise NotFoundError("Project", str(project_id))
    return row


def _audit(bg: BackgroundTasks, request: Request, user: CurrentUser, *, action: str,
           table: str, record_id: str, new: dict[str, Any], old: dict[str, Any] | None,
           description: str) -> None:
    bg.add_task(
        audit_service.log,
        user_id=user.id, user_email=user.email, action=action, table_name=table,
        record_id=record_id, old_values=old, new_values=new,
        ip_address=get_client_ip(request), user_agent=request.headers.get("user-agent"),
        description=description,
    )


# ── the ongoing list ───────────────────────────────────────────────────────

@router.get("/ongoing")
async def list_ongoing(
    current_user: Annotated[CurrentUser, Depends(require_projects_read)],
    as_at: date | None = Query(None, description="Defaults to today"),
) -> dict[str, Any]:
    """The head-office 'ongoing projects' list, as at any date: status and
    contract sum are both read from history as they stood on that day."""
    at = as_at or date.today()
    ids = await visible_project_ids(current_user)
    params: list[Any] = [at]
    scope = scope_condition(ids, "p.id", params)
    rows = await fetch(
        f"""WITH st AS (
              SELECT DISTINCT ON (project_id) project_id, status, effective_date
                FROM project_status_events
               WHERE effective_date <= $1
               ORDER BY project_id, effective_date DESC, created_at DESC),
            cs AS (
              SELECT DISTINCT ON (project_id) project_id, amount, basis, kind
                FROM project_contract_sums
               WHERE effective_date <= $1
               ORDER BY project_id, effective_date DESC, created_at DESC)
            SELECT p.id, p.project_name, p.short_name, p.client, p.project_type,
                   s.name AS state_name,
                   st.status::text AS status, st.effective_date AS status_since,
                   cs.amount AS contract_sum, cs.basis::text AS contract_sum_basis,
                   cs.kind::text AS contract_sum_kind
              FROM projects p
              JOIN st ON st.project_id = p.id
              LEFT JOIN cs ON cs.project_id = p.id
              LEFT JOIN states s ON s.id = p.state_id
             WHERE st.status IN ('mobilised', 'active', 'suspended')
               AND {scope}
             ORDER BY s.name NULLS LAST, p.short_name NULLS LAST, p.project_name""",
        *params,
    )
    total = sum(float(r["contract_sum"] or 0) for r in rows)
    return {"success": True, "data": rows,
            "meta": {"as_at": at.isoformat(), "count": len(rows), "total_contract_sum": total}}


# ── history & activity ─────────────────────────────────────────────────────

@router.get("/{project_id}/history")
async def project_history(
    project_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_projects_read)],
) -> dict[str, Any]:
    """Contract sums and status events merged, newest first, with who and
    when. Deltas and the 'current' marker come from v_project_contract_sums."""
    await _project_or_404(project_id)
    sums = await fetch(
        """SELECT v.id, 'contract_sum' AS entry_type, v.kind::text AS label,
                  v.amount, v.delta, v.basis::text AS basis, v.is_current,
                  v.effective_date, v.instrument_ref, v.document_path, v.note,
                  v.created_at, u.full_name AS created_by_name, u.email AS created_by_email
             FROM v_project_contract_sums v
             LEFT JOIN users u ON u.id = v.created_by
            WHERE v.project_id = $1::uuid""",
        str(project_id),
    )
    events = await fetch(
        """SELECT e.id, 'status' AS entry_type, e.status::text AS label,
                  NULL::numeric AS amount, NULL::numeric AS delta, NULL::text AS basis,
                  (row_number() OVER (ORDER BY e.effective_date DESC, e.created_at DESC) = 1) AS is_current,
                  e.effective_date, NULL::text AS instrument_ref, NULL::text AS document_path,
                  e.note, e.created_at, u.full_name AS created_by_name, u.email AS created_by_email
             FROM project_status_events e
             LEFT JOIN users u ON u.id = e.created_by
            WHERE e.project_id = $1::uuid""",
        str(project_id),
    )
    merged = sorted(sums + events,
                    key=lambda r: (str(r["effective_date"]), str(r["created_at"])), reverse=True)
    return {"success": True, "data": merged}


@router.get("/{project_id}/activity")
async def project_activity(
    project_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_projects_read)],
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, Any]:
    """Who did what on this project: audit rows keyed to it. A site
    engineer sees only their own actions (PRD v2 §11 D2)."""
    await _project_or_404(project_id)
    params: list[Any] = [str(project_id), limit]
    own = ""
    if current_user.is_site_engineer:
        params.append(current_user.id)
        own = f"AND a.user_id = ${len(params)}::uuid"
    rows = await fetch(
        f"""SELECT a.id, a.action, a.table_name, a.record_id, a.description,
                   a.old_values, a.new_values, a.user_email, a.created_at
              FROM audit_logs a
             WHERE (a.record_id = $1
                    OR a.new_values->>'project_id' = $1
                    OR a.old_values->>'project_id' = $1)
               {own}
             ORDER BY a.created_at DESC
             LIMIT $2""",
        *params,
    )
    return {"success": True, "data": rows}


# ── adding history (admin) ─────────────────────────────────────────────────

@router.post("/{project_id}/contract-sums", status_code=201)
async def add_contract_sum(
    project_id: UUID,
    body: ContractSumIn,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Record a contract-sum instrument. Saved at once (no approval — PRD
    v2 §6); the trigger moves projects.current_contract_sum."""
    project = await _project_or_404(project_id)
    if body.kind == "correction" and not body.note:
        raise ValidationError("A correction must say what it corrects (note required)")
    has_original = await fetchrow(
        "SELECT 1 FROM project_contract_sums WHERE project_id = $1::uuid AND kind = 'original'",
        str(project_id),
    )
    if body.kind == "original" and has_original:
        raise ValidationError("This project already has an original contract sum; "
                              "record a variation, revision or correction instead")
    if body.kind != "original" and not has_original:
        raise ValidationError("Record the original contract sum before a variation or correction")

    row = await fetchrow(
        """INSERT INTO project_contract_sums
             (project_id, kind, amount, basis, effective_date, instrument_ref,
              document_path, note, created_by)
           VALUES ($1::uuid, $2::contract_sum_kind, $3, $4::contract_sum_basis, $5, $6, $7, $8, $9::uuid)
           RETURNING *""",
        str(project_id), body.kind, body.amount, body.basis, body.effective_date,
        body.instrument_ref, body.document_path, body.note, current_user.id,
    )
    after = await fetchrow(
        "SELECT current_contract_sum FROM projects WHERE id = $1::uuid", str(project_id))
    _audit(background_tasks, request, current_user,
           action="contract_sum_added", table="project_contract_sums", record_id=str(project_id),
           old={"current_contract_sum": float(project["current_contract_sum"] or 0)},
           new={"project_id": str(project_id), "id": str(row["id"]), "kind": body.kind,
                "amount": body.amount, "basis": body.basis,
                "effective_date": body.effective_date.isoformat(),
                "instrument_ref": body.instrument_ref},
           description=f"{body.kind} contract sum {body.amount:,.2f} ({body.basis}) "
                       f"effective {body.effective_date} on {project['short_name'] or project['project_name']}")
    logger.info("Contract sum recorded", project_id=str(project_id), kind=body.kind,
                amount=body.amount, by=current_user.email)
    return {"success": True, "data": row,
            "meta": {"current_contract_sum": float(after["current_contract_sum"] or 0)}}


@router.post("/{project_id}/status-events", status_code=201)
async def add_status_event(
    project_id: UUID,
    body: StatusEventIn,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Move the project through its lifecycle (PRD v2 §4). Saved at once;
    the trigger moves projects.status / status_since. Backdating is allowed
    — the transition is checked against the status as at that date."""
    project = await _project_or_404(project_id)
    before = await fetchrow(
        "SELECT project_status_as_at($1::uuid, $2)::text AS status", str(project_id), body.effective_date)
    current = before["status"] if before else None
    if not transition_allowed(current, body.status):
        raise ValidationError(
            f"Cannot move from '{current or 'no status'}' to '{body.status}' "
            f"(as at {body.effective_date}); allowed: "
            f"{', '.join(sorted(ALLOWED_TRANSITIONS.get(current or '', set()))) or 'none'}")

    row = await fetchrow(
        """INSERT INTO project_status_events (project_id, status, effective_date, note, created_by)
           VALUES ($1::uuid, $2::project_status, $3, $4, $5::uuid) RETURNING *""",
        str(project_id), body.status, body.effective_date, (body.note or "").strip() or None,
        current_user.id,
    )
    after = await fetchrow(
        "SELECT status, status_since FROM projects WHERE id = $1::uuid", str(project_id))
    _audit(background_tasks, request, current_user,
           action="status_changed", table="project_status_events", record_id=str(project_id),
           old={"status": project["status"], "status_since": str(project["status_since"])},
           new={"project_id": str(project_id), "id": str(row["id"]), "status": body.status,
                "effective_date": body.effective_date.isoformat(), "note": body.note},
           description=f"status → {body.status} effective {body.effective_date} "
                       f"on {project['short_name'] or project['project_name']}")
    logger.info("Project status recorded", project_id=str(project_id), status=body.status,
                effective=str(body.effective_date), by=current_user.email)
    return {"success": True, "data": row,
            "meta": {"status": after["status"], "status_since": str(after["status_since"])}}
