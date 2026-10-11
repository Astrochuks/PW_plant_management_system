# Project rules

Standing instructions for this codebase. These apply to **every module** —
plants, spare parts, purchase orders, projects, reports, and anything
built later. Each rule exists because breaking it already cost real money
or real trust.

Architecture and page-by-page detail: `docs/HOW_IT_WORKS.md`.
Known defects: `docs/PLANT_MODULE_AUDIT.md`.
Workbook formulas: `docs/WORKBOOK_ARITHMETIC.md`.

---

## 1. Never round a figure the user is meant to read

**Show the number that is stored. If it is 34.211, show `34.211`.**

No silent rounding to whole naira. No truncation. No `toFixed(0)` on a
money value. A rounded figure is a different figure, and a reader who
cannot reconcile a total against a source document stops trusting the
whole system.

**Use the shared formatters in `frontend/src/lib/format.ts`. Do not write
a local `formatCurrency` in a page or component** — that is how this
codebase ended up with ten different definitions, most rounding naira to
zero decimal places and several abbreviating ₦1,234,567 to "₦1.2M".

| Use | Formatter |
|---|---|
| Any money figure | `money(value, currency)` |
| Any plain number | `num(value)` |
| A headline that must be short | `compact(value)` — **only with the exact figure beside or beneath it** |

**Abbreviation is rounding.** `₦1.2M` hides ₦34,567. It is allowed only
as a *headline* when the exact value is also on screen — the pattern
already used on the project cards. Never as the only representation of a
number.

**Charts** may use `compact()` on axis ticks, where space genuinely
forbids the full figure. Tooltips must show the exact value.

### The one technical caveat, stated honestly

Money is `numeric` in Postgres (exact), but `_record_to_dict` converts
`Decimal` to `float` before it reaches JSON. IEEE-754 cannot represent
most decimal fractions, so summing values produces artifacts like
`3455445033.920001` — which reached the live executive summary.

So the two formatters cap differently, and for different reasons:

- **`money()` shows exactly 2 decimals.** That is not a rounding policy —
  **2dp is the stored precision.** Every money column is written
  `round(…, 2)` by Postgres and the PO documents themselves write
  `802,620.00`. A third decimal on a money figure is never data, only
  noise, so refusing to render it loses nothing.
- **`num()` allows up to 6**, because quantities, rates and FX values
  genuinely carry more — `34.211` litres is a real figure and must show
  as `34.211`.

The proper fix is to carry money as a string from Postgres to the browser
so the exact `numeric` survives end to end. Until then: do not introduce
a money value with more than 2 real decimals, or a quantity with more
than 6.

---

## 2. VAT, discount and other costs belong to the purchase order

**They are levied on the invoice, not on the line.** A purchase order
lists its parts, sums them to a goods value, and *then* applies VAT.

Consequences that must hold everywhere:

- A **line item's cost is `unit_cost × quantity`.** Nothing else. It must
  always multiply out on screen.
- **PO-level and plant-level totals show the components separately** —
  goods, then VAT, then discount, then other costs, then the total. Never
  a single blended number that hides which parts carried VAT.
- **Never distribute a PO-level charge across line items and store it.**
  Splitting one VAT figure across N lines forces a rounding on each split
  and the parts stop summing to the whole. That is exactly how
  ₦63,026.10 of VAT became ₦63,026.09 on PW-PO220726-003.

If a total must be attributed to a single plant, apportion **at query
time** and label it as an allocation. Do not bake an allocation into
stored data — see rule 4.

> **Migration status:** `spare_parts.vat_amount` / `discount_amount` /
> `other_costs` are still stored per row, distributed pro-rata at entry.
> Moving them to PO scope is specified in **`docs/PO_VAT_RESCOPING.md`**
> and not yet started. Until it lands, read the components from the PO
> aggregate, never from a single line.

---

## 3. Aggregate `total_cost_ngn`, never `total_cost`

`total_cost` is the **original currency**. Summing it across a
multi-currency table adds pounds to naira. That understated supplier
spend by ₦9,229,167.32.

`fx_rate_to_ngn` is frozen at PO entry and must never be recomputed —
otherwise last year's reports change every time the rate moves.

---

## 4. Apportion shared costs only when asking about one plant

> *"What did plant T468 cost?"* → its share.
> *"What did we spend this year?"* → **the full amount.**

A ₦100,000 PO shared across 5 plants contributed ₦20,000 to the month and
the other ₦80,000 vanished, because the query divided by the fleet count
without expanding the row. Across 2026 that destroyed **₦12,449,231.25**.

---

## 5. A purchase order is its NUMBER *and* its DATE

PO numbers come from the plant people and legitimately recur, including
across years. Group and count by `(purchase_order_number, po_date)`.

**Never "correct" a `po_date` against a PO number.** ~78% of numbers
encode a date and 71 disagree with their own `po_date`. That is a
convention, not an authority. The date on the document is the truth.

---

## 6. `condition`, never `status`, on plants

`plants_master.status` is stale/legacy. `condition` is the live column,
updated by the weekly-report ETL.

Exactly six values, enforced by `plants_master_condition_check`:
**working, standby, breakdown, missing, scrap, off_hire.** All six are
named everywhere; there is no "Other" bucket. Drive every list from
`frontend/src/lib/conditions.ts`.

---

## 7. Weeks are ISO weeks

`week_number` is ISO-8601, paired with the ISO year — not day-of-year ÷ 7.
One helper: `isoWeek()` in `lib/format.ts`. Scope WEEK queries by ISO
year.

Check `pg_trigger` before trusting a value computed in Python; a BEFORE
trigger silently overwrote this column once already.

---

## 8. No AI in the parsing pipeline

Workbook and weekly-report parsing is **deterministic** — anchor-based
sheet detection and explicit column mapping. No model, no inference, no
guessing. AI may read data (analysis, chat, summaries); it never writes it.

---

## Working practice

- **Test the affected surface, not just the change.** After any edit,
  grep for consumers and run their tests too. A migration retiring a
  value must audit the app, `pg_proc`, `pg_views` and column defaults in
  the same change-set.
- **Verify a DB function's column names against the frontend interface.**
  `SELECT * FROM func()` returning different names than TypeScript expects
  produces blank cells, not errors.
- **`Number()`-normalise in the API layer**, not in components.
- **Never run DB-heavy pytest while the user is working.**
- **The user performs uploads personally.** Do not upload workbooks.
- **No edits under `backend/app/` while the user's dev server is watching
  it, unless they have said go — and say so when you do, because every
  save restarts their server.** (2026-10-11: a harmless cleanup triggered
  a reload that hung, and login "stopped working".)
- **Build every page, card and table by `docs/UI_STANDARD.md`** — the
  Plant Register / Ongoing Projects shape: header, `MiniKpi` cards that
  follow the filters, URL-state filters, toolbar, table-or-cards. Read it
  before adding a page.
- **Start the backend only via `backend/scripts/dev.sh`.** It pins
  `--reload-dir app --timeout-graceful-shutdown 5`; a bare
  `uvicorn --reload` can hang forever on open SSE streams. Production
  (Dockerfile CMD) carries the same shutdown cap, and the app ends its
  own streams on shutdown (`app.core.events.signal_shutdown`, pinned by
  `tests/test_sse_shutdown.py`).
- Commit and push per milestone.
- Backend tests need the asyncio plugin loaded:
  `pytest -o addopts="" -p pytest_asyncio`.
