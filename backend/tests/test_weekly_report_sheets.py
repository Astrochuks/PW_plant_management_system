"""T2.4–T2.13 — sheet parsers vs the real Akwa Ibom workbooks.

Golden file freezes the full Week 10 parse; spot checks pin known real
values so a parser regression can never slip through as 'row counts
still match'.

Regenerate deliberately: UPDATE_GOLDEN=1 pytest tests/test_weekly_report_sheets.py
"""

import json
import math
import os
from datetime import date, datetime
from pathlib import Path

import openpyxl
import pytest

from app.services.weekly_report_sheets import parse_workbook

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


class TestSpotChecksWeek10:
    """Hand-verified values from the actual sheets."""

    def test_all_sheets_parse_without_failures(self, week10):
        failed = {
            n: s.get("error") for n, s in week10["sheets"].items()
            if s["status"] == "failed"
        }
        assert not failed, failed
        assert week10["drift"]["clean"]

    def test_identity(self, week10):
        idy = week10["identity"]
        assert idy["short_name"] == "AKWA IBOM AIRPORT APRON"
        assert idy["original_contract_amount"] == pytest.approx(10621359979.09)
        assert idy["award_date"] == date(2020, 11, 14)
        assert idy["original_duration_months"] == 12

    def test_plant_return(self, week10):
        rows = week10["sheets"]["Plant Return"]["rows"]
        assert len(rows) == 126
        ac163 = next(r for r in rows if r["fleet_number_raw"] == "AC163")
        assert ac163["hours_worked"] == 0
        assert ac163["breakdown_hours"] == 63
        assert ac163["rate_ngn"] == 10920
        bp4 = next(r for r in rows if r["fleet_number_raw"] == "BP4")
        assert bp4["plant_cost"] == pytest.approx(3198700)

    def test_diesel(self, week10):
        sheet = week10["sheets"]["Diesel Consumption"]
        rows = sheet["rows"]
        eg172 = next(r for r in rows if r["fleet_number_raw"] == "EG172")
        assert eg172["saturday_litres"] == 50
        assert eg172["friday_litres"] == 120
        total = sum(v for k, v in eg172.items() if k.endswith("_litres"))
        assert total == 550
        # The workbook's own arithmetic is off by 171L — must be SURFACED
        assert any("Used This Week" in w for w in sheet["warnings"])

    def test_certificates(self, week10):
        rows = week10["sheets"]["Certificate Status"]["rows"]
        assert len(rows) == 13
        cert1 = next(r for r in rows if r["cert_number"] == "1")
        assert cert1["gross_value_works_done"] == pytest.approx(292876150)
        assert cert1["total_retention_held"] == pytest.approx(14643807.5)

    def test_payments_reconcile(self, week10):
        sheet = week10["sheets"]["Payments Recieved"]
        rows = sheet["rows"]
        assert len(rows) == 19
        advance = next(r for r in rows if r["voucher_number"] == "Advance")
        assert advance["gross_amount"] == pytest.approx(1593203996.86)
        assert advance["net_amount"] == pytest.approx(1409985537.2210999)
        # gross − deductions == net on every row → no warnings
        assert not [w for w in sheet["warnings"] if "gross-deductions" in w]

    def test_beme(self, week10):
        rows = week10["sheets"]["BEME & Works Completed Fd"]["rows"]
        assert len(rows) == 112
        mob = next(r for r in rows if r["item_code"] == "1.01")
        assert "mobilization" in mob["description"].lower()
        assert mob["contract_amount"] == pytest.approx(69000000)
        assert mob["pct_complete"] == pytest.approx(0.7246, rel=1e-3)
        # bills detected beyond bill 1
        assert {r["bill_no"] for r in rows} >= {2}

    def test_cost_report_sections(self, week10):
        rows = week10["sheets"]["Cost Report"]["rows"]
        diesel = next(r for r in rows if r["description"] == "Diesel")
        assert diesel["section"] == "PLANT DEPARTMENT"
        assert diesel["cost_category"] == "AGO"
        assert diesel["amount_this_week"] == pytest.approx(13753600)

    def test_labour(self, week10):
        rows = week10["sheets"]["Labour Strength"]["rows"]
        plant = next(r for r in rows if r["department"] == "Plant")
        assert plant["manning_this_week"] == 15

    def test_subcontractor_carry_forward(self, week10):
        rows = week10["sheets"]["Subcontractors"]["rows"]
        paschal = [r for r in rows if r["subcontractor_name"]
                   and "PASCHAL" in r["subcontractor_name"]]
        # blank continuation rows inherit the name above
        assert len(paschal) >= 8

    def test_materials(self, week10):
        rows = week10["sheets"]["Materials & Civils"]["rows"]
        bulk = next(r for r in rows if "Bulk" in r["material_name"])
        assert bulk["unit_cost"] == 75000
        assert bulk["opening_stock"] == pytest.approx(12.925)

    def test_lists_calendar(self, week10):
        weeks = week10["sheets"]["Lists"]["week_endings"]
        assert weeks[(2026, 10)] == date(2026, 3, 6)
        assert len(weeks) > 300  # 2020–2031 span
        ref = week10["sheets"]["Lists"]["reference"]
        assert len(ref) > 20


class TestWeek2:
    def test_parses_cleanly(self, week2):
        failed = {n for n, s in week2["sheets"].items() if s["status"] == "failed"}
        assert not failed
        assert week2["identity"]["short_name"] == "AKWA IBOM AIRPORT APRON"

    def test_core_sheets_have_rows(self, week2):
        for sheet in ("Plant Return", "Diesel Consumption", "Cost Report",
                      "Certificate Status", "Payments Recieved",
                      "BEME & Works Completed Fd", "Labour Strength"):
            rows = week2["sheets"][sheet].get("rows", [])
            assert len(rows) > 0, f"{sheet}: no rows in week 2"
