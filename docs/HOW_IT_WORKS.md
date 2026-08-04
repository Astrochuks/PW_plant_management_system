# How this system works

A complete walk through the PW Plant Management System: how a click becomes
a database query, how purchase orders are modelled, what every page does,
and the rules that keep the money figures honest.

Every number in this document was read from the live database or the code
on 3 August 2026, not from memory.

---

## 1. The shape of the system

Three pieces, deployed separately:

```
   Browser (Nigeria)
        │  HTTPS + JWT
        ▼
   Next.js frontend  ──────────► Vercel
        │  axios → /api/v1/*
        ▼
   FastAPI backend   ──────────► Render (Frankfurt)
        │  asyncpg over Supavisor :6543
        ▼
   PostgreSQL        ──────────► Supabase (Ireland)
```

| Layer | Technology | Where |
|---|---|---|
| Frontend | Next.js 16, React 19, Tailwind 4, shadcn/ui, React Query, Axios | Vercel |
| Backend | FastAPI (Python 3.11), asyncpg | Render, Frankfurt |
| Database | PostgreSQL 57 tables, 17 views, ~40 functions | Supabase, eu-west-1 |
| Auth | Supabase Auth (JWT, ES256) | Supabase |
| File storage | Supabase Storage, bucket `documents` (public) | Supabase |

**Scale today:** 1,688 plants · 1,856 spare-part lines · 424 purchase orders ·
28,249 weekly plant records · 219 projects · 30 sites · 27 suppliers ·
68 pages · 200+ API endpoints.

### The one architectural decision worth knowing

Supabase gives you a REST gateway called PostgREST. **We do not use it for
data.** Every read and write goes through **asyncpg**, a direct PostgreSQL
driver, because PostgREST was adding 3–4 seconds per request. Direct
connections answer in 2–5 milliseconds.

Supabase is still used for two things it is genuinely good at:

- **Auth** — sign in, sign out, create user, refresh token
- **Storage** — uploading and serving PO documents and workbooks

So: `app/core/database.py` is Supabase (auth + storage only), and
`app/core/pool.py` is asyncpg (all data). Mixing these up is the single
easiest way to make the app slow again.

---

## 2. How a request travels

Follow one click — opening a plant's detail page.

**1. The component asks for data.** React Query hooks live in
`frontend/src/hooks/use-*.ts`. They cache results for 2–10 minutes, so
revisiting a page doesn't re-hit the network.

```ts
const { data: plant } = usePlant(plantId)
```

**2. Axios attaches the token.** `frontend/src/lib/api/client.ts` holds one
configured axios instance. An interceptor reads the JWT from
`sessionStorage` and sets `Authorization: Bearer …` on every request. A
second interceptor catches `401`, silently refreshes the token, and retries
once. Global timeout is 10 seconds — except exports, which pass
`EXPORT_TIMEOUT_MS` (120s) because they transfer files rather than answer
queries.

**3. FastAPI authenticates.** `app/core/security.py`:

- Verify the JWT **locally** using Supabase's public key (ES256 via JWKS).
  The key is cached, so this costs **zero network calls**.
- Only if local verification fails does it fall back to asking Supabase's
  API (one network call).
- Expired tokens are rejected immediately, with no network call at all.
- Then look up the user's role. A **5-minute in-memory cache** means a
  cache hit costs zero database calls. If the database is briefly down, an
  expired cache entry is served rather than failing the request.

**4. A role gate runs.** Each endpoint declares who may call it:

```python
current_user: Annotated[CurrentUser, Depends(require_management_or_admin)]
```

**5. The endpoint queries Postgres.** Through the pool helpers in
`app/core/pool.py`:

| Helper | Use |
|---|---|
| `fetch` | many rows → list of dicts |
| `fetchrow` | one row → dict or None |
| `fetchval` | one value |
| `execute` | INSERT / UPDATE / DELETE |
| `executemany` | batch writes |
| `stream_rows` | **large exports** — reads through a cursor in batches |

**6. Types are normalised.** `_record_to_dict` converts Postgres types into
things JSON understands: UUID → string, Decimal → float, datetime/date →
ISO string.

**7. The response comes back**, React Query caches it, the component
renders.

