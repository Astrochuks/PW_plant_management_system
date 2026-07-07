"""Operations endpoints (Phase 3) — recomputed weekly aggregates.

Runs against the live dev DB, which holds all 9 Akwa Ibom weeks
(2026 W2–W10). Read-only; skips cleanly if the DB is unreachable.
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
    r = client.get("/api/v1/projects/operations")
    if r.status_code == 503:
        pytest.skip("database unavailable")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data, "no projects with weekly data"
    return data[0]["id"]


class TestPortfolio:
    def test_portfolio_shape_and_consistency(self, client, as_management):
        r = client.get("/api/v1/projects/operations")
        if r.status_code == 503:
            pytest.skip("database unavailable")
        assert r.status_code == 200
        rows = r.json()["data"]
        assert len(rows) >= 1
        akwa = rows[0]
        assert akwa["weeks_received"] == 9
        assert akwa["first_week"] == 2 and akwa["last_week"] == 10
        # the numbers quoted to the GPM
        assert 15000 < float(akwa["hours_worked"]) < 17000
        assert 50000 < float(akwa["diesel_litres"]) < 60000
        assert float(akwa["plant_cost_ngn"]) > 100_000_000
        assert akwa["days_since_last_report"] is not None

    def test_plant_officer_blocked(self, client, as_plant_officer):
        assert client.get("/api/v1/projects/operations").status_code == 403


class TestSummary:
    def test_summary_matches_portfolio(self, client, as_management):
        pid = _akwa_project_id(client)
        r = client.get(f"/api/v1/projects/{pid}/operations/summary")
        assert r.status_code == 200
        d = r.json()["data"]
        assert d["totals"]["weeks_received"] == 9
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
        assert len(weekly) == 9
        assert [w["week_number"] for w in weekly] == list(range(2, 11))

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
        assert 1 <= len(monthly) <= 4
        assert sum(m["weeks_in_month"] for m in monthly) == 9

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
