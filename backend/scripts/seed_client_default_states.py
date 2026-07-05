"""T1.6 — seed clients.default_state_id from the client's own name.

"PLATEAU STATE GOVT" → Plateau. Only fills NULLs; never overwrites a
manually-set default. Safe to rerun.

Run:  python -m scripts.seed_client_default_states
"""

import asyncio
import sys
from pathlib import Path

import asyncpg
from dotenv import dotenv_values

sys.path.insert(0, str(Path(__file__).parent.parent))
from app.services.register_parsing import extract_client_default_state  # noqa: E402


def _database_url() -> str:
    import os

    url = os.environ.get("DATABASE_URL") or dotenv_values(
        Path(__file__).parent.parent / ".env"
    ).get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL not found", file=sys.stderr)
        sys.exit(1)
    return url


async def seed(conn: asyncpg.Connection) -> dict[str, int]:
    async with conn.transaction():
        state_ids = {
            r["name"]: r["id"] for r in await conn.fetch("SELECT id, name FROM states")
        }
        clients = await conn.fetch(
            "SELECT id, name FROM clients WHERE default_state_id IS NULL"
        )
        pairs = []
        unmapped = []
        for c in clients:
            state = extract_client_default_state(c["name"])
            if state and state in state_ids:
                pairs.append((state_ids[state], c["id"]))
            else:
                unmapped.append(c["name"])
        await conn.executemany(
            "UPDATE clients SET default_state_id = $1, updated_at = now() WHERE id = $2",
            pairs,
        )
    return {"seeded": len(pairs), "no_state_in_name": len(unmapped)}


async def main() -> None:
    conn = await asyncpg.connect(_database_url(), statement_cache_size=0)
    try:
        stats = await seed(conn)
    finally:
        await conn.close()
    print(f"defaults seeded      : {stats['seeded']}")
    print(f"no state in name     : {stats['no_state_in_name']} (left NULL — expected for private/federal clients)")


if __name__ == "__main__":
    asyncio.run(main())
