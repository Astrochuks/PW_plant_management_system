# Plant module audit — 26 July 2026

Pre-production pass over the plant module: every page, the endpoints behind
it, tested against live data. Findings are marked **[verified]** where I
called the endpoint or queried the database, and **[by inspection]** where
they come from reading the code only.

Health baseline: **77 parameter-free GET endpoints swept, zero 500s.**
Nothing crashes. Every problem below is a *correctness* or *trust* problem,
which is worse — the page renders a number and the number is wrong.

---

## P1 — Wrong numbers, or a page that fails outright

### 1.0 Purchase Orders vs Spare Parts totals — FIXED (migration 031) **[verified]**

The two cards disagreed for 2026: **₦540,639,556.32** vs **₦541,777,556.32**,
a gap of exactly **₦1,138,000**.

**A purchase order is its NUMBER *and* its DATE.** PO numbers come from
the plant people; PW does not control how they are written and the same
number can legitimately recur, including in a different year. The
authority for when a PO was raised is the date on the purchase order
document, which is what `po_date` holds.

`v_purchase_orders_summary` grouped by `purchase_order_number` **alone**
and dated the merged row `min(po_date)`. So POs sharing a number were
fused into one row carrying the earliest date, and a PO raised in 2026
that shared its number with a 2025 one disappeared from 2026 entirely.

Live case: `PW-PO201125-08` covers 2025-11-20 (₦100,000), 2026-02-21
(₦680,000) and 2026-04-08 (₦458,000). All ₦1,238,000 was filed under 2025.

Migration 031 groups by `(purchase_order_number, po_date)` and correlates
the `plants_count` subquery on the date too. **No data changed** — not one
date, not one amount. Both cards now read ₦541,777,556.32; every year
reconciles to ₦0.00 and the view total equals the table total exactly
(₦675,870,760.06). The 2026 PO count goes 300 → 311, because 14 PO
numbers cover more than one date and are now correctly counted as
separate POs. Locked by `backend/tests/test_po_identity.py` (7 tests).

**A caution recorded so it is not repeated:** ~78% of PO numbers encode a
date (`PW-POddmmyy-nn`), and 71 POs have a `po_date` that disagrees with
their own number. That looks like a data-quality problem but **is not** —
the plant people only sometimes derive the number from the date, so the
number is a convention, never an authority. Do **not** "correct" dates
against PO numbers.

### 1.1 Maintenance costs destroyed ₦12.4m — FIXED (migration 032) **[verified]**

My first read of this was wrong and is corrected here. The two overloads
were not "two conventions, one sensible". The `text` overload — the one
the API actually resolved to — was **losing money**.

Its aggregate divided a shared PO by its fleet count but never expanded
the row:

```sql
CASE WHEN sp.shared_fleet_numbers IS NOT NULL
     THEN sp.total_cost_ngn / array_length(sp.shared_fleet_numbers, 1)
     ELSE sp.total_cost_ngn END
```

A ₦100,000 PO shared across 5 plants contributed ₦20,000 to the month and
the other ₦80,000 vanished. Across 2026 that destroyed **₦12,449,231.25**
of ₦65,548,502.24 of shared spend — proven by differencing the apportioned
sum against the actual.

That is why Reports → Maintenance Costs read ₦529,328,325.07 while Spare
Parts and Purchase Orders both read ₦541,777,556.32. The months summed
correctly to their own grand total; the grand total itself was short.

Apportioning is only meaningful when the question is *"what did THIS
plant cost"*. Asked portfolio-wide, the money was spent in full.
Migration 032 apportions only when `p_plant_id` is supplied, and drops
the `varchar` overload so one definition can ever run.

**Now:** maintenance costs, spare-parts stats, the PO list and the
analytics summary all return **₦541,777,556.32** for 2026 — verified
through the API. Locked by `backend/tests/test_spare_parts_money.py`.

### 1.1b Supplier spend was raw currency shown as naira — FIXED (032) **[verified]**

`v_supplier_stats.total_spend` summed `total_cost`, the **original**
currency, while both consumers render it as naira — understating by
**₦9,229,167.32** overall. It now sums `total_cost_ngn`. Its `po_count`
also counted distinct numbers rather than distinct POs (see 1.0).

