# Workbook Arithmetic — the formula bible

Locked 2026-07-15. Every formula the weekly-report workbooks use, verified
cell-by-cell on two independent projects:

- **AKWA** — Akwa Ibom Airport Apron, W10/2026 (mature: 13 certs, 17 payments)
- **KADUNA** — 6th Bridge over River Kaduna, W09/2025 (young: empty ledgers)

Rule of reading: *the workbook states facts in three columns — Completed
Previously | This Week | Project to Date — and the chain `previous + this
week = to date` holds on every summary sheet.* One week of workbook is
therefore enough to know project-to-date: the previous column carries all
history. This is why our store keeps **this-week atoms + baseline/gap
facts** and reconciles to the workbook's own cumulative to the kobo.

---

## 1. Global conventions (ours, derived from theirs)

| Convention | Rule |
|---|---|
| Stored facts | THIS WEEK movement only. Cumulative columns are cross-checks, never data. |
| Project to date | baseline (before first stored week) + gaps (missing weeks) + Σ stored weeks. Equals the workbook's own to-date column exactly. |
| Sheet totals | Cross-checks only. A mismatch is a flag, never a correction. |
| VAT | 7.5%, company-wide ("VAT & State Levies"). |
| Contingency/VOP | **Per-project** — read from the BEME tail, never hardcoded. Akwa: 2.5% + 2.5%. Kaduna: 3% + 5%. |
| Earnings | works × 1.075 (VAT only, NO contingency) — matches the Weekly Summary's own bottom line. |
| Money ladder basis | VAT-inclusive throughout (payments are gross incl. VAT; certs grossed up ×1.075 for comparison). |
| Certified / Paid | Certificate + Payments **ledgers** only. Never the Contract Summary client block (fossil, see §4). |
| Payments reading | via `v_project_payments_latest` — the table holds one ledger copy per uploaded report. |
| KPI naming | Every figure = **measure + scope + period**, with its workbook lineage (sheet + column) shown. |

---

## 2. BEME & Works Completed Fd

**Item grid** (per row): `contract_amount = contract_qty × rate` (verified).
Quantity progress and amount progress are **independent columns** — for most
items `previous_amount ≠ rate × previous_qty` (verified: W43 item 2.02:
108,673.5 × ₦680 = ₦73.9M vs sheet ₦44.6M). Sites value work separately from
measuring it. Never derive one from the other; % complete uses AMOUNTS.

**Classification** (company standard): bill = dotted code any depth +
ALL-CAPS name + no amounts; item = exactly one code segment deeper; item
ownership by CODE not position; `Total Bill No…` rows close bills and are
cross-checks over contract / this-week / previous columns.

**Tail ladder** (bottom of sheet):

```
SUB-TOTAL (all bills)                 works
+ Contingency @ c%  + VOP @ v%        per-project rates
= SUB-TOTAL
+ VAT @ 7.5%
= TOTAL
```

Verified: AKWA works-to-date 13,599,036,705.05 → +679,951,835.25 (2.5+2.5%)
→ +VAT 1,070,924,140.52 → TOTAL 15,349,912,680.83.
KADUNA: 1,278,501,787.18 → +0 (3%+5% defined, none applied) → +30,033,483.39
→ 430,479,928.59. Kaduna's contract-column TOTAL = 4,617,148,926.06 = the
formal contract sum exactly (contract was priced as works+provisions+VAT).
Akwa's contract-column TOTAL (24.45B) exceeds its 10.62B contract — scope
overrun / variation pending; % complete vs contract will exceed 100%.

**Known defects** (auto-flagged per upload): Bill 6 contract SUM range short
₦111,072,750 (all Akwa files); Bill 2 previous SUM short ₦59,090,000 (W43,
site fixed by W10/2026); item 7.09 sits in Bill 8's block (assigned to
Bill 7 by code); Excel float-corrupted item codes ('6.239999…' → '6.24').

---

## 3. Weekly Summary — the workbook's KPI page

Two ladders, both `previous + this week = to date`:

**Works ladder** (by BEME section):

```
SUB-TOTAL (works, all sections)                    13,599,036,705.05  (AKWA)
+ VAT & State Levies 7.5%                           1,019,927,752.88
= Total Works Completed (Incl. VAT)                14,618,964,457.93  ← EXCLUDES contingency
Contingency (own line, own VAT)                       730,948,222.90
= Grand total incl. contingency                    15,349,912,680.83  (= BEME tail TOTAL ✓)
```

**Costs ladder** (the 7 company-standard categories = Cost Report rollup):
Plant, AGO, Materials, Sub Contractors, Local Labour, Overheads, Site Level
Expenses. AKWA to date 7,094,752,961.32; KADUNA 1,081,400,127.61.

**Net Earnings — Excluding Bill 1** (their label, their bottom line):

```
Net Earnings = Total Works Completed (Incl. VAT, excl. contingency)
             − Total Costs to Date
%Net         = Net Earnings ÷ Total Works Completed (Incl. VAT)
```

Verified exactly: AKWA 14,618,964,457.93 − 7,094,752,961.32 =
7,524,211,496.61 (51%); KADUNA 1,374,389,421.22 − 1,081,400,127.61 =
292,989,293.61 (21%).

**Defects**: the label "Excluding Bill 1" is a fossil — the arithmetic
INCLUDES Bill 1 (verified); AKWA row 24 "% Compl. 1.26" is a broken formula.

---

## 4. Contract Summary — identity live, commerce dead

**Fossil proof**: rows 18–56 are numerically identical in AKWA and KADUNA
(certified 1,879,930,738.36; retention 203,181,862.59; Bill 1 figures;
"Permanent Works" 10,158,750.00; APG ₦1.5B expiring 2018-03-27 — predating
both projects). Payment Status block is `#VALUE!` in both files. The
template was copied project-to-project with the client block frozen.

