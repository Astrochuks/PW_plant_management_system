# PRD: Projects Module v2 — Register, Weekly Ingest Pipeline, Role-Scoped Dashboards & AI Layer

| Field | Value |
|---|---|
| **Document Status** | DRAFT v2.0 — awaiting final review |
| **Version** | 2.0 (supersedes v1.1 of 2026-05-13) |
| **Date** | 2026-07-04 |
| **Owner** | Ram |
| **Approval Required From** | Product Owner (Ram) |

**What changed vs v1.1:** full redesign of roles (management umbrella split into MD / GPM / PM / plant officer), project↔location bridge to the plants module, anchor-based parsing strategy, Lists sheet promoted to master data, "this week is the only fact" rule, deterministic-only parsing (no AI anywhere in the parse path), AI repositioned as a query/narrative layer on top, entry forms as the long-term second input channel, monitoring shipped lite-first, business case added.

---

## 1. Problem Statement

Project performance data for a multi-billion-naira construction portfolio is trapped in hand-maintained, 16-sheet Excel workbooks, emailed weekly to the General Project Manager's inbox. Only one site (Akwa Ibom Airport) reports consistently. The workbooks contain broken cross-workbook formulas, inconsistent identifiers, and no validation — so even the data that arrives cannot be trusted or aggregated. Management cannot answer basic questions ("which plants are idle?", "what is our uncertified exposure?", "where is diesel leaking?") without manual Excel archaeology, per question, per site. Decisions are made late, on incomplete and unverified data.

## 2. Findings (from auditing the actual files)

- **F1 — No enforcement loop.** 9 weeks from 1 site, week 1 missing, filenames inconsistent. Nobody can see *that* a site hasn't reported. The system must measure submission compliance itself.
- **F2 — Workbooks are presentation documents, not data.** `#VALUE!`/`#REF!` errors, fleet numbers written three ways ("BP6", "BP 9"), Certificate Status with zero submission dates, a computed Total Work in Progress of −₦2.05B, load-bearing typos ("Payments Recieved"). The Award Letters register: contract sums as prose, dates as narrative, retention applied in 2014 still "Paid: NO".
- **F3 — Every number exists in three competing versions.** *Previous / This Week / To Date* columns are maintained by **live cross-workbook links to the prior week's file** (proven by the FMWH-Ogrute link breakage). When the linked file is absent, Previous/To-Date are garbage.
- **F4 — The project reports contain the plant usage data the company never captured.** Plant Return has hours worked / standby / breakdown, rates and cost per fleet number; Diesel Consumption has per-plant fuel with a variance-vs-standard column. The plants module only knows presence + condition.
- **F5 — Information arrives after the decision window.** Breakdown hours, diesel variance and stock-outs are only actionable within days.

## 3. Business Case (assumption-stated estimates)

| Lever | Basis (Week 10, Akwa Ibom actuals) | Annual value |
|---|---|---|
| Diesel leakage | ~₦13.7M/week AGO per site; recover 5% across 5 sites | ~₦165M/yr |
| Idle & broken plant | Plants at 63 B/D hours with 0 worked; internal plant charge ₦39.8M/wk; convert 5% of idle/broken hours | ~₦100–240M/yr |
| Working capital on uncertified work | Every ₦1B certified one month sooner ≈ ₦20–25M financing cost avoided (25–30% rates) | ~₦50–200M/yr |
| Forgotten retention | Register shows retention applied 2014, unpaid; 5% of contract sum per recovery | ~₦50M per recovery |
| Management time & decision speed | 2+ person-days/week of consolidation eliminated | Enabler for all the above |

---

## 4. What Already Exists (foundation)

- `projects` master table (35+ columns incl. all lifecycle/cert/retention fields), CRUD API, `/projects` pages, Award Letters parser (working, known accuracy gaps).
- 11 operational tables from migration `007` (weekly reports header, plant utilization, diesel, certificates, payments, cost report, labour, subcontractors, materials stock, hired vehicles, documents) — schema only, unfed.
- Plants module: `plants_master` (~1,600 plants), fleet-number normalisation, locations (27 sites), spare-parts/PO spend per plant, upload→worker ETL pattern, audit logging, notifications, SSE events.
- Stack: Next.js 16 + Supabase (Auth/Storage) + FastAPI + asyncpg → PostgreSQL. All on current hosting; no new infrastructure required.

