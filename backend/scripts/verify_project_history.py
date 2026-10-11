"""Acceptance check for migrations 036 + 037 (PRD v2 §11, E2).

Read-only. Run after applying the two migrations:

    cd backend && python scripts/verify_project_history.py

Asserts, for all projects:
  - every project has ≥ 1 status event and projects.status/status_since
    equal the latest event (the cache trigger did its job);
  - every project with a sum on record has an 'original' contract-sum row
    and projects.current_contract_sum equals the latest row;
  - the append-only guard refuses UPDATE/DELETE on both history tables;
  - project_status_as_at() reproduces today's status for every project.
Prints PASS/FAIL per check and exits non-zero on any failure.
"""

import asyncio
import os
import sys

import asyncpg
from dotenv import dotenv_values

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.environ.get("DATABASE_URL") or dotenv_values(os.path.join(ROOT, ".env")).get("DATABASE_URL")


async def main() -> int:
    c = await asyncpg.connect(DB, statement_cache_size=0, timeout=60, command_timeout=120)
    failures = 0

    def check(label: str, ok: bool, detail: str = "") -> None:
        nonlocal failures
        failures += 0 if ok else 1
        print(f"  {'PASS' if ok else 'FAIL'}  {label}{(' — ' + detail) if detail else ''}")

    try:
        n_projects = await c.fetchval("select count(*) from projects")
        print(f"projects: {n_projects}")

        # status events + cache
        no_event = await c.fetchval("""
            select count(*) from projects p
             where not exists (select 1 from project_status_events e where e.project_id = p.id)""")
        check("every project has a status event", no_event == 0, f"{no_event} without")

        cache_drift = await c.fetchval("""
            select count(*) from projects p
             join lateral (select status, effective_date from project_status_events e
                            where e.project_id = p.id
                            order by effective_date desc, created_at desc limit 1) l on true
             where p.status <> l.status::text or p.status_since is distinct from l.effective_date""")
        check("projects.status / status_since equal the latest event", cache_drift == 0, f"{cache_drift} drifted")

        dist = await c.fetch("select status, count(*) from projects group by 1 order by 2 desc")
        print("  status distribution:", [(r[0], r[1]) for r in dist])

        # contract sums + cache
        missing_original = await c.fetchval("""
            select count(*) from projects p
             where coalesce(p.original_contract_sum, p.current_contract_sum) is not null
               and not exists (select 1 from project_contract_sums s
                                where s.project_id = p.id and s.kind = 'original')""")
        check("every project with a sum has an 'original' row", missing_original == 0, f"{missing_original} missing")

        sum_drift = await c.fetchval("""
            select count(*) from projects p
             join lateral (select amount from project_contract_sums s
                            where s.project_id = p.id
                            order by effective_date desc, created_at desc limit 1) l on true
             where p.current_contract_sum is distinct from l.amount""")
        check("projects.current_contract_sum equals the latest row", sum_drift == 0, f"{sum_drift} drifted")

        n_sums = await c.fetchval("select count(*) from project_contract_sums")
        n_var = await c.fetchval("select count(*) from project_contract_sums where kind = 'variation'")
        print(f"  contract-sum rows: {n_sums} ({n_var} variations)")

        # delta view sanity: deltas sum back to the current amount per project
        bad_delta = await c.fetchval("""
            select count(*) from (
              select project_id, sum(delta) as total, max(amount) filter (where is_current) as current
                from v_project_contract_sums group by project_id) t
             where abs(total - current) > 0.005""")
        check("v_project_contract_sums deltas sum to the current amount", bad_delta == 0, f"{bad_delta} projects off")

        # append-only guard
        sid = await c.fetchval("select id from project_status_events limit 1")
        try:
            await c.execute("update project_status_events set note = 'x' where id = $1", sid)
            check("UPDATE on project_status_events is refused", False)
        except asyncpg.exceptions.RestrictViolationError:
            check("UPDATE on project_status_events is refused", True)
        cid = await c.fetchval("select id from project_contract_sums limit 1")
        try:
            await c.execute("delete from project_contract_sums where id = $1", cid)
            check("DELETE on project_contract_sums is refused", False)
        except asyncpg.exceptions.RestrictViolationError:
            check("DELETE on project_contract_sums is refused", True)

        # as-at function
        asat_drift = await c.fetchval("""
            select count(*) from projects p
             where project_status_as_at(p.id, current_date)::text is distinct from p.status""")
        check("project_status_as_at(today) matches projects.status", asat_drift == 0, f"{asat_drift} differ")

        active_today = await c.fetchval("""
            select count(*) from projects p
             where project_status_as_at(p.id, current_date) in ('mobilised','active','suspended')""")
        print(f"  ongoing as at today: {active_today}")
    finally:
        await c.close()

    print("RESULT:", "PASS" if failures == 0 else f"FAIL ({failures})")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
