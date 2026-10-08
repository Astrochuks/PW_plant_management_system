# Projects module — complete map

Every table, view and file. Counts taken 8 Oct 2026; row counts move as
workbooks are ingested.

**Roughly 24,000 lines across ~70 files, 31 tables, 8 views.**

Related reading: `docs/PRD_PROJECTS_MODULE.md` (locked requirements),
`docs/WORKBOOK_ARITHMETIC.md` (the formula bible — every figure's
derivation, verified cell-by-cell), `docs/PARSE_SPEC.md`,
`docs/PROJECTS_MODULE_TASKS.md` (build order).

---

## 1. Database — 31 tables

### Register — who the projects are

| Table | Cols | Rows | Holds |
|---|---|---|---|
| `projects` | 59 | 221 | The register. Identity, client, type, state, contract sums, schedule dates, `location_id` → site |
| `clients` | 8 | 33 | Client master, with type (government / private) |
| `project_register_review_queue` | 14 | 126 | Register entries the parser could not resolve confidently — awaits a human verdict |

### Ingest & provenance — what arrived, and whether to trust it

| Table | Cols | Rows | Holds |
|---|---|---|---|
| `project_report_submissions` | 20 | 11 | One row per uploaded workbook — the upload audit trail |
| `project_weekly_reports` | 20 | 11 | The week header a submission produced (project + year + week) |
| `project_sheet_flags` | 12 | 182 | Per-sheet quality verdicts: `stale_copy`, `frozen_column`, `cross_check_fail` |
| `project_ledger_adjustments` | 14 | 306 | Baseline and gap facts, recomputed every ingest (BEME gap, cost gap) |
| `project_reference_lists` | 6 | 197 | The Lists sheet — company week calendar 2020–2031 + reference items |

### Work & progress

| Table | Cols | Rows | Holds |
|---|---|---|---|
| `project_beme_bills` | 8 | 19 | Bill hierarchy, keyed by `bill_code` text (migration 021) |
| `project_beme_items` | 11 | 239 | BEME line items; ownership by **code**, not sheet position |
| `project_beme_progress` | 12 | 1,015 | Per-week progress per item. **Never SUM raw — section/total rows inside cause a 5.307× over-count** |
| `project_weekly_summary` | 12 | 497 | The Weekly Summary sheet — the verification sheet |

### Cost

| Table | Cols | Rows | Holds |
|---|---|---|---|
| `project_cost_report` | 16 | 772 | Cost by category. **Rows with NULL `cost_category` are the sheet's own totals — cross-check only** |
| `project_diesel_consumption` | 21 | 247 | Diesel events. Money truth is the Cost Report AGO row, not this |
| `project_materials_stock` | 27 | 309 | Materials on site |
| `project_labour_strength` | 14 | 231 | Headcount by trade |
| `project_subcontractors` | 22 | 818 | Subcontractor ledger |
| `project_hired_vehicles` | 15 | 83 | Hired plant and vehicles |

### Plant

| Table | Cols | Rows | Holds |
|---|---|---|---|
| `project_plant_utilization` | 19 | 1,306 | Per-plant worked / standby / breakdown hours per week |
| `project_fleet_aliases` | 8 | 1 | Durable link-or-external verdicts for unmatched fleet numbers (migration 025) |

### Financial

| Table | Cols | Rows | Holds |
|---|---|---|---|
| `project_certificates` | 28 | 13 | **Cumulative** valuations. Read MAX, never SUM; per-cert value is an increment |
| `project_payments` | 16 | 148 | Per-report ledger. **Always read via `v_project_payments_latest`** — a bare SUM multiplies by workbook count |
| `project_contract_summary_snapshot` | 33 | 11 | The Contract Summary sheet as captured. Its client-position block is frozen ~2023 — quarantined |

### Built but never used — 0 rows

| Table | Intended for |
|---|---|
| `project_alerts` | Phase 3 alerting |
| `project_bill1_claims` · `project_bill1_items` · `project_bill1_payments` | Bill 1 — the "promote dormant sheets" task |
| `project_documents` | Document attachments |
| `project_photos` | **Phase 5 site photos** |
| `project_precast` | Precast sheet |
| `user_project_assignments` | PM / site-engineer project scoping |

