"""Live check of the bill edit cycle — run from backend/ with:

    PYTHONPATH=. python scripts/check_bill_edit.py

Records a bill, edits it, saves again — through the real API on a
throwaway project (short_name E2E-BILL-CHECK, deleted at the end).
Writes to the live database for ~30 s; do not run during an upload. Auth is overridden to the real admin account; every
request goes through the router, the SQL and the database. The project is
deleted at the end (it has no history rows, so the cascade removes the bill)."""
import asyncio, os, sys
from dotenv import load_dotenv; load_dotenv(dotenv_path=".env")
import asyncpg
from fastapi.testclient import TestClient
from app.main import app
from app.core.security import CurrentUser, get_current_user, require_admin, require_projects_read

ADMIN = CurrentUser(id="ff86ca12-3d62-452d-92d3-c2f8a76128d0", email="ajakgheshedrack@gmail.com", role="admin", project_scope="all")
for dep in (get_current_user, require_admin, require_projects_read):
    app.dependency_overrides[dep] = lambda: ADMIN

async def make_project():
    c = await asyncpg.connect(os.environ["DATABASE_URL"], statement_cache_size=0)
    async with c.transaction():
        await c.execute("SET LOCAL app.seed_history = 'off'")
        pid = await c.fetchval("INSERT INTO projects (project_name, client, short_name) VALUES ('E2E BILL EDIT CHECK', 'E2E', 'E2E-BILL-CHECK') RETURNING id")
    await c.close(); return str(pid)

async def drop_project(pid):
    c = await asyncpg.connect(os.environ["DATABASE_URL"], statement_cache_size=0)
    n = await c.execute("DELETE FROM projects WHERE id = $1::uuid AND short_name = 'E2E-BILL-CHECK'", pid)
    left = await c.fetchval("SELECT count(*) FROM project_beme_revisions WHERE project_id = $1::uuid", pid)
    await c.close(); return n, left

def bill(code, name, items):
    its = [{"item_code": c, "description": d, "unit": u, "contract_qty": q, "rate": r,
            "contract_amount": None if q is None or r is None else round(q * r, 2), "sort_order": i + 1}
           for i, (c, d, u, q, r) in enumerate(items)]
    return {"bill_code": code, "bill_no": int(code) if code.isdigit() else None, "sort_order": 1, "name": name,
            "sheet_total": None, "items_total": round(sum((x["contract_amount"] or 0) for x in its), 2), "item_count": len(its), "items": its}

pid = asyncio.run(make_project())
print("throwaway project:", pid)
ok = True
def check(cond, msg):
    global ok
    print(("  PASS " if cond else "  FAIL ") + msg)
    ok = ok and cond
