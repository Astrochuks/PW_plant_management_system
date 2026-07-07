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
            "project_payments": 17,  # 19 sheet rows − subtotal − grand total
            "project_beme_progress": distinct_beme,
            "project_subcontractors": 83,
            "project_labour_strength": 22,
            "project_materials_stock": 28,
            "project_hired_vehicles": 6,
            "project_precast": 1,
        }
        for table, n in expect.items():
            assert stats["row_counts"][table] == n, table
            # scope to this report — the live DB holds other weeks too
            in_db = await conn.fetchval(
                f"SELECT count(*) FROM {table} WHERE weekly_report_id = $1::uuid",
                stats["weekly_report_id"],
            )
            assert in_db == n, f"{table}: db {in_db} != {n}"

        assert stats["week_ending_date"].isoformat() == "2026-03-06"

    async def test_fleet_resolution(self, db):
        conn, _, project_id, stats = db
        linked = await conn.fetchval(
            """SELECT count(*) FROM project_plant_utilization
               WHERE weekly_report_id = $1::uuid AND plant_id IS NOT NULL""",
            stats["weekly_report_id"],
        )
        total = await conn.fetchval(
            """SELECT count(*) FROM project_plant_utilization
               WHERE weekly_report_id = $1::uuid""",
            stats["weekly_report_id"],
        )
        # The Akwa Ibom fleet numbers must overwhelmingly match plants_master
        assert linked / total > 0.8, f"only {linked}/{total} resolved"
        assert stats["fleet_resolved"] > 100

    async def test_usage_joins_to_plants_master(self, db):
        """The cross-module bridge: project usage rows land on the same
        plant entities the plant module tracks."""
        conn, _, project_id, stats = db
        row = await conn.fetchrow(
            """SELECT pu.hours_worked, pu.breakdown_hours, pm.fleet_number,
                      pm.condition
               FROM project_plant_utilization pu
               JOIN plants_master pm ON pm.id = pu.plant_id
               WHERE pu.weekly_report_id = $1::uuid
                 AND pu.fleet_number_raw = 'AC163'""",
            stats["weekly_report_id"],
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

    async def test_payments_totals_dropped_but_reconciled(self, db):
        """Subtotal/grand-total sheet rows are never stored; the sum of the
        stored rows equals the sheet's own grand total (net)."""
        conn, _, project_id, stats = db
        n_totals = await conn.fetchval(
            """SELECT count(*) FROM project_payments
               WHERE weekly_report_id = $1::uuid
                 AND payment_date IS NULL AND payment_type IS NULL
                 AND voucher_number IS NULL""",
            stats["weekly_report_id"],
        )
        assert n_totals == 0
        net = await conn.fetchval(
            """SELECT sum(net_amount) FROM project_payments
               WHERE weekly_report_id = $1::uuid""",
            stats["weekly_report_id"],
        )
        assert float(net) == pytest.approx(12_039_846_565.61, abs=1.0)

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


class TestDeleteWeekCascades:
    async def test_header_delete_wipes_all_week_tables(self, db, parsed10):
        """The delete-week endpoint relies on this: removing the weekly
        report header must cascade every per-week operational table and
        must not leave SET-NULL orphans behind."""
        conn, user_id, project_id, first = db
        wr_id = first["weekly_report_id"]

        cascade_tables = [
            r["table_name"] for r in await conn.fetch(
                """SELECT c.table_name
                   FROM information_schema.columns c
                   WHERE c.column_name = 'weekly_report_id'
                     AND c.table_name = ANY($1::text[])""",
                list(first["row_counts"].keys()),
            )
        ]
        orphans_before = {
            t: await conn.fetchval(
                f"""SELECT count(*) FROM {t}
                    WHERE project_id = $1::uuid AND weekly_report_id IS NULL""",
                project_id,
            ) for t in cascade_tables
        }

        await conn.execute(
            "DELETE FROM project_weekly_reports WHERE id = $1::uuid", wr_id
        )

        for t in cascade_tables:
            remaining = await conn.fetchval(
                f"SELECT count(*) FROM {t} WHERE weekly_report_id = $1::uuid",
                wr_id,
            )
            assert remaining == 0, f"{t}: {remaining} rows kept the deleted report id"
            orphans_after = await conn.fetchval(
                f"""SELECT count(*) FROM {t}
                    WHERE project_id = $1::uuid AND weekly_report_id IS NULL""",
                project_id,
            )
            assert orphans_after == orphans_before[t], \
                f"{t}: week deletion left {orphans_after - orphans_before[t]} orphans"

    async def test_delete_then_reupload_restores_counts(self, db, parsed10):
        conn, user_id, project_id, first = db
        await conn.execute(
            """DELETE FROM project_weekly_reports
               WHERE project_id = $1::uuid AND year = 2026 AND week_number = 10""",
            project_id,
        )
        stats = await persist_weekly_report(
            conn, project_id, 2026, 10, copy.deepcopy(parsed10), user_id
        )
        assert stats["row_counts"] == first["row_counts"]


class TestIdempotentReupload:
    async def test_reupload_replaces_never_duplicates(self, db, parsed10):
        conn, user_id, project_id, first = db
        for _ in range(2):
            stats = await persist_weekly_report(
                conn, project_id, 2026, 10, copy.deepcopy(parsed10), user_id
            )
        # Same counts in the DB after 3 total persists — scoped to the
        # final report id (the live DB holds other weeks for this project)
        for table, n in first["row_counts"].items():
            if table in ("project_contract_summary_snapshot",
                         "project_bill1_items"):
                continue  # snapshot keyed per week; bill1 items are master rows
            in_db = await conn.fetchval(
                f"SELECT count(*) FROM {table} WHERE weekly_report_id = $1::uuid",
                stats["weekly_report_id"],
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
