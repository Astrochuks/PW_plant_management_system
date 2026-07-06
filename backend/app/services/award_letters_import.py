"""Persistence for Award Letters imports (T1.8).

Extracted from the API endpoint so the exact same code path is exercised
by the import endpoint AND by integration tests (which run it inside an
always-rolled-back transaction).

Contract:
  - One transaction on the caller-supplied connection: clean legacy
    reimport (delete legacy projects + unresolved queue rows), upsert
    clients, batch-insert projects, insert review-queue rows linked to
    their project ids. Any failure rolls the whole import back.
  - Never invents data: review items land exactly as the parser emitted
    them, raw values preserved.
"""

from typing import Any

import asyncpg

from app.monitoring.logging import get_logger
from app.services.register_parsing import normalize_client_name

logger = get_logger(__name__)

_UUID_FIELDS = {"state_id", "client_id", "created_by", "updated_by", "import_batch_id"}
_BOOL_FIELDS = {"has_award_letter", "is_legacy"}

#: parser-output keys that are not projects columns
_NON_COLUMN_KEYS = {"state_name", "state_resolution_method"}


async def persist_award_letters(
    conn: asyncpg.Connection,
    parsed: dict[str, Any],
    user_id: str,
) -> dict[str, Any]:
    """Persist a parsed Award Letters workbook. Single transaction.

    Returns stats: deleted, created, clients_upserted, review_queued,
    insert_errors (list).
    """
    projects: list[dict[str, Any]] = parsed["projects"]
    review_items: list[dict[str, Any]] = parsed.get("review_items", [])
    batch_id: str = parsed["import_batch_id"]
    insert_errors: list[dict[str, Any]] = []

    async with conn.transaction():
        # ── lookups ─────────────────────────────────────────────────────
        state_map = {
            r["name"].strip().lower(): str(r["id"])
            for r in await conn.fetch("SELECT id, name FROM states")
        }

        # ── clients upsert ──────────────────────────────────────────────
        distinct: dict[str, str] = {}
        for proj in projects:
            raw = (proj.get("client") or "").strip()
            if raw:
                distinct.setdefault(normalize_client_name(raw), raw)

        clients_upserted = 0
        for norm, raw in distinct.items():
            result = await conn.execute(
                """INSERT INTO clients (name, normalized_name)
                   VALUES ($1, $2) ON CONFLICT (normalized_name) DO NOTHING""",
                raw, norm,
            )
            if result == "INSERT 0 1":
                clients_upserted += 1
        client_map = {
            r["normalized_name"]: str(r["id"])
            for r in await conn.fetch("SELECT id, normalized_name FROM clients")
        }

        # ── enrich rows ─────────────────────────────────────────────────
        for proj in projects:
            state_name = proj.pop("state_name", None)
            proj.pop("state_resolution_method", None)
            if state_name:
                sid = state_map.get(state_name.strip().lower())
                if sid:
                    proj["state_id"] = sid
            client_raw = (proj.get("client") or "").strip()
            if client_raw:
                cid = client_map.get(normalize_client_name(client_raw))
                if cid:
                    proj["client_id"] = cid
            proj["created_by"] = user_id
            proj["updated_by"] = user_id

        # ── clean reimport ──────────────────────────────────────────────
        deleted = await conn.fetchval(
            "WITH d AS (DELETE FROM projects WHERE is_legacy = true RETURNING 1) "
            "SELECT count(*) FROM d"
        )
        # Unresolved queue rows from prior imports are superseded by this
        # parse; resolved rows are kept as an audit trail.
        await conn.execute(
            "DELETE FROM project_register_review_queue WHERE resolved = false"
        )

        # ── batch insert projects ───────────────────────────────────────
        all_cols: set[str] = set()
        for proj in projects:
            all_cols.update(k for k in proj if k not in _NON_COLUMN_KEYS)
        col_list = sorted(all_cols)

        placeholders = []
        for i, col in enumerate(col_list):
            if col in _UUID_FIELDS:
                placeholders.append(f"${i + 1}::uuid")
            elif col in _BOOL_FIELDS:
                placeholders.append(f"${i + 1}::boolean")
            else:
                placeholders.append(f"${i + 1}")
        sql = (
            f"INSERT INTO projects ({', '.join(col_list)}) "
            f"VALUES ({', '.join(placeholders)})"
        )
        args_list = [[proj.get(col) for col in col_list] for proj in projects]

        created = 0
        try:
            async with conn.transaction():  # savepoint
                await conn.executemany(sql, args_list)
            created = len(args_list)
        except Exception:
            # Fall back to row-by-row with individual savepoints so one bad
            # row cannot sink the other 217.
            for proj_args, proj in zip(args_list, projects):
                try:
                    async with conn.transaction():  # savepoint
                        await conn.execute(sql, *proj_args)
                    created += 1
                except Exception as row_err:
                    insert_errors.append({
                        "project_name": str(proj.get("project_name", ""))[:80],
                        "sheet": proj.get("source_sheet"),
                        "error": str(row_err),
                    })

        # ── review queue, linked to project ids ─────────────────────────
        id_map = {
            (r["source_sheet"], r["source_row"]): str(r["id"])
            for r in await conn.fetch(
                "SELECT id, source_sheet, source_row FROM projects "
                "WHERE import_batch_id = $1::uuid",
                batch_id,
            )
        }
        queue_args = [
            (
                batch_id,
                item.get("sheet_name"),
                item.get("row_number"),
                id_map.get((item.get("sheet_name"), item.get("row_number"))),
                item.get("field"),
                item.get("raw_value"),
                item.get("reason"),
                item.get("suggested_value"),
            )
            for item in review_items
        ]
        await conn.executemany(
            """INSERT INTO project_register_review_queue
               (import_batch_id, sheet_name, row_number, project_id,
                field, raw_value, reason, suggested_value)
               VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6, $7, $8)""",
            queue_args,
        )

    return {
        "deleted": deleted,
        "created": created,
        "clients_upserted": clients_upserted,
        "review_queued": len(queue_args),
        "insert_errors": insert_errors,
    }


async def fetch_client_default_states(conn_or_pool: Any) -> dict[str, str]:
    """{normalized_client_name: state_name} for parser fallback resolution."""
    rows = await conn_or_pool.fetch(
        """SELECT c.normalized_name, s.name AS state_name
           FROM clients c JOIN states s ON s.id = c.default_state_id"""
    )
    return {r["normalized_name"]: r["state_name"] for r in rows}