### The connection pool, and why it matters

The backend keeps **2 to 10 open connections** shared by every request.
Two settings shape its behaviour:

- **`command_timeout=15`** — any single database command taking longer than
  15 seconds is assumed dead. Exceeding it twice triggers a full pool
  rebuild, which interrupts *every other user*. This is why the plants
  export was rewritten to stream through a cursor: one 16-second command
  became many sub-second ones.
- **`statement_cache_size=0`** — required. Supavisor pools in *transaction
  mode*, so a prepared statement created on one backend connection won't
  exist on the next one. Caching them causes random errors.

---

## 3. Roles and who sees what

Five roles, defined in `frontend/src/lib/roles.ts` and enforced in
`app/core/security.py`:

| Role | Purpose |
|---|---|
| `admin` | Everything, including user management and data entry |
| `managing_director` | Read-only executive view |
| `general_project_manager` | Same access as the MD |
| `plant_officer` | Plant module, no projects |
| `site_engineer` | The separate site portal only |

`managing_director` and `general_project_manager` are deliberately
identical in permissions — `MANAGEMENT_ROLES` treats them as one tier. They
were split from a single `management` role in migration 029 so the app can
address them differently later without another migration. Rows still
carrying the old `management` value are still honoured.

Frontend gating uses `<ProtectedRoute requiredRole="admin">`. **This is
convenience, not security** — the backend gate is the real one. Four pages
(`/locations`, `/locations/[id]`, `/suppliers`, `/suppliers/[id]`) currently
have no frontend gate, so a site engineer typing the URL renders the page
and collects 403s from every call. Cosmetic, but on the fix list.

---

## 4. The data model

### Plants

`plants_master` — 1,688 rows, the fleet register.

**The single most important gotcha in this schema:**

| Column | Status |
|---|---|
| `condition` | **The live column.** Updated by the weekly-report ETL. Use this. |
| `status` | **Stale/legacy.** Do not count or filter on it. |

Every view and function correctly uses `condition`. The export endpoint was
the last place `status` survived, and it made every filtered export return
a 500 until it was fixed.

`condition` has exactly six values, enforced on the table itself by
`plants_master_condition_check`:

| Condition | Count |
|---|---|
| working | 437 |
| standby | 515 |
| breakdown | 334 |
| missing | 301 |
| scrap | 88 |
| off_hire | 12 |
| **total** | **1,688** |

There is no "Other" bucket anywhere. Dashboards used to show
working/standby/breakdown and lump the remaining 401 plants — including 301
*missing* ones — into one grey column. All six are now named everywhere,
driven from one constant, `frontend/src/lib/conditions.ts`.

### Supporting tables

| Table | Rows | What it holds |
|---|---|---|
| `plant_weekly_records` | 28,249 | One row per plant per reported week — **the source of truth** |
| `plant_events` | 5,289 | Timeline of things that happened to a plant |
| `plant_location_history` | 1,813 | Where each plant has been |
| `plant_transfers` | 373 | Movements between sites |
| `archived_plants` | 577 | Removed from the active register |
| `locations` | 30 | Sites |
| `states` | — | Nigerian states, grouping sites |
| `suppliers` | 27 | Vendors |
| `fleet_number_prefixes` | 79 | Maps `T` → TRUCKS, `AC` → COMPRESSORS, etc. |

### Views

17 views. The ones that matter for the plant module:

| View | Purpose |
|---|---|
| `v_plants_summary` | The fleet register with costs joined on — 43 columns |
| `v_purchase_orders_summary` | One row per purchase order |
| `v_supplier_stats` | Spend per supplier |
| `v_location_stats` | Per-site plant counts by condition |
| `v_plant_costs` | Cost rollup per plant |

---

## 5. Purchase orders — the part people get wrong

This is the most subtle area of the system, so it gets the most space.

### 5.1 What a purchase order actually is

There is **no `purchase_orders` table**. A PO is a *group of rows* in
`spare_parts` that share a purchase order number and a date. Each row is
one line item.

**A purchase order is identified by its NUMBER *and* its DATE.**

