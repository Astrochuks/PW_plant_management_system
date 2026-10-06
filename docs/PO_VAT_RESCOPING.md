# Purchase orders: scoping VAT to the PO

**Status: specified, not started.** One decision needs confirming before
the migration is written — see *The one open decision* at the end.

This is the work that was in flight when the project was last touched
(last commit `fde87d7`). It was agreed in conversation and referenced
from `CLAUDE.md` rule 2 as "planned and tracked", but never written down.
This file is that record.

---

## The problem, in one purchase order

PW-PO220726-003 (ZOOMLION, 22 Jul 2026, plant E123):

| | Document says | System said |
|---|---|---|
| RETAINER 1,073.70 × 10 | 10,737.00 | ~~11,542.27~~ |
| BUCKET TIP 80,262.00 × 10 | 802,620.00 | ~~862,817.33~~ |
| PIN 2,699.10 × 10 | 26,991.00 | ~~29,015.32~~ |
| Goods value | 840,348.00 | 840,348.00 |
| VAT | **63,026.10** | **63,026.09** |
| Total | 903,374.10 | 903,374.09 |

The line totals are fixed (commit `d2af4c3` — they are now ex-VAT and
match the document exactly). **The kobo is not.**

It exists because VAT is charged **once on the purchase order** and then
split across three line items at entry, with each split rounded to 2dp.
`63,026.10 ÷ 3` does not divide evenly, so the parts no longer sum to the
whole — and because the split is *stored*, the kobo is lost permanently.

492 of 1,897 rows carry a distributed overhead this way.

---

## The kobo cannot be recovered — only stopped

**`vat_percentage` is 0 on every row.** The bulk-entry insert
(`POST /spare-parts/bulk`) writes `vat_amount` but never writes
`vat_percentage` — it is simply absent from the column list, so it keeps
its default. **The rate is destroyed at entry; only the rounded,
distributed amounts survive.**

So the original document VAT is not in the database, and cannot be
derived from it. I tested the obvious recovery — infer the rate from
`vat ÷ goods`, snap it to 2dp, recompute on the whole PO:

| | |
|---|---|
| POs it would change | **28 of 124** |
| Net movement | **−₦440.78** (the wrong direction) |
| Worst single PO | **₦222.33** (PW-PO130126-18) |

That does not recover anything. It *fabricates* figures — the stored
₦411,127.50 may be exactly what the supplier's document says, and there
is no evidence ₦410,905.17 is better. **Rejected.**

**Consequence for the migration:** the backfill carries
`sum(vat_amount)` forward **as-is**. Historic kobo stay lost.

That does not weaken the case — it sharpens it. The migration's value is
that **no future PO can lose another one**: 85 POs are currently exposed
to this, covering ₦14.6m of VAT, and the count grows with every
multi-line VAT entry. It is a tourniquet, not a cure, and the entry form
fix (step 6) is what stops the bleeding.

---

## The decision

> **VAT, discount and other costs belong to the purchase order.**
> A line item costs `unit_cost × quantity`, nothing else.
> PO totals and plant totals include VAT, with the components shown
> separately: goods → VAT → discount → other → total.

Store `63,026.10` once, exactly. Nothing divides it, so nothing rounds it.

This is already written as **rule 2 in `CLAUDE.md`**; this document is
the implementation plan for it.

---

## What the data actually looks like

**Profiled 6 Oct 2026** with `scratchpad/po_research.py`. Figures move as
POs are entered — re-run it before building, and never trust a number
frozen into this file.

### Scale

| | |
|---|---|
| Line items | 2,161 |
| Purchase orders `(number, date)` | **511** |
| Distinct PO numbers | 494 |
| Total spend, all time | **₦824,968,052.05** |
| 2025 / 2026 | ₦130,538,203.74 / ₦690,874,848.31 |
| Date range | 2025-01-10 → 2026-09-14 |

**PO identity is load-bearing:** 494 numbers produce 511 POs. Thirteen
numbers appear on two dates, two on three. Grouping by number alone loses
17 purchase orders.

### Shape 1 — who the money can be pinned to

