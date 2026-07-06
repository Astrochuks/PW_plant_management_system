"""T1.8 — integration: parser v2 output persists end-to-end.

Runs the REAL persistence path (same function the endpoint calls) against
the real database inside the always-rolled-back db_conn transaction.
"""

from pathlib import Path

import pytest

from app.services.award_letters_import import (
    fetch_client_default_states,
    persist_award_letters,
)
from app.services.award_letters_parser import parse_award_letters_excel

FIXTURE = Path(__file__).parent / "fixtures" / "projects" / "award_letters_2017.xlsx"

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


@pytest.fixture(scope="module")
def parsed():
    """Parse once per module — deterministic, no DB needed."""
    return parse_award_letters_excel(FIXTURE.read_bytes())


async def _ensure_test_user(db_conn):
    """created_by FK needs a real user id inside the transaction."""
    row = await db_conn.fetchrow("SELECT id FROM users LIMIT 1")
    return str(row["id"])


class TestPersistAwardLetters:
    async def test_full_import_counts(self, db_conn, parsed):
        user_id = await _ensure_test_user(db_conn)
        stats = await persist_award_letters(db_conn, dict(parsed), user_id)

        assert stats["created"] == 218
        assert stats["insert_errors"] == []
        assert stats["review_queued"] == len(parsed["review_items"]) == 225

        in_db = await db_conn.fetchval(
            "SELECT count(*) FROM projects WHERE import_batch_id = $1::uuid",
            parsed["import_batch_id"],
        )
        assert in_db == 218

    async def test_every_project_has_client_and_register_source(self, db_conn, parsed):
        user_id = await _ensure_test_user(db_conn)
        await persist_award_letters(db_conn, dict(parsed), user_id)

        missing_client = await db_conn.fetchval(
            "SELECT count(*) FROM projects WHERE import_batch_id = $1::uuid "
            "AND client_id IS NULL",
            parsed["import_batch_id"],
        )
        assert missing_client == 0

        sources = await db_conn.fetch(
            "SELECT DISTINCT register_source FROM projects "
            "WHERE import_batch_id = $1::uuid",
            parsed["import_batch_id"],
        )
        assert [r["register_source"] for r in sources] == ["award_letters_workbook"]

    async def test_review_queue_rows_link_to_projects(self, db_conn, parsed):
        user_id = await _ensure_test_user(db_conn)
        await persist_award_letters(db_conn, dict(parsed), user_id)

        # Every queue row emitted for a parsed row must link to its project
        unlinked = await db_conn.fetchval(
            "SELECT count(*) FROM project_register_review_queue "
            "WHERE import_batch_id = $1::uuid AND project_id IS NULL",
            parsed["import_batch_id"],
        )
        assert unlinked == 0

        # Raw values must be preserved for human review
        no_raw = await db_conn.fetchval(
            "SELECT count(*) FROM project_register_review_queue "
            "WHERE import_batch_id = $1::uuid AND raw_value IS NULL "
            "AND reason NOT IN ('no_state_found', 'ambiguous_states')",
            parsed["import_batch_id"],
        )
        assert no_raw == 0

    async def test_types_and_states_persisted(self, db_conn, parsed):
        user_id = await _ensure_test_user(db_conn)
        await persist_award_letters(db_conn, dict(parsed), user_id)

        typed = await db_conn.fetchval(
            "SELECT count(*) FROM projects WHERE import_batch_id = $1::uuid "
            "AND project_type IS NOT NULL",
            parsed["import_batch_id"],
        )
        assert typed == 210

        stated = await db_conn.fetchval(
            "SELECT count(*) FROM projects WHERE import_batch_id = $1::uuid "
            "AND state_id IS NOT NULL",
            parsed["import_batch_id"],
        )
        assert stated == 212  # 6 correctly unresolved → queue

    async def test_client_defaults_fallback_via_db_map(self, db_conn, parsed):
        """With the DB-backed client-defaults map, resolution can only stay
        equal or improve vs the bare parse."""
        defaults = await fetch_client_default_states(db_conn)
        assert len(defaults) >= 15

        reparsed = parse_award_letters_excel(FIXTURE.read_bytes(), defaults)
        bare_unresolved = sum(
            1 for i in parsed["review_items"] if i["field"] == "state"
        )
        with_defaults_unresolved = sum(
            1 for i in reparsed["review_items"] if i["field"] == "state"
        )
        assert with_defaults_unresolved <= bare_unresolved
