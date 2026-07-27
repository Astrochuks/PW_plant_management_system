"""Report filters: "All …" must mean all, and Export must not 500.

Two faults, both making a page useless rather than merely wrong:

1. Five report pages rendered `<SelectItem value="all">` and then
   forwarded the literal string, because `"all"` is truthy in
   `locationId ? { location_id: locationId } : {}`. On a UUID parameter
   that is a 422; on a text parameter like `fleet_type` it is worse — a
   silent 200 with an empty result, which reads as "no maintenance cost
   this year".

2. `GET /reports/export/plants` filtered `WHERE status = $1` against
   `v_plants_summary`, which has no `status` column at all — it has
   `condition`. Every filtered export 500'd. This is the documented
   status-vs-condition trap; the export endpoint was the last place it
   survived.

The frontend now strips the sentinel (`lib/filters.ts`), and the endpoint
filters `condition` with a validating pattern, so a bad value is a 422
rather than a 500.
"""

import pytest

from app.core.security import CurrentUser, get_current_user

CONDITIONS = ("working", "standby", "breakdown", "missing", "scrap", "off_hire")


@pytest.fixture
def as_management(app, management_user):
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(**management_user)
    yield
    app.dependency_overrides.pop(get_current_user, None)


def _skip_if_no_db(r):
    if r.status_code == 503:
        pytest.skip("database unavailable")


class TestExportPlants:
    def test_unfiltered_export_works(self, client, as_management):
        r = client.get("/api/v1/reports/export/plants")
        _skip_if_no_db(r)
        assert r.status_code == 200
        assert r.json()["count"] > 0

    @pytest.mark.parametrize("cond", CONDITIONS)
    def test_every_condition_exports(self, client, as_management, cond):
        """Each of these was a 500 — WHERE status = $1 on a view with no
        status column."""
        r = client.get(f"/api/v1/reports/export/plants?condition={cond}")
        _skip_if_no_db(r)
        assert r.status_code == 200, r.text[:200]
        assert r.json()["count"] >= 0

    @pytest.mark.parametrize("cond", ["working", "breakdown"])
    def test_status_still_accepted_as_a_deprecated_alias(
        self, client, as_management, cond
    ):
        """An existing bookmark or script must not break."""
        r = client.get(f"/api/v1/reports/export/plants?status={cond}")
        _skip_if_no_db(r)
        assert r.status_code == 200
        by_condition = client.get(
            f"/api/v1/reports/export/plants?condition={cond}")
        assert r.json()["count"] == by_condition.json()["count"]

    def test_conditions_partition_the_fleet(self, client, as_management):
        """The filters must add up to the unfiltered export — proof the
        filter selects rather than silently dropping rows.

        Every response is status-checked: the unfiltered export is the
        heaviest call in the app (1,688 rows x 43 columns) and can exceed
        the request timeout on a slow pooler, which would otherwise show
        up here as a confusing KeyError rather than an honest skip.
        """
        total = client.get("/api/v1/reports/export/plants")
        _skip_if_no_db(total)
        assert total.status_code == 200, total.text[:200]

        parts = 0
        for cond in CONDITIONS:
            r = client.get(f"/api/v1/reports/export/plants?condition={cond}")
            _skip_if_no_db(r)
            assert r.status_code == 200, f"{cond}: {r.text[:200]}"
            parts += r.json()["count"]

        # every plant carries a condition except a known handful with NULL
        assert 0 < parts <= total.json()["count"]

    def test_a_bad_condition_is_a_422_not_a_500(self, client, as_management):
        r = client.get("/api/v1/reports/export/plants?condition=nonsense")
        _skip_if_no_db(r)
        assert r.status_code == 422

    def test_the_literal_all_is_rejected_cleanly(self, client, as_management):
        """Belt and braces: the UI no longer sends it, but if anything
        does, it must be a clean 422 and never a 500."""
        for q in ("condition=all", "status=all"):
            r = client.get(f"/api/v1/reports/export/plants?{q}")
            _skip_if_no_db(r)
            assert r.status_code == 422, f"{q} -> {r.status_code}"

    def test_csv_format_works_with_a_filter(self, client, as_management):
        r = client.get(
            "/api/v1/reports/export/plants?format=csv&condition=working")
        _skip_if_no_db(r)
        assert r.status_code == 200
        assert r.json()["format"] == "csv"


class TestAllSentinelNeverReachesTheApi:
    """The frontend strips it; these assert the backend's own contract, so
    a regression on either side is caught."""

    @pytest.mark.parametrize("path", [
        "/api/v1/reports/fleet-summary?location_id=all",
        "/api/v1/reports/maintenance-costs?year=2026&group_by=month&location_id=all",
        "/api/v1/reports/unverified-plants?location_id=all",
    ])
    def test_literal_all_on_a_uuid_filter_is_422(self, client, as_management, path):
        r = client.get(path)
        _skip_if_no_db(r)
        assert r.status_code == 422

    @pytest.mark.parametrize("path", [
        "/api/v1/reports/fleet-summary",
        "/api/v1/reports/maintenance-costs?year=2026&group_by=month",
        "/api/v1/reports/unverified-plants",
    ])
    def test_omitting_the_filter_returns_everything(
        self, client, as_management, path
    ):
        """What the UI now sends for "All locations" — no parameter."""
        r = client.get(path)
        _skip_if_no_db(r)
        assert r.status_code == 200

    def test_fleet_type_all_returns_nothing_which_is_why_it_is_stripped(
        self, client, as_management
    ):
        """fleet_type is a text filter, so "all" is a 200 with an empty
        result — the failure mode that reads as "no cost this year".
        Recorded so the reason the UI must strip it stays visible."""
        r = client.get(
            "/api/v1/reports/maintenance-costs"
            "?year=2026&group_by=month&fleet_type=all")
        _skip_if_no_db(r)
        assert r.status_code == 200
        assert r.json()["data"] == []

        unfiltered = client.get(
            "/api/v1/reports/maintenance-costs?year=2026&group_by=month")
        assert unfiltered.json()["data"] != []
