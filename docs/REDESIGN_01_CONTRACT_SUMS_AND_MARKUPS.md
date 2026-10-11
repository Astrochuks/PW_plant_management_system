# Projects redesign — finding 01: contract sums, BEME totals and the markup ladders

Date: 2026-10-11. Evidence: the four weekly workbooks in `project files/`
(Akwa W10/2026, Kaduna W09/2025, Maru-Lugga W38/2026, Kuba–Daffo W39/2026),
the three contract BEMEs (Kaduna .xls, Lot II, Lot III), the Lere Road BoQ,
and `ONGOING Projects..pdf` (head-office list, 12 projects, "revised
contract sum"). Every figure below was recomputed and matches to ₦0.01
unless marked ≠.

---

## 1. What "revised contract sum" means in the head-office PDF

| Project | PDF revised sum | What it equals | Status |
|---|---|---|---|
| Akwa Ibom apron | 14,621,359,979.09 | Contract Summary original 10,621,359,979.09 **+ exactly 4,000,000,000.00** | formal variation; NOT derivable from the BEME (BEME contract column = 24,447,532,051.47) |
| Kaduna 6th bridge | 3,976,872,460.00 | BEME **SUB-TOTAL** — bare works, no VOP, no contingency, no VAT | site's own Contract Summary says 4,617,148,926.06 = (works + 3% + 5%) × 1.075 → **the PDF and the site disagree by 640,276,466.06** |
| Maru-Lugga | 8,574,216,648.75 | nothing in the W38 workbook: BEME TOTAL is 8,026,475,683.86, gap 547,740,964.89 | PDF names "2 No. bridges, 36 m & 270 m"; the W38 BEME has only `5 BRIDGE WORK - 36m` → a **revised BEME exists that we do not have** |
| Kuba–Daffo | 53,796,850,584.12 | BEME TOTAL incl. 5% contingency + 1% stamp + 7.5% VAT + 3% SRF | all-in |
| Gusau Lot 2 | 44,376,645,376.25 | contract BEME grand total: 37,527,818,500 + 5% VOP + 5% contingency = 41,280,600,350 + 7.5% VAT | all-in |
| Gusau Lot 3 | 54,264,096,079.33 | contract BEME grand total, same ladder | all-in |
| Lere Road | 10,139,435,742.70 | BoQ "ETC": 9,403,821,783.68 + contingency 28,211,465.35 + 7.5% VAT | all-in |

**Conclusion.** For 6 of the 7 we can check, the PDF figure is the
**all-in awarded total** (works + provisions + VAT/levies). Kaduna is the
outlier (bare works), and Akwa/Maru show the sum moving by **formal
variation**, which no BEME arithmetic reproduces. Therefore:

> The contract sum is a **register fact** (award letter + variations, each
> dated), never a derivation from the BEME. The BEME revision has its own
> computed total; the two are shown side by side and their gap is a KPI.

---

## 2. How each site builds its ladder (they are NOT the same)

Notation: W = Σ item amounts (works). S2 = W + provisions.

| | Akwa | Kaduna | Maru-Lugga | Kuba–Daffo |
|---|---|---|---|---|
| Provisions (contract column) | contingency 2.5% + VOP 2.5% of W | VOP 5% + contingency 3% of W | VOP 5% of W (contingency line present, ₦0) | contingency 5% of W (VOP/contingency 3% lines present, ₦0) |
| VAT base (contract column) | **S2** | **S2** | **W only** | S2 |
| Extra levies | — | — | — | stamp 1% + SRF 3%, each on S2, **parallel** (not compounded) |
| Provisions accrue with progress? | yes, 5% of W-to-date | **no** (₦0 to date) | row exists but holds **7.5% of W** — it is the VAT figure (formula points at the wrong cell); 5% would be 213,801,381.19 not 320,702,071.78 | contingency ₦0 to date; stamp/VAT/SRF accrue on W-to-date |
| VAT base to date | W + provisions | W only | W only | W only |
| Weekly Summary = BEME tail? | yes (kobo) | yes | **≠ by 24,301,942.00** (VAT stacked on the mis-pointed provisions row) | **≠ by 236,661,703.50** — BEME tail double-counts one "Total Bill" row (r90 and r101 both carry previous 236,661,703.50); Weekly Summary is the correct one |
| Net Earnings basis | works **incl. VAT** − costs | incl. VAT | incl. VAT (excl. provisions) | works **ex-VAT** − costs |
| Contract Summary vs Weekly Summary Net Earnings | differ by provisions incl. VAT (known, decision log §7.2) | same | not re-checked (same template) | same template |

So the four sites use **three different VAT bases, two different Net
Earnings bases, four different provision regimes**, two of them contain
formula errors, and two of them disagree with themselves between sheets.

---

## 3. Take: how the system should compute

1. **One fact: works.** Per item per period: quantity and amount this
   period (amount is a site valuation, independent of qty × rate — see
   WORKBOOK_ARITHMETIC §2). Everything else is derived.
2. **Markups are parameters of the BEME revision, not arithmetic in a
   sheet.** An ordered list of *adders*: name, rate, base (`works` |
   `after_provisions`), and `accrues_with_progress` (true = pro-rata on
   works-to-date; false = provisional sum drawn down only when claimed).
   Akwa = [contingency 2.5% works ✓accrue, VOP 2.5% works ✓accrue, VAT 7.5%
   after_provisions]. Kuba = [contingency 5% works ✗, stamp 1% after_prov,
   VAT 7.5% after_prov, SRF 3% after_prov]. Maru's and Kaduna's regimes are
   expressible the same way — and their *errors* become visible as
   "sheet says X, parameters say Y" flags instead of being inherited.
3. **One head-office convention for the standard output**, applied to
   every project regardless of what its sheet does:
   - *Physical* measure = works ex-everything (the only comparable number
     across sites).
   - *Value incl. VAT* = works + accruing provisions + VAT/levies per the
     project's parameters.
   - *Net earnings* = value incl. VAT − costs (the convention already
     locked in decision log §7.1–7.2; Kuba's ex-VAT variant is a deviation
     to flag, not a second standard).
   - *% complete* = works-to-date ÷ BEME works (physical), with the
     commercial variant (value ÷ contract sum) alongside.
4. **Sites' own totals become cross-checks only.** Each upload/entry
   stores what the sheet said and shows the delta; we never adopt it.
5. **Contract sum lives on the project with a dated history** (original
   award, each variation with its instrument/date). "Revised contract sum"
   = latest effective. BEME revision total ≠ contract sum is normal and
   displayed, not reconciled away.

---

## 4. Workbook defects to raise with the sites (not ours to fix)

- Maru-Lugga: provisions-to-date row is the VAT figure (7.5%), not VOP 5%;
  Bill 1 "previous" amounts in trillions (₦ amounts typed in the quantity
  column, qty × rate exploded); Bill 5 header `5 BRIDGE WORK - 36m`; item
  code `410` for 6.20; `4.06.1` nesting.
- Kuba–Daffo: duplicated "Total Bill" previous (236,661,703.50) in the BEME
  tail; Bill 1 entered as a single lump row `A General` without item codes;
  bill headers typed as `BILL NO:4` in the item column; Pavement split into
  two blocks; Net Earnings computed ex-VAT unlike every other site; stamp
  duty and SRF levy lines unknown to the shared template.
- Kaduna: head-office PDF (3,976,872,460.00) vs site Contract Summary
  (4,617,148,926.06) — which is the contract? Summary table shows `#REF!`.
- All: the Contract Summary client-position block is a frozen 2023 fossil
  (identical in all four, incl. the brand-new Kuba file).

---

## 5. Pattern sweep across all 13 weekly workbooks (2026-10-11)

Column-exact reads (Weekly Summary D/E/F = previous/this week/to date;
Contract Summary D/F/G). "WS" = Weekly Summary, "CS" = Contract Summary.

| Workbook | VAT base (to date) | provisions ÷ works | WS Net Earnings basis | CS Net Earnings basis | WS works = BEME tail? | WS grand = BEME TOTAL? |
|---|---|---|---|---|---|---|
| AKWA W43/2025 | works | 0.0500 | incl VAT, excl prov | incl VAT **+ prov** | yes | yes |
| AKWA W02/2026 | works | 0.0508 | incl VAT | incl VAT + prov | **≠ −187,152,000** | ≠ −201,188,400 |
| AKWA W03/2026 | works | 0.0520 | incl VAT | incl VAT + prov | **≠ −455,103,225** | ≠ −489,235,967 |
| AKWA W04/2026 | works | 0.0500 | incl VAT | incl VAT + prov | yes | yes |
| AKWA W05/2026 | works | 0.0508 | incl VAT | incl VAT + prov | **≠ −186,152,565** | ≠ −200,114,007 |
| AKWA W06–W10/2026 | works | 0.0500 | incl VAT | incl VAT + prov | yes | yes |
| KADUNA W09/2025 | works | 0 | incl VAT | incl VAT (+prov = 0) | **≠ +878,055,342** (BEME tail sums ONE bill; WS is right) | ≠ +943,909,493 |
| MARU W38/2026 | works | **0.0750** (VAT cell) | incl VAT | incl VAT | yes | ≠ +24,301,942 |
| KUBA W39/2026 | works | n/a (₦0 accrued) | **ex VAT** | **ex VAT** | **≠ −236,661,704** (BEME tail double-counts; WS is right) | ≠ −294,386,635 |

Patterns:

1. **VAT to date is always 7.5% of works** (13/13). Akwa adds a second VAT
   line on its accrued provisions; nobody else has provisions to tax.
2. **Provisions accrual is a per-site habit and stable over time**: Akwa 5%
   pro-rata in all 10 weeks (the 0.0508/0.0520 weeks are the same 5% taken
   on a BEME figure the WS works row had not caught up with); Kaduna and
   Kuba ₦0; Maru 7.5% by formula error.
3. **WS Net Earnings = works incl VAT (excl provisions) − costs in 12/13**;
   Kuba alone is ex-VAT. **CS Net Earnings adds provisions** wherever
   provisions accrue (Akwa, all 10 weeks) — the two sheets disagree by
   design, consistently.
4. **No sheet's totals can be trusted as data.** The BEME tail is wrong in
   3 of 4 sites (Kaduna counts one bill, Kuba double-counts a bill total,
   Maru mis-stacks VAT); the Weekly Summary is stale in 3 of Akwa's 10
   weeks. Only Σ items is reliable — the system must compute.
5. **Within a site the convention is stable** (Akwa: 10 of 10 weeks on
   every dimension). A site's "convention fingerprint" — VAT base,
   provisions accrual, levies, WS/CS net-earnings bases — can be detected
   from its first workbook, confirmed by a person, and then *verified* on
   every later upload; a change is a flag, not a silent adoption.

## 6. Open questions for the PM / user

1. Kaduna: is the contract 3,976,872,460.00 or 4,617,148,926.06?
2. Maru-Lugga: please send the revised BEME that carries 8,574,216,648.75
   (the 270 m bridge scope).
3. Should provisions (contingency/VOP) accrue pro-rata with progress in the
   head-office figure (Akwa's practice) or only when drawn (Kaduna's and
   Kuba's practice)? This changes "value of work done" by up to 5–8%.
4. Confirm the head-office Net Earnings basis is VAT-inclusive on both
   sides (3 of 4 sites) — Kuba to be told.
5. Kwoi (row 5, highlighted green in the PDF) is reported finished — is
   green the PDF's own "completed" marker?
