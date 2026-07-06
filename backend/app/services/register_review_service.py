"""Review-queue workflow for the project register (T1.10).

Resolving an item writes the corrected value to the right projects
column (with per-field coercion), marks the item resolved, and preserves
what was applied. Dismissing marks resolved without touching the project
("the raw value is fine as-is / leave blank").

All functions take an asyncpg connection so tests can run them inside a
rolled-back transaction. The API layer is a thin wrapper.
"""

from datetime import date, datetime, timezone
from typing import Any

import asyncpg

from app.core.exceptions import NotFoundError, ValidationError
from app.monitoring.logging import get_logger
from app.services.register_parsing import (
    PROJECT_TYPES,
    STATE_CANONICAL,
    WORK_NATURES,
)

logger = get_logger(__name__)

#: queue field → projects column + coercion kind
_FIELD_TARGETS: dict[str, tuple[str, str]] = {
    "award_date": ("award_date", "date"),
    "commencement_date": ("commencement_date", "date"),
    "substantial_completion_date": ("substantial_completion_date", "date"),
    "final_completion_date": ("final_completion_date", "date"),
    "maintenance_cert_date": ("maintenance_cert_date", "date"),
    "retention_application_date": ("retention_application_date", "date"),
    "state": ("state_id", "state"),
    "contract_sum": ("original_contract_sum", "number"),
    "variation_sum": ("variation_sum", "number"),
    "client": ("client", "client"),
    "retention_paid": ("retention_paid", "yes_no"),
    "classification": ("", "classification"),  # writes two columns
    "substantial_completion_cert": ("substantial_completion_cert", "text"),
    "final_completion_cert": ("final_completion_cert", "text"),
    "maintenance_cert": ("maintenance_cert", "text"),
}


def _coerce(kind: str, value: str) -> Any:
    """Validate + convert a resolution value. Raises ValidationError."""
    v = value.strip()
    if kind == "date":
        try:
            return datetime.strptime(v, "%Y-%m-%d").date()
        except ValueError as exc:
            raise ValidationError(f"Expected YYYY-MM-DD date, got {v!r}") from exc
    if kind == "number":
        try:
            return float(v.replace(",", ""))
        except ValueError as exc:
            raise ValidationError(f"Expected a number, got {v!r}") from exc
    if kind == "yes_no":
        if v.lower() not in ("yes", "no"):
            raise ValidationError("retention_paid must be 'yes' or 'no'")
        return v.lower()
    if kind == "text":
        return v.lower()[:50]
    raise ValidationError(f"Unsupported coercion kind {kind!r}")


