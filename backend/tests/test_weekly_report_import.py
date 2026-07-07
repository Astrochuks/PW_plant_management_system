"""T2.15/T2.16 — weekly-report persistence against the real DB (rolled back).

One parse + one seeded connection per module; per-test savepoints.
"""

import copy
from pathlib import Path

import openpyxl
import pytest
import pytest_asyncio

from app.services.weekly_report_import import persist_weekly_report
from app.services.weekly_report_sheets import parse_workbook

FIXTURES = Path(__file__).parent / "fixtures" / "projects"

pytestmark = pytest.mark.asyncio(loop_scope="module")


@pytest.fixture(scope="module")
def parsed10():
    wb = openpyxl.load_workbook(
        FIXTURES / "week_10_akwa_ibom_2026.xlsx", data_only=True
    )
    return parse_workbook(wb)


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def seeded(parsed10):
    """(conn, user_id, project_id, stats) — Week 10 persisted once."""
    import asyncpg

    from tests.conftest import _database_url

    url = _database_url()
    if not url:
        pytest.skip("no DATABASE_URL")
    try:
        conn = await asyncpg.connect(url, statement_cache_size=0, timeout=15)
    except Exception as exc:
        pytest.skip(f"database unreachable: {exc}")

    outer = conn.transaction()
    await outer.start()
    try:
        user_id = str((await conn.fetchrow("SELECT id FROM users LIMIT 1"))["id"])
        project_id = str(await conn.fetchval(
            "SELECT id FROM projects WHERE short_name = 'AKWA IBOM AIRPORT APRON'"
        ))
        stats = await persist_weekly_report(
            conn, project_id, 2026, 10, copy.deepcopy(parsed10), user_id
        )
        yield conn, user_id, project_id, stats
    finally:
        try:
            await outer.rollback()
        finally:
            await conn.close()


@pytest_asyncio.fixture(loop_scope="module")
async def db(seeded):
    conn, user_id, project_id, stats = seeded
    sp = conn.transaction()
    await sp.start()
    try:
        yield conn, user_id, project_id, stats
    finally:
        await sp.rollback()


class TestPersistWeek10:
    async def test_row_counts_match_parser(self, db, parsed10):
        conn, _, project_id, stats = db
        beme_rows = parsed10["sheets"]["BEME & Works Completed Fd"]["rows"]
        distinct_beme = len({
            (r["bill_no"], r["item_code"] or "", r["description"]) for r in beme_rows
        })
        expect = {
            "project_plant_utilization": 126,
            "project_diesel_consumption": 122,
            "project_cost_report": 78,
            "project_certificates": 13,
            "project_payments": 19,
            "project_beme_progress": distinct_beme,
            "project_subcontractors": 83,
            "project_labour_strength": 22,
            "project_materials_stock": 28,
            "project_hired_vehicles": 6,
            "project_precast": 1,
        }
        for table, n in expect.items():
            assert stats["row_counts"][table] == n, table
            in_db = await conn.fetchval(
                f"SELECT count(*) FROM {table} WHERE project_id = $1::uuid",
                project_id,
            )
            assert in_db == n, f"{table}: db {in_db} != {n}"

        assert stats["week_ending_date"].isoformat() == "2026-03-06"

    async def test_fleet_resolution(self, db):
        conn, _, project_id, stats = db
        linked = await conn.fetchval(
            """SELECT count(*) FROM project_plant_utilization
               WHERE project_id = $1::uuid AND plant_id IS NOT NULL""",
            project_id,
        )
        total = await conn.fetchval(
            """SELECT count(*) FROM project_plant_utilization
               WHERE project_id = $1::uuid""",
            project_id,
        )
        # The Akwa Ibom fleet numbers must overwhelmingly match plants_master
        assert linked / total > 0.8, f"only {linked}/{total} resolved"
        assert stats["fleet_resolved"] > 100

    async def test_usage_joins_to_plants_master(self, db):
        """The cross-module bridge: project usage rows land on the same
        plant entities the plant module tracks."""
        conn, _, project_id, _ = db
        row = await conn.fetchrow(
            """SELECT pu.hours_worked, pu.breakdown_hours, pm.fleet_number,
                      pm.condition
               FROM project_plant_utilization pu
               JOIN plants_master pm ON pm.id = pu.plant_id
               WHERE pu.project_id = $1::uuid AND pu.fleet_number_raw = 'AC163'""",
            project_id,
        )
        assert row is not None
        assert row["fleet_number"] == "AC163"
        assert row["breakdown_hours"] == 63

    async def test_beme_items_created_once(self, db, parsed10):
        conn, _, project_id, _ = db
        beme_rows = parsed10["sheets"]["BEME & Works Completed Fd"]["rows"]
        distinct_beme = len({
            (r["bill_no"], r["item_code"] or "", r["description"]) for r in beme_rows
        })
        items = await conn.fetchval(
            "SELECT count(*) FROM project_beme_items WHERE project_id = $1::uuid",
            project_id,
        )
        assert items == distinct_beme

    async def test_contract_snapshot(self, db):
        conn, _, project_id, _ = db
        snap = await conn.fetchrow(
            """SELECT current_contract_amount, works_certified
               FROM project_contract_summary_snapshot
               WHERE project_id = $1::uuid AND week_number = 10""",
            project_id,
        )
        assert float(snap["current_contract_amount"]) == pytest.approx(10621359979.09)
        assert snap["works_certified"] is not None

    async def test_reference_lists_ingested(self, db):
        conn, *_ = db
        n = await conn.fetchval("SELECT count(*) FROM project_reference_lists")
        assert n > 20


class TestIdempotentReupload:
    async def test_reupload_replaces_never_duplicates(self, db, parsed10):
        conn, user_id, project_id, first = db
        for _ in range(2):
            stats = await persist_weekly_report(
                conn, project_id, 2026, 10, copy.deepcopy(parsed10), user_id
            )
        # Same counts in the DB after 3 total persists
        for table, n in first["row_counts"].items():
            if table == "project_contract_summary_snapshot":
                continue
            in_db = await conn.fetchval(
                f"SELECT count(*) FROM {table} WHERE project_id = $1::uuid",
                project_id,
            )
            assert in_db == n, f"{table}: {in_db} != {n} after re-uploads"

        # exactly ONE header row for the week
        headers = await conn.fetchval(
            """SELECT count(*) FROM project_weekly_reports
               WHERE project_id = $1::uuid AND year = 2026 AND week_number = 10""",
            project_id,
        )
        assert headers == 1

        # BEME items never duplicate on re-upload (incl. ''-code items)
        beme_rows = parsed10["sheets"]["BEME & Works Completed Fd"]["rows"]
        distinct_beme = len({
            (r["bill_no"], r["item_code"] or "", r["description"]) for r in beme_rows
        })
        items = await conn.fetchval(
            "SELECT count(*) FROM project_beme_items WHERE project_id = $1::uuid",
            project_id,
        )
        assert items == distinct_beme
