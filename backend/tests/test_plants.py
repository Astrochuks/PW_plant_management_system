"""Tests for plant endpoints.

Auth is faked via FastAPI dependency_overrides (the only mechanism that
actually intercepts a resolved dependency — patching the module function
does nothing once the router has captured the reference).

Read-only endpoints hit the real database through the app's pool; tests
skip if it is unreachable so the unit suite stays runnable offline.
"""

import pytest

from app.core.security import CurrentUser, get_current_user


def _override_user(app, user_dict):
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(**user_dict)


@pytest.fixture(autouse=True)
def _clean_overrides(app):
    yield
    app.dependency_overrides.pop(get_current_user, None)


class TestPlantsEndpoints:
    def test_list_plants_unauthorized(self, client):
        response = client.get("/api/v1/plants")
        assert response.status_code == 401

    def test_list_plants_with_auth(self, client, app, admin_user):
        _override_user(app, admin_user)
        response = client.get("/api/v1/plants?page=1&page_size=5")
        if response.status_code == 503:
            pytest.skip("database unavailable")
        assert response.status_code == 200
        body = response.json()
        assert "data" in body and isinstance(body["data"], list)

    def test_get_plant_not_found(self, client, app, admin_user):
        _override_user(app, admin_user)
        response = client.get("/api/v1/plants/00000000-0000-0000-0000-000000000000")
        if response.status_code == 503:
            pytest.skip("database unavailable")
        assert response.status_code == 404


class TestPlantCreation:
    def test_create_plant_requires_admin(self, client, app, management_user):
        _override_user(app, management_user)
        response = client.post(
            "/api/v1/plants",
            json={"fleet_number": "PW 999", "description": "Test"},
        )
        # Role check fires before any DB write
        assert response.status_code == 403


class TestPlantValidation:
    def test_fleet_number_required(self, client, app, admin_user):
        _override_user(app, admin_user)
        response = client.post(
            "/api/v1/plants",
            json={"description": "Missing fleet number"},
        )
        assert response.status_code == 422
