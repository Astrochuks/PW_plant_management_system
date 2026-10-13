"""One-off: bring every project_name and short_name to the house Title Case
(decision 2026-10-13). Idempotent — rows already in house style are left
alone. Prints each change. Run from backend/:

    PYTHONPATH=. python scripts/backfill_project_names.py          # dry run
    PYTHONPATH=. python scripts/backfill_project_names.py --apply
"""

import asyncio
import os
import sys

import asyncpg
from dotenv import load_dotenv

from app.core.text import title_case


async def main(apply: bool) -> None:
    load_dotenv(dotenv_path=".env")
    c = await asyncpg.connect(os.environ["DATABASE_URL"], statement_cache_size=0)
    rows = await c.fetch("SELECT id, project_name, short_name FROM projects ORDER BY project_name")
    changes = []
    for r in rows:
        name, short = title_case(r["project_name"]), title_case(r["short_name"])
        if name != r["project_name"] or short != r["short_name"]:
            changes.append((str(r["id"]), name, short, r["project_name"], r["short_name"]))
    print(f"[backfill_project_names] {len(changes)} of {len(rows)} projects change")
    for _, name, short, old_name, old_short in changes[:40]:
        print(f"  {old_name!r:70.70} -> {name!r:70.70}" + (f" | {old_short!r} -> {short!r}" if old_short != short else ""))
    if apply and changes:
        async with c.transaction():
            await c.executemany(
                "UPDATE projects SET project_name = $2, short_name = $3, updated_at = now() WHERE id = $1::uuid",
                [(pid, name, short) for pid, name, short, _, _ in changes])
        print("[backfill_project_names] applied")
    elif changes:
        print("[backfill_project_names] dry run — add --apply to write")
    await c.close()


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
