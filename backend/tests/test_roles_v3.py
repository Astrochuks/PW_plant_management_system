"""Roles v3 (migration 035, PRD v2 §2) — who gets through which gate.

Pure unit tests over the gate functions and the request models; no
database. The migration itself is checked by scripts/verify_roles_v3.py.
"""

import pytest
from pydantic import ValidationError as PydanticValidationError

from app.api.v1.auth import AssignableRole, CreateUserRequest, UpdateUserRequest
from app.core.exceptions import AuthorizationError
from app.core.security import (
    PROJECT_MANAGER_ROLES,
    CurrentUser,
    require_admin,
    require_management_or_admin,
    require_projects_access,
)


def _user(role: str) -> CurrentUser:
    return CurrentUser(id="00000000-0000-0000-0000-000000000001",
                       email=f"{role}@example.com", role=role)


# ── the vocabulary ────────────────────────────────────────────────────────

def test_assignable_roles_are_exactly_the_four_seats():
    assert set(AssignableRole.__args__) == {
        "admin", "project_manager", "plant_officer", "site_engineer"}


def test_parked_values_still_resolve_to_the_project_manager_tier():
    # cached sessions / stray rows must not be locked out by the rename
    assert {"managing_director", "general_project_manager", "management"} <= PROJECT_MANAGER_ROLES
    for parked in ("managing_director", "general_project_manager", "management"):
        assert _user(parked).is_project_manager


# ── the gates ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("role,allowed", [
    ("admin", True), ("project_manager", True),
    ("plant_officer", False), ("site_engineer", False),
])
def test_projects_gate(role, allowed):
    if allowed:
        assert require_projects_access(_user(role)).role == role
    else:
        with pytest.raises(AuthorizationError):
            require_projects_access(_user(role))


@pytest.mark.parametrize("role,allowed", [
    ("admin", True), ("plant_officer", True),
    ("project_manager", False),   # roles v3: PM has NO plant access
    ("site_engineer", False),
    ("managing_director", False),  # parked value behaves as PM
])
def test_plant_gate(role, allowed):
    if allowed:
        assert require_management_or_admin(_user(role)).role == role
    else:
        with pytest.raises(AuthorizationError):
            require_management_or_admin(_user(role))


@pytest.mark.parametrize("role,allowed", [
    ("admin", True), ("plant_officer", True), ("project_manager", True),
    ("site_engineer", False),
])
def test_shared_read_gate_states_and_sites_lists(role, allowed):
    """States and sites are master data both modules reference: the project
    manager may READ the lists (register filters, site link) without any
    other plant access."""
    from app.core.security import require_shared_read
    if allowed:
        assert require_shared_read(_user(role)).role == role
    else:
        with pytest.raises(AuthorizationError):
            require_shared_read(_user(role))


def test_admin_gate_admits_only_admin():
    assert require_admin(_user("admin")).is_admin
    for role in ("project_manager", "plant_officer", "site_engineer"):
        with pytest.raises(AuthorizationError):
            require_admin(_user(role))


# ── user creation / update models ─────────────────────────────────────────

def test_site_engineer_can_be_created_without_a_location():
    req = CreateUserRequest(email="eng@example.com", password="Secur3pass!",
                            full_name="Site Engineer", role="site_engineer")
    assert req.location_id is None


@pytest.mark.parametrize("parked", ["managing_director", "general_project_manager", "management"])
def test_parked_roles_cannot_be_assigned(parked):
    with pytest.raises(PydanticValidationError):
        CreateUserRequest(email="x@example.com", password="Secur3pass!",
                          full_name="Someone", role=parked)  # type: ignore[arg-type]
    with pytest.raises(PydanticValidationError):
        UpdateUserRequest(role=parked)  # type: ignore[arg-type]


def test_project_manager_is_assignable():
    assert UpdateUserRequest(role="project_manager").role == "project_manager"
    assert CreateUserRequest(email="pm@example.com", password="Secur3pass!",
                             full_name="Engr. Buge", role="project_manager").role == "project_manager"


# ── project scope resolution on user create/update (PRD v2 §3.5) ──────────

def test_resolve_project_scope_rules():
    from app.api.v1.auth import resolve_project_scope
    from app.core.exceptions import ValidationError
    assert resolve_project_scope("site_engineer", None, ["p1"]) == "assigned"
    assert resolve_project_scope("site_engineer", "all", ["p1"]) == "assigned"   # cannot widen
    assert resolve_project_scope("project_manager", None, None) == "all"          # the General PM
    assert resolve_project_scope("project_manager", "assigned", ["p1"]) == "assigned"
    assert resolve_project_scope("admin", "assigned", None) == "all"              # never consulted
    with pytest.raises(ValidationError):
        resolve_project_scope("project_manager", "assigned", [])                  # needs ≥ 1 project
    with pytest.raises(ValidationError):
        resolve_project_scope("project_manager", "all", ["p1"])                   # projects need 'assigned'
    with pytest.raises(ValidationError):
        resolve_project_scope("plant_officer", None, ["p1"])
