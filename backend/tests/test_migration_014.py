"""T2.1 — Phase 2 schema assertions (weekly-report ingest tables)."""

PHASE2_TABLES = {
    "project_report_submissions",
    "project_reference_lists",
    "project_beme_bills",
    "project_beme_items",
    "project_beme_progress",
    "project_bill1_items",
    "project_bill1_claims",
    "project_bill1_payments",
    "project_precast",
    "project_weekly_summary",
    "project_contract_summary_snapshot",
    "project_alerts",
    "project_photos",
    "user_project_assignments",
}


async def test_all_phase2_tables_exist(db_conn):
    rows = await db_conn.fetch(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
    )
    existing = {r["table_name"] for r in rows}
    missing = PHASE2_TABLES - existing
    assert not missing, f"missing tables: {missing}"


async def test_submission_status_constraint(db_conn):
    import asyncpg
    import pytest

    project_id = await db_conn.fetchval("SELECT id FROM projects LIMIT 1")
    with pytest.raises(asyncpg.CheckViolationError):
        async with db_conn.transaction():
            await db_conn.execute(
                """INSERT INTO project_report_submissions
                   (project_id, year, week_number, status)
                   VALUES ($1, 2026, 2, 'bogus_status')""",
                project_id,
            )


async def test_cascade_from_weekly_report(db_conn):
    """Deleting one weekly report header must cascade to ALL its children —
    the rollback mechanism for a bad upload."""
    project_id = await db_conn.fetchval("SELECT id FROM projects LIMIT 1")
    wr = await db_conn.fetchval(
        """INSERT INTO project_weekly_reports
           (project_id, year, week_number, week_ending_date, status)
           VALUES ($1, 2026, 99, '2026-12-31', 'completed') RETURNING id""",
        project_id,
    )
    await db_conn.execute(
        """INSERT INTO project_weekly_summary
           (weekly_report_id, project_id, year, week_number, section, metric, value)
           VALUES ($1, $2, 2026, 99, 'TEST', 'test_metric', 1)""",
        wr, project_id,
    )
    await db_conn.execute(
        "DELETE FROM project_weekly_reports WHERE id = $1", wr
    )
    orphans = await db_conn.fetchval(
        "SELECT count(*) FROM project_weekly_summary WHERE weekly_report_id = $1", wr
    )
    assert orphans == 0


async def test_beme_progress_unique_per_report(db_conn):
    import asyncpg
    import pytest

    project_id = await db_conn.fetchval("SELECT id FROM projects LIMIT 1")
    wr = await db_conn.fetchval(
        """INSERT INTO project_weekly_reports
           (project_id, year, week_number, week_ending_date, status)
           VALUES ($1, 2026, 98, '2026-12-24', 'completed') RETURNING id""",
        project_id,
    )
    bill = await db_conn.fetchval(
        "INSERT INTO project_beme_bills (project_id, bill_no) VALUES ($1, 2) RETURNING id",
        project_id,
    )
    item = await db_conn.fetchval(
        """INSERT INTO project_beme_items (project_id, bill_id, item_code, description)
           VALUES ($1, $2, '1.01', 'Test item') RETURNING id""",
        project_id, bill,
    )
    await db_conn.execute(
        """INSERT INTO project_beme_progress
           (weekly_report_id, project_id, item_id, year, week_number, qty_this_week)
           VALUES ($1, $2, $3, 2026, 98, 5)""",
        wr, project_id, item,
    )
    with pytest.raises(asyncpg.UniqueViolationError):
        async with db_conn.transaction():
            await db_conn.execute(
                """INSERT INTO project_beme_progress
                   (weekly_report_id, project_id, item_id, year, week_number, qty_this_week)
                   VALUES ($1, $2, $3, 2026, 98, 7)""",
                wr, project_id, item,
            )