| Block | State | We use instead |
|---|---|---|
| Contract details (names, sums) | LIVE ✓ | Trust — identity anchor |
| Dates / EOT | suspect (identical across projects) | Verify vs award letters; register holds truth |
| Client position (certified, retention) | FOSSIL | Certificate ledger: certified = latest cumulative gross; ×1.075 for incl-VAT; retention/releases/advance from cert columns |
| PW position (works done) | FOSSIL | BEME/Weekly-Summary chain (reconciled) |
| Total work in progress | FOSSIL | works incl VAT − certified incl VAT (real KPI: uncertified work) |
| Payment status | `#VALUE!` broken | Payments ledger by payment_type: advances / certs paid / on account; gross & net; % of contract |
| Certified not yet paid | `#VALUE!` | certified × 1.075 − paid (gross) |
| APG | FOSSIL (2018) | Register fields — commercial team input, no derivation exists |
| Bill 1 | FOSSIL | Bill 1 Summary + Bill 1 Payments sheets (dormant — promotion required) + certs' General Bill 1 column. Standing contradiction: certs claim ₦250.9M vs this block's ₦49.9M |
| Cost & revenue summary | LIVE | = Weekly Summary restated — but see contradiction below |
| Financial information | never filled | ignore |

**Internal contradiction (AKWA)**: Contract Summary's "Net Earnings" =
8,255,159,719.50 = grand-total-incl-contingency − costs. Weekly Summary's =
7,524,211,496.61 = excl-contingency − costs. Difference = contingency incl.
VAT (730,948,222.89) exactly. **We use the Weekly Summary definition** —
see §7 decision log.

**Verdict**: we do not read the Contract Summary's money — we **compute a
living Contract Summary** from the ledgers and show drift-vs-sheet as flags.

---

## 5. The other sheets (identities from the dossiers)

| Sheet | Arithmetic | Cross-checks |
|---|---|---|
| Cost Report | per line: previous + this week = to date; sections Materials/Quarry; 7 canonical categories | category & section totals; Plant Internal ↔ Plant Return footer |
| Plant Return | plant_cost = hours_worked × rate | footer net = plant total − consumables (broken in Akwa files — flagged); standby/breakdown frozen-column detection |
| Diesel Consumption | total = Σ(Sat…Fri) per plant | litres charged (Cost Report AGO) vs logged — attribution coverage %; AGO row is the MONEY truth, log is per-plant litres |
| Hired Vehicles | amount = days_worked × rate | sheet Total row |
| Labour Strength | this week = previous + movement (identity per dept slot) | head-count totals per block |
| Subcontractors | total qty (J) = previous (H) + this week (I); values same chain | per-name ledgers; latest report carries the cumulative truth |
| Materials & Civils | available = opening + received − closing; total used = works+precast+mobilisation+other; sheet's own Variance = available − used (cols O/P, verbatim) | our recomputed discrepancy when stock is maintained (Kaduna yes, Akwa no) |
| Certificates | cumulative per row; retention = 5% × cumulative gross; increments ≥ 0 | zero-increment (resubmission) flag; New Total / Less Previously Certified tail columns stored |
| Payments | net = gross − (WHT + VAT + vetting + stamp + other); rate columns L–P are display constants (labels misaligned in template: 'VAT %' holds 2.5%) | rows must sum to 'Total All' (gross AND net) |
| Lists | company calendar (date → week no) = week-ending authority; reference vocabularies | byte-identical across projects (hash-checked) |

---

## 6. Reconciliation proofs (live DB vs workbook, 2026-07-15)

**AKWA cost to date**: baseline 5,752,122,825.76 + gaps (W1,W6 missing)
136,110,668.48 + stored 1,206,519,467.07 = **7,094,752,961.31** vs workbook
7,094,752,961.32 ✓ (kobo rounding).
**AKWA works to date**: 11,117,781,363.05 + 248,445,180.00 + 2,232,810,162.00
= **13,599,036,705.05** ✓ exact.
**KADUNA cost to date**: 1,063,288,085.13 + 18,112,042.45 =
**1,081,400,127.58** ✓. Works: 1,255,886,429.84 + 22,615,357.33 =
**1,278,501,787.17** ✓.
**Payments latest view**: 13,599,853,394.21 = sheet 'Total All' ✓ (raw table
holds 8 ledger copies ≈ ₦106B — never sum it directly).

---

## 7. Decision log

1. **Earnings = works × 1.075** (VAT only, no contingency/VOP) — matches the
   Weekly Summary's own "Total Works Completed (Incl. VAT)" and its Net
   Earnings basis. User-locked; site-confirmed.
2. **Net Earnings uses the WEEKLY SUMMARY definition** (excl. contingency),
   not the Contract Summary's incl-contingency variant. Rationale: it is the
   site's bottom-line convention, it is the conservative figure, and the
   Contract Summary is the fossil sheet. The incl-contingency number may be
   shown as a secondary "with provisions" line, never the headline.
3. Margin views: headline = site convention (VAT-inclusive both sides);
   an ex-VAT margin may be shown as secondary (VAT is not income).
4. % complete has three named variants: **physical** (works ÷ BEME scope) —
   headline; commercial (certified ÷ contract — can exceed 100% when scope
   outruns contract); workbook-reported (Weekly Summary's own %).
5. Every KPI card displays its derivation the way the workbook does its
   ladders — e.g. "works 13,599.0M + VAT 7.5% = 14,618.9M" — with scope and
   period in the label. No naked numbers.