Eight tables scaffolded ahead of the work. Worth knowing before building
anything that needs them — the shape already exists.

---

## 2. Database — 8 views

| View | Rows | Why it exists |
|---|---|---|
| `v_projects_summary` | 221 | The register, joined and typed, for the list page |
| `v_project_beme_cumulative` | 239 | Cumulative BEME with `pct` **computed, never stored** |
| `v_project_certificates` | 13 | Per-certificate increment derived from the cumulative column |
| `v_project_payments_latest` | 17 | Deduplicates payments across workbooks — the only safe read |
| `v_project_subcontractors_latest` | 170 | Latest row per subcontractor |
| `v_project_submission_status` | 4 | Which weeks arrived, which are missing |
| `v_project_benchmarks_by_type` | 8 | Delivery benchmarks by project type |
| `v_project_delivery_times` | 74 | Planned vs actual delivery, from the register |

Only one project function: `update_projects_updated_at()` (a trigger).
Everything else is views and application code.

---

## 3. Backend — ~8,500 lines

### API

| File | Lines | Does |
|---|---|---|
| `app/api/v1/projects.py` | 2,391 | All 43 project endpoints — register, hub, operations, financials, upload, review queue, report |
| `app/models/project.py` | 137 | Pydantic models |

### Services

| File | Lines | Does |
|---|---|---|
| `services/weekly_report_sheets.py` | 1,426 | **The parser.** Anchor-based, 8 sheets parsed + 7 stored-only. Golden-locked |
| `services/weekly_report_import.py` | 907 | Persist layer — delete-header-cascade idempotent ingest |
| `services/weekly_report_parsing.py` | 281 | Parse orchestration + preview |
| `services/register_parsing.py` | 771 | Register/award-letter parser v2 — types, natures, state resolution |
| `services/award_letters_parser.py` | 528 | Award-letter workbook reader |
| `services/award_letters_import.py` | 233 | Award-letter persist |
| `services/register_review_service.py` | 278 | Review-queue verdict handling |
| `services/project_overview.py` | 464 | The hub Overview — one query, kobo-verified 17/17 |
| `services/project_report.py` | 386 | Report pack assembly (weekly → yearly → to-date) |
| `services/project_portfolio.py` | 325 | Portfolio rollup for the executive summary |
| `services/project_brief.py` | 213 | `build_findings()` — the Executive brief's quantified findings |
| `workers/project_report_worker.py` | 139 | Background report generation |

Shared files that also carry project logic: `api/v1/reports.py`,
`api/v1/locations.py`, `core/security.py` (`require_projects_access`),
`services/insights_service.py`.

### Migrations — 19 touch projects

`007` operational tables · `008` register upgrade · `009` register views
and benchmarks · `010` client types + register reset · `011` legacy
status · `014` Phase-2 weekly ingest tables · `015` submission-status
view · `016` plant-officer role · `017` KPI rebuild · `019` purge retired
conditions · `020` certificates + payments locked · `021` hierarchical
BEME bills · `022` promotions · `023` materials sections · `024` workbook
verbatim columns · `025` fleet aliases · `027` BEME tail + flag
resolution · `028` contract schedule fields · `029` MD/GPM roles

### Tests — 12 files, ~2,470 lines

`test_weekly_report_sheets.py` (520) · `test_weekly_report_import.py`
(339) · `test_register_review.py` (223) · `test_award_letters_import.py`
(210) · `test_register_parsing.py` (193) · `test_register_views.py` (193)
· `test_project_operations.py` (189) · `test_weekly_report_anchors.py`
(157) · `test_project_upload_api.py` (126) · `test_project_classifier.py`
(125) · `test_award_letters_golden.py` (105) · `test_project_fixtures.py`
(90)

---

## 4. Frontend — ~12,900 lines

### Pages

**The hub** — route group `projects/[id]/(hub)`, seven pill pages:

| File | Lines | Page |
|---|---|---|
| `(hub)/layout.tsx` | 221 | Pill shell + period lens |
| `(hub)/page.tsx` | 757 | Overview — the living Contract Summary |
| `(hub)/work-cost/page.tsx` + 3 sections | 1,081 | Work done · Costs · Site |
| `(hub)/plant/page.tsx` + 3 sections | 1,268 | Analytics · Plants · Diesel |
| `(hub)/financials/page.tsx` | 316 | Certificates, payments, FIFO unpaid |
| `(hub)/report/page.tsx` | 732 | Report pack + PDF/Excel export |
| `(hub)/issues/page.tsx` | 335 | Data issues (admin) |
| `(hub)/submissions/page.tsx` | 121 | Weeks received |

