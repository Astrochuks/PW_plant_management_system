"""One-shot: wipe all Akwa Ibom weekly data and re-ingest the 10 workbooks
through the REAL upload pipeline (Storage upload → submission → worker →
persist v2 → flags → adjustments).

Run inside the backend container:
    python scripts/reingest_akwa_ibom.py
"""

import asyncio
import glob
import re
import sys

sys.path.insert(0, ".")

FILES_DIR = "/app/project_files"  # mounted below via docker cp


async def main() -> None:
    from app.core.pool import close_pool, fetch, fetchval, init_pool

    await init_pool()

    project_id = await fetchval(
        "SELECT id FROM projects WHERE short_name = 'AKWA IBOM AIRPORT APRON'")
    if not project_id:
        raise SystemExit("Akwa Ibom project not found")
    project_id = str(project_id)
    admin = await fetchval(
        "SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1")

    # ── wipe (one transaction; only with --wipe) ────────────────────────
    from app.core.pool import get_pool
    pool = get_pool()
    do_wipe = "--wipe" in sys.argv
    if not do_wipe:
        print("(incremental mode — pass --wipe for a full reset)")
    async with pool.acquire() as conn:
        async with conn.transaction():
            for table in (() if not do_wipe else (
                "project_report_submissions", "project_weekly_reports",
                "project_ledger_adjustments", "project_beme_items",
                "project_beme_bills", "project_certificates",
                "project_payments",
            )):
                n = await conn.fetchval(
                    f"SELECT count(*) FROM {table} WHERE project_id = $1::uuid",
                    project_id)
                await conn.execute(
                    f"DELETE FROM {table} WHERE project_id = $1::uuid",
                    project_id)
                print(f"  wiped {table}: {n} rows")

    # ── re-ingest through the real pipeline: storage → submission →
    # worker (same code path as the endpoint, single event loop) ────────
    import hashlib

    from app.core.database import get_supabase_admin_client
    from app.workers.project_report_worker import process_project_weekly_report

    storage = get_supabase_admin_client().storage.from_("reports")

    paths = []
    for p in sorted(glob.glob(f"{FILES_DIR}/Week *.xlsx")):
        wk = re.search(r"Week (\d+)", p)
        yr = re.search(r"(20\d{2})", p)
        if wk and yr:
            paths.append((int(yr.group(1)), int(wk.group(1)), p))
    paths.sort()  # (year, week) — W43 2025 first
    print(f"\ningesting {len(paths)} workbooks:")

    for year, week, path in paths:
        done = await fetchval(
            """SELECT count(*) FROM project_report_submissions
               WHERE project_id = $1::uuid AND year = $2 AND week_number = $3
                 AND status = 'success'""", project_id, year, week)
        if done:
            print(f"  {year}-W{week:02d}: already ingested — skipped")
            continue
        await fetchval(
            """DELETE FROM project_report_submissions
               WHERE project_id = $1::uuid AND year = $2 AND week_number = $3
               RETURNING 1""", project_id, year, week)
        fname = path.rsplit("/", 1)[-1]
        content = open(path, "rb").read()
        storage_path = (f"weekly-reports/projects/{project_id}/"
                        f"{year}-W{week:02d}/{fname}")
        for attempt in range(3):
            try:
                storage.upload(storage_path, content, {
                    "content-type": "application/vnd.openxmlformats-"
                                    "officedocument.spreadsheetml.sheet"})
                break
            except Exception as e:
                if "already exists" in str(e).lower() or "duplicate" in str(e).lower():
                    storage.update(storage_path, content)
                    break
                if attempt == 2:
                    raise
                print(f"    storage retry {attempt + 1}: {str(e)[:60]}")
                await asyncio.sleep(3)
        sub_id = await fetchval(
            """INSERT INTO project_report_submissions
               (project_id, year, week_number, file_name, file_hash, file_path,
                file_size, source, status, uploaded_by)
               VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'excel', 'queued', $8::uuid)
               RETURNING id""",
            project_id, year, week, fname,
            hashlib.sha256(content).hexdigest(), storage_path, len(content),
            str(admin))
        await process_project_weekly_report(str(sub_id))
        sub = await fetch(
            """SELECT status, error_message FROM project_report_submissions
               WHERE id = $1::uuid""", str(sub_id))
        print(f"  {year}-W{week:02d}: {sub[0]['status']}"
              + (f" — {sub[0]['error_message']}" if sub[0]["error_message"] else ""))

    # ── verification ────────────────────────────────────────────────────
    print("\n=== verification ===")
    weeks = await fetchval(
        "SELECT count(*) FROM project_weekly_reports WHERE project_id = $1::uuid",
        project_id)
    items = await fetchval(
        "SELECT count(*) FROM project_beme_items WHERE project_id = $1::uuid",
        project_id)
    gap = await fetch(
        """SELECT i.item_code, a.amount FROM project_ledger_adjustments a
           JOIN project_beme_items i ON i.id = a.beme_item_id
           WHERE a.project_id = $1::uuid AND a.ledger='beme' AND a.kind='gap'
           ORDER BY i.item_code""", project_id)
    cost_gap = await fetchval(
        """SELECT COALESCE(sum(amount),0) FROM project_ledger_adjustments
           WHERE project_id = $1::uuid AND ledger='cost' AND kind='gap'""",
        project_id)
    stale = await fetchval(
        """SELECT count(DISTINCT weekly_report_id) FROM project_sheet_flags
           WHERE project_id = $1::uuid AND flag_type = 'stale_copy'""",
        project_id)
    frozen = await fetchval(
        """SELECT count(DISTINCT weekly_report_id) FROM project_sheet_flags
           WHERE project_id = $1::uuid AND flag_type = 'frozen_column'""",
        project_id)
    bill6 = await fetchval(
        """SELECT count(*) FROM project_sheet_flags
           WHERE project_id = $1::uuid AND message LIKE '%bill_6_contract%'""",
        project_id)
    done = await fetchval(
        """SELECT sum(amount_done) FROM v_project_beme_cumulative
           WHERE project_id = $1::uuid""", project_id)
    print(f"  weeks stored: {weeks} (expect 10)")
    print(f"  beme items: {items} (expect 97)")
    print(f"  beme gap facts: {[(g['item_code'], float(g['amount'])) for g in gap]}")
    print(f"  beme gap total: {sum(float(g['amount']) for g in gap):,.2f} (expect 425,055,750.00)")
    print(f"  cost gap total: {float(cost_gap):,.2f} (expect 251,505,724.99)")
    print(f"  stale-copy weeks flagged: {stale} (expect 7: W4-W9 identical + W10 near-copy)")
    print(f"  frozen-column weeks flagged: {frozen}")
    print(f"  bill-6 broken-SUM flags: {bill6} (expect 10 — every workbook)")
    print(f"  total work done (all items, baseline+gap+weeks): ₦{float(done):,.2f}")

    await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
