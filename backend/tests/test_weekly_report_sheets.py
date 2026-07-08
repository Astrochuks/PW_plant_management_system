"""Sheet parsers v2 vs the real Akwa Ibom workbooks (locked spec 2026-07-08).

Golden file freezes the full Week 10 parse; spot checks pin hand-verified
values so a parser regression can never slip through as 'row counts still
match'. Week 43 (2025) proves the parser works across the year boundary
and supplies the baseline/gap inputs.

Regenerate deliberately: UPDATE_GOLDEN=1 pytest tests/test_weekly_report_sheets.py
"""

import json
import math
import os
from datetime import date, datetime
from pathlib import Path

import openpyxl
import pytest

from app.services.weekly_report_sheets import (
    STORED_ONLY_SHEETS,
    parse_workbook,
)

FIXTURES = Path(__file__).parent / "fixtures" / "projects"
GOLDEN = Path(__file__).parent / "golden" / "weekly_report_week10_baseline.json"


def _load(name):
    return openpyxl.load_workbook(FIXTURES / name, data_only=True)


@pytest.fixture(scope="module")
def week10():
    return parse_workbook(_load("week_10_akwa_ibom_2026.xlsx"))


@pytest.fixture(scope="module")
def week2():
    return parse_workbook(_load("week_02_akwa_ibom_2026.xlsx"))


@pytest.fixture(scope="module")
def week43():
    return parse_workbook(_load("week_43_akwa_ibom_2025.xlsx"))


def _normalize(obj):
    if isinstance(obj, dict):
        return {str(k): _normalize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_normalize(v) for v in obj]
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if isinstance(obj, float) and math.isnan(obj):
        return None
    return obj