This is not a technicality — it caused a real ₦1,138,000 error. PO numbers
come from the plant people, and PW does not control how they are written.
The same number legitimately recurs, including across years.

Live example — `PW-PO201125-08` covers three separate purchase orders:

| Date | Amount |
|---|---|
| 2025-11-20 | ₦100,000 |
| 2026-02-21 | ₦680,000 |
| 2026-04-08 | ₦458,000 |

Grouping by number alone fused these into one row dated 2025-11-20, and the
₦1,138,000 raised in 2026 vanished from 2026 entirely.

**A hard rule, recorded so it is never repeated:** about 78% of PO numbers
encode a date (`PW-POddmmyy-nn`), and 71 POs have a `po_date` that disagrees
with their own number. That looks like a data-quality problem. **It is
not.** The plant people only sometimes derive the number from the date, so
the number is a convention, never an authority. `po_date` is the date on the
purchase order document, and it is what we follow. **Never "correct" a date
against a PO number.**

### 5.2 How cost is calculated

`total_cost` and `total_cost_ngn` are **generated columns** — Postgres
computes them, you cannot insert them:

```
base      = unit_cost × quantity
vat       = vat_amount      or  base × vat_percentage / 100
discount  = discount_amount or  base × discount_percentage / 100

total_cost      = round(base + vat − discount + other_costs, 2)
total_cost_ngn  = round((base + vat − discount + other_costs) × fx_rate_to_ngn, 2)
```

| Column | Meaning |
|---|---|
| `total_cost` | The **original currency** amount |
| `total_cost_ngn` | The same amount converted to naira |
| `currency` | ISO code — NGN, USD, GBP, EUR |
| `fx_rate_to_ngn` | The rate **at PO entry**, frozen forever |

**Always aggregate `total_cost_ngn`.** Summing `total_cost` mixes pounds
and naira into one meaningless number. That exact bug understated supplier
spend by ₦9,229,167.32.

The FX rate is deliberately frozen at entry. A PO raised at ₦1,400/$ stays
valued at ₦1,400/$ forever — otherwise last year's reports would silently
change every time the rate moved.

### 5.3 Direct vs shared — the actual rule

When a PO is entered, the fleet field is parsed
(`app/services/fleet_parser.py`) and classified:

```python
def get_cost_classification(fleet_associations):
    resolved_plants = [f for f in fleet_associations if f.get("plant_id")]
    has_workshop    = any(f.get("is_workshop")  for f in fleet_associations)
    has_category    = any(f.get("is_category")  for f in fleet_associations)

    if len(resolved_plants) == 1 and not has_workshop and not has_category:
        return "direct"
    return "shared"
```

In plain terms:

> **`direct`** — the PO is for exactly one identified plant, and nothing else.
> **`shared`** — anything else: two or more plants, or a workshop entry, or a category.

Live split:

| | Rows | Value | POs |
|---|---|---|---|
| direct | 1,517 | ₦602,403,765.32 | 354 |
| shared | 339 | ₦73,466,994.74 | 74 |
| **total** | **1,856** | **₦675,870,760.06** | **424** |

### 5.4 What the fleet field accepts

The parser handles four kinds of input:

**Fleet numbers**, including abbreviated ones that inherit the previous
prefix:

```
T468, 463, 466   →   T468, T463, T466
```

**Workshop keywords** — `WORKSHOP`, `W/SHOP`, `WS`, `GENERAL`, `SITE`,
`OFFICE`. These set `is_workshop = true`, carry no plant, and force the PO
to `shared`.

**Categories** — spend against a class of equipment or a cost type rather
than a machine. `LOW LOADER`, `VOLVO`, `PRECAST`, `CONSUMABLES`, `TYRES`,
`BATTERIES`, `LUBRICANTS`, `FUEL`, `D6`/`D7`/`D8`, `CAT`, `OTHERS`,
`MISCELLANEOUS` and their variants. These set `is_category = true` plus a
normalised `category_name`, and also force `shared`. 61 rows are categories.

**Fleet type names** like `TRUCKS` — matched against
`fleet_number_prefixes` and treated as a category.

### 5.5 How the rows are written

For a shared, multi-fleet PO:

- **One row per line item**, at its **original full price** — costs are
  *not* divided at write time.