**`get_maintenance_costs_combined` — DROPPED (migration 033).** It was
dead *and* broken: no caller anywhere, and it selected from
`v_purchase_order_costs`, a view deleted long ago, so calling it raised
`UndefinedTableError` rather than returning a wrong number. It also summed
raw currency. Migrations 005 and 026 had both noted it as dead and left it
standing; left there it is a trap, because it looks like a cost source and
the next person reconciling has to work out it is a ruin before ignoring
it.
`get_high_cost_plants` apportions shared POs, which is *correct* there:
it ranks plants by what each plant cost.

### 1.1c Report generator — audited, PO counts fixed **[verified]**

The generator (`GET /reports/generate`) is the document that leaves the
building, so it was audited line by line against the same sources.

**Already correct, left alone:** it uses `total_cost_ngn` everywhere (with
a comment explaining why), filters by `replaced_date BETWEEN`, and carries
explicit *unattributed* (no plant) and *unlocated* (no site) rows so its
sub-lists tie back to its own headline.

**Fixed:** four `count(DISTINCT sp.purchase_order_number)` sites — the
summary, top suppliers, sites spend and unlocated spend — now count
`DISTINCT (number, po_date)` (see 1.0).

Reconciled for 1 Jan – 31 Dec 2026, all exact:

| | |
|---|---|
| generator total spend | ₦541,777,556.32 |
| spare-parts stats | ₦541,777,556.32 |
| maintenance costs | ₦541,777,556.32 |
| generator PO count | 311 = PO list |
| sites ranking + unlocated | ties to headline |
| plants + unattributed | ties to headline |

Locked by `backend/tests/test_report_generator_money.py` (6 tests), which
calls the real endpoint rather than a copy of its SQL.

### 1.2 "All locations" returns a 422 — FIXED **[verified]**

Five report pages render `<SelectItem value="all">`, then forward the
literal string `all` as a filter because `"all"` is truthy:

```
GET /reports/fleet-summary?location_id=all        -> 422
GET /reports/maintenance-costs?location_id=all    -> 422
GET /reports/unverified-plants?location_id=all    -> 422
```

Affected: `/reports/fleet-summary`, `/reports/maintenance-costs`,
`/reports/trends`, `/reports/unverified`, `/reports/export`.
`/reports/generate` got this right — it uses a `_all` sentinel mapped back
to `''`.

**Fixed.** `frontend/src/lib/filters.ts` now exports `ALL` (the Radix
placeholder token, since `<SelectItem>` cannot take `""`) and `only()`,
which returns `undefined` for "everything". All five pages bind
`value={x || ALL}` / `onValueChange={v => setX(v === ALL ? '' : v)}`, so
component state holds `''` and the parameter is simply omitted. `only()`
is also applied when building params, and still strips the older literal
`'all'`, so neither layer alone can send a bad request.

### 1.3 "All fleet types" silently returns nothing — FIXED **[verified]**

```
GET /reports/maintenance-costs?year=2026&group_by=month&fleet_type=all  -> 200  []
```

Worse than the 422: no error, just an empty chart. The user reads it as
"no maintenance cost this year."

### 1.4 Export Data is broken on every status filter **[verified]**

```
GET /reports/export/plants?status=working    -> 500
GET /reports/export/plants?status=breakdown  -> 500
GET /reports/export/plants?status=all        -> 500
```

Root cause: `reports.py:478` filters `WHERE status = $1` against
`v_plants_summary`, and that view has **no `status` column** — it has
`condition` (43 columns, confirmed). This is the documented
`status` vs `condition` trap; this endpoint is the one place it survived.

Unfiltered export is fine: 1,688 rows, ~2 MB. (An earlier revision struck
this out on the strength of a bad measurement — see 1.5.)

**Fixed.** The endpoint now filters `condition`, validated against the
six-value taxonomy so a bad value is a 422 rather than a 500. `status` is
kept as a deprecated alias mapping to the same column, so an existing
bookmark or script keeps working. The dropdown is renamed **Condition**
and gained the missing `off_hire` option.

Locked by `backend/tests/test_report_filters.py` (20 tests): every
condition exports, the conditions partition the fleet, the deprecated
alias returns identical counts, a bad value is a 422, and a literal
`all` is a clean 422 on both parameters.

### 1.5 Export tore down the connection pool — FIXED **[verified]**

