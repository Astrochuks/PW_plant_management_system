"""T1.8 + T1.9 — integration: parser v2 output persists end-to-end.

Runs the REAL persistence path (same function the endpoint calls) against
the real database, never persisting anything:

  - ONE seed import per module (outer transaction, rolled back at the end)
  - each test runs inside a SAVEPOINT on that connection
  - the idempotency test performs its own additional imports inside its
    savepoint — that repetition IS the thing under test.
"""

import copy
from pathlib import Path

import pytest
import pytest_asyncio

from app.services.award_letters_import import (
    fetch_client_default_states,
    persist_award_letters,
)
from app.services.award_letters_parser import parse_award_letters_excel

FIXTURE = Path(__file__).parent / "fixtures" / "projects" / "award_letters_2017.xlsx"

pytestmark = pytest.mark.asyncio(loop_scope="module")


@pytest.fixture(scope="module")
def parsed():
    """Parse once per module — deterministic, no DB needed."""
    return parse_award_letters_excel(FIXTURE.read_bytes())


@pytest_asyncio.fixture(loop_scope="module", scope="module")
async def seeded(parsed):
    """(conn, user_id, batch_id) with the register imported once."""
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
        batch = copy.deepcopy(dict(parsed))
        stats = await persist_award_letters(conn, batch, user_id)
        yield conn, user_id, batch["import_batch_id"], stats
    finally:
        try:
            await outer.rollback()
        finally:
            await conn.close()


@pytest_asyncio.fixture(loop_scope="module")
async def db(seeded):
    """Per-test SAVEPOINT — isolation without repeating the import."""
    conn, user_id, batch_id, stats = seeded
    sp = conn.transaction()
    await sp.start()
    try:
        yield conn, user_id, batch_id, stats
    finally:
        await sp.rollback()


class TestPersistAwardLetters:
    async def test_full_import_counts(self, db, parsed):
        conn, _, batch_id, stats = db
        assert stats["created"] == 218
        assert stats["insert_errors"] == []
        assert stats["review_queued"] == len(parsed["review_items"]) == 126

        in_db = await conn.fetchval(
            "SELECT count(*) FROM projects WHERE import_batch_id = $1::uuid",
            batch_id,
        )
        assert in_db == 218

    async def test_every_project_has_client_and_register_source(self, db):
        conn, _, batch_id, _ = db
        missing_client = await conn.fetchval(
            "SELECT count(*) FROM projects WHERE import_batch_id = $1::uuid "
            "AND client_id IS NULL",
            batch_id,
        )
        assert missing_client == 0

        sources = await conn.fetch(
            "SELECT DISTINCT register_source FROM projects "
            "WHERE import_batch_id = $1::uuid",
            batch_id,
        )
        assert [r["register_source"] for r in sources] == ["award_letters_workbook"]

        statuses = await conn.fetch(
            "SELECT DISTINCT status FROM projects WHERE import_batch_id = $1::uuid",
            batch_id,
        )
        assert [r["status"] for r in statuses] == ["legacy"]  # NEVER active

        # client types populated on the clients master
        types = {
            r["client_type"]
            for r in await conn.fetch("SELECT DISTINCT client_type FROM clients")
        }
        assert types <= {"state_government", "federal_government", "private"}

    async def test_review_queue_rows_link_to_projects(self, db):
        conn, _, batch_id, _ = db
        unlinked = await conn.fetchval(
            "SELECT count(*) FROM project_register_review_queue "
            "WHERE import_batch_id = $1::uuid AND project_id IS NULL",
            batch_id,
        )
        assert unlinked == 0

        no_raw = await conn.fetchval(
            "SELECT count(*) FROM project_register_review_queue "
            "WHERE import_batch_id = $1::uuid AND raw_value IS NULL "
            "AND reason NOT IN ('no_state_found', 'ambiguous_states')",
            batch_id,
        )
        assert no_raw == 0

    async def test_types_and_states_persisted(self, db):
        conn, _, batch_id, _ = db
        typed = await conn.fetchval(
            "SELECT count(*) FROM projects WHERE import_batch_id = $1::uuid "
            "AND project_type IS NOT NULL",
            batch_id,
        )
        assert typed == 210

        stated = await conn.fetchval(
            "SELECT count(*) FROM projects WHERE import_batch_id = $1::uuid "
            "AND state_id IS NOT NULL",
            batch_id,
        )
        assert stated == 212  # 6 correctly unresolved → queue

    async def test_client_defaults_fallback_via_db_map(self, db, parsed):
        """With the DB-backed client-defaults map, resolution can only stay
        equal or improve vs the bare parse."""
        conn, *_ = db
        defaults = await fetch_client_default_states(conn)
        assert len(defaults) >= 10  # 12 state governments in the register

        reparsed = parse_award_letters_excel(FIXTURE.read_bytes(), defaults)
        bare_unresolved = sum(
            1 for i in parsed["review_items"] if i["field"] == "state"
        )
        with_defaults_unresolved = sum(
            1 for i in reparsed["review_items"] if i["field"] == "state"
        )
        assert with_defaults_unresolved <= bare_unresolved


class TestIdempotentReimport:
    """T1.9 — reimporting replaces cleanly, never duplicates. The repeated
    imports here are the behaviour under test (this test is legitimately
    the slowest in the suite)."""

    async def test_reimports_identical_final_state_and_full_replacement(
        self, db, parsed
    ):
        import uuid

        conn, user_id, _, seed_stats = db

        snapshots = []
        stats_list = []
        for _ in range(2):  # + the module seed = 3 total imports
            batch = copy.deepcopy(dict(parsed))
            batch["import_batch_id"] = str(uuid.uuid4())
            for proj in batch["projects"]:
                proj["import_batch_id"] = batch["import_batch_id"]
            stats = await persist_award_letters(conn, batch, user_id)
            stats_list.append(stats)
            snapshots.append((
                stats["created"],
                await conn.fetchval(
                    "SELECT count(*) FROM projects WHERE is_legacy = true"
                ),
                await conn.fetchval(
                    "SELECT count(*) FROM project_register_review_queue "
                    "WHERE resolved = false"
                ),
                await conn.fetchval("SELECT count(*) FROM clients"),
            ))

        # Identical state after every reimport — zero accumulation
        assert snapshots[0] == snapshots[1], snapshots
        assert snapshots[0][0] == 218   # created
        assert snapshots[0][1] == 218   # exactly one generation of legacy rows
        assert snapshots[0][2] == 126   # queue replaced, not appended

        # Full replacement semantics + client stability across reimports
        for stats in stats_list:
            assert stats["deleted"] == seed_stats["created"] == 218
            assert stats["clients_upserted"] == 0
