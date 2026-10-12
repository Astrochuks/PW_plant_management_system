"""Project scoping + register rules (PRD v2 §2, §3.5, §4, §8) — pure unit tests.

No database: the SQL builder, the gate, the lifecycle transitions and the
request models. The applied-migration checks live in
scripts/verify_project_history.py.
"""

import pytest
from pydantic import ValidationError as PydanticValidationError

from app.api.v1.project_register import (
    ALLOWED_TRANSITIONS,
    STATUSES,
    ContractSumIn,
    transition_allowed,
)
from app.core.exceptions import AuthorizationError
from app.core.project_scope import is_scoped, scope_condition
from app.core.security import CurrentUser, require_projects_read


def _user(role: str, scope: str = "all") -> CurrentUser:
    return CurrentUser(id="00000000-0000-0000-0000-000000000001",
                       email=f"{role}@example.com", role=role, project_scope=scope)


# ── who is scoped ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("role,scope,expected", [
    ("admin", "all", False), ("admin", "assigned", False),          # never consulted
    ("plant_officer", "assigned", False),
    ("project_manager", "all", False),                               # the General PM
    ("project_manager", "assigned", True),                           # project-scoped PM
    ("site_engineer", "all", True),                                  # always scoped
    ("site_engineer", "assigned", True),
    ("general_project_manager", "all", False),                       # parked value = PM
])
def test_is_scoped(role, scope, expected):
    assert is_scoped(_user(role, scope)) is expected


# ── the SQL fragment ───────────────────────────────────────────────────────

def test_unrestricted_adds_nothing():
    params: list = ["x"]
    assert scope_condition(None, "p.id", params) == "TRUE"
    assert params == ["x"]


def test_empty_assignments_see_nothing_not_everything():
    params: list = []
    assert scope_condition([], "p.id", params) == "FALSE"
    assert params == []


def test_assigned_ids_become_an_any_clause_with_the_next_placeholder():
    params: list = [1, 2]
    frag = scope_condition(["a", "b"], "v.id", params)
    assert frag == "v.id = ANY($3::uuid[])"
    assert params == [1, 2, ["a", "b"]]


# ── the read gate ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("role,allowed", [
    ("admin", True), ("project_manager", True), ("site_engineer", True),
    ("plant_officer", False),
])
def test_projects_read_gate(role, allowed):
    if allowed:
        assert require_projects_read(_user(role)).role == role
    else:
        with pytest.raises(AuthorizationError):
            require_projects_read(_user(role))


# ── lifecycle ──────────────────────────────────────────────────────────────

def test_exactly_two_statuses():
    # migration 042, decision 2026-10-12: Ongoing ('active') or Archived
    assert STATUSES == ("active", "archived")


def test_no_history_may_start_as_either_but_only_with_a_real_status():
    assert transition_allowed(None, "active")
    assert transition_allowed(None, "archived")
    assert not transition_allowed(None, "awarded")   # retired by 042
    assert not transition_allowed(None, "closed")    # retired by 042
    assert not transition_allowed(None, "legacy")


@pytest.mark.parametrize("frm,to,ok", [
    ("active", "archived", True),    # Move to Archive
    ("archived", "active", True),    # Return to Ongoing
    ("active", "active", False),     # a move must move
    ("archived", "archived", False),
    ("active", "closed", False),     # retired vocabulary is refused
    ("closed", "active", False),
])
def test_transitions(frm, to, ok):
    assert transition_allowed(frm, to) is ok


def test_transition_table_only_names_real_statuses():
    for frm, tos in ALLOWED_TRANSITIONS.items():
        assert frm in STATUSES and tos <= set(STATUSES)


# ── request models ─────────────────────────────────────────────────────────

def test_contract_sum_amount_is_the_resulting_sum_and_never_negative():
    with pytest.raises(PydanticValidationError):
        ContractSumIn(kind="variation", amount=-1, effective_date="2026-10-01")
    ok = ContractSumIn(kind="variation", amount=14_621_359_979.09, effective_date="2026-10-01")
    assert ok.basis == "all_in" and ok.note is None


def test_blank_note_becomes_none():
    assert ContractSumIn(kind="original", amount=1, effective_date="2026-10-01", note="   ").note is None