**This entry previously claimed `v_plants_summary` costs ~74ms per row
and takes 110.81s unfiltered. That was wrong, and so was the cause I
gave for it.** Both are retracted here; the real defect was elsewhere and
was worse.

The view is fast. `EXPLAIN ANALYZE`, three runs:

| | |
|---|---|
| server-side execution | **7.6ms · 8.0ms · 7.7ms** |
| client-side fetch of the same query | **16.00s · 15.34s · 16.27s** |

8 milliseconds to execute, 16 seconds to arrive — the gap is transfer,
not work. The plan is entirely hash joins over 433 buffer hits; the
"two correlated sub-SELECTs in the column list" I blamed are `LEFT JOIN`
derived tables that compute once. The original 110.81s was me timing a
round-trip through the Supabase MCP — which serialises 1,688 × 43 columns
to JSON and ships them — and attributing it to the view. The
"Checked and found correct" note at the foot of this document said
exports ran in 1–2s and that earlier timeouts were sweep contention;
that note was right and this section contradicted it for a week.

**The real defect.** `fetch()` runs a SELECT as ONE command, so
`command_timeout=15` (`pool.py:72`) covers executing it *and* shipping
every row. The export needed ~16s, so it missed by a second, was retried
once (another 15s), and then hit `_try_recover_pool()`:

```
Query timeout in fetch — retrying once
Query timeout in fetch (final), triggering pool recovery
Pool is dead — attempting auto-recovery
```

**One user pressing Export rebuilt the connection pool for everybody
else.** The failed download was the least of it.

**Fixed** by streaming instead of buffering:

- `pool.stream_rows()` (new) reads through an asyncpg **cursor**, so each
  FETCH is its own short command and none approaches the timeout.
  Memory is flat regardless of row count.
- Both `/reports/export/plants` and `/reports/export/maintenance` now
  return a `StreamingResponse` — the file itself, not a JSON envelope
  wrapping it. The browser only ever unwrapped `data` and rebuilt the
  file from it, so **the downloaded file is unchanged**: the CSV is
  byte-identical to the old one (617,467 chars, compared against the old
  code path directly), and the JSON is the same bare array.
- Row count moved to `X-Total-Count`, since headers precede the body.
- Exports get their own 120s axios timeout; the global 10s stays for
  queries.

Measured after: no 503, no retry, no pool recovery, and time-to-first-byte
**519ms**, so the browser starts saving immediately. Unfiltered CSV over
the wire drops **2.02MB → 0.59MB**, because the envelope had been
repeating all 43 column names on every one of 1,688 rows. JSON goes
2.02MB → 2.31MB, as the envelope shipped compact JSON that the browser
then pretty-printed; the *file* was always 2.31MB and CSV is the UI
default.

Locked by 10 new tests in `backend/tests/test_report_filters.py`
(30 total), which assert an attachment filename, that the body is not an
envelope, that CSV rows and JSON array length both equal `X-Total-Count`,
and that the count header is CORS-exposed.

**Caveat on the numbers:** the 16s transfer was measured from a laptop in
Nigeria to Supabase in Ireland. In production that hop is Render
(Frankfurt) → Supabase (Ireland) and will be fast — but the same 2MB
still has to reach a browser in Nigeria, so the slow hop moves rather
than disappears. That is what the CSV size reduction and the streaming
start actually buy.

**Still open:** `shared_po_count` uses
`count(DISTINCT purchase_order_number)` in both branches of its UNION —
the PO-identity bug from 1.0. Measured impact today is **zero** (0 of 67
plants undercounted, 0 POs missed), so it is latent rather than wrong on
screen; it is fixed separately so it cannot break silently later.
Separately, the second branch of that UNION is inert: all 56 qualifying
spare-parts rows have `plant_id IS NULL` (0 orphans), so it can never
contribute. It is left in place because it would fire correctly if such a
row ever gained a plant.

---

## P2 — Numbers that mislead

### 2.0 One condition taxonomy, no "Other" — FIXED (migration 034) **[verified]**

The six conditions are enforced on the table itself
(`plants_master_condition_check`): **working, standby, breakdown,
missing, scrap, off_hire**. Everywhere they are listed, all six now
appear by name.

