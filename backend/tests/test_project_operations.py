"""Operations endpoints (Phase 3) — recomputed weekly aggregates.

Runs against the live dev DB, which holds all 10 Akwa Ibom weeks
(2025 W43 + 2026 W2–W10). Read-only; skips cleanly if the DB is unreachable.
"""

import pytest

from app.core.security import CurrentUser, get_current_user


@pytest.fixture
def as_management(app, management_user):
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(**management_user)
    yield
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def as_plant_officer(app, plant_officer_user):
    app.dependency_overrides[get_current_user] = (
        lambda: CurrentUser(**plant_officer_user)
    )
    yield
    app.dependency_overrides.pop(get_current_user, None)


def _akwa_project_id(client) -> str:
    """The Akwa Ibom airport apron project, by name — the registry is the
    lookup now that the Site Operations portfolio endpoint is retired."""
    r = client.get("/api/v1/projects", params={"search": "AKWA IBOM"})
    if r.status_code == 503:
        pytest.skip("database unavailable")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data, "Akwa Ibom project not in the registry"
    return data[0]["id"]


class TestAccess:
    def test_plant_officer_blocked(self, client, as_plant_officer):
        assert client.get("/api/v1/projects").status_code == 403


class TestSummary:
    def test_summary_matches_portfolio(self, client, as_management):
        pid = _akwa_project_id(client)
        r = client.get(f"/api/v1/projects/{pid}/operations/summary")
        assert r.status_code == 200
        d = r.json()["data"]
        assert d["totals"]["weeks_received"] == 10
        assert d["latest_snapshot"] is not None
        assert float(d["latest_snapshot"]["current_contract_amount"]) == pytest.approx(
            10621359979.09
        )

    def test_summary_404(self, client, as_management):
        r = client.get(
            "/api/v1/projects/00000000-0000-0000-0000-000000000000/operations/summary"
        )
        if r.status_code == 503:
            pytest.skip("database unavailable")
        assert r.status_code == 404


class TestSeries:
    def test_weekly_series_sums_to_totals(self, client, as_management):
        pid = _akwa_project_id(client)
        weekly = client.get(
            f"/api/v1/projects/{pid}/operations/series?granularity=week"
        ).json()["data"]
        assert len(weekly) == 10
        assert [w["week_number"] for w in weekly] == [43] + list(range(2, 11))

        summary = client.get(
            f"/api/v1/projects/{pid}/operations/summary"
        ).json()["data"]["totals"]

        for key in ("hours_worked", "breakdown_hours", "diesel_litres",
                    "plant_cost_ngn"):
            series_sum = sum(float(w[key] or 0) for w in weekly)
            assert series_sum == pytest.approx(float(summary[key]), rel=1e-6), key

    def test_monthly_series_sums_to_totals(self, client, as_management):
        pid = _akwa_project_id(client)
        monthly = client.get(
            f"/api/v1/projects/{pid}/operations/series?granularity=month"
        ).json()["data"]
        assert 1 <= len(monthly) <= 5
        assert sum(m["weeks_in_month"] for m in monthly) == 10

        summary = client.get(
            f"/api/v1/projects/{pid}/operations/summary"
        ).json()["data"]["totals"]
        for key in ("hours_worked", "diesel_litres", "plant_cost_ngn"):
            series_sum = sum(float(m[key] or 0) for m in monthly)
            assert series_sum == pytest.approx(float(summary[key]), rel=1e-6), key

    def test_bad_granularity_422(self, client, as_management):
        pid = _akwa_project_id(client)
        r = client.get(f"/api/v1/projects/{pid}/operations/series?granularity=day")
        assert r.status_code == 422


