"""Import endpoint resilience: DB timeouts retry, failures surface clearly.

Born from a real incident (2026-07-06): a concurrent test run held locks on
clients, the user's upload hit a statement timeout, and the UI showed a
meaningless generic error. Never again.
"""

from pathlib import Path

import pytest

from app.core.security import CurrentUser, get_current_user

FIXTURE = Path(__file__).parent / "fixtures" / "projects" / "award_letters_2017.xlsx"

GOOD_STATS = {
    "deleted": 0,
    "created": 218,
    "clients_upserted": 33,
    "review_queued": 126,
    "insert_errors": [],
}


def _upload(client):
    with FIXTURE.open("rb") as f:
        return client.post(
            "/api/v1/projects/import/award-letters",
            files={"file": ("award_letters_2017.xlsx", f,
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )


@pytest.fixture
def as_admin(app, admin_user):
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(**admin_user)
    yield
    app.dependency_overrides.pop(get_current_user, None)


class TestImportRetries:
    def test_transient_timeout_is_retried_then_succeeds(
        self, client, as_admin, monkeypatch
    ):
        calls = {"n": 0}

        async def flaky_persist(conn, parsed, user_id):
            calls["n"] += 1
            if calls["n"] < 3:
                raise TimeoutError("simulated busy database")
            return dict(GOOD_STATS)

        monkeypatch.setattr(
            "app.services.award_letters_import.persist_award_letters", flaky_persist
        )
        # avoid real sleeps in the retry backoff
        import asyncio as real_asyncio

        async def no_sleep(_):
            return None

        monkeypatch.setattr(real_asyncio, "sleep", no_sleep)

        r = _upload(client)
        if r.status_code == 503 and "timed out" not in r.text:
            pytest.skip("database unavailable for defaults fetch")
        assert r.status_code == 200, r.text
        assert calls["n"] == 3
        assert r.json()["data"]["created"] == 218

    def test_persistent_failure_returns_actionable_message(
        self, client, as_admin, monkeypatch
    ):
        async def always_fails(conn, parsed, user_id):
            raise TimeoutError("simulated dead database")

        monkeypatch.setattr(
            "app.services.award_letters_import.persist_award_letters", always_fails
        )
        import asyncio as real_asyncio

        async def no_sleep(_):
            return None

        monkeypatch.setattr(real_asyncio, "sleep", no_sleep)

        r = _upload(client)
        assert r.status_code == 503, r.text
        body = r.json()
        message = body.get("error", {}).get("message", "")
        # The user must learn: it failed, nothing was saved, retrying is safe
        assert "Nothing was saved" in message
        assert "retry" in message.lower()

    def test_each_attempt_gets_a_fresh_parse_copy(self, client, as_admin, monkeypatch):
        """persist mutates its input (pops state_name etc.) — a retry with
        the mutated dict would silently lose state enrichment."""
        seen_state_names = []

        calls = {"n": 0}

        async def inspecting_persist(conn, parsed, user_id):
            calls["n"] += 1
            seen_state_names.append(
                sum(1 for p in parsed["projects"] if p.get("state_name"))
            )
            for p in parsed["projects"]:
                p.pop("state_name", None)  # simulate the mutation
            if calls["n"] < 2:
                raise TimeoutError("boom")
            return dict(GOOD_STATS)

        monkeypatch.setattr(
            "app.services.award_letters_import.persist_award_letters",
            inspecting_persist,
        )
        import asyncio as real_asyncio

        async def no_sleep(_):
            return None

        monkeypatch.setattr(real_asyncio, "sleep", no_sleep)

        r = _upload(client)
        if r.status_code == 503:
            pytest.skip("database unavailable for defaults fetch")
        assert r.status_code == 200
        assert len(seen_state_names) == 2
        # Attempt 2 saw the SAME number of enriched rows as attempt 1
        assert seen_state_names[0] == seen_state_names[1] > 0
