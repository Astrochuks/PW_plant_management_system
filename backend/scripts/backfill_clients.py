"""T1.3 — Backfill clients master from projects.client strings (idempotent).

Creates one clients row per distinct normalized client name, then sets
projects.client_id. Safe to run any number of times:
  - clients upserted by normalized_name (ON CONFLICT DO NOTHING)
  - only projects with NULL client_id are updated

Run:  python -m scripts.backfill_clients          (from backend/, venv)
      docker compose run --rm backend python -m scripts.backfill_clients
"""

import asyncio
import re
import sys
from pathlib import Path

import asyncpg
from dotenv import dotenv_values


def normalize_client_name(name: str) -> str:
    """Canonical form for matching: uppercase, collapsed whitespace,
    punctuation stripped. 'Plateau State Govt.' == 'PLATEAU STATE GOVT'"""
    s = re.sub(r"[^\w\s]", " ", name.upper())
    return re.sub(r"\s+", " ", s).strip()


def _database_url() -> str:
    import os

    url = os.environ.get("DATABASE_URL") or dotenv_values(
        Path(__file__).parent.parent / ".env"
    ).get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL not found in env or backend/.env", file=sys.stderr)
        sys.exit(1)
    return url


async def backfill(conn: asyncpg.Connection) -> dict[str, int]:
    """Returns counts for reporting/assertions. All-or-nothing transaction."""
    async with conn.transaction():
        rows = await conn.fetch(
            """SELECT DISTINCT client FROM projects
               WHERE client IS NOT NULL AND btrim(client) <> ''"""
        )

        inserted = 0
        for r in rows:
            raw = r["client"].strip()
            result = await conn.execute(
                """INSERT INTO clients (name, normalized_name)
                   VALUES ($1, $2) ON CONFLICT (normalized_name) DO NOTHING""",
                raw,
                normalize_client_name(raw),
            )
            if result == "INSERT 0 1":
                inserted += 1

        # Link projects → clients in Python so matching uses the SAME
        # normalizer that built the clients rows (no SQL re-implementation
        # that could silently diverge).
        client_ids = {
            r["normalized_name"]: r["id"]
            for r in await conn.fetch("SELECT id, normalized_name FROM clients")
        }
        unlinked = await conn.fetch(
            """SELECT id, client FROM projects
               WHERE client_id IS NULL AND client IS NOT NULL AND btrim(client) <> ''"""
        )
        pairs = [
            (client_ids[norm], p["id"])
            for p in unlinked
            if (norm := normalize_client_name(p["client"])) in client_ids
        ]
        await conn.executemany(
            "UPDATE projects SET client_id = $1 WHERE id = $2", pairs
        )
        linked = len(pairs)

        unmatched = await conn.fetchval(
            """SELECT count(*) FROM projects
               WHERE client_id IS NULL AND client IS NOT NULL AND btrim(client) <> ''"""
        )

    return {
        "distinct_names": len(rows),
        "clients_inserted": inserted,
        "projects_linked": linked,
        "projects_unmatched": unmatched,
    }


async def main() -> None:
    conn = await asyncpg.connect(_database_url(), statement_cache_size=0)
    try:
        stats = await backfill(conn)
    finally:
        await conn.close()

    print(f"distinct client names : {stats['distinct_names']}")
    print(f"clients inserted      : {stats['clients_inserted']}")
    print(f"projects linked       : {stats['projects_linked']}")
    print(f"projects unmatched    : {stats['projects_unmatched']}")
    if stats["projects_unmatched"] > 0:
        print("WARNING: unmatched projects remain — investigate before Phase 1 sign-off",
              file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    asyncio.run(main())