async def list_review_queue(
    conn: asyncpg.Connection,
    *,
    sheet: str | None = None,
    reason: str | None = None,
    field: str | None = None,
    resolved: bool | None = False,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    conditions, args = [], []
    if sheet:
        args.append(sheet)
        conditions.append(f"q.sheet_name = ${len(args)}")
    if reason:
        args.append(reason)
        conditions.append(f"q.reason = ${len(args)}")
    if field:
        args.append(field)
        conditions.append(f"q.field = ${len(args)}")
    if resolved is not None:
        args.append(resolved)
        conditions.append(f"q.resolved = ${len(args)}")
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    args.append(page_size)
    limit_pos = len(args)
    args.append((page - 1) * page_size)
    offset_pos = len(args)

    rows = await conn.fetch(
        f"""SELECT q.*, p.project_name, count(*) OVER() AS _total_count
            FROM project_register_review_queue q
            LEFT JOIN projects p ON p.id = q.project_id
            {where}
            ORDER BY q.sheet_name, q.row_number, q.field
            LIMIT ${limit_pos} OFFSET ${offset_pos}""",
        *args,
    )
    total = rows[0]["_total_count"] if rows else 0
    items = [{k: v for k, v in dict(r).items() if k != "_total_count"} for r in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


async def summarize_review_queue(conn: asyncpg.Connection) -> dict[str, Any]:
    by_sheet = await conn.fetch(
        """SELECT sheet_name, count(*) AS n FROM project_register_review_queue
           WHERE resolved = false GROUP BY sheet_name ORDER BY sheet_name"""
    )
    by_reason = await conn.fetch(
        """SELECT reason, count(*) AS n FROM project_register_review_queue
           WHERE resolved = false GROUP BY reason ORDER BY n DESC"""
    )
    by_field = await conn.fetch(
        """SELECT field, count(*) AS n FROM project_register_review_queue
           WHERE resolved = false GROUP BY field ORDER BY n DESC"""
    )
    open_total = await conn.fetchval(
        "SELECT count(*) FROM project_register_review_queue WHERE resolved = false"
    )
    return {
        "open_total": open_total,
        "by_sheet": [dict(r) for r in by_sheet],
        "by_reason": [dict(r) for r in by_reason],
        "by_field": [dict(r) for r in by_field],
    }


async def resolve_review_item(
    conn: asyncpg.Connection,
    item_id: str,
    user_id: str,
    value: str | None,
) -> dict[str, Any]:
    """Resolve one queue item.

    value=None → dismiss (mark resolved, project untouched).
    value=str  → coerce per field kind, write to the project, mark resolved.
    """
    async with conn.transaction():
        item = await conn.fetchrow(
            "SELECT * FROM project_register_review_queue WHERE id = $1::uuid",
            item_id,
        )
        if item is None:
            raise NotFoundError(f"Review item {item_id} not found")
        if item["resolved"]:
            raise ValidationError("Item is already resolved")

        applied: dict[str, Any] = {}
        if value is not None and value.strip():
            if item["project_id"] is None:
                raise ValidationError(
                    "Item is not linked to a project (project was deleted); "
                    "dismiss it instead"
                )
            field = item["field"]
            target = _FIELD_TARGETS.get(field)
            if target is None:
                raise ValidationError(
                    f"Field {field!r} cannot be auto-applied; edit the project "
                    "directly and dismiss this item"
                )
            column, kind = target

            if kind == "state":
                canonical = STATE_CANONICAL.get(value.strip().lower())
                if canonical is None:
                    raise ValidationError(f"Unknown state {value!r}")
                state_id = await conn.fetchval(
                    "SELECT id FROM states WHERE lower(name) = lower($1)", canonical
                )
                if state_id is None:
                    raise ValidationError(f"State {canonical!r} not in states table")
                await conn.execute(
                    "UPDATE projects SET state_id = $1::uuid, updated_by = $2::uuid, "
                    "updated_at = now() WHERE id = $3::uuid",
                    str(state_id), user_id, str(item["project_id"]),
                )
                applied = {"state_id": str(state_id), "state": canonical}

            elif kind == "classification":
                parts = [p.strip().lower() for p in value.split("/")]
                if len(parts) != 2 or parts[0] not in PROJECT_TYPES or parts[1] not in WORK_NATURES:
                    raise ValidationError(
                        "classification must be 'type/nature', e.g. 'road/rehabilitation'"
                    )
                await conn.execute(
                    "UPDATE projects SET project_type = $1, work_nature = $2, "
                    "updated_by = $3::uuid, updated_at = now() WHERE id = $4::uuid",
                    parts[0], parts[1], user_id, str(item["project_id"]),
                )
                applied = {"project_type": parts[0], "work_nature": parts[1]}

            elif kind == "client":
                from app.services.register_parsing import normalize_client_name

                display = value.strip()
                client_id = await conn.fetchval(
                    """INSERT INTO clients (name, normalized_name)
                       VALUES ($1, $2)
                       ON CONFLICT (normalized_name) DO UPDATE SET updated_at = now()
                       RETURNING id""",
                    display, normalize_client_name(display),
                )
                await conn.execute(
                    "UPDATE projects SET client = $1, client_id = $2::uuid, "
                    "updated_by = $3::uuid, updated_at = now() WHERE id = $4::uuid",
                    display, str(client_id), user_id, str(item["project_id"]),
                )
                applied = {"client": display, "client_id": str(client_id)}

            elif column in ("original_contract_sum", "variation_sum"):
                coerced = _coerce(kind, value)
                other = (
                    "variation_sum"
                    if column == "original_contract_sum"
                    else "original_contract_sum"
                )
                await conn.execute(
                    f"UPDATE projects SET {column} = $1, "
                    f"current_contract_sum = $1 + COALESCE({other}, 0), "
                    f"updated_by = $2::uuid, updated_at = now() WHERE id = $3::uuid",
                    coerced, user_id, str(item["project_id"]),
                )
                applied = {column: str(coerced), "current_contract_sum": "recomputed"}

            else:
                coerced = _coerce(kind, value)
                await conn.execute(
                    f"UPDATE projects SET {column} = $1, updated_by = $2::uuid, "
                    f"updated_at = now() WHERE id = $3::uuid",
                    coerced, user_id, str(item["project_id"]),
                )
                applied = {column: str(coerced)}

        await conn.execute(
            """UPDATE project_register_review_queue
               SET resolved = true, resolved_by = $1::uuid,
                   resolved_at = $2, resolution_value = $3
               WHERE id = $4::uuid""",
            user_id, datetime.now(timezone.utc), value, item_id,
        )

    return {"id": item_id, "applied": applied, "dismissed": value is None or not value.strip()}


async def bulk_dismiss(
    conn: asyncpg.Connection,
    user_id: str,
    *,
    reason: str,
    field: str | None = None,
) -> int:
    """Dismiss every unresolved item with the given reason (and optional
    field) — e.g. all 46 'Ongoing' narrative_status rows in one action.
    Projects are untouched; raw values remain on the items as audit."""
    conditions = ["resolved = false", "reason = $2"]
    args: list[Any] = [user_id, reason]
    if field:
        args.append(field)
        conditions.append(f"field = ${len(args)}")
    result = await conn.execute(
        f"""UPDATE project_register_review_queue
            SET resolved = true, resolved_by = $1::uuid, resolved_at = now(),
                resolution_value = NULL
            WHERE {' AND '.join(conditions)}""",
        *args,
    )
    return int(result.split()[-1])
