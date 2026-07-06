"""T1.10 — review-queue workflow: service logic (rolled-back DB) + API gating.

Performance design: the 218-project import is expensive over the network,
so it runs ONCE per module inside an outer transaction; each test gets a
SAVEPOINT that rolls back, so tests stay isolated and nothing ever
persists. (Naive per-test seeding made this file take 9+ minutes.)
"""

import copy
from pathlib import Path

import pytest
import pytest_asyncio

from app.core.exceptions import NotFoundError, ValidationError
from app.services import register_review_service as review
from app.services.award_letters_import import persist_award_letters
from app.services.award_letters_parser import parse_award_letters_excel

FIXTURE = Path(__file__).parent / "fixtures" / "projects" / "award_letters_2017.xlsx"

pytestmark = pytest.mark.asyncio(loop_scope="module")


@pytest.fixture(scope="module")
def parsed():
    return parse_award_letters_excel(FIXTURE.read_bytes())


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def seeded(parsed):
    """(conn, user_id) with the register imported — outer tx rolls back at
    module end; nothing persists."""
    import asyncpg

    from tests.conftest import _database_url

    url = _database_url()
    if not url:
        pytest.skip("no DATABASE_URL available")
    try:
        conn = await asyncpg.connect(url, statement_cache_size=0, timeout=15)
    except Exception as exc:
        pytest.skip(f"database unreachable: {exc}")

    outer = conn.transaction()
    await outer.start()
    try:
        user_id = str((await conn.fetchrow("SELECT id FROM users LIMIT 1"))["id"])
        await persist_award_letters(conn, copy.deepcopy(dict(parsed)), user_id)
        yield conn, user_id
    finally:
        try:
            await outer.rollback()
        finally:
            await conn.close()


@pytest_asyncio.fixture(loop_scope="module")
async def db(seeded):
    """Per-test SAVEPOINT on the seeded connection — full isolation."""
    conn, user_id = seeded
    sp = conn.transaction()
    await sp.start()
    try:
        yield conn, user_id
    finally:
        await sp.rollback()


async def _item_by(db_conn, **conds):
    where = " AND ".join(f"{k} = ${i+1}" for i, k in enumerate(conds))
    return await db_conn.fetchrow(
        f"SELECT * FROM project_register_review_queue WHERE resolved = false "
        f"AND {where} LIMIT 1",
        *conds.values(),
    )


class TestListAndSummary:
    async def test_list_filters_and_pagination(self, db):
        db_conn, _ = db
        page = await review.list_review_queue(db_conn, page=1, page_size=10)
        assert page["total"] == 126
        assert len(page["items"]) == 10

        only_state = await review.list_review_queue(db_conn, field="state")
        assert only_state["total"] == 6
        assert all(i["field"] == "state" for i in only_state["items"])

    async def test_summary_counts(self, db):
        db_conn, _ = db
        s = await review.summarize_review_queue(db_conn)
        assert s["open_total"] == 126
        reasons = {r["reason"]: r["n"] for r in s["by_reason"]}
        assert reasons["narrative_status"] == 16


