"""Report generator: as-of-date correctness + internal consistency.

Born from the Q1 2026 incident: a quarterly report generated in April
showed April's fleet (current-state queries) and three maintenance
sections that disagreed with each other (different filter universes).

Rules enforced here:
  1. Historical reports show the fleet AS OF the period end.
  2. Every breakdown in a report ties out to its own headline. Always.
"""

from datetime import date

import pytest

from app.core.security import CurrentUser, get_current_user

Q1_PARAMS = "period=quarterly&date=2026-02-15"  # Q1 2026 (ends 2026-03-31)


@pytest.fixture
def as_admin(app, admin_user):
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(**admin_user)
    yield
    app.dependency_overrides.pop(get_current_user, None)


def _get_report(client, params):
    r = client.get(f"/api/v1/reports/generate?{params}")
    if r.status_code == 503:
        pytest.skip("database unavailable")
    assert r.status_code == 200, r.text
    return r.json()["data"]


class TestAsOfCorrectness:
    async def test_q1_total_is_the_q1_fleet_not_todays(self, client, as_admin, db_conn):
        report = _get_report(client, Q1_PARAMS)
        assert report["meta"]["historical"] is True
        assert report["meta"]["as_of"] == "2026-03-31"

        expected_q1 = await db_conn.fetchval(
            """SELECT count(DISTINCT plant_id) FROM plant_weekly_records
               WHERE week_ending_date <= '2026-03-31'"""
        )
        today_total = await db_conn.fetchval("SELECT count(*) FROM plants_master")

        assert report["fleet_condition"]["total_plants"] == expected_q1
        # The original bug: Q1 total == today's total. Guard against it
        # for as long as the fleet keeps growing.
        if expected_q1 != today_total:
            assert report["fleet_condition"]["total_plants"] != today_total

    def test_current_period_is_live(self, client, as_admin):
        report = _get_report(client, f"period=weekly&date={date.today().isoformat()}")
        assert report["meta"]["historical"] is False
        assert report["meta"]["as_of"] == "live"


class TestInternalConsistency:
    """Every number must tie out — on BOTH historical and live reports."""

    _cache: dict = {}

    @pytest.fixture(params=[Q1_PARAMS, "period=weekly"], ids=["Q1-historical", "live"])
    def report(self, request, client, as_admin):
        # One generation per param for the whole class — each report is
        # ~10 queries against the real DB and the payload is immutable here.
        if request.param not in self._cache:
            self._cache[request.param] = _get_report(client, request.param)
        return self._cache[request.param]

    def test_conditions_sum_to_total(self, report):
        fc = report["fleet_condition"]
        listed = (
            fc["working"] + fc["standby"] + fc["breakdown"]
            + fc["missing"] + fc["scrap"] + fc["off_hire"] + fc["unknown"]
        )
        assert listed == fc["total_plants"], fc

    def test_fleet_types_sum_to_total(self, report):
        assert sum(r["total"] for r in report["fleet_by_type"]) == \
            report["fleet_condition"]["total_plants"]

    def test_states_sum_to_total(self, report):
        assert sum(r["total_plants"] for r in report["states_summary"]) == \
            report["fleet_condition"]["total_plants"]

    def test_sites_sum_to_total(self, report):
        assert sum(r["total_plants"] for r in report["sites_breakdown"]) == \
            report["fleet_condition"]["total_plants"]

    def test_per_plant_maintenance_ties_to_headline(self, report):
        sp = report["spare_parts"]
        listed = sum(r["total_spend"] for r in sp["high_cost_plants"])
        assert abs(listed - sp["summary"]["total_spend"]) < 0.01, (
            f"per-plant {listed:,.2f} != headline {sp['summary']['total_spend']:,.2f}"
        )

    def test_site_spend_ties_to_headline(self, report):
        sp = report["spare_parts"]
        listed = sum(r["total_spend"] for r in sp["sites_ranking"])
        assert abs(listed - sp["summary"]["total_spend"]) < 0.01, (
            f"site ranking {listed:,.2f} != headline {sp['summary']['total_spend']:,.2f}"
        )

    def test_no_retired_conditions_in_payload(self, report):
        assert "under_repair" not in report["fleet_condition"]
        assert "faulty" not in report["fleet_condition"]
        for row in report["fleet_by_type"]:
            assert "under_repair" not in row