| Case | POs | Lines | Spend | Share |
|---|---|---|---|---|
| **A** single plant, fully tagged | 357 | 1,360 | ₦603,243,426.40 | **73.1%** |
| **B** multi-plant, every line tagged | 57 | 373 | ₦130,475,755.67 | **15.8%** |
| **C** multi-plant, lines **untagged** | 29 | 103 | ₦28,292,073.36 | **3.4%** |
| C⁻ single fleet, lines untagged | 50 | 233 | ₦51,734,046.62 | 6.3% |
| D workshop / category (no plant) | 15 | 81 | ₦11,005,750.00 | 1.3% |
| E mixed (some tagged, some not) | 1 | 8 | ₦84,000.00 | 0.0% |
| F untagged, no fleet list at all | 2 | 3 | ₦133,000.00 | 0.0% |

**89% of spend needs no guessing.** Case B is already fully attributed
because the per-line fleet field was used at entry
(`description|qty|cost|part_no|fleet` — the 5th field in
`POST /spare-parts/bulk`). C⁻ has one fleet, so all of it goes there.

**Only 3.4% is genuinely ambiguous.**

### Shape 2 — what sits on top of goods

| | POs | Goods | VAT | Discount | Other |
|---|---|---|---|---|---|
| none (goods only) | **376** | ₦553,043,756.60 | — | — | — |
| VAT only | 106 | ₦215,983,901.95 | ₦15,821,543.15 | — | — |
| VAT + discount | 18 | ₦9,936,460.00 | ₦687,930.94 | ₦432,207.91 | — |
| other costs only | 11 | ₦19,941,074.00 | — | — | ₦275,170.00 |

**Three quarters of POs carry no overhead at all.** Only 124 carry VAT.
`is_po_overhead` is set on **0 rows** — the flag was built and never used.

### Shape 3 — how far each VAT is split

| VAT divided over | POs | VAT exposed |
|---|---|---|
| 1 line (no split, no rounding) | 39 | ₦1,904,763.12 |
| 2–3 lines | 38 | ₦2,749,809.14 |
| 4–6 lines | 23 | ₦4,328,205.92 |
| 7+ lines | 24 | ₦7,526,695.91 |

**85 POs currently split a VAT figure across multiple lines**, covering
**₦14.6m of VAT**. Every one is a rounding opportunity, and every new
multi-line VAT PO adds another.

### Shape 4 — currency

508 NGN · 2 GBP (₦9,234,144.16) · 1 USD (₦481,600.00). **No PO mixes
currencies**, so one currency + one `fx_rate_to_ngn` per PO row is safe.

### The VAT arithmetic is sound — don't "fix" it

Implied rate (`vat ÷ goods`) across the 124 POs carrying VAT:

| Implied | POs | Explanation |
|---|---|---|
| 7.500% | 103 | VAT on goods |
| 7.163% / 7.162% | 17 | **exactly 7.500% of (goods − discount)** — all 17 have a discount |
| 1.403%, 3.636%, 1.396%, 5.013% | 4 | VAT entered as an amount that matches no clean rate |

The sub-7.5% cohort is **correct accounting** — VAT levied on the
discounted base. It is not an error and must not be normalised away.

---

## Allocation rules

Applied in order. Rules 1 and 2 are facts; only rule 3 is an estimate.

1. **Line is tagged to a plant** → that plant carries it. *(89% of spend)*
2. **PO covers exactly one fleet** → 100% to that fleet. *(6.3%)*
3. **Multiple plants, lines untagged** → split ÷ N across the fleets on
   the PO, **labelled on screen as a share, never as a document figure**.
   *(3.4%)*

VAT follows goods: a line's share of the PO's VAT is its share of the
goods value. That rule is shape-independent and needs no special cases.

### Why not value-weighted for rule 3

Value ratios tell you how to split VAT **across lines** — already settled
above. They tell you nothing about **which plant got which line**. A PO
with a ₦1.5m engine and a ₦10k filter across 5 untagged plants still
divides each line by 5 under any weighting, because there is no per-plant
basis to weight by. Attribution cannot be derived from price.

The real fix for rule 3 is not a cleverer split — it is **tagging the
line**, which moves the PO into Case B.

---

## Compute, do not persist

Allocations are derived at read time. They are **never written to the
database**.

This was argued both ways. The case for persisting is that historical
reports stay frozen and runtime aggregation is avoided. Both fail here:

