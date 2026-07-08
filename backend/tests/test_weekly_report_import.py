"""Import v2 against the real DB (rolled back) — locked spec.

Sequence W43(2025) → W2 → W10 exercises: baseline facts from the first
workbook, gap facts across missing weeks, idempotent re-upload, computed
cumulative view, and stale-copy detection.

One parse per module; per-test savepoints on one connection.
"""

import copy
from pathlib import Path

import openpyxl
import pytest
import pytest_asyncio

from app.services.weekly_report_import import (
    persist_weekly_report,
    recompute_adjustments,
)
from app.services.weekly_report_sheets import parse_workbook

FIXTURES = Path(__file__).parent / "fixtures" / "projects"

pytestmark = pytest.mark.asyncio(loop_scope="module")


def _parse(name):
    return parse_workbook(openpyxl.load_workbook(FIXTURES / name, data_only=True))


@pytest.fixture(scope="module")
def parsed43():
    return _parse("week_43_akwa_ibom_2025.xlsx")


@pytest.fixture(scope="module")
def parsed2():
    return _parse("week_02_akwa_ibom_2026.xlsx")


@pytest.fixture(scope="module")
def parsed10():
    return _parse("week_10_akwa_ibom_2026.xlsx")


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def seeded(parsed43, parsed2, parsed10):
    """(conn, user_id, project_id, stats10) — W43, W2, W10 persisted once."""
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
        # wipe ALL project weekly data inside the txn so the module is
        # self-contained regardless of live DB state (items/bills/certs
        # are project-scoped — not cascaded by the report-header delete)
        for table in ("project_weekly_reports", "project_ledger_adjustments",
                      "project_beme_items", "project_beme_bills",
                      "project_certificates", "project_payments"):
            await conn.execute(
                f"DELETE FROM {table} WHERE project_id = $1::uuid", project_id)
        await persist_weekly_report(
            conn, project_id, 2025, 43, copy.deepcopy(parsed43), user_id)
        await persist_weekly_report(
            conn, project_id, 2026, 2, copy.deepcopy(parsed2), user_id)
        stats10 = await persist_weekly_report(
            conn, project_id, 2026, 10, copy.deepcopy(parsed10), user_id)
        yield conn, user_id, project_id, stats10
    finally:
        try:
            await outer.rollback()
        finally:
            await conn.close()


@pytest_asyncio.fixture(loop_scope="module")
async def db(seeded):
    conn, user_id, project_id, stats10 = seeded
    sp = conn.transaction()
    await sp.start()
    try:
        yield conn, user_id, project_id, stats10
    finally:
        await sp.rollback()


class TestPersistShapes:
    async def test_row_counts(self, db):
        conn, _, project_id, stats = db
        expect = {
            "project_plant_utilization": 126,   # full roster incl. idle
            "project_diesel_consumption": 22,   # fuel events only
            "project_cost_report": 70,          # category rows, no '0' slots
            "project_certificates": 13,
            # 17, not 19: the sheet's two grand-total rows (₦13.6B!) were
            # stored as payments by the old pipeline — now cross-checks
            "project_payments": 17,
            "project_beme_progress": 97,        # real items only
        }
        for table, n in expect.items():
            assert stats["row_counts"][table] == n, table
        assert stats["week_ending_date"].isoformat() == "2026-03-06"

    async def test_beme_items_clean(self, db):
        """97 real items — no summary-table or total-row pollution."""
        conn, _, project_id, _ = db
        n = await conn.fetchval(
            "SELECT count(*) FROM project_beme_items WHERE project_id = $1::uuid",
            project_id)
        assert n == 97
        # the old pollution: single-digit codes (summary-table restatement)
        polluted = await conn.fetchval(
            """SELECT count(*) FROM project_beme_items
               WHERE project_id = $1::uuid AND item_code ~ '^[0-9]$'""",
            project_id)
        assert polluted == 0
        # both 3.07 duplicates kept as distinct items
        dup = await conn.fetch(
            """SELECT dup_seq FROM project_beme_items
               WHERE project_id = $1::uuid AND item_code = '3.07'
               ORDER BY dup_seq""",
            project_id)
        assert [r["dup_seq"] for r in dup] == [0, 1]

    async def test_bills_carry_names(self, db):
        conn, _, project_id, _ = db
        rows = await conn.fetch(
            """SELECT bill_no, name FROM project_beme_bills
               WHERE project_id = $1::uuid ORDER BY bill_no""",
            project_id)
        assert len(rows) == 8
        assert rows[3]["name"] == "PAVEMENT AND SURFACING"

    async def test_diesel_events_and_cost_centres(self, db):
        conn, _, project_id, _ = db
        mech = await conn.fetchrow(
            """SELECT is_cost_centre, amount_ngn FROM project_diesel_consumption
               WHERE project_id = $1::uuid AND fleet_number_raw = 'MECHANICS'
                 AND week_number = 10""",
            project_id)
        assert mech["is_cost_centre"] is True
        zero_rows = await conn.fetchval(
            """SELECT count(*) FROM project_diesel_consumption d
               WHERE project_id = $1::uuid
                 AND COALESCE(saturday_litres,0)+COALESCE(sunday_litres,0)
                   + COALESCE(monday_litres,0)+COALESCE(tuesday_litres,0)
                   + COALESCE(wednesday_litres,0)+COALESCE(thursday_litres,0)
                   + COALESCE(friday_litres,0) = 0""",
            project_id)
        assert zero_rows == 0  # events only

    async def test_contract_snapshot_overview(self, db):
        conn, _, project_id, _ = db
        snap = await conn.fetchrow(
            """SELECT overdue_weeks, gross_certified, apg_amount,
                      bill1_outstanding, retention_held
               FROM project_contract_summary_snapshot
               WHERE project_id = $1::uuid AND year = 2026 AND week_number = 10""",
            project_id)
        assert float(snap["overdue_weeks"]) == pytest.approx(-50.6, abs=0.1)
        assert float(snap["gross_certified"]) == pytest.approx(2_083_112_600.95, abs=0.01)
        assert float(snap["apg_amount"]) == pytest.approx(1_500_000_000)
        assert float(snap["bill1_outstanding"]) == pytest.approx(6_576_000)