class TestFinancials:
    def test_weekly_net_matches_sheet_arithmetic(self, client, as_management):
        """Our recomputed net must equal the sheet's own Net Earnings row
        for EVERY week — (works subtotal + 7.5% VAT) − recomputed costs."""
        pid = _akwa_project_id(client)
        r = client.get(f"/api/v1/projects/{pid}/operations/financials")
        assert r.status_code == 200
        d = r.json()["data"]
        assert len(d["weeks"]) == 10
        assert d["cross_check_warnings"] == []

        w10 = next(w for w in d["weeks"] if w["week_number"] == 10)
        assert w10["works_value"] == pytest.approx(294_550_350.0)
        assert w10["cost_total"] == pytest.approx(196_009_206.03, abs=0.01)
        assert w10["net"] == pytest.approx(120_632_420.22, abs=0.5)
        assert w10["sheet_net"] == pytest.approx(w10["net"], abs=0.5)
        assert w10["diesel_cost"] == pytest.approx(13_753_600.0)
        assert w10["diesel_litres"] > 5000

        # every week individually reconciles with the sheet
        for w in d["weeks"]:
            if w["sheet_net"] is not None:
                assert w["net"] == pytest.approx(w["sheet_net"], abs=1.0), \
                    f"W{w['week_number']}"

    def test_totals_and_bills(self, client, as_management):
        pid = _akwa_project_id(client)
        d = client.get(
            f"/api/v1/projects/{pid}/operations/financials"
        ).json()["data"]
        t = d["totals"]
        assert t["net"] == pytest.approx(
            sum(w["net"] for w in d["weeks"]), abs=0.5)
        assert t["weeks_gaining"] + t["weeks_losing"] <= 10
        assert t["diesel_cost"] > 0 and t["diesel_litres"] > 50_000
        assert "AGO" in t["cost_by_category"]
        assert len(d["bills"]) >= 5  # BEME bills with % complete

    def test_plant_officer_blocked(self, client, as_plant_officer):
        assert client.get("/api/v1/projects").status_code == 403


class TestPlantsRollup:
    def test_per_plant_totals(self, client, as_management):
        pid = _akwa_project_id(client)
        r = client.get(f"/api/v1/projects/{pid}/operations/plants")
        assert r.status_code == 200
        rows = r.json()["data"]
        assert len(rows) > 100  # ~126 plants on site

        # rollup must equal the summary totals
        summary = client.get(
            f"/api/v1/projects/{pid}/operations/summary"
        ).json()["data"]["totals"]
        assert sum(float(p["hours_worked"]) for p in rows) == pytest.approx(
            float(summary["hours_worked"]), rel=1e-9)
        assert sum(float(p["diesel_litres"]) for p in rows) == pytest.approx(
            float(summary["diesel_litres"]), rel=1e-9)

        # resolved plants carry register identity + condition
        ac163 = next(p for p in rows if p["fleet_number_raw"] == "AC163")
        assert ac163["fleet_number"] == "AC163"
        assert ac163["condition"] is not None
        assert ac163["weeks_seen"] == 10


class TestCommercialPosition:
    """Locked 2026-07-11: certified/paid/outstanding come from the cert +
    payments LEDGERS — Contract Summary's client position is frozen ~2023."""

    def test_commercial_from_ledgers(self, client, as_management):
        pid = _akwa_project_id(client)
        r = client.get(f"/api/v1/projects/{pid}/operations/summary")
        assert r.status_code == 200
        c = r.json()["data"]["commercial"]
        assert float(c["certified_cumulative"]) == pytest.approx(12_741_757_149.69)
        assert float(c["retention_held"]) == pytest.approx(637_087_857.48, abs=0.01)
        assert float(c["advances_gross"]) == pytest.approx(2_655_339_994.77)
        assert float(c["cert_payments_gross"]) == pytest.approx(10_944_513_399.44)
        # the MD number: certified but unpaid
        assert float(c["certified_unpaid"]) == pytest.approx(1_797_243_750.25)
        # and it must NOT equal the frozen snapshot figure
        snap = r.json()["data"]["latest_snapshot"]
        assert float(snap["works_certified"]) != pytest.approx(
            float(c["certified_cumulative"]))
