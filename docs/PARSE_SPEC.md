# Weekly Report Parse Spec (locked)

Research completed 2026-07-08 → 2026-07-11 across all 10 Akwa Ibom
workbooks (2025 W43 + 2026 W2–W10). Every rule here was verified against
the workbooks' own arithmetic before being locked. Change this spec only
with a matching parser + migration + golden-test change.

## Principles

1. **This-week-only**: cumulative workbook columns are never trusted;
   we store atomic weekly facts and recompute. Two principled
   exceptions, stored in `project_ledger_adjustments`:
   - **baseline** — the earliest workbook's reported-previous column
   - **gap** — derived movement between non-consecutive stored weeks
2. **Sheet totals are cross-checks, never data.** Disagreement with our
   recomputation becomes a `project_sheet_flags` row (this is how the
   system caught the site's broken Bill 6 SUM in all 10 workbooks).
3. **Ledgers**: certificates upsert by cert number (project-lifetime);
   payments are per-report — read ONLY via `v_project_payments_latest`.
4. **Stale-copy detection**: per-sheet content hashes compared against
   the previous stored week (caught diesel sheets copy-pasted W3–W10).

## Parsed sheets → tables

| Sheet | Table(s) | Stored columns |
|---|---|---|
| BEME & Works Completed Fd | `project_beme_bills` (once) | bill_no, name, contract_amount (cross-check) |
| | `project_beme_items` (once) | item_code (+dup_seq), description, unit, contract_qty, rate, contract_amount |
| | `project_beme_progress` (weekly) | qty/amount_this_week, qty/amount_previous_reported, year, week, week_ending_date |
| Cost Report | `project_cost_report` (weekly) | section, description, cost_category, unit, quantity_this_week, rate_ngn, amount_previous_week, amount_this_week, amount_to_date |
| Plant Return | `project_plant_utilization` (weekly, full roster incl. idle) | fleet_number_raw, plant_id, description, plant_category, hours_worked, standby_hours, breakdown_hours, rate_ngn, plant_cost, transferred_from, current_location, remarks |
| Diesel Consumption | `project_diesel_consumption` (weekly, fuel events only) | fleet_number_raw, plant_id, description, plant_category, saturday..friday_litres, total_litres, amount_ngn, is_cost_centre |
| Contract Summary | `project_contract_summary_snapshot` (weekly) | names, original/current contract amounts, dates, durations, EOT, overdue_weeks, APG, advance recovered/unrecovered, bill1 requested/paid/outstanding, works-certified figures (STALE — cross-check only) |
| Certificate Status | `project_certificates` (ledger by cert_number) | cert_number, date_submitted, gross_value_works_done (CUMULATIVE), materials add/less, general_bill_1, total_value_of_work_done, value_of_works_per_cert, total_retention_held, total_net_payment, retention_released, contingency_used/deducted, fluctuation_materials, advance_received, total_works_executed, advance_recovery |
| Payments Recieved | `project_payments` (ledger per report) | payment_date, voucher_number, payment_type, gross_amount, wht, vat, vetting_fee, stamp_duty, other_deductions, net_amount |
| Lists (once) | `project_reference_lists` | list_name, item, detail, sort_order + week calendar → week_ending_date |
| Weekly Summary | `project_weekly_summary` | section, item, metric, value — CROSS-CHECK ONLY |

## Derived / infrastructure

- `project_weekly_reports` — header per (project, year, week); sheet_hashes
- `project_ledger_adjustments` — baseline + gap facts (recomputed per ingest)
- `project_sheet_flags` — cross-checks, staleness, variances per sheet/week
- `project_report_submissions` — upload tracking (sha256, per-sheet status)
- Views: `v_project_beme_cumulative` (done, %, over-run/no-qty flags),
  `v_project_certificates` (per-cert increments, retention %, zero-increment),
  `v_project_payments_latest` (latest report's ledger only)

## Stored in Storage, NOT parsed

Bill 1 Summary, Bill 1 Payments, Subcontractors, Labour Strength,
Materials & Civils, Hired Vehicles, Precast — their money auto-posts
into the Cost Report. Labour headcount + cost come from the Cost
Report's Labour row (qty = headcount).

## Locked semantics worth remembering

- Earnings = BEME works this week × 1.075 (7.5% VAT on works only);
  contingency (2.5% + 2.5% VOP) tracked separately, excluded from net.
- Diesel MONEY truth = Cost Report AGO row (litres charged × price/L;
  price history 1,100 → 1,200 → 1,600 ₦/L). The diesel sheet is
  per-plant attribution only.
- Plant cost = hours worked × rate; standby/breakdown never charged;
  footer total minus consumables posts to Cost Report "Plant Internal".
- Physical % = works done ÷ works total, SAME basis both sides
  (markups cancel). Never divide works-only by the ₦24.4B grand total.
- Certified/paid/outstanding come from the LEDGERS; Contract Summary's
  client-position block froze ~2023 and is flagged on every ingest.
- Over-run (>100%) stored uncapped; no-contract-qty items keep % = null.