class TestAdjustments:
    async def test_baseline_from_w43(self, db):
        """The earliest workbook's reported-previous becomes the baseline."""
        conn, _, project_id, _ = db
        n = await conn.fetchval(
            """SELECT count(*) FROM project_ledger_adjustments
               WHERE project_id = $1::uuid AND ledger = 'beme'
                 AND kind = 'baseline'""",
            project_id)
        assert n > 20
        # item 1.01 baseline = ₦50M (work before W43)
        amt = await conn.fetchval(
            """SELECT a.amount FROM project_ledger_adjustments a
               JOIN project_beme_items i ON i.id = a.beme_item_id
               WHERE a.project_id = $1::uuid AND a.kind = 'baseline'
                 AND i.item_code = '1.01'""",
            project_id)
        assert float(amt) == pytest.approx(50_000_000.0)

    async def test_gap_w43_to_w2(self, db):
        """Missing weeks W44-2025 → W1-2026: exactly 3 BEME items,
        ₦425,055,750 total — derived, labelled, auditable."""
        conn, _, project_id, _ = db
        rows = await conn.fetch(
            """SELECT i.item_code, a.amount, a.covers_from_year,
                      a.covers_from_week, a.covers_to_year, a.covers_to_week
               FROM project_ledger_adjustments a
               JOIN project_beme_items i ON i.id = a.beme_item_id
               WHERE a.project_id = $1::uuid AND a.ledger = 'beme'
                 AND a.kind = 'gap' AND a.covers_from_year = 2025
               ORDER BY i.item_code""",
            project_id)
        assert [r["item_code"] for r in rows] == ["4.04", "4.05", "4.06"]
        assert sum(float(r["amount"]) for r in rows) == pytest.approx(425_055_750.0)
        assert rows[0]["covers_from_week"] == 43
        assert rows[0]["covers_to_week"] == 2

    async def test_cost_gap_derived_too(self, db):
        conn, _, project_id, _ = db
        total = await conn.fetchval(
            """SELECT sum(amount) FROM project_ledger_adjustments
               WHERE project_id = $1::uuid AND ledger = 'cost' AND kind = 'gap'
                 AND covers_from_year = 2025""",
            project_id)
        assert float(total) == pytest.approx(251_505_724.99, abs=0.05)

    async def test_cumulative_view_reproduces_workbook_totals(self, db, parsed10):
        """baseline + gaps + this-weeks == the workbook's own total column."""
        conn, _, project_id, _ = db
        view_rows = await conn.fetch(
            """SELECT item_code, amount_done FROM v_project_beme_cumulative
               WHERE project_id = $1::uuid""",
            project_id)
        got = sorted((r["item_code"], round(float(r["amount_done"]), 2))
                     for r in view_rows)
        rows10 = parsed10["sheets"]["BEME & Works Completed Fd"]["rows"]
        expect = sorted(
            (r["item_code"],
             round(float(r["amount_previous_reported"] or 0)
                   + float(r["amount_this_week"] or 0), 2))
            for r in rows10)
        assert got == expect

    async def test_overrun_and_no_qty_flags(self, db):
        conn, _, project_id, _ = db
        i405 = await conn.fetchrow(
            """SELECT is_overrun FROM v_project_beme_cumulative
               WHERE project_id = $1::uuid AND item_code = '4.05'""",
            project_id)
        assert i405["is_overrun"] is True
        i211 = await conn.fetchrow(
            """SELECT no_contract_qty, pct_complete FROM v_project_beme_cumulative
               WHERE project_id = $1::uuid AND item_code = '2.11'""",
            project_id)
        assert i211["no_contract_qty"] is True
        assert i211["pct_complete"] is None

    async def test_recompute_is_idempotent(self, db):
        conn, _, project_id, _ = db
        before = await conn.fetchval(
            """SELECT count(*) FROM project_ledger_adjustments
               WHERE project_id = $1::uuid""", project_id)
        await recompute_adjustments(conn, project_id)
        after = await conn.fetchval(
            """SELECT count(*) FROM project_ledger_adjustments
               WHERE project_id = $1::uuid""", project_id)
        assert before == after