## 5. Data Sources & Input Channels

| Source | Cadence | Channel (v2 decision) |
|---|---|---|
| Award Letters / Completion Certs workbook (2017) | One-time seed + occasional updates | Admin imports via existing dialog |
| Weekly Progress Report workbooks (16 sheets) | Weekly per site | **Sites email Excel to GPM → admin uploads** (unchanged social process). ~~Site upload tokens~~ — explicitly rejected. |
| In-app weekly entry forms | Future | Web forms that **mirror the Excel sheets**, draft→submit workflow; rolled out site-by-site with in-person training when ready |

**Design rule — two doors, one pipeline:** Excel upload and in-app entry both create a `project_report_submissions` record (`source: excel | manual`) and write to the same tables through the same validation layer. Dashboards never know which door the data came through.

---

## 6. Roles & Access Model

The current `management` role is an umbrella over different people (MD, GPM, plant officer). Projects breaks the umbrella; roles become explicit.

| Role | Plants module | Projects module |
|---|---|---|
| **admin** | Full (unchanged) | Full: uploads, register edits, review queues, fleet-number linking |
| **md** | Read all (as today) | Read all; lands on executive portfolio view |
| **gpm** | Read all (as today) | Read all projects — operational + financial depth |
| **pm** | **No standalone plants pages.** Plant data appears inside his project's dashboard ("Plants on Site" tab) | Only assigned project(s) via `user_project_assignments` |
| **plant_officer** | Read all (exactly as today) | **None — projects section hidden entirely** |
| **site_engineer** | Unchanged (existing site pages) | Data-entry forms for assigned project (when forms ship) |

- New table **`user_project_assignments`** (user_id, project_id, role_on_project, created_at) scopes PMs and site engineers.
- Migration maps existing `management` users to their real roles (few users; trivial).
- Backend: `require_role(...)` dependencies extended; every projects read endpoint filters by assignment for `pm`/`site_engineer`.
- **Financial visibility:** MD/GPM/admin see all financials. PM sees **his own project's financials** (certs, payments, retention) — *recommended, awaiting explicit confirmation*. Plant officer sees no project financials.
- Cross-module bonus: plant detail pages gain a usage section (hours/diesel/cost from project reports) — the plant officer finally gets utilization data without touching the projects module.

### 6.1 Information architecture — login → landing → navigation

Login flow unchanged (Supabase Auth → JWT). A `role → landing route` map in the auth provider + a `role → nav items` sidebar config + role lists on `<ProtectedRoute>`; projects endpoints additionally filter by `user_project_assignments` for `pm`/`site_engineer`.

| Role | Lands on | Sidebar |
|---|---|---|
| **admin** | Current plant dashboard (unchanged) | Everything: both domains + Uploads, Submissions, Review Queues, Admin |
| **md** | **Executive Home** (new): portfolio money pipeline (contract→certified→paid→outstanding per project), net earnings %, red-flag alert strip, fleet condition snapshot | Portfolio, Projects, Plants (all pages, read), Reports, Insights, Notifications |
| **gpm** | **Projects Overview**: cross-site league tables (progress rate, cost efficiency, breakdown hours, diesel variance), submission compliance board | Same as MD, projects-first ordering |
| **plant_officer** | Current plant dashboard — pixel-identical to today | Today's sidebar exactly; Projects never appears |
| **pm** | His project's dashboard directly (no picker if single assignment) | My Project (Dashboard, Plants on Site, Financials, Reports), Profile, Notifications |
| **site_engineer** | Unchanged; Phase 5 adds entry forms | Unchanged + Entry Forms (Phase 5) |

Additional MD/GPM KPIs adopted from analytics review (2026-07-04): **payment lag per client** (cert date → payment date), **advance-recovery exposure**, **own-vs-hire plant analysis** (Plant Return × Hired Vehicles — also surfaced to plant_officer, as it is plant data).