`get_fleet_summary_by_type` used to return working/standby/breakdown and
lump the rest into `other`, which put a plant nobody can find in the same
grey column as one merely off hire — 401 plants behind one number. The
report generator carried its own copy of the same query.

Fixed in migration 034 and in `reports.py`, and the frontend now drives
every list from one constant, `frontend/src/lib/conditions.ts`
(value + label + colour), so a dashboard, a chart, a table and a report
cannot drift apart again.

Portfolio, reconciled against direct counts:

| condition | count |
|---|---|
| working | 437 |
| standby | 515 |
| breakdown | 334 |
| missing | 301 |
| scrap | 88 |
| off_hire | 12 |
| *unknown* | *1* |
| **total** | **1,688** |

`unknown` is not a bucket — it exists so `total` ties, and holds exactly
one plant, **AC127 STATIC COMPRESSOR**, which has no condition recorded.
Setting it makes the six sum to the fleet exactly. A test names the
offending plants rather than passing quietly.

Locked by `backend/tests/test_conditions.py` (7 tests), including one
asserting the CHECK constraint still allows exactly these six — so if the
taxonomy ever changes, the app is forced to change with it.


### 2.1 Fleet Summary hides 402 of 1,688 plants — FIXED (migration 034) **[verified]**

The table shows Total / Working / Standby / Breakdown. The endpoint also
returns `other`, which the page never renders:

```
total=1688   working=437   standby=515   breakdown=334   other=402
shown columns sum to 1286  ->  402 plants unaccounted for
38 of 75 fleet-type rows visibly do not add up
```

Management reads a row where the parts don't equal the total. That single
impression costs more trust than the missing column is worth.

**Fix:** show `other`, or split it into missing / scrap / off-hire /
unknown.

### 2.2 `under_repair` is a phantom field **[verified]**

`FleetSummaryData.under_repair` is typed and normalized, but the endpoint
never returns it — confirmed keys are
`breakdown, fleet_type, other, standby, total, working`. It is always 0.

### 2.3 Plant Movement shows an always-blank column **[verified]**

The page renders `transferred_by`; the endpoint returns
`event_date, fleet_number, fleet_type, from_location, plant_id, remarks, to_location`.
No `transferred_by` — the column is permanently empty.

`remarks` and `fleet_type` are returned and thrown away.

### 2.4 Two transfer reports that can disagree **[by inspection]**

`/reports/trends` reads `get_plant_movement_report()`; `/reports/generate`
queries `plant_transfers WHERE status='confirmed'` directly. Two sources,
one subject.

### 2.5 Table columns misaligned in Report Generator **[by inspection]**

`generate/page.tsx:436` — the States Summary table has 8 `<TableHead>` and
7 `<TableCell>` per row, so every column right of B/Down is shifted one
left. Same shape at line 485 for Sites Breakdown. Its Excel export pushes
7 sums onto a 6-column header, producing `NaN` in the totals row.

### 2.6 Cards that ignore their own page filters **[by inspection]**

On `/spare-parts`, Top Suppliers and High-Cost Plants are called with
`limit` only — they show all-time data beside filtered cards. On
`/spare-parts/analytics` the High-Cost Plants table cannot take a
`location_id` at all, so changing the site filter leaves it unchanged.

### 2.7 Exports and search that quietly ignore the filter **[by inspection]**

- Price Catalog export omits `search` — exporting a filtered view dumps
  the whole catalogue.
- Repeat Purchases search filters client-side over the current 50-row page
  only; matches on later pages are invisible.

### 2.8 Dropped fields

`avg_cost` (maintenance-costs) **[verified]** returned and discarded.
`last_submission_date` (compliance), `verified_count` (weekly-trend),
`meta.as_of` / `meta.historical` (generate) — the last means a report for a
past period shows historical data with no indicator on screen.

---

## P3 — Pages and code we do not need

Reachability checked against `sidebar.tsx` and `plant-tabs.tsx`.

**Delete outright**