class TestGoldenWeek10:
    def test_matches_golden(self, week10):
        current = _normalize(week10)
        if os.environ.get("UPDATE_GOLDEN") == "1":
            GOLDEN.parent.mkdir(parents=True, exist_ok=True)
            GOLDEN.write_text(
                json.dumps(current, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
            )
            pytest.skip(f"golden regenerated at {GOLDEN} — review the diff")
        assert GOLDEN.exists(), "generate golden with UPDATE_GOLDEN=1 first"
        assert current == json.loads(GOLDEN.read_text())

    def test_deterministic(self, week10):
        again = parse_workbook(_load("week_10_akwa_ibom_2026.xlsx"))
        assert _normalize(again) == _normalize(week10)


class TestBemeClassification:
    """The heart of the rebuild: only real items become data."""

    def test_exactly_97_real_items_8_bills(self, week10):
        b = week10["sheets"]["BEME & Works Completed Fd"]
        assert len(b["rows"]) == 97
        assert [x["bill_no"] for x in b["bills"]] == [1, 2, 3, 4, 5, 6, 7, 8]
        assert b["bills"][3]["name"] == "PAVEMENT AND SURFACING"

    def test_letter_variants_are_items(self, week10):
        rows = week10["sheets"]["BEME & Works Completed Fd"]["rows"]
        codes = {r["item_code"] for r in rows}
        assert {"3.02a", "3.04a", "3.06a", "4.04a", "4.05a", "4.05b",
                "4.05c", "4.05d", "4.05e", "4.09a", "4.10a"} <= codes

    def test_float_corrupted_code_normalized(self, week10):
        rows = week10["sheets"]["BEME & Works Completed Fd"]["rows"]
        codes = {r["item_code"] for r in rows}
        assert "6.24" in codes
        assert not any(c.startswith("6.23999") for c in codes)

    def test_summary_table_never_pollutes_items(self, week10):
        b = week10["sheets"]["BEME & Works Completed Fd"]
        # summary table captured separately, with Title Case names
        assert len(b["summary_table"]) == 8
        assert b["summary_table"][3]["name"] == "Pavement and Joints"
        # and its rows are NOT in items
        item_descs = {r["description"] for r in b["rows"]}
        assert "Pavement and Joints" not in item_descs

    def test_bill_totals_match_except_broken_bill6(self, week10):
        b = week10["sheets"]["BEME & Works Completed Fd"]
        fails = {c["check"]: c for c in b["cross_checks"]}
        # the site's Bill 6 SUM range stops at row 120 — ₦111,072,750 outside
        assert set(fails) == {"bill_6_contract"}
        assert fails["bill_6_contract"]["delta"] == pytest.approx(111_072_750.0)

    def test_tail_markup_structure(self, week10):
        tail = week10["sheets"]["BEME & Works Completed Fd"]["tail"]
        assert tail["contingency"]["contract"] == pytest.approx(541_473_578.105625)
        assert tail["vop"]["contract"] == pytest.approx(541_473_578.105625)
        assert tail["vat"]["contract"] == pytest.approx(1_705_641_771.03, abs=0.01)
        assert tail["grand_total"]["contract"] == pytest.approx(24_447_532_051.47, abs=0.01)

    def test_this_week_only_bill4_moved(self, week10):
        rows = week10["sheets"]["BEME & Works Completed Fd"]["rows"]
        moved = [r for r in rows if (r["amount_this_week"] or 0) > 0]
        assert all(r["bill_no"] == 4 for r in moved)
        assert sum(r["amount_this_week"] for r in moved) == pytest.approx(294_550_350.0)

    def test_reported_previous_captured(self, week10):
        """Baseline/gap inputs: every item carries reported-previous."""
        rows = week10["sheets"]["BEME & Works Completed Fd"]["rows"]
        mob = next(r for r in rows if r["item_code"] == "1.01")
        assert mob["amount_previous_reported"] == pytest.approx(50_000_000.0)
        assert mob["contract_amount"] == pytest.approx(69_000_000.0)

    def test_over_completion_stored_uncapped(self, week10):
        rows = week10["sheets"]["BEME & Works Completed Fd"]["rows"]
        i405 = next(r for r in rows if r["item_code"] == "4.05")
        # 3,132 mats done vs 92.4 contracted — stored exactly as reported
        assert i405["contract_qty"] == pytest.approx(92.4)
        total_qty = (i405["qty_previous_reported"] or 0) + (i405["qty_this_week"] or 0)
        assert total_qty > i405["contract_qty"] * 30

    def test_no_contract_qty_item_kept(self, week10):
        rows = week10["sheets"]["BEME & Works Completed Fd"]["rows"]
        i211 = next(r for r in rows if r["item_code"] == "2.11")
        assert i211["contract_qty"] in (None, 0)
        assert i211["qty_previous_reported"] == pytest.approx(500)
        assert i211["rate"] == pytest.approx(118_180)


class TestCostReport:
    def test_rows_and_total_cross_check(self, week10):
        c = week10["sheets"]["Cost Report"]
        # zero warnings: qty×rate and prev+this=todate hold on every row,
        # and the categorized sum equals the sheet total
        assert c["warnings"] == []
        assert c["sheet_total"]["this_week"] == pytest.approx(196_009_206.03, abs=0.01)
        ours = sum(r["amount_this_week"] for r in c["rows"] if r["cost_category"])
        assert ours == pytest.approx(196_009_206.03, abs=0.01)

    def test_template_zero_rows_skipped(self, week10):
        c = week10["sheets"]["Cost Report"]
        assert not any(r["description"] == "0" for r in c["rows"])

    def test_diesel_row_is_the_money_truth(self, week10):
        c = week10["sheets"]["Cost Report"]
        diesel = next(r for r in c["rows"] if r["description"] == "Diesel")
        assert diesel["section"] == "PLANT DEPARTMENT"
        assert diesel["cost_category"] == "AGO"
        assert diesel["quantity_this_week"] == pytest.approx(8596)
        assert diesel["rate_ngn"] == pytest.approx(1600)
        assert diesel["amount_this_week"] == pytest.approx(13_753_600)

    def test_labour_row_carries_headcount(self, week10):
        c = week10["sheets"]["Cost Report"]
        labour = next(r for r in c["rows"] if r["description"] == "Labour")
        assert labour["quantity_this_week"] == 61
        assert labour["amount_this_week"] == pytest.approx(2_440_000)

    def test_reported_previous_captured(self, week10):
        c = week10["sheets"]["Cost Report"]
        diesel = next(r for r in c["rows"] if r["description"] == "Diesel")
        assert diesel["amount_previous_week"] == pytest.approx(810_328_330)


class TestPlantReturn:
    def test_full_roster_including_idle(self, week10):
        p = week10["sheets"]["Plant Return"]
        assert len(p["rows"]) == 126
        idle = [r for r in p["rows"]
                if r["hours_worked"] == 0 and r["standby_hours"] == 0
                and r["breakdown_hours"] == 0]
        assert len(idle) >= 40  # idle-on-site is a signal, never dropped

    def test_cost_equals_hours_times_rate(self, week10):
        p = week10["sheets"]["Plant Return"]
        assert not [w for w in p["warnings"] if "× rate" in w]

    def test_footer_reconciliation_inputs(self, week10):
        f = week10["sheets"]["Plant Return"]["footer"]
        assert f["total_all"] == pytest.approx(42_548_138)
        assert f["pct_allocated"] == 1
        # consumable adjustment lines (deducted before Cost Report posting)
        adj = {a["label"]: a["amount"] for a in f["adjustments"]}
        assert adj.get("Engine Oil") == pytest.approx(1_003_500)
        assert adj.get("Gear oil") == pytest.approx(45_000)


class TestDiesel:
    def test_events_only(self, week10):
        d = week10["sheets"]["Diesel Consumption"]
        assert len(d["rows"]) == 22  # only recipients who took fuel
        assert all(
            sum(r[k] for k in r if k.endswith("_litres")) > 0 for r in d["rows"]
        )

    def test_arithmetic_is_internally_perfect(self, week10):
        """The '171L error' of the first build was OUR double-count of the
        sheet's own subtotal. Events must sum to the sheet total exactly."""
        d = week10["sheets"]["Diesel Consumption"]
        assert d["warnings"] == []
        assert d["sheet_totals"]["all_used"] == pytest.approx(6056)
        assert d["sheet_totals"]["other_used"] == pytest.approx(171)

    def test_stock_line_captured(self, week10):
        d = week10["sheets"]["Diesel Consumption"]
        assert d["stock"] == {"opening": 0.0, "received": 0.0,
                              "used": 6056.0, "closing": -6056.0}

    def test_cost_centres_marked(self, week10):
        d = week10["sheets"]["Diesel Consumption"]
        by_name = {r["fleet_number_raw"]: r for r in d["rows"]}
        assert by_name["MECHANICS"]["is_cost_centre"] is True
        assert by_name["AC163"]["is_cost_centre"] is False
        assert by_name["AC163"]["amount_ngn"] == pytest.approx(96_000)


class TestContractSummaryOverview:
    def test_overview_fields(self, week10):
        s = week10["sheets"]["Contract Summary"]["snapshot"]
        assert s["original_contract_amount"] == pytest.approx(10_621_359_979.09)
        assert s["overdue_weeks"] == pytest.approx(-50.6, abs=0.1)
        assert s["gross_certified"] == pytest.approx(2_083_112_600.95, abs=0.01)
        assert s["retention_held"] == pytest.approx(203_181_862.59, abs=0.01)
        assert s["apg_amount"] == pytest.approx(1_500_000_000)
        assert s["bill1_requested"] == pytest.approx(49_933_962)
        assert s["bill1_paid"] == pytest.approx(43_357_962)
        assert s["bill1_outstanding"] == pytest.approx(6_576_000)


class TestCertificatesAndPayments:
    def test_certificates(self, week10):
        rows = week10["sheets"]["Certificate Status"]["rows"]
        assert len(rows) == 13
        cert1 = next(r for r in rows if r["cert_number"] == "1")
        assert cert1["gross_value_works_done"] == pytest.approx(292_876_150)

    def test_payments_reconcile(self, week10):
        sheet = week10["sheets"]["Payments Recieved"]
        assert len(sheet["rows"]) == 19
        assert not [w for w in sheet["warnings"] if "gross-deductions" in w]


class TestStoredOnlySheets:
    def test_not_parsed_but_present_in_manifest(self, week10):
        for name in STORED_ONLY_SHEETS:
            assert name not in week10["sheets"], f"{name} should not be parsed"
        assert week10["drift"]["clean"]  # manifest still verifies presence


class TestLists:
    def test_calendar(self, week10):
        weeks = week10["sheets"]["Lists"]["week_endings"]
        assert weeks[(2026, 10)] == date(2026, 3, 6)
        assert len(weeks) > 300


class TestWeek43AcrossYearBoundary:
    """The first workbook we hold — supplies the opening baseline."""

    def test_skeleton_identical_to_2026(self, week43, week10):
        k43 = [(r["bill_no"], r["item_code"], r["description"],
                str(r["contract_qty"]), str(r["rate"]))
               for r in week43["sheets"]["BEME & Works Completed Fd"]["rows"]]
        k10 = [(r["bill_no"], r["item_code"], r["description"],
                str(r["contract_qty"]), str(r["rate"]))
               for r in week10["sheets"]["BEME & Works Completed Fd"]["rows"]]
        assert k43 == k10

    def test_baseline_inputs_present(self, week43):
        rows = week43["sheets"]["BEME & Works Completed Fd"]["rows"]
        with_prev = [r for r in rows if (r["amount_previous_reported"] or 0) > 0]
        assert len(with_prev) > 20  # work existed before W43

    def test_parses_cleanly(self, week43):
        failed = {n for n, s in week43["sheets"].items() if s["status"] == "failed"}
        assert not failed
        assert week43["identity"]["short_name"] == "AKWA IBOM AIRPORT APRON"

    def test_bill6_break_existed_in_2025(self, week43):
        checks = week43["sheets"]["BEME & Works Completed Fd"]["cross_checks"]
        assert any(c["check"] == "bill_6_contract" for c in checks)


class TestWeek2:
    def test_parses_cleanly(self, week2):
        failed = {n for n, s in week2["sheets"].items() if s["status"] == "failed"}
        assert not failed

    def test_gap_derivation_inputs(self, week2, week43):
        """W2's reported-previous minus W43's cumulative = the missing-weeks
        gap: exactly 3 items, ₦425,055,750 total. Identity includes dup_seq
        (the workbook reuses code 3.07 for two different rows)."""
        def key(r):
            return (r["bill_no"], r["item_code"], r["dup_seq"])
        w43 = {key(r): r for r in
               week43["sheets"]["BEME & Works Completed Fd"]["rows"]}
        gap = {}
        for r in week2["sheets"]["BEME & Works Completed Fd"]["rows"]:
            prev2 = float(r["amount_previous_reported"] or 0)
            base = w43.get(key(r))
            done43 = (float(base["amount_previous_reported"] or 0)
                      + float(base["amount_this_week"] or 0)) if base else 0.0
            if abs(prev2 - done43) > 1:
                gap[r["item_code"]] = prev2 - done43
        assert set(gap) == {"4.04", "4.05", "4.06"}
        assert sum(gap.values()) == pytest.approx(425_055_750.0)