class TestFlags:
    async def test_bill6_broken_sum_flagged(self, db):
        conn, _, project_id, _ = db
        n = await conn.fetchval(
            """SELECT count(*) FROM project_sheet_flags
               WHERE project_id = $1::uuid AND flag_type = 'cross_check_fail'
                 AND message LIKE '%bill_6_contract%'""",
            project_id)
        assert n >= 1

    async def test_works_reconcile_with_weekly_summary(self, db):
        conn, _, project_id, _ = db
        n = await conn.fetchval(
            """SELECT count(*) FROM project_sheet_flags f
               JOIN project_weekly_reports r ON r.id = f.weekly_report_id
               WHERE f.project_id = $1::uuid AND r.week_number = 10
                 AND f.flag_type = 'cross_check_pass'
                 AND f.message LIKE '%works reconcile%'""",
            project_id)
        assert n == 1

    async def test_diesel_variance_recorded(self, db):
        conn, _, project_id, _ = db
        row = await conn.fetchrow(
            """SELECT f.message FROM project_sheet_flags f
               JOIN project_weekly_reports r ON r.id = f.weekly_report_id
               WHERE f.project_id = $1::uuid AND r.week_number = 10
                 AND f.flag_type = 'variance'""",
            project_id)
        assert row is not None
        assert "8596" in row["message"].replace(",", "")

    async def test_stale_copy_detected(self, db, parsed10):
        """Re-persisting W10's content as 'W11' must trip the detector."""
        conn, user_id, project_id, _ = db
        await persist_weekly_report(
            conn, project_id, 2026, 11, copy.deepcopy(parsed10), user_id)
        flags = await conn.fetch(
            """SELECT flag_type, sheet_name FROM project_sheet_flags f
               JOIN project_weekly_reports r ON r.id = f.weekly_report_id
               WHERE f.project_id = $1::uuid AND r.week_number = 11
                 AND f.flag_type IN ('stale_copy', 'frozen_column')""",
            project_id)
        kinds = {(f["flag_type"], f["sheet_name"]) for f in flags}
        assert ("stale_copy", "Diesel Consumption") in kinds
        assert ("frozen_column", "Plant Return") in kinds


class TestIdempotentReupload:
    async def test_reupload_replaces_never_duplicates(self, db, parsed10):
        conn, user_id, project_id, first = db
        for _ in range(2):
            await persist_weekly_report(
                conn, project_id, 2026, 10, copy.deepcopy(parsed10), user_id)
        for table in ("project_beme_progress", "project_plant_utilization",
                      "project_diesel_consumption", "project_cost_report"):
            in_db = await conn.fetchval(
                f"""SELECT count(*) FROM {table}
                    WHERE project_id = $1::uuid AND week_number = 10""",
                project_id)
            assert in_db == first["row_counts"][table], table
        items = await conn.fetchval(
            "SELECT count(*) FROM project_beme_items WHERE project_id = $1::uuid",
            project_id)
        assert items == 97
        headers = await conn.fetchval(
            """SELECT count(*) FROM project_weekly_reports
               WHERE project_id = $1::uuid AND year = 2026 AND week_number = 10""",
            project_id)
        assert headers == 1
