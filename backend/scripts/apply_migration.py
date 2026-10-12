"""Apply one numbered migration from backend/migrations/ over asyncpg.

    python scripts/apply_migration.py 042

A file may be split into steps with lines that start with
``-- ── STEP``. Each step runs on its own: a step that contains BEGIN/COMMIT
runs as one transaction (its own BEGIN/COMMIT lines are stripped and the
runner's transaction is used instead); a step without them runs in
autocommit, which is what ``ALTER TYPE ... ADD VALUE`` needs before the
next step can use the label. A file with no STEP markers is one step.

Reads DATABASE_URL from backend/.env. Prints every step and the row
counts it reports. Log phrase: [apply_migration].
"""

from __future__ import annotations

import asyncio
import os
import re
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent.parent
STEP_RE = re.compile(r"^-- ── STEP.*$", re.M)


def split_steps(sql: str) -> list[str]:
    parts = STEP_RE.split(sql)
    steps = [p for p in parts[1:]] if len(parts) > 1 else [sql]
    return [s.strip() for s in steps if s.strip()]


def strip_tx(step: str) -> tuple[str, bool]:
    """Remove a leading BEGIN; / trailing COMMIT; and say whether they were there."""
    body = step.strip()
    tx = False
    if re.match(r"^BEGIN;", body):
        body = body[len("BEGIN;"):]
        tx = True
    if re.search(r"COMMIT;\s*$", body):
        body = re.sub(r"COMMIT;\s*$", "", body)
        tx = True
    return body.strip(), tx


async def main(number: str) -> None:
    load_dotenv(dotenv_path=HERE / ".env")
    files = sorted((HERE / "migrations").glob(f"{number}_*.sql"))
    if len(files) != 1:
        sys.exit(f"[apply_migration] expected one file for {number}, found {[f.name for f in files]}")
    sql = files[0].read_text()
    steps = split_steps(sql)
    print(f"[apply_migration] {files[0].name}: {len(steps)} step(s)")

    conn = await asyncpg.connect(os.environ["DATABASE_URL"], statement_cache_size=0)
    try:
        for i, step in enumerate(steps, 1):
            body, tx = strip_tx(step)
            if tx:
                async with conn.transaction():
                    status = await conn.execute(body)
                print(f"[apply_migration] step {i}: committed as one transaction ({status})")
            else:
                status = await conn.execute(body)
                print(f"[apply_migration] step {i}: autocommit ({status})")
    finally:
        await conn.close()
    print("[apply_migration] done")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python scripts/apply_migration.py <number>")
    asyncio.run(main(sys.argv[1]))