## 7. Plant ↔ Project Correlation

Two links at different levels; **1 project = 1 site** (confirmed):

1. **`projects.location_id`** — nullable FK to `locations`. Once linked, everything the plants module knows about that site (plants stationed, condition, spare-parts/PO spend) rolls up onto the project dashboard with zero new data entry. Legacy register projects without a matching location simply stay unlinked.
2. **Fleet-number resolution per operational row** — every Plant Return / Diesel row stores `fleet_number_raw` + resolved `plant_id` (same normalisation the plant ETL uses). Unresolved numbers go to an admin queue; manual linking back-fills historical rows.

**Data authority split (no stream overwrites the other):**
- Plant weekly report (existing) stays authoritative for **presence + condition** (`plants_master.condition`, location history, transfers).
- Project weekly report becomes authoritative for **usage** (hours worked/standby/breakdown, plant cost, per-plant diesel).
- Where both report the same plant in the same week, dashboards surface discrepancies (e.g. "working" at location, 0 hours in project report) as a data-quality feature.

---

## 8. Pipeline Architecture: ingest → validate → load → serve

1. **Ingest** — admin upload (or, later, form submission) creates a submission record: who, when, project, year, week, file hash, source. This alone creates the compliance loop (F1).
2. **Validate & clean** — normalisation layer: fleet-number normalisation, date/currency coercion, error-cell (`#VALUE!`/`#REF!`) quarantine → NULL + flag, and cross-checks (This-Week + Previous ≈ To-Date; diesel litres × rate ≈ AGO cost line). Failing cells land in a review queue with raw values preserved — nothing vanishes silently.
3. **Load** — idempotent, transactional. Re-upload of a `(project, year, week)` replaces cleanly (delete children by weekly_report_id, re-insert, one transaction). Zero duplicates, audit trail kept.
4. **Serve** — role-scoped dashboards, alerts, exports; later chatbot + narratives.

### 8.1 Parsing strategy (deterministic only — LOCKED)

