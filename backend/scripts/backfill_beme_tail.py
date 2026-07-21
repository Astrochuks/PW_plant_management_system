"""One-off: fill project_weekly_reports.beme_tail for reports ingested
before migration 027, by re-parsing the original workbooks already in
Storage. Idempotent — only touches rows where beme_tail IS NULL.

Run: python scripts/backfill_beme_tail.py
"""

import asyncio
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import openpyxl  # noqa: E402

from app.core.database import get_supabase_admin_client  # noqa: E402
from app.core.pool import close_pool, fetch, get_pool, init_pool  # noqa: E402
from app.services.weekly_report_sheets import parse_workbook  # noqa: E402


async def main() -> None:
    await init_pool()
    try:
        rows = await fetch(
            """SELECT wr.id AS report_id, wr.year, wr.week_number,
                      s.file_path, p.short_name
               FROM project_weekly_reports wr
               JOIN projects p ON p.id = wr.project_id
               LEFT JOIN project_report_submissions s
                 ON s.project_id = wr.project_id AND s.year = wr.year
                AND s.week_number = wr.week_number
                AND s.status IN ('success', 'partial')
               WHERE wr.beme_tail IS NULL
               ORDER BY p.short_name, wr.year, wr.week_number"""
        )
        if not rows:
            print("Nothing to backfill — all reports have beme_tail.")
            return

        client = get_supabase_admin_client()
        pool = get_pool()
        done = skipped = 0
        for r in rows:
            label = f"{r['short_name']} {r['year']}-W{r['week_number']:02d}"
            if not r["file_path"]:
                print(f"SKIP {label}: no submission file on record")
                skipped += 1
                continue
            file_bytes = client.storage.from_("reports").download(r["file_path"])
            if not file_bytes:
                print(f"SKIP {label}: storage returned empty file")
                skipped += 1
                continue
            wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
            parsed = parse_workbook(wb)
            tail = (parsed["sheets"].get("BEME & Works Completed Fd", {})
                    .get("tail")) or None
            if tail is None:
                print(f"SKIP {label}: parser found no BEME tail")
                skipped += 1
                continue
            async with pool.acquire() as conn:
                await conn.execute(
                    """UPDATE project_weekly_reports
                       SET beme_tail = $2::jsonb, updated_at = now()
                       WHERE id = $1::uuid""",
                    str(r["report_id"]), tail,
                )
            keys = ", ".join(sorted(tail.keys()))
            print(f"OK   {label}: {keys}")
            done += 1
        print(f"\nBackfilled {done}, skipped {skipped}, of {len(rows)} reports.")
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
