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


def _count(r) -> int:
    """Row count of an export.

    Exports stream a file now, so the count moved out of the body and
    into `X-Total-Count` — headers must be sent before the first row.
    """
    return int(r.headers["X-Total-Count"])


class TestExportPlants:
    def test_unfiltered_export_works(self, client, as_management):
        r = client.get("/api/v1/reports/export/plants")
        _skip_if_no_db(r)
        assert r.status_code == 200
        assert _count(r) > 0

    @pytest.mark.parametrize("cond", CONDITIONS)
    def test_every_condition_exports(self, client, as_management, cond):
        """Each of these was a 500 — WHERE status = $1 on a view with no
        status column."""
        r = client.get(f"/api/v1/reports/export/plants?condition={cond}")
        _skip_if_no_db(r)
        assert r.status_code == 200, r.text[:200]
        assert _count(r) >= 0

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
        assert _count(r) == _count(by_condition)

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
            parts += _count(r)

        # every plant carries a condition except a known handful with NULL
        assert 0 < parts <= _count(total)

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
        assert r.headers["content-type"].startswith("text/csv")


class TestExportsAreStreamedFiles:
    """The export sends the FILE, not a JSON envelope wrapping it.

    Buffering the whole result held ONE command open for the entire
    transfer. The view executes in ~8ms but shipping 2MB took ~16s, so it
    blew `command_timeout=15`, was retried, and then tripped
    `_try_recover_pool()` — one user pressing Export tore down the
    connection pool for every other request. Streaming through a cursor
    makes each FETCH its own short command.

    These lock the contract the frontend now depends on: bytes, a
    filename, and the count in a header.
    """

    ENDPOINTS = (
        "/api/v1/reports/export/plants",
        "/api/v1/reports/export/maintenance?year=2026",
    )

    @staticmethod
    def _url(path: str, fmt: str) -> str:
        return f"{path}{'&' if '?' in path else '?'}format={fmt}"

    @pytest.mark.parametrize("path", ENDPOINTS)
    def test_it_is_an_attachment_with_a_filename(self, client, as_management, path):
        r = client.get(self._url(path, "csv"))
        _skip_if_no_db(r)
        assert r.status_code == 200
        disposition = r.headers.get("content-disposition", "")
        assert "attachment" in disposition
        assert ".csv" in disposition

    @pytest.mark.parametrize("path", ENDPOINTS)
    def test_the_body_is_the_file_not_an_envelope(self, client, as_management, path):
        """The old shape was {success, data, format, count} and the browser
        unwrapped `data` to rebuild the file. If an envelope ever comes
        back, the user saves a .csv full of JSON."""
        r = client.get(self._url(path, "csv"))
        _skip_if_no_db(r)
        assert r.status_code == 200
        assert not r.text.lstrip().startswith('{"success"')

    @pytest.mark.parametrize("path", ENDPOINTS)
    def test_csv_row_count_matches_the_header(self, client, as_management, path):
        r = client.get(self._url(path, "csv"))
        _skip_if_no_db(r)
        assert r.status_code == 200
        n = _count(r)
        if n == 0:
            assert r.text == ""
            return
        # quoted fields may contain newlines, so count parsed rows
        import csv as _csv
        import io as _io

        rows = list(_csv.DictReader(_io.StringIO(r.text)))
        assert len(rows) == n

    @pytest.mark.parametrize("path", ENDPOINTS)
    def test_json_is_a_bare_array_of_the_same_length(
        self, client, as_management, path
    ):
        """`JSON.stringify(result.data, null, 2)` wrote the bare array, so
        a bare array is the same file the user already received."""
        import json as _json

        r = client.get(self._url(path, "json"))
        _skip_if_no_db(r)
        assert r.status_code == 200
        parsed = _json.loads(r.text)
        assert isinstance(parsed, list)
        assert len(parsed) == _count(r)

    def test_csv_carries_every_view_column(self, client, as_management):
        """Column set and order come from the row itself, so this catches a
        projection quietly narrowing what the user downloads."""
        r = client.get("/api/v1/reports/export/plants?format=csv")
        _skip_if_no_db(r)
        assert r.status_code == 200
        header = r.text.splitlines()[0].split(",")
        for col in ("fleet_number", "description", "condition",
                    "current_location", "total_maintenance_cost",
                    "shared_po_count"):
            assert col in header, f"{col} missing from the export"

    def test_the_count_header_is_exposed_to_the_browser(self, client, as_management):
        """Cross-origin a header is invisible to JS unless exposed, and the
        page reads the count from it to say "Exported N records"."""
        r = client.get("/api/v1/reports/export/plants?format=csv")
        _skip_if_no_db(r)
        exposed = r.headers.get("access-control-expose-headers", "")
        assert "X-Total-Count" in exposed
        assert "Content-Disposition" in exposed


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