- `plant_id` is `NULL` — the item belongs to no single plant.
- `shared_fleet_numbers` (a text array) records which fleets it covers.
  283 rows carry this.

For a direct PO, `plant_id` is set and `shared_fleet_numbers` is `NULL`.

**Per-item override:** a single PO can mix both. If a line item names its
own fleet (the 5th field in the item format), that item is written as
`direct` to that plant while the rest of the PO stays shared.

VAT, discount, and other costs are entered once for the whole PO and then
**distributed across line items proportionally** to each item's share of the
subtotal.

### 5.6 The apportionment rule — where ₦12.4m was destroyed

Here is the rule that matters most:

> **Shared costs are divided by fleet count *only* when asking what ONE
> plant cost. Asked portfolio-wide, the money was spent in full.**

A ₦100,000 PO shared across 5 plants:

- *"What did plant T468 cost?"* → ₦20,000. Correct — that's its share.
- *"What did we spend in 2026?"* → **₦100,000.** The whole amount left the
  business.

The old `get_maintenance_cost_analysis` divided by the fleet count but never
expanded the row back out, so the ₦100,000 PO contributed ₦20,000 to the
month and **₦80,000 simply vanished**. Across 2026 that destroyed
**₦12,449,231.25** of ₦65,548,502.24 of shared spend.

Migration 032 fixed it: apportion only when a specific plant is asked for.

`get_high_cost_plants` still apportions — correctly, because it ranks
plants by what each plant cost.

### 5.7 Other flags

| Flag | Meaning | Rows |
|---|---|---|
| `is_workshop` | Workshop/general, not a plant | 2 |
| `is_category` | A category of spend, not a plant | 61 |
| `is_po_overhead` | PO-level overhead line, excluded from plant rollups | 0 |
| `fleet_number_raw` | Exactly what was typed, before resolution | — |
| `submission_number` | Distinguishes repeat entries under one PO number | — |

`fleet_number_raw` is worth knowing: it preserves the operator's input
verbatim. The resolved `fleet_number` shown in the UI comes from a
`LEFT JOIN plants_master`.

### 5.8 Entering a PO

`POST /spare-parts/bulk` is the unified entry point — admin only. It takes
fleets, a PO number, and an items string, then in one pass:

1. Runs three independent lookups **in parallel** — next submission number,
   fleet parsing, supplier resolution.
2. Resolves the supplier: exact name match → fuzzy match
   (`find_similar_supplier`, 0.3 threshold) → create new.
3. Parses a flexible date (`13-January-26`, `2026-01-13`, and others).
4. Parses items, either as JSON or as
   `description|qty|cost|part_no|fleet;next…`.
5. Classifies direct vs shared.
6. Distributes VAT / discount / other costs across items.
7. Inserts **all rows in one batched `UNNEST` statement** inside a
   transaction.
8. Sets `shared_fleet_numbers` on the shared rows.
9. Logs to the audit trail in a background task.

---

## 6. The weekly report pipeline

This is how plant data actually gets into the system.

```
Excel workbook
      ↓  admin uploads (you do this personally)
   parser  ← deterministic. No AI. Ever.
      ↓
weekly_report_submissions  +  plant_weekly_records
      ↓  ETL
plants_master (condition, location, verification)  +  plant_events
```

**The parsing is entirely deterministic** — anchor-based sheet detection and
explicit column mapping in `app/services/weekly_report_*.py`. There is no
model, no inference, no guessing anywhere in this path. That is a hard
project rule.

### Records are the source of truth

`plants_master` is a *derived* cache of the latest state.
`plant_weekly_records` is the truth.

This shows up most clearly when a week is deleted. The system doesn't just
remove the records — it **rewinds** each affected plant to its latest
*remaining* record:

```sql
UPDATE plants_master pm SET
    condition = r.condition,
    physical_verification = r.physical_verification,
    last_verified_date = r.week_ending_date, …
FROM (SELECT DISTINCT ON (plant_id) …
      FROM plant_weekly_records
      ORDER BY plant_id, year DESC, week_number DESC) r
WHERE pm.id = r.plant_id
```