class TestResolve:
    async def test_resolve_state_updates_project(self, db):
        db_conn, user_id = db
        item = await _item_by(db_conn, field="state")
        result = await review.resolve_review_item(
            db_conn, str(item["id"]), user_id, "Lagos"
        )
        assert result["applied"]["state"] == "Lagos"

        state_name = await db_conn.fetchval(
            """SELECT s.name FROM projects p JOIN states s ON s.id = p.state_id
               WHERE p.id = $1""",
            item["project_id"],
        )
        assert state_name == "Lagos"

    async def test_resolve_date_updates_project(self, db):
        db_conn, user_id = db
        item = await _item_by(db_conn, field="retention_application_date")
        await review.resolve_review_item(db_conn, str(item["id"]), user_id, "2014-11-17")
        applied = await db_conn.fetchval(
            "SELECT retention_application_date FROM projects WHERE id = $1",
            item["project_id"],
        )
        assert str(applied) == "2014-11-17"

    async def test_resolve_classification(self, db):
        db_conn, user_id = db
        item = await _item_by(db_conn, field="classification")
        await review.resolve_review_item(
            db_conn, str(item["id"]), user_id, "road/rehabilitation"
        )
        row = await db_conn.fetchrow(
            "SELECT project_type, work_nature FROM projects WHERE id = $1",
            item["project_id"],
        )
        assert (row["project_type"], row["work_nature"]) == ("road", "rehabilitation")

    async def test_dismiss_leaves_project_untouched(self, db):
        db_conn, user_id = db
        item = await _item_by(db_conn, reason="narrative_status")
        before = await db_conn.fetchrow(
            "SELECT * FROM projects WHERE id = $1", item["project_id"]
        )
        result = await review.resolve_review_item(db_conn, str(item["id"]), user_id, None)
        assert result["dismissed"] is True
        after = await db_conn.fetchrow(
            "SELECT * FROM projects WHERE id = $1", item["project_id"]
        )
        assert dict(before) == dict(after)

    async def test_double_resolve_rejected(self, db):
        db_conn, user_id = db
        item = await _item_by(db_conn, reason="narrative_status")
        await review.resolve_review_item(db_conn, str(item["id"]), user_id, None)
        with pytest.raises(ValidationError):
            await review.resolve_review_item(db_conn, str(item["id"]), user_id, None)

    async def test_bad_inputs_rejected(self, db):
        db_conn, user_id = db
        with pytest.raises(NotFoundError):
            await review.resolve_review_item(
                db_conn, "00000000-0000-0000-0000-000000000000", user_id, None
            )
        date_item = await _item_by(db_conn, field="award_date")
        with pytest.raises(ValidationError):
            await review.resolve_review_item(
                db_conn, str(date_item["id"]), user_id, "not-a-date"
            )
        state_item = await _item_by(db_conn, field="state")
        with pytest.raises(ValidationError):
            await review.resolve_review_item(
                db_conn, str(state_item["id"]), user_id, "Atlantis"
            )


class TestBulkDismiss:
    async def test_bulk_dismiss_by_reason(self, db):
        db_conn, user_id = db
        count = await review.bulk_dismiss(db_conn, user_id, reason="narrative_status")
        assert count == 16
        remaining = await db_conn.fetchval(
            "SELECT count(*) FROM project_register_review_queue "
            "WHERE resolved = false AND reason = 'narrative_status'"
        )
        assert remaining == 0


class TestApiGating:
    def test_review_queue_requires_auth(self, client):
        assert client.get("/api/v1/projects/review-queue").status_code == 401

    def test_review_queue_requires_admin(self, client, app, management_user):
        from app.core.security import CurrentUser, get_current_user

        app.dependency_overrides[get_current_user] = lambda: CurrentUser(**management_user)
        try:
            r = client.get("/api/v1/projects/review-queue")
            assert r.status_code == 403
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    def test_admin_can_list(self, client, app, admin_user):
        from app.core.security import CurrentUser, get_current_user

        app.dependency_overrides[get_current_user] = lambda: CurrentUser(**admin_user)
        try:
            r = client.get("/api/v1/projects/review-queue?page_size=5")
            if r.status_code == 503:
                pytest.skip("database unavailable")
            assert r.status_code == 200
            body = r.json()
            assert "items" in body["data"] and "total" in body["data"]
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    def test_bulk_dismiss_requires_reason(self, client, app, admin_user):
        from app.core.security import CurrentUser, get_current_user

        app.dependency_overrides[get_current_user] = lambda: CurrentUser(**admin_user)
        try:
            r = client.post("/api/v1/projects/review-queue/bulk-dismiss", json={})
            assert r.status_code == 422
        finally:
            app.dependency_overrides.pop(get_current_user, None)
