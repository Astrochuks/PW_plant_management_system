"""T1.2 — schema assertions for migration 008 (projects register upgrade).

Read-only checks against the real database: tables, columns, constraints
and indexes the rest of Phase 1 depends on. If someone drops or renames
any of this, these tests point at the exact missing piece.
"""

import pytest

EXPECTED_PROJECT_COLUMNS = {
    "client_id": "uuid",
    "location_id": "uuid",
    "project_type": "text",
    "work_nature": "text",
    "scope_quantity": "numeric",
    "scope_unit": "text",
    "register_source": "text",
    "apg_amount": "numeric",
    "apg_expiry": "date",
    "apg_renewal_expiry": "date",
}

EXPECTED_QUEUE_COLUMNS = {
    "id", "import_batch_id", "sheet_name", "row_number", "project_id",
    "field", "raw_value", "reason", "suggested_value", "resolved",
    "resolved_by", "resolved_at", "resolution_value", "created_at",
}


async def _columns(db_conn, table: str) -> dict[str, str]:
    rows = await db_conn.fetch(
        """SELECT column_name, data_type FROM information_schema.columns
           WHERE table_schema='public' AND table_name=$1""",
        table,
    )
    return {r["column_name"]: r["data_type"] for r in rows}


async def test_clients_table_exists_with_unique_normalized_name(db_conn):
    cols = await _columns(db_conn, "clients")
    assert {"id", "name", "normalized_name", "client_type", "default_state_id"} <= set(cols)

    unique = await db_conn.fetchval(
        """SELECT count(*) FROM information_schema.table_constraints
           WHERE table_name='clients' AND constraint_type='UNIQUE'"""
    )
    assert unique >= 1, "clients.normalized_name must be UNIQUE"


async def test_projects_register_columns(db_conn):
    cols = await _columns(db_conn, "projects")
    for name, dtype in EXPECTED_PROJECT_COLUMNS.items():
        assert name in cols, f"projects.{name} missing"
        assert cols[name] == dtype, f"projects.{name}: {cols[name]} != {dtype}"


async def test_project_type_check_constraint_enforced(db_conn):
    """CHECK constraints must actually reject junk (runs inside the
    rolled-back test transaction — nothing persists)."""
    import asyncpg

    with pytest.raises(asyncpg.CheckViolationError):
        await db_conn.execute(
            "UPDATE projects SET project_type='skyscraper' WHERE is_legacy = true"
        )


async def test_review_queue_table(db_conn):
    cols = await _columns(db_conn, "project_register_review_queue")
    assert EXPECTED_QUEUE_COLUMNS <= set(cols)


async def test_register_source_backfilled(db_conn):
    nulls = await db_conn.fetchval(
        "SELECT count(*) FROM projects WHERE register_source IS NULL"
    )
    assert nulls == 0, f"{nulls} projects missing register_source"


async def test_indexes_exist(db_conn):
    rows = await db_conn.fetch(
        """SELECT indexname FROM pg_indexes
           WHERE tablename IN ('projects', 'project_register_review_queue')"""
    )
    names = {r["indexname"] for r in rows}
    for expected in (
        "idx_projects_client_id",
        "idx_projects_location_id",
        "idx_projects_project_type",
        "idx_review_queue_open",
        "idx_review_queue_batch",
    ):
        assert expected in names, f"index {expected} missing"