- **Every expensive bug in this project was a stored derivation drifting
  from its source.** Migration 032 baked apportionment into a function
  and destroyed ₦12,449,231.25. VAT distributed at write time lost the
  kobo above. A trigger stored `week_number` using a third wrong formula.
  `v_purchase_orders_summary` grouped POs by number alone and filed
  ₦1,138,000 in the wrong year. The kobo this work exists to fix *is
  itself* a stored-derivation bug.
- **There is no performance problem to design around.** 1,897 line items,
  424 POs. `v_plants_summary` — 43 columns, five joins, 1,688 rows —
  executes in 7.6 ms.
- **The PO total is the immutable fact** (₦840,348.00 + ₦63,026.10 =
  ₦903,374.10) and never moves under any of this. The plant split is a
  management allocation, not a ledger entry.
- **A changed fleet list is a correction, and should propagate.** That
  was the lesson of migration 031.

If frozen historicals are ever genuinely needed (a board pack), snapshot
at the **report** level — the pattern `project_contract_summary_snapshot`
already uses — not by denormalising onto rows.

**Adopt the largest-remainder technique** so allocated parts sum exactly
to the whole: give the final line the remainder rather than its own
rounded share. This works identically at read time; exact summation and
persistence are independent concerns.

---

## Implementation plan

The scaffolding already exists and is unused: `spare_parts.purchase_order_id`
(0 of 1,897 populated), `purchase_order_items` (0 rows),
`purchase_order_submissions` (0 rows), `is_po_overhead` (0 rows).

1. **Migration — `purchase_orders` table**, keyed on
   `(purchase_order_number, po_date)`, the identity established in
   migration 031. Holds `vat_amount`, `discount_amount`, `other_costs`,
   `supplier_id`, `location_id`, `requisition_number`, `currency`,
   `fx_rate_to_ngn`, document fields. Link via `spare_parts.purchase_order_id`.
2. **Backfill** — for each PO, sum the distributed overheads off its
   lines and write the total once. Verify the sum per PO before and after.
3. **Line totals** — `total_cost` becomes `unit_cost × quantity`;
   `total_cost_ngn` that × `fx_rate_to_ngn`. Both stay generated columns.
4. **Views and functions** — `v_purchase_orders_summary`,
   `v_supplier_stats`, `v_plants_summary`, `get_maintenance_cost_analysis`,
   `get_high_cost_plants`, and the report generator must read PO-level
   overheads and add them at the right level.
5. **UI** — PO page, plant page, supplier page and the report generator
   decompose totals into goods / VAT / discount / other / total.
6. **Entry form** — require a per-line fleet on multi-plant POs, so
   Case C stops growing.

### Things the `purchase_orders` table has to survive

Profiling turned these up. Each needs a decision before the schema is
written, because each breaks "one PO = one row":

| | Count | Problem |
|---|---|---|
| POs with **more than one supplier** | 15 | which supplier goes on the PO row? |
| POs with **more than one location** | 5 | same question for site |
| POs with **more than one `cost_type`** | 4 | direct and shared on one PO |
| POs entered **more than once** (`submission_number > 1`) | 14 | one PO, several entry batches |
| Rows with **NULL `po_date`** | 3 | no `(number, date)` identity at all |
| Fleet numbers in `shared_fleet_numbers` **not in `plants_master`** | 38 | Case C cannot allocate to a plant that does not exist |

Otherwise the data is clean: no NULL, zero or negative unit costs; no
NULL or zero quantities; no `cost_type`/`plant_id` contradictions.

### Acceptance test

Non-negotiable — **measure the before figure on the day, do not use a
number from this file.** Spend changes as POs are entered; the 2026 total
was ₦541,777,556.32 when this work was first scoped and is
₦690,874,848.31 today.

The rule is *before equals after*, across all five surfaces — Spare
Parts, Purchase Orders, Analytics, Maintenance Costs, report generator —
and every PO must satisfy:

```
sum(unit_cost × quantity) + VAT − discount + other == PO total
```

Existing guards to keep green: `test_po_identity.py`,
`test_spare_parts_money.py`, `test_report_generator_money.py`,
`test_report_filters.py`, `test_conditions.py`.

---

## The one open decision

**For a PO covering several plants with untagged lines, does a plant's
VAT share follow its goods share?**

Recommended: **yes** — the same ÷ N the goods already use, so goods and
VAT never diverge, shown as a labelled share. Rule 3 above assumes this.

Confirm before the migration is written; everything else is settled.