- **No AI anywhere in the parse path.** Parsers are plain, tested code. A parser that cannot be unit-tested cannot be trusted with an MD's numbers.
- **Anchor-based, not fixed addresses.** Find the cell labelled "Name of Contract:" and read beside it; find the row containing "Fleet No. | Description | ..." and treat it as the header wherever it lands. Immune to inserted rows/shifted columns across sites. (Replaces v1.1's fixed row/col assumptions.)
- **Golden-file regression tests** against the 2017 Award Letters workbook and the 9 Akwa Ibom weeklies. Tests lock behaviour before any parser change merges.
- **"This Week" is the only fact.** Cumulative columns (Previous / To-Date) are recomputed by us from accumulated weeks; the workbook's own cumulative values are used only as a reconciliation cross-check (F3).
- **Manifest drift check.** Expected sheets/headers per template version; a missing sheet or renamed column → submission `partial` with specifics, never a silent mis-parse.
- **Week convention = the system's existing standard.** Every weekly table carries the denormalised triple `(year, week_number, week_ending_date)` — exactly as `plant_weekly_records`, `weekly_report_submissions`, and the existing migration-007 project tables already do. **No separate calendar dimension table.** The workbook's Lists calendar (2020–2031) is used at **parse time only**, as a validation map (week_number → expected week-ending date); mismatches flag the submission.
  - Nuance: plant weeks end **Sunday**; project workbook weeks run **Sat–Fri** (end Friday). Week numbers align (~ISO), so cross-module correlation joins on `(year, week_number)`, never on `week_ending_date`.
- **Lists sheet reference data ingested once** (changed from v1.1's "not ingested"): ~75 reference items (UOMs, cost categories, plant categories, rates) → `project_reference_lists`, seeding validation and future form dropdowns.
- **Submission compliance mirrors the plant pattern.** The system already has `missing_weekly_reports` + `v_weekly_submission_status` for plants; projects get the same: a view deriving expected-vs-received reports per active project per week (F1's enforcement loop, using a proven in-house pattern).

### 8.2 Monitoring — lite first (v2 scope), full later

**Ships in v2:** submission status (`queued|parsing|success|partial|failed|deleted`), per-sheet results + row counts (`sheets_processed`, `row_counts` JSONB), error messages, parse duration, retry count — all visible on the submissions UI. Review queue for failed cells/ambiguous values.

**Deferred (fast-follow):** `parser_runs`/`parser_field_failures` telemetry tables, accuracy trend views, drift dashboards (`/admin/parser-monitoring`). Designed-in (the lite fields are forward-compatible), not built.

---

## 9. Phase Plan (build order — PRD order confirmed)

### Phase 1 — Award Letters → clean Project Register
The register is the dimension table everything hangs off.
1. **Schema:** `clients` master (id, name, normalized_name UNIQUE, type govt|private|agency, default_state_id, notes) + `projects.client_id` backfill; `projects.project_type` (road|bridge|airport|building|drainage|other — keyword classifier, review queue for odd ones); `projects.scope_quantity` + `scope_unit` (nullable; backfilled opportunistically — prerequisite for cost-per-km benchmarking); `projects.location_id`; `projects.register_source` (award_letters_workbook|manual|weekly_report_inferred).
2. **Golden tests** locking current parser output on the 2017 workbook.
3. **Parser v2 (deterministic):** state resolution fixed (regex from project name → client default state → NULL + queue), narrative dates ("Ongoing", "Applied 17th November, 2014") → raw preserved, parsed NULL, queued; contract-sum prose ("Original: X, Variation: Y") → decomposed sums; multi-date strings → first parseable + flag.
4. **Review queue UI:** admin resolves ambiguous cells; resolutions write back to the register.
5. **Register views:** filter by type/client/state, per-project completeness score, first benchmark cards — **overrun factor by type/client** (award→completion actuals) and **indexed cost ranges by type** (where scope data exists).

### Phase 2 — Weekly Report ingest pipeline
1. Migration: new tables (§10) incl. `project_report_submissions`, week calendar, BEME/Bill-1/precast/summary tables, `user_project_assignments`.
2. Parser, sheet by sheet (anchor-based, per-sheet golden tests): Contract Summary + Weekly Summary → Cost Report + Plant Return + Diesel → Certificates + Payments + Bill 1 → BEME + Subcontractors + Materials + Labour + Hired Vehicles + Precast.
3. Upload endpoint `POST /api/v1/projects/upload-weekly-report` (admin) + background worker + idempotent re-upload + auto-create project from Contract Summary when unknown (`register_source='weekly_report_inferred'`, visible in register with filter chip).
4. Submissions UI: list + detail (per-sheet breakdown, retry, soft-delete), auto-refresh while processing.
5. Fleet-number resolution queue + historical back-fill on link.
6. Validated end-to-end against all 9 Akwa Ibom files: ≥98% per-sheet success, 0 duplicates after 3 re-uploads, <30s per workbook.

### Phase 3 — Roles split + dashboards + alerts
1. Role migration (management → md/gpm/plant_officer), `user_project_assignments`, route gating, sidebar per role.
2. **MD portfolio view:** money pipeline per project + total (contract → work done → certified → paid → outstanding), WIP exposure, net earnings %, red flags only (overdue vs revised completion, retention unpaid, APG expiry, silent sites).
3. **GPM cross-site view:** weekly progress rate (BEME % movement), cost-vs-value efficiency by category, plant productivity league table (worked/standby/breakdown), diesel variance ranking, certificate ageing pipeline, submission compliance board.
4. **PM single-project dashboard:** week-vs-week snapshot (works, costs, labour, materials closing stock), lagging BEME sections, **Plants-on-Site tab** (condition from plants module + hours/diesel variance from project reports + maintenance spend from spare parts), own-project certs & payments.
5. **Alerts** (computed on ingest; in-app): no report ≥14 days, past revised completion, diesel variance sustained 3 weeks, plant B/D >30% for 3 weeks, cost category >200% of trailing 4-week avg, APG expiring ≤60 days, retention overdue (>12 months post-FCC), certified-but-unpaid ageing.
6. Excel exports: per-project, portfolio, register mirror.

### Phase 4 — AI layer (after data exists)
**Golden rule (LOCKED): code calculates every number; AI interprets, explains and routes — never calculates.**
1. **Chatbot (text-to-SQL):** chat panel → FastAPI endpoint → Claude API with tool access to a documented semantic layer (curated views only). Guardrails: dedicated read-only Postgres role, SELECT-only validation, row limits/timeouts, role-scoped results (PM sees only his project), generated SQL shown alongside answers, every Q/query/answer logged.
2. **Auto-narrative weekly reports:** SQL computes the figures; the model writes the commentary ("Completion 51.4%, up 0.7 pts; diesel variance elevated at X for a third week"). Per-project and portfolio-level.
3. Cost: API tokens only (~ a few dollars/month at expected volume). Everything else stays on existing free-tier infrastructure.

### Phase 5 — Entry forms + photos (rollout when ready)
1. Weekly entry forms mirroring the Excel sheets (Plant Return form, Diesel form, Labour, Materials, ...), dropdowns from Lists reference data, **draft → submit** (save freely as draft; submit validates, locks, creates a submission identical to an Excel one).
2. Trained site-by-site in person; Excel-by-email remains available indefinitely.
3. **Site photo progress log:** `project_photos` (photo in Supabase Storage; URL + project_id, week, caption, GPS, timestamp, uploader in DB); gallery per project/week on the dashboard. Table designed in Phase 2 migration; UI built here.

---

## 10. Data Model Delta

**Additions to `projects`:** `client_id` FK, `location_id` FK, `project_type`, `scope_quantity`, `scope_unit`, `register_source`, `apg_amount`, `apg_expiry`, `apg_renewal_expiry`.

**New tables:**

| Table | Phase | Purpose |
|---|---|---|
| `clients` | 1 | Normalised client master (backfilled from `projects.client`) |
| `project_register_review_queue` | 1 | Ambiguous parser cells: batch, sheet, row, field, raw_value, reason, suggested_value, resolved(_by/_at) |
| `project_reference_lists` | 2 | UOMs, cost categories, plant categories from Lists (Lists calendar used at parse time only — no calendar table, per system convention) |
| `project_report_submissions` | 2 | Upload audit: file, hash, path, uploader, project, year, week, status, error, sheets_processed JSONB, row_counts JSONB, duration, retry_count, source (excel|manual) |
| `user_project_assignments` | 2/3 | Scopes pm/site_engineer to projects |
| `project_beme_bills` / `project_beme_items` / `project_beme_progress` | 2 | BEME structure + weekly progress (items inserted once; weeks append progress) |
| `project_bill1_items` / `project_bill1_claims` / `project_bill1_payments` | 2 | Bill 1 schedule, claim matrix, disbursements |
| `project_precast` | 2 | Precast stock per week |
| `project_weekly_summary` | 2 | Flattened Weekly Summary (section, item, metric, value — this-week values only) |
| `project_contract_summary_snapshot` | 2 | Thin per-week snapshot for contract-evolution charting |
| `project_alerts` | 3 | Computed alerts (type, severity, message, triggered/resolved) |
| `project_photos` | 2 (schema) / 5 (UI) | Photo metadata; file in Storage |

**Existing 11 operational tables (migration 007):** fed by Phase 2; `project_plant_utilization` and `project_diesel_consumption` gain `fleet_number_raw` + resolved `plant_id` columns if not present.

**Views:** register completeness, per-project money pipeline, portfolio rollup, plant usage-by-project (feeds plant detail pages), submission compliance per site/week.

## 11. Success Criteria

**Phase 1:** golden tests pass; warnings on 2017 workbook ↓ ≥50%; state-resolution misses <5%; review queue resolves end-to-end; `clients` backfilled with zero UI regressions; every register row has `project_type`.
**Phase 2:** all 9 Akwa Ibom weeks ingest ≥98% per-sheet; re-upload ×3 → 0 duplicates; <30s per workbook; auto-create verified with synthetic unknown-project workbook; unmapped fleet queue + back-fill works.
**Phase 3:** each role sees exactly their scope (verified per role); MD answers "who owes us what" in <5s; GPM sees submission compliance; ≥1 alert of each type fires on real data; plant officer's plant pages unchanged but enriched with usage.
**Phase 4:** chatbot answers portfolio questions correctly against a held-out Q&A eval set, refuses out-of-scope, always shows SQL; narratives contain zero model-computed figures (all numbers traceable to SQL).
**Overall:** submission compliance visible for every active site every week; time-to-answer <5s on one screen; every anomalous cell traceable to a queued review item.

## 12. Out of Scope / Deferred

- ~~Site upload tokens for weekly reports~~ — **rejected**; email→admin channel stays until forms roll out.
- AI in any parsing/cleaning path — **permanently out**.
- Predictive cost/duration ML — deferred until scope fields + weekly production history mature; v2 ships **benchmark analytics** (overrun factors, indexed unit-rate ranges) instead.
- Full parser telemetry dashboards (`parser_runs` etc.) — fast-follow after Phase 2.
- Individual Site Output workbook ingest; BEME line-item dashboards (data ingested Phase 2, dashboards later); materials/subcontractor master catalogues; multi-currency (NGN only); email/SMS notifications; mobile native app.

## 13. Open Decisions

| # | Decision | Status |
|---|---|---|
| D1 | PM sees own project's financials (certs, payments, retention) | **CONFIRMED YES (2026-07-04)** |
| D2 | Taxonomy (from 218 real register projects): `project_type` = road/bridge/drainage/building/airport/water/infrastructure/other **+** `work_nature` = construction/dualization/rehabilitation/maintenance/emergency_repair/completion | **CONFIRMED (2026-07-04)** — ambiguous classifications go to the Phase-1 review queue |
| D3 | User→role mapping: fonche@pwnigeria.com (Friday Onche) → **plant_officer** (confirmed 2026-07-04). MD + GPM + PM accounts created at Phase 3 onboarding. Other current accounts are test users. | Partially resolved; MD/GPM accounts at Phase 3 |

## Appendix A: Reference Files

- Weekly reports (Akwa Ibom, weeks 2–10): `project files/Week {N} Weekly Progress Report-Akwa Ibom Airport 2026*.xlsx`
- Award Letters workbook: `project files/Copy of Award letters  Completion Certs.2017 (1).xlsx`
- Historical monthly output (out of scope): `project files/Individual site output January - October.xlsx`
- Existing parser: `backend/app/services/award_letters_parser.py` · Routes: `backend/app/api/v1/projects.py` · Migration: `backend/migrations/007_projects_operational_tables.sql`
- Plant-module patterns to mirror: `backend/app/api/v1/uploads.py`, `backend/app/workers/etl_worker.py`
- Frontend: `frontend/src/app/(dashboard)/projects/`, `frontend/src/hooks/use-projects.ts`, `frontend/src/lib/api/projects.ts`
- Charts: **ECharts** (echarts-for-react — the app's existing library; v1.1's "Recharts" reference was wrong)

## Appendix B: Key Decisions Log

- 2026-05-13 — Award Letters workbook is the register seed; plant-module patterns adopted; auto-create on unknown project; clients master added; no `project_variations` table.
- 2026-07-03/04 — Roles split (md/gpm/pm/plant_officer + existing admin/site_engineer); 1 project = 1 site via `projects.location_id`; condition-vs-usage authority split; two-doors-one-pipeline; **deterministic parsing only, golden tests mandatory**; anchor-based parsing; "This Week" is the only stored fact; Lists = master data (week calendar + reference lists); monitoring lite-first; AI = chatbot (text-to-SQL) + auto-narratives, never in parsing, never calculates; benchmarks now, prediction later; **email→admin upload channel stays; site upload tokens rejected**; entry forms mirror Excel with draft→submit, trained on-site later; photo progress log designed now, built in Phase 5.
