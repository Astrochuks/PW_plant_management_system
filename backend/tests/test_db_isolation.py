"""T0.4 — prove the integration-test DB fixture never pollutes real tables.

Test A inserts a marker row inside the fixture's transaction and sees it.
Test B runs afterwards on a fresh connection and must NOT see the marker —
proving the rollback isolated the write. Uses `states` (small, stable table)
with an unmistakable marker name that could never collide with real data.
"""

import pytest

MARKER_NAME = "ZZ_TEST_ISOLATION_DO_NOT_KEEP"
MARKER_CODE = "Z9"


@pytest.mark.asyncio
async def test_write_is_visible_inside_transaction(db_conn):
    before = await db_conn.fetchval("SELECT count(*) FROM states")

    await db_conn.execute(
        "INSERT INTO states (name, code) VALUES ($1, $2)", MARKER_NAME, MARKER_CODE
    )

    after = await db_conn.fetchval("SELECT count(*) FROM states")
    assert after == before + 1

    found = await db_conn.fetchval(
        "SELECT count(*) FROM states WHERE name = $1", MARKER_NAME
    )
    assert found == 1


@pytest.mark.asyncio
async def test_previous_write_was_rolled_back(db_conn):
    """Runs after the test above on a new connection/transaction: the marker
    row must be gone. If this fails, the isolation fixture is broken and
    integration tests are polluting the real database."""
    found = await db_conn.fetchval(
        "SELECT count(*) FROM states WHERE name = $1", MARKER_NAME
    )
    assert found == 0, "rollback failed — marker row leaked into the database!"