| What | Why |
|---|---|
| `app/(dashboard)/suppliers/create/page.tsx` | Zero inbound links. Duplicates the inline create form already on `/suppliers`; both call the same mutation. |
| `components/locations/location-card.tsx` | Imported by nobody — `/locations` defines its own local `LocationCard`. |
| `components/locations/location-detail-modal.tsx` | Superseded by the `/locations/[id]` page. |
| `components/dashboard/dashboard-filters.tsx`, `dashboard-print.tsx` | Never rendered. Consequence: the zustand filter store has no UI, so the dashboard Cost Trend is permanently pinned to the current year. |
| `components/charts/fleet-category-chart.tsx`, `locations-chart.tsx` | Exported, never imported. |

**Merge**

`/reports/verification` and `/reports/compliance` are structurally
identical — same layout, same KPI card, same worst-first sort, same
progress bar, `rateColor`/`rateBg` copy-pasted byte-for-byte. Only the
endpoint and two labels differ. One page with a toggle.

**Dead hooks / API functions** (defined, exported, zero call sites)

`useWeeklyBrief`, `useAcknowledgeEvent`, `usePlantEvents` (the
`use-dashboard.ts` one, which name-collides with the *used* one in
`use-plants.ts` — easy to import the wrong one), `useCreateSparePart`,
`useDeleteSparePart`, `useAutocompleteDescriptions`, `getPODocument`,
`getSupplierAutocomplete`, `usePendingTransfers`.

**Orphaned backend endpoints** (no frontend caller)

Spare parts: `GET /autocomplete/descriptions`, `POST ""`, `POST /entry`,
`POST /legacy-bulk`, `GET /by-po/{po}/document`, `DELETE /{part_id}`.
Uploads: `POST /weekly-report`, `POST /purchase-order`,
`GET /status/{job_id}`, `POST /admin/rebuild-timeline`,
`POST /admin/purchase-order`, `POST /admin/weekly-report`, and
`POST /admin/weekly-report/preview` — a near-duplicate of the one the UI
actually uses (`POST /admin/preview-weekly-report`). Easy to call the wrong one.

**Duplicate wrappers for one endpoint**

`GET /reports/fleet-summary` has two client functions and two hooks both
named `useFleetSummary`, with different shapes, query keys and staleTimes —
so it is fetched and cached twice per load. `GET /locations` has three
entry points and is fetched at least twice on the dashboard.

---

## P4 — Correctness risks worth knowing before production

- **Upload tokens send the wrong shape [by inspection]** —
  `upload_types` goes as one comma-joined string; the backend declares
  `list[str]`, so FastAPI parses `"weekly_report,purchase_order"` as a
  single element containing a comma. The form also advertises
  `spare_parts`, which is not a backend value.
- **No role gate on four pages** — `/locations`, `/locations/[id]`,
  `/suppliers`, `/suppliers/[id]` have no `ProtectedRoute`; the dashboard
  layout checks authentication only. A site engineer who types the URL
  renders the page and collects 403s.
- **Management cannot reach Sites or Suppliers** from any nav — they are
  in the SHARED sidebar section, which is gated to admin/plant-officer, and
  they are not in the plant tab bar.
- **The SSE stream puts the JWT in the query string**
  (`/events/stream?token=…`) — it will appear in server access logs.
- ~~**10s global axios timeout** applies to the full-table exports.~~
  **Fixed with 1.5** — exports now pass `EXPORT_TIMEOUT_MS` (120s) per
  call. The global 10s is left alone: raising it would make a genuinely
  hung request hang for two minutes.
- **`downloadSubmissionFile` bypasses the auth interceptor** (raw `fetch`
  reading sessionStorage) — a download just after token expiry fails with a
  bare "Failed to download file" instead of refreshing.
- **`POST /insights/generate` builds its query string by concatenation**
  without encoding.

---

## Checked and found correct

Worth recording, so they are not re-investigated:

- `/reports/unverified-plants` — flagged as the highest blank-value risk
  because its normalizer is identity-only. **Verified correct**: the
  endpoint returns exactly `plant_id, fleet_number, description,
  current_location, last_verified_date, weeks_since_verification`
  (+ `condition`, `fleet_type`). Nothing renders blank.
- `/reports/verification-status` — normalizer maps `verified_count`
  correctly.
- `/reports/submission-compliance` — `total_expected` / `total_submitted`
  map correctly.
- Exports run in ~1–2s unfiltered; earlier 503/timeouts were contention
  from the parallel sweep, not a defect.
- Route ordering in `plants.py` is correct — the literal routes are all
  declared before `/{plant_id}`.