And a plant whose only record was that upload has its condition set back to
`NULL` — unknown, rather than a stale ghost value. Location history is then
rebuilt from the surviving records.

### Weeks are ISO weeks

`week_number` is the **ISO-8601** week, paired with the ISO year. Not
"day of year ÷ 7". A database trigger owns this column, which once silently
overrode the value Python computed — the trigger and the backfill had to be
fixed in the same migration.

`month`, `quarter` and `year` are ordinary calendar values from the date.
One helper, `isoWeek()` in `frontend/src/lib/format.ts`, computes it on the
frontend so nothing drifts.

---

## 7. Transfers

A plant moves between sites through `plant_transfers` (373 rows), managed
by `app/services/transfer_service.py`.

The flow sets `plants_master.pending_transfer_id` while a move is in
progress, and clears it on confirmation or cancellation. Confirmation
updates the plant's `current_location_id` and writes to
`plant_location_history`.

**Pending transfers are no longer shown** in the plant officer view,
management view, plant detail, or site detail pages. Only confirmed
transfers appear. A transfer is also confirmable by a subsequent weekly
report — the plant simply shows up at its new site.

Note: `/reports/trends` and `/reports/generate` read transfers from two
different sources (`get_plant_movement_report()` versus a direct query on
`status='confirmed'`), so they can in principle disagree. On the fix list.

---

## 8. The pages

68 pages. Grouped by what they're for.

### Plant module

| Page | What you can do |
|---|---|
| `/` | Fleet dashboard — counts by condition, cost trend, fleet by type, site breakdown |
| `/plants` | Fleet register. Debounced search (300ms), filter by condition/site/type/state/year/division, Excel export |
| `/plants/[id]` | One plant: details, maintenance history, cost, events timeline, transfers |
| `/plants/[id]/edit` | Edit plant attributes |
| `/plants/create` | Add a plant |
| `/plant` | Management landing for the plant workbench |

### Spare parts and POs

| Page | What you can do |
|---|---|
| `/spare-parts` | All line items, filterable. Cards: total spend, PO count, top suppliers, high-cost plants |
| `/spare-parts/pos` | Purchase orders, one row each. Grand total across all pages via a window function |
| `/spare-parts/po/[poNumber]` | One PO: line items, supplier, fleets covered, attached document. Edit and delete |
| `/spare-parts/create` | Enter a PO |
| `/spare-parts/analytics` | Spend by period, year-over-year, top suppliers, high-cost plants |
| `/spare-parts/price-catalog` | What each part has cost over time |
| `/spare-parts/repeat-purchases` | Parts bought repeatedly — the reorder/waste signal |

### Reports

| Page | What you can do |
|---|---|
| `/reports` | Index |
| `/reports/fleet-summary` | Fleet by type × condition, all six named |
| `/reports/maintenance-costs` | Spend by month/quarter/year, filterable by site and fleet type |
| `/reports/trends` | Movement and condition trends over time |
| `/reports/unverified` | Plants not physically verified recently, worst first |
| `/reports/verification` | Verification rates by site |
| `/reports/compliance` | Weekly-report submission compliance by site |
| `/reports/generate` | **The report generator** — full document for any period, PDF print and Excel export |
| `/reports/export` | Bulk CSV/JSON export of plants and maintenance |

`/reports/verification` and `/reports/compliance` are structurally identical
— same layout, same KPI card, same sort, byte-identical helper functions.
They should be one page with a toggle.

### Projects

| Page | What you can do |
|---|---|
| `/projects` | Project registry |
| `/projects/executive` | **Executive summary** — the MD/GPM landing page |
| `/projects/[id]` | Project hub overview: KPIs |
| `/projects/[id]/financials` | Contract value, certificates, payments, retention |
| `/projects/[id]/work-cost` | Cost by category × week/month/quarter/year |
| `/projects/[id]/plant` | Plant utilisation and diesel |
| `/projects/[id]/submissions` | What has been reported, by week |
| `/projects/[id]/issues` | Data issues needing attention (admin only) |
| `/projects/[id]/report` | Report pack for any period |
| `/projects/upload` | Upload a project workbook, with preview before commit |
| `/projects/review-queue` | Resolve ambiguous register entries |
| `/projects/submissions` | All project submissions |
| `/projects/create`, `/projects/[id]/edit` | Create and edit |

