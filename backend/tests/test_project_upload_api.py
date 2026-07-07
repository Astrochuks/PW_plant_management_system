"""T2.14/T2.19 — upload + submissions API: gating and validation.

Worker/persistence logic is covered by test_weekly_report_import; these
verify the HTTP surface (roles, validation, list/detail shapes).
"""

import pytest

from app.core.security import CurrentUser, get_current_user


@pytest.fixture
def as_admin(app, admin_user):
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(**admin_user)
    yield
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def as_management(app, management_user):
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(**management_user)
    yield
    app.dependency_overrides.pop(get_current_user, None)


class TestUploadValidation:
    def test_requires_auth(self, client):
        r = client.post("/api/v1/projects/upload-weekly-report")
        assert r.status_code == 401

    def test_management_cannot_upload(self, client, as_management):
        r = client.post(
            "/api/v1/projects/upload-weekly-report",
            files={"file": ("x.xlsx", b"fake", "application/octet-stream")},
            data={"project_id": "00000000-0000-0000-0000-000000000000",
                  "year": "2026", "week_number": "10"},
        )
        assert r.status_code == 403

    def test_rejects_non_xlsx(self, client, as_admin):
        r = client.post(
            "/api/v1/projects/upload-weekly-report",
            files={"file": ("report.pdf", b"fake", "application/pdf")},
            data={"project_id": "00000000-0000-0000-0000-000000000000",
                  "year": "2026", "week_number": "10"},
        )
        assert r.status_code == 422

    def test_rejects_bad_week(self, client, as_admin):
        r = client.post(
            "/api/v1/projects/upload-weekly-report",
            files={"file": ("report.xlsx", b"fake", "application/octet-stream")},
            data={"project_id": "00000000-0000-0000-0000-000000000000",
                  "year": "2026", "week_number": "77"},
        )
        assert r.status_code == 422

    def test_unknown_project_404(self, client, as_admin):
        r = client.post(
            "/api/v1/projects/upload-weekly-report",
            files={"file": ("report.xlsx", b"fake", "application/octet-stream")},
            data={"project_id": "00000000-0000-0000-0000-000000000000",
                  "year": "2026", "week_number": "10"},
        )
        if r.status_code == 503:
            pytest.skip("database unavailable")
        assert r.status_code == 404


class TestSubmissionsRead:
    def test_list_shape(self, client, as_management):
        r = client.get("/api/v1/projects/submissions?limit=5")
        if r.status_code == 503:
            pytest.skip("database unavailable")
        assert r.status_code == 200
        body = r.json()
        assert "meta" in body and body["meta"]["total"] >= 9  # the batch ingest
        row = body["data"][0]
        assert {"status", "week_number", "short_name", "row_counts"} <= set(row)

    def test_status_filter_validated(self, client, as_management):
        r = client.get("/api/v1/projects/submissions?status=bogus")
        assert r.status_code == 422

    def test_detail_404(self, client, as_management):
        r = client.get(
            "/api/v1/projects/submissions/00000000-0000-0000-0000-000000000000"
        )
        if r.status_code == 503:
            pytest.skip("database unavailable")
        assert r.status_code == 404

    def test_retry_admin_only(self, client, as_management):
        r = client.post(
            "/api/v1/projects/submissions/00000000-0000-0000-0000-000000000000/retry"
        )
        assert r.status_code == 403
