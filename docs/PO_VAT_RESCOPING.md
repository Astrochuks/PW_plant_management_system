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

Measured 6 Oct 2026. This is what makes the problem tractable — the hard
case is small.

| Case | POs | Lines | Spend | Share |
|---|---|---|---|---|
| **A** single plant | 357 | 1,360 | ₦603,243,426.40 | **73.1%** |
| **B** multi-plant, every line tagged | 57 | 373 | ₦130,475,755.67 | **15.8%** |
| **C** multi-plant, lines untagged | 29 | 103 | ₦28,292,073.36 | **3.4%** |
| C⁻ single fleet, line untagged | 50 | 233 | ₦51,734,046.62 | 6.3% |
| D workshop / category (no plant) | 15 | 81 | ₦11,005,750.00 | 1.3% |
| E mixed / other | 3 | 11 | ₦217,000.00 | 0.0% |

**89% of spend needs no guessing at all.** Case B is already fully
attributed because the per-line fleet field was used at entry
(`description|qty|cost|part_no|fleet` — the 5th field in
`POST /spare-parts/bulk`). C⁻ has one fleet, so 100% goes to it.

**Only 3.4% of spend is genuinely ambiguous.**

Reproduce the table with `scripts/po_attribution_cases.sql` logic — the
query groups by `(purchase_order_number, po_date)` and classifies on
`plant_id`, `shared_fleet_numbers`, `is_workshop`, `is_category`.

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

### Acceptance test

Non-negotiable. The 2026 figure must still be **₦541,777,556.32** across
all five surfaces — Spare Parts, Purchase Orders, Analytics, Maintenance
Costs, report generator — **before and after**, and every PO must satisfy:

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