**Module pages:**

| File | Lines | Page |
|---|---|---|
| `projects/upload/page.tsx` | 917 | Two-step upload: preview all sheets → Confirm & Ingest |
| `projects/executive/page.tsx` | 736 | Executive summary + Executive brief |
| `projects/review-queue/page.tsx` | 418 | Resolve ambiguous register entries |
| `projects/page.tsx` | 317 | The register |
| `projects/submissions/page.tsx` | 138 | All submissions |
| `projects/create` · `[id]/edit` · `layout.tsx` | 120 | CRUD + module gate |

### Components — 11 files, 2,748 lines

`project-form.tsx` (748) · `projects-table.tsx` (480) ·
`report-preview-dialog.tsx` (326) · `submission-row.tsx` (205) ·
`project-location-link.tsx` (184) · `project-milestone-timeline.tsx`
(170) · `import-award-letters-dialog.tsx` (167) ·
`projects-filters.tsx` (131) · `projects-cards.tsx` (129) ·
`hub-ui.tsx` (112 — **read this first**, it is the hub's UI standard) ·
`projects-stats-cards.tsx` (96)

### Data layer

| File | Lines | Does |
|---|---|---|
| `lib/api/projects.ts` | 1,378 | Every project API call + normalisation layer |
| `hooks/use-projects.ts` | 604 | React Query hooks |
| `lib/executive-brief-pdf.ts` | 519 | The brief PDF — pure `buildBriefDoc()` + pdfmake |
| `lib/api/report-generator.ts` | 165 | Report-pack contract |

---

## 5. Rules that are easy to break

Pulled from `WORKBOOK_ARITHMETIC.md` and hard experience. Each cost real
money or a wrong report:

1. **Never SUM `project_beme_progress`** — section/total rows inside give
   a constant **5.307×** over-count.
2. **Certificates are cumulative** — read MAX, never SUM. Per-cert value
   is an increment, computed in the view.
3. **Payments: always `v_project_payments_latest`** — a bare SUM over
   `project_payments` multiplies by the number of workbooks. The old
   pipeline stored ₦13.6B of grand-total rows as cash.
4. **Cost Report rows with NULL `cost_category` are the sheet's own
   totals** — cross-check only, never add them in.
5. **Net Earnings = Weekly Summary definition, excluding contingency.**
   Contingency/VOP rates are **per project** from the BEME tail — Akwa
   2.5+2.5%, Kaduna 3+5%. Never hardcode.
6. **Contract Summary rows 18–56 are template fossils**, byte-identical
   across both projects. Its client-position block is frozen ~2023 —
   certified/paid/outstanding come from the ledgers.
7. **Cost adjustments group by `split_part(cost_key,'|',2)`** —
   `cost_key` is `SECTION|Category|Description`; grouping raw gives 52
   fake categories.
8. **Availability = (worked + standby) ÷ (worked + standby + breakdown)**
   — standby is fit-to-work and counts. Utilisation = worked ÷ the same.
9. **Storage calls need `get_supabase_admin_client()`** — the anon client
   hits RLS and returns a bare 500.
10. **jsonb: pass objects, never `json.dumps`** — the pool codec encodes.
11. **Deterministic parsing only.** No AI anywhere in the parse path.
12. **Only "This Week" is a stored fact** — the workbook's
    Previous/To-Date columns are broken cross-workbook links. Recompute.

---

## 6. State, 8 Oct 2026

Hub is feature-complete. The constraint is data, not code:

- **221 projects** on the register, **2 active**, **1 site-linked**
- Only **2 projects have ever reported** — Akwa Ibom (9 weeks, W01 and
  W06 missing) and Kaduna (1 week)
- Newest data: week ending **6 Mar 2026** — over 200 days old
- **126** review-queue items and **182** sheet flags outstanding

Open work is listed at the end of
`memory/project_next_projects_module.md`; the long-standing blocker is
the user's own hub adjustments round.