try:
    with TestClient(app) as client:
        base = f"/api/v1/projects/{pid}/bills"
        # 0. empty
        r = client.get(base); d = r.json()["data"]
        check(r.status_code == 200 and d["revision"] is None and d["bills"] == [] and d["summary"] is None, "empty project reads as no bill")

        # 1. record revision 1 (the builder's payload shape)
        rev1 = {"source": "award_beme", "effective_date": "2026-10-13", "note": "first entry",
                "adders": [{"name": "Contingency", "kind": "percent_of_works", "value": 5}, {"name": "VAT", "kind": "percent_of_running", "value": 7.5}],
                "bills": [bill("1", "PRELIMINARIES", [("1.01", "Site office", "P.S", 1, 2500000), ("1.02", "Insurance", "L.S", 1, 1000000)]),
                          bill("2", "EARTHWORKS", [("2.01", "Clear site", "Ha", 13, 100000), ("2.02", "Excavate", "m3", 147223, 1500), ("2.02", "Excavate", "m3", 10, 1500)])]}
        r = client.post(f"{base}/revisions", json=rev1); check(r.status_code == 201, f"record revision 1 -> {r.status_code} {r.text[:120]}")
        r1 = r.json()["data"]; check(r1["revision_no"] == 1 and abs(r1["works_total"] - (3500000 + 1300000 + 220834500 + 15000)) < 0.01, f"revision 1 works total {r1['works_total']}")

        # 2. read back — this is what the builder is prefilled from
        d = client.get(base).json()["data"]
        check(d["revision"]["revision_no"] == 1, "current = revision 1")
        check([b["bill_code"] for b in d["bills"]] == ["1", "2"], "bills in order")
        b2 = next(b for b in d["bills"] if b["bill_code"] == "2")
        check([i["item_code"] for i in b2["items"]] == ["2.01", "2.02", "2.02"], "items in sheet order, the repeated line kept")
        check(any(i["unit"] == "m3" and i["contract_qty"] == 147223 and i["rate"] == 1500 and i["contract_amount"] == 220834500 for i in b2["items"]), "quantity, rate, amount stored exactly")
        s = d["summary"]; check(abs(s["works_total"] - 225649500) < 0.01 and abs(s["contract_total"] - round(225649500 * 1.05 * 1.075, 2)) < 0.011, f"summary with adders: works {s['works_total']} -> contract {s['contract_total']}")
        check(d["revision"]["adders"] == rev1["adders"], "adders carried on the revision")

        # 3. edit: change a rate, add an item, remove the repeated line, add a bill — save as revision 2 (what 'Edit by hand' does)
        edited = d["bills"]
        for b in edited:
            for i in b["items"]:
                if i["item_code"] == "1.01": i["rate"] = 2600000; i["contract_amount"] = 2600000
        edited[1]["items"] = [i for i in edited[1]["items"] if not (i["item_code"] == "2.02" and i["contract_qty"] == 10)]
        edited[1]["items"].append({"item_code": "2.03", "description": "Dub in grass", "unit": "m3", "contract_qty": 17000, "rate": 800, "contract_amount": 13600000, "sort_order": 3})
        edited.append(bill("3", "DRAINAGE", [("3.01", "Culvert", "No", 4, 2500000)]))
        for b in edited: b["items_total"] = round(sum((i["contract_amount"] or 0) for i in b["items"]), 2); b["item_count"] = len(b["items"])
        rev2 = {"source": "correction", "effective_date": "2026-10-13", "note": "rate fix + culverts", "bills": edited, "adders": d["revision"]["adders"]}
        r = client.post(f"{base}/revisions", json=rev2); check(r.status_code == 201 and r.json()["data"]["revision_no"] == 2, f"record revision 2 -> {r.status_code}")

        # 4. everyone now sees revision 2; revision 1 kept
        d2 = client.get(base).json()["data"]
        check(d2["revision"]["revision_no"] == 2 and d2["revision"]["state"] == "approved", "current = revision 2")
        check([b["bill_code"] for b in d2["bills"]] == ["1", "2", "3"], "new bill present, order kept")
        b1 = next(b for b in d2["bills"] if b["bill_code"] == "1"); check(next(i for i in b1["items"] if i["item_code"] == "1.01")["rate"] == 2600000, "edited rate saved")
        b2 = next(b for b in d2["bills"] if b["bill_code"] == "2"); check([i["item_code"] for i in b2["items"]] == ["2.01", "2.02", "2.03"], "removed line gone, added line in place")
        check(len(d2["revisions"]) == 2 and d2["revisions"][0]["revision_no"] == 2 and d2["revisions"][1]["state"] == "superseded", "history: 2 snapshots, old one superseded")
        check(d2["revisions"][0]["recorded_by_email"] == ADMIN.email, "history names who saved")

        # 5. the old snapshot opens in full, with a correct diff against the current bill
        old_id = d2["revisions"][1]["id"]
        r = client.get(f"{base}/revisions/{old_id}"); dd = r.json()["data"]
        check(r.status_code == 200 and dd["revision"]["revision_no"] == 1 and len(dd["bills"]) == 2, "revision 1 opens in full")
        diff = dd["diff"]
        changed = {(c["item_code"], c["old"]["rate"], c["new"]["rate"]) for c in diff["items_changed"]}
        check(("1.01", 2500000.0, 2600000.0) in changed, "diff: rate change seen old->new")
        check({i["item_code"] for i in diff["items_added"]} == {"2.03", "3.01"} and diff["bills_added"] == ["3"], "diff: added items and bill")
        check([i["item_code"] for i in diff["items_removed"]] == ["2.02"] and diff["items_removed"][0]["old"]["contract_qty"] == 10.0, "diff: the removed repeated line, by occurrence")
        check(abs(diff["works_proposed"] - diff["works_current"] - (100000 - 15000 + 13600000 + 10000000)) < 0.01, f"diff: works delta {diff['works_delta']}")

        # 6. adders edit on the current bill
        r = client.patch(f"{base}/adders", json={"adders": [{"name": "VAT", "kind": "percent_of_running", "value": 7.5}]})
        d3 = client.get(base).json()["data"]
        check(r.status_code == 200 and len(d3["revision"]["adders"]) == 1 and abs(d3["summary"]["contract_total"] - round(d3["summary"]["works_total"] * 1.075, 2)) < 0.011, "adders updated and summary follows")

        # 7. progress endpoint behaves with a bill and no weeks
        p = client.get(f"{base}/progress").json()["data"]
        check(p["weeks_on_file"] == 0 and [b["bill_code"] for b in p["bills"]] == ["1", "2", "3"] and all(b["to_date"] == 0 for b in p["bills"]), "progress by bill: 3 bills, nothing to date")

        # 8. validation: a revision with no items is refused
        r = client.post(f"{base}/revisions", json={"source": "correction", "effective_date": "2026-10-13", "bills": [{"bill_code": "9", "items": []}]})
        check(r.status_code in (400, 422), f"empty bill refused ({r.status_code})")
finally:
    n, left = asyncio.run(drop_project(pid)); print("cleanup:", n, "| revisions left for it:", left)
print("\nRESULT:", "ALL PASS" if ok else "FAILURES ABOVE"); sys.exit(0 if ok else 1)
