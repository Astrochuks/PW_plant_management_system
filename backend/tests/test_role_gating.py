"""Roles v1 (migration 016) — module access by role.

management  = MD / GPM: plants + projects (read).
plant_officer = plants only; every /projects route must 403.
"""

import pytest

from app.core.security import CurrentUser, get_current_user


@pytest.fixture
def as_plant_officer(app, plant_officer_user):
    app.dependency_overrides[get_current_user] = (
        lambda: CurrentUser(**plant_officer_user)
    )
    yield
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def as_management(app, management_user):
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(**management_user)
    yield
    app.dependency_overrides.pop(get_current_user, None)


PROJECT_READ_ROUTES = [
    "/api/v1/projects",
    "/api/v1/projects/stats",
    "/api/v1/projects/submissions",
    "/api/v1/projects/unmapped-fleet-numbers",
]


class TestPlantOfficerBlockedFromProjects:
    @pytest.mark.parametrize("route", PROJECT_READ_ROUTES)
    def test_projects_reads_403(self, client, as_plant_officer, route):
        r = client.get(route)
        assert r.status_code == 403, f"{route} returned {r.status_code}"

    def test_project_detail_403(self, client, as_plant_officer):
        r = client.get("/api/v1/projects/00000000-0000-0000-0000-000000000000")
        assert r.status_code == 403


class TestPlantOfficerKeepsPlantAccess:
    def test_plants_list_allowed(self, client, as_plant_officer):
        r = client.get("/api/v1/plants?limit=1")
        if r.status_code == 503:
            pytest.skip("database unavailable")
        assert r.status_code == 200

    def test_locations_allowed(self, client, as_plant_officer):
        r = client.get("/api/v1/locations")
        if r.status_code == 503:
            pytest.skip("database unavailable")
        assert r.status_code == 200


class TestManagementKeepsProjectAccess:
    @pytest.mark.parametrize("route", PROJECT_READ_ROUTES)
    def test_projects_reads_200(self, client, as_management, route):
        r = client.get(route)
        if r.status_code == 503:
            pytest.skip("database unavailable")
        assert r.status_code == 200, f"{route} returned {r.status_code}"
