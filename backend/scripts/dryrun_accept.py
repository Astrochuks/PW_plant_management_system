"""Dry-run an Accept end-to-end against the LIVE schema, then roll back.

Parses a real workbook, runs persist_weekly_report inside an outer
transaction (its internal transaction becomes a savepoint), verifies
row counts and spot-checks known workbook values landed in the right
columns, then rolls everything back. Nothing is saved.

Usage:  python3 -m scripts.dryrun_accept "<workbook path>" <year> <week>
"""

import asyncio
import io
import sys

import openpyxl
from dotenv import load_dotenv

load_dotenv(".env")

CHECK_TABLES = [
    "project_beme_bills", "project_beme_items", "project_beme_progress",
    "project_cost_report", "project_plant_utilization",
    "project_diesel_consumption", "project_certificates", "project_payments",
    "project_hired_vehicles", "project_labour_strength",
    "project_subcontractors", "project_materials_stock",
    "project_weekly_summary", "project_contract_summary_snapshot",
    "project_sheet_flags", "project_reference_lists",
]


async def main(path: str, year: int, week: int) -> None:
    from app.core.pool import init_pool, close_pool, get_pool
    from app.services.weekly_report_sheets import parse_workbook
    from app.services.weekly_report_import import persist_weekly_report

    await init_pool()
    pool = get_pool()
    ok = True
    try:
        async with pool.acquire() as conn:
            project = await conn.fetchrow(
                "SELECT id, short_name FROM projects WHERE short_name ILIKE '%akwa%'")
            if project is None:
                print("✗ Akwa project not found in register"); return
            pid = str(project["id"])
            print(f"project: {project['short_name']} ({pid[:8]}…)")

            ref_before = await conn.fetchval(
                "SELECT count(*) FROM project_reference_lists")

            wb = openpyxl.load_workbook(path, data_only=True)
            parsed = parse_workbook(wb)
            failed = [n for n, s in parsed["sheets"].items()
                      if s.get("status") == "failed"]
            print(f"parsed: {len(parsed['sheets'])} sheets, failed: {failed or 'none'}")

            outer = conn.transaction()
            await outer.start()
            try:
                stats = await persist_weekly_report(
                    conn, pid, year, week, parsed, None)
                print(f"persisted OK — week ending {stats['week_ending_date']}")
                for t, n in sorted(stats["row_counts"].items()):
                    print(f"   {t:38} {n:>5} rows")
                print(f"   fleet resolved: {stats['fleet_resolved']}, "
                      f"unresolved: {stats['fleet_unresolved'] or 'none'}")
                for w in stats["warnings"]:
                    print(f"   ⚠ {w}")

                async def val(q, *a):
                    return await conn.fetchval(q, *a)

                def check(name, got, want, tol=0.01):
                    nonlocal ok
                    good = (got is not None and want is not None
                            and abs(float(got) - float(want)) <= tol)
                    print(f"   {'✓' if good else '✗'} {name}: {got}"
                          + ("" if good else f"  (expected {want})"))
                    ok = ok and good

                print("spot checks (workbook truth → db):")
                check("payments count",
                      await val("SELECT count(*) FROM project_payments WHERE project_id=$1::uuid", project["id"]), 17, 0)
                check("payments gross sum = sheet Total All",
                      await val("SELECT sum(gross_amount) FROM project_payments WHERE project_id=$1::uuid", project["id"]),
                      13_599_853_394.21, 0.5)
                check("cert 1 gross",
                      await val("SELECT gross_value_works_done FROM project_certificates WHERE project_id=$1::uuid AND cert_number='1'", project["id"]),
                      292_876_150)
                check("cert 2 new_total (col R)",
                      await val("SELECT new_total FROM project_certificates WHERE project_id=$1::uuid AND cert_number='2'", project["id"]),
                      3_530_565_785.7525, 0.5)
                check("cert 2 less_previously_certified (col S)",
                      await val("SELECT less_previously_certified FROM project_certificates WHERE project_id=$1::uuid AND cert_number='2'", project["id"]),
                      2_343_183_884.11, 0.5)
                check("materials rebar 8mm variance_qty (col O)",
                      await val("SELECT variance_qty FROM project_materials_stock WHERE project_id=$1::uuid AND material_name ILIKE 'rebar (8mm)%'", project["id"]),
                      -8.736)
                check("materials rebar 8mm variance_value (col P)",
                      await val("SELECT variance_value FROM project_materials_stock WHERE project_id=$1::uuid AND material_name ILIKE 'rebar (8mm)%'", project["id"]),
                      -3_712_800.0, 0.5)
                check("beme items", await val("SELECT count(*) FROM project_beme_items WHERE project_id=$1::uuid", project["id"]), 97, 0)
                check("beme bills", await val("SELECT count(*) FROM project_beme_bills WHERE project_id=$1::uuid", project["id"]), 8, 0)
            finally:
                await outer.rollback()
                print("rolled back.")

            leftovers = 0
            for t in CHECK_TABLES:
                if t == "project_reference_lists":
                    n = await conn.fetchval(
                        "SELECT count(*) FROM project_reference_lists") - ref_before
                else:
                    n = await conn.fetchval(
                        f"SELECT count(*) FROM {t} WHERE project_id = $1::uuid",
                        project["id"])
                if n:
                    print(f"   ✗ {t} gained {n} rows"); leftovers += n
            print("✓ all tables empty after rollback" if leftovers == 0
                  else f"✗ {leftovers} leftover rows!")
            if leftovers:
                ok = False
    finally:
        await close_pool()
    print("RESULT:", "PASS — Accept will save correctly" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], int(sys.argv[2]), int(sys.argv[3])))