The **Executive brief** button on the executive page generates a one-page
PDF (client-side, pdfmake) with quantified findings — certified-not-paid,
retention held, unattributed diesel, price movements, stale sheets.

### Sites, suppliers, transfers

| Page | What you can do |
|---|---|
| `/locations` | Sites with plant counts by condition |
| `/locations/[id]` | One site: plants, costs, transfers |
| `/suppliers` | Suppliers with spend, PO count, item count |
| `/suppliers/[id]` | One supplier's history |
| `/transfers` | Confirmed transfers |
| `/admin/transfers` | Transfer administration |

### Uploads and admin

| Page | What you can do |
|---|---|
| `/uploads` | Upload weekly reports and PO documents |
| `/uploads/submissions` | Every submission, with status |
| `/uploads/submissions/[id]` | One submission: rows parsed, errors, delete (which rewinds) |
| `/uploads/tokens` | Generate upload links for people without accounts |
| `/admin/users` | Create and edit users, assign roles |
| `/admin/states` | Manage states |
| `/admin/audit` | Audit log |
| `/insights` | Weekly insights |
| `/notifications` | Notifications |
| `/profile` | Your own account |

### The site portal

A separate area at `/site/*` with its own layout, for `site_engineer`
users:

| Page | What you can do |
|---|---|
| `/site/dashboard` | That site's plants |
| `/site/report` | Submit a weekly report |
| `/site/submissions` | What this site has submitted |
| `/site/transfers` | Confirmed transfers for this site |

---

## 9. Rules that keep the numbers honest

Learned the hard way, each one from a real bug:

1. **Aggregate `total_cost_ngn`, never `total_cost`.** Raw currency summed
   across a multi-currency table is meaningless. Cost: ₦9,229,167.32
   understated.

2. **Count POs by `(purchase_order_number, po_date)`.** Number alone is not
   unique. Cost: ₦1,138,000 filed in the wrong year, and 11 POs missing
   from the 2026 count.

3. **Apportion shared costs only for a single plant.** Portfolio-wide, the
   money was spent in full. Cost: ₦12,449,231.25 destroyed.

4. **Use `condition`, never `status`,** on `plants_master`.

5. **All six conditions, always, with no "Other".** 401 plants once hid
   behind one grey column.

6. **`week_number` is ISO**, paired with the ISO year.

7. **Never "correct" a `po_date` against a PO number.**

8. **Check `pg_trigger` before trusting Python.** A BEFORE trigger silently
   overwrote a computed column once already.

9. **Verify a DB function's column names against the frontend interface.**
   `SELECT * FROM func()` returning different names than the TypeScript
   expects produces blank cells, not errors. Every report API function now
   has a normalisation layer.

10. **`Number()`-normalise in the API layer.** Don't trust asyncpg to hand
    JavaScript a number.

All of these are locked by tests in `backend/tests/`: `test_po_identity.py`,
`test_spare_parts_money.py`, `test_report_generator_money.py`,
`test_report_filters.py`, `test_conditions.py`.

Every spare-parts figure across Spare Parts, Purchase Orders, Analytics,
Maintenance Costs and the report generator reconciles to
**₦541,777,556.32** for 2026.

---

## 10. Where to look

| You want | Look at |
|---|---|
| An endpoint | `backend/app/api/v1/<module>.py` |
| Database access | `backend/app/core/pool.py` |
| Auth and roles | `backend/app/core/security.py` |
| PO parsing rules | `backend/app/services/fleet_parser.py` |
| Weekly report parsing | `backend/app/services/weekly_report_*.py` |
| Schema changes | `backend/migrations/` (numbered, in order) |
| A page | `frontend/src/app/(dashboard)/<route>/page.tsx` |
| An API call | `frontend/src/lib/api/<module>.ts` |
| A data hook | `frontend/src/hooks/use-*.ts` |
| Money formulas | `docs/WORKBOOK_ARITHMETIC.md` |
| Known defects | `docs/PLANT_MODULE_AUDIT.md` |
| Deployment | `PRODUCTION.md` |
