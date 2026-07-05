# Projects Module — Task Breakdown (v2 PRD execution plan)

**Source of truth:** `docs/PRD_PROJECTS_MODULE.md` (v2.0, locked 2026-07-04)
**Status legend:** ☐ todo · ◐ in progress · ✅ done
**Rule:** a task is DONE only when its acceptance test passes, the full affected test suite is green, and defensive-coding standards (§0) are met.

---

## 0. Engineering Standards (apply to every task)

1. **Every task is testable.** Each task lists its acceptance test. No task merges without it passing. Parsers get golden-file tests; pure functions get unit tests; endpoints get API tests; UI gets a verification checklist run in the preview browser.
2. **Defensive code:**
   - Validate inputs at every boundary (API request → Pydantic; parser cell → coercion helpers that never raise on bad data, they return `(value|None, raw, reason)`).
   - No bare `except:`. Catch specific exceptions; anything unexpected propagates to the worker/endpoint boundary where it is logged with context (submission_id, sheet, row) and converted to a typed error from `app/core/exceptions.py`.
   - Multi-row writes are transactional — one failure rolls back the whole unit; submission status records the failure.
   - Idempotency everywhere: migrations use `IF NOT EXISTS`/guards; imports and re-uploads replace, never duplicate.
   - Parsers NEVER silently drop data: every unparseable cell → review queue / warnings JSONB with the raw value preserved.
3. **Debug loop:** write the test → run → fix → rerun → then run the whole backend suite (`pytest`) before marking done.
4. **Conventions (from CLAUDE.md/memory):** asyncpg via `app.core.pool` helpers; `$1::uuid` casts; `Number()`-normalize in the frontend API layer; `count(*) OVER()` pagination; datetime objects (not isoformat strings) into asyncpg; ECharts for charts; React Query staleTime 2–10 min.

---

## Phase 0 — Foundations: Docker + test harness

*Goal: identical dev/test environment everywhere; fixtures in place.*

| ID | Task | Acceptance test | Depends on |
|---|---|---|---|
| T0.1 ✅ | `docker-compose.yml` at repo root: `backend` service (build `backend/Dockerfile`, volume-mount `./backend/app`, `--reload`, env from `backend/.env`, port 8000) + `frontend` service (node:20 image, volume mount, `npm run dev`, named volume for `node_modules`, port 3000) + healthchecks. `.dockerignore` for both. | `docker compose config` valid; `docker compose up` → `GET :8000/api/v1/health` 200 and `GET :3000/login` 200 (run when native dev servers are stopped) | — |
| T0.2 ✅ | Test runner in Docker: `docker compose run --rm backend pytest`. Add `scripts/test.sh` wrapper (runs pytest in container if Docker up, else local venv). | Existing backend tests pass identically in container and venv | T0.1 |
| T0.3 ✅ | Test fixtures: `backend/tests/fixtures/projects/` with the 2017 Award Letters workbook + Week 2 & Week 10 Akwa Ibom files (copied); `conftest.py` fixture paths. | Fixture-loading test opens all 3 via openpyxl, asserts expected sheet names | — |
| T0.4 ✅ | Test DB strategy: pytest fixtures create/teardown a dedicated schema (or use transactions with rollback) against the dev database, so integration tests never pollute real tables. | Integration smoke test writes + rolls back; real table counts unchanged | T0.2 |
| T0.5 ✅ | (added during Phase 0) Repair legacy test suite: test_plants auth via dependency_overrides, health response shapes, fleet-normalization contract, test_auth live-server suite skips when no server. | Full suite green: 43 passed, 7 skipped (live smoke), 0 failed — identical in venv and Docker | T0.2 |

## Phase 1 — Award Letters → clean Project Register

*Goal: trustworthy register with clients, types, review queue. The parser only improves — provably.*

| ID | Task | Acceptance test | Depends on |
|---|---|---|---|
| T1.1 ✅ | **Golden baseline.** Script runs the CURRENT parser on the 2017 workbook, dumps normalized JSON (projects, errors, warnings) to `backend/tests/golden/award_letters_v1_baseline.json`. Test asserts parser output == baseline. | Test green on two consecutive runs (proves determinism) | T0.3 |
| T1.2 ✅ | **Migration 008:** `clients` table; `projects` + `client_id`, `location_id`, `project_type`, `work_nature`, `scope_quantity`, `scope_unit`, `register_source`, `apg_amount/expiry/renewal_expiry`; `project_register_review_queue`. All guarded/idempotent. | Migration runs twice without error; schema assertions test (columns + FKs + indexes exist) | — |
| T1.3 ✅ | **Clients backfill** script (idempotent): distinct `projects.client` → `clients` (normalized_name), set `client_id`. | Post-run: 0 projects with client string but NULL client_id; rerun changes nothing | T1.2 |
| T1.4 ✅ | **Pure fn: contract-sum decomposition.** `parse_contract_sum(raw) → {original, variation, total, currency, warnings}` handling "Original: X, Variation: Y", "X & Y", plain numbers, junk. | Unit tests: ≥15 real samples from the workbook + edge cases (None, text, negative) | — |
| T1.5 ✅ | **Pure fn: date parsing.** `parse_register_date(raw) → (date|None, raw, reason)` — ordinals, month names, typos, narrative strings ("Ongoing", "Applied 17th Nov, 2014" → extract intent), multi-dates (first + flag). Never raises. | Unit tests: table of ≥30 real inputs → expected outputs | — |
| T1.6 | **State resolution v2:** regex state-mention extraction from project name → client default state → NULL + queue reason. Remove row-index hardcoding. | Unit test per non-state sheet (FERMA, FAAN, FMW, FCDA, PRIVATE); integration: misses <5% on 2017 workbook | T1.4, T1.5 |
| T1.7 | **Pure fn: type/nature classifier.** `classify_project(name) → {project_type, work_nature, confident}`; not-confident → queue. | Unit tests against a hand-labeled set of 40 real register names; ≥90% accuracy, 0 silent wrong labels on the labeled set (uncertain must be flagged, not guessed) | — |
| T1.8 | **Parser v2 integration:** wire T1.4–T1.7 into `award_letters_parser.py`; emit review-queue rows; update golden file deliberately (reviewed diff = the improvement). | New golden test green; warnings vs v1 baseline reduced ≥50%; import into test schema → expected row/queue counts; zero unhandled exceptions | T1.1–T1.7 |
| T1.9 | **Idempotent re-import:** same workbook imported twice → updates, no duplicates (match by sheet+row or normalized name+client). | Integration test: import ×2 → identical project count | T1.8 |
| T1.10 | **Review queue API:** `GET /projects/review-queue` (filters: sheet, reason, resolved), `POST /projects/review-queue/{id}/resolve` (writes corrected value to `projects`, marks resolved, audit-logs). Admin-only. | API tests: list/filter/resolve/403-for-non-admin; resolving updates the project row | T1.2, T1.8 |
| T1.11 | **Review queue UI** `/projects/review-queue` (admin): table, filters, inline resolve (raw value + parser guess + editable field), bulk-resolve by reason. | Preview checklist: resolve one row end-to-end; bulk-resolve; queue count drops | T1.10 |
| T1.12 | **Register UI upgrades:** type/nature/client filters, `register_source` chip, per-project completeness indicator. | Preview checklist + API test for new filter params | T1.8 |
| T1.13 | **Benchmark views + cards:** SQL views `v_project_overrun_factors` (award→completion actuals by type/client) + `v_project_cost_ranges` (by type, where scope present); two cards on register page. | View unit tests with known fixture rows → hand-computed expected values; cards render | T1.8 |

## Phase 2 — Weekly Report ingest pipeline

*Goal: all 16 sheets of all 9 Akwa Ibom files land in the DB, idempotently, with per-sheet accounting.*

| ID | Task | Acceptance test | Depends on |
|---|---|---|---|
| T2.1 | **Migration 009:** `project_report_submissions`, `project_reference_lists`, `project_beme_bills/items/progress`, `project_bill1_items/claims/payments`, `project_precast`, `project_weekly_summary`, `project_contract_summary_snapshot`, `project_alerts`, `project_photos`, `user_project_assignments`; add `fleet_number_raw`+`plant_id` to utilization/diesel if missing; indexes on `(project_id, year, week_number)`. | Runs twice clean; schema assertion test | T1.2 |
| T2.2 | **Anchor toolkit (pure fns):** `find_label_value(ws, label_regex)`, `find_header_row(ws, required_headers)`, `iter_table_rows(ws, header_row)` — tolerant of shifted rows/cols, merged cells, trailing junk. | Unit tests against real Week 2 + Week 10 sheets AND synthetically shifted copies (insert 2 rows/1 col → same results) | T0.3 |
| T2.3 | **Workbook manifest check:** expected sheets (tolerant name matching), required headers per sheet → drift report `{sheet: ok|missing|drifted}`. | Test: real file → all ok; synthetic file with renamed sheet + dropped column → correct drift report, no exception | T2.2 |
| T2.4 | **Sheet parser: Contract Summary** → header identity (name, short name, client, sums, dates) + thin snapshot row. This-week only; cells with errors → None + warning. | Golden tests weeks 2 & 10 (exact expected dicts); `#VALUE!` cells produce warnings not crashes | T2.2 |
| T2.5 | **Sheet parser: Weekly Summary** → section/item/metric rows (this-week values only; to-date ignored per PRD). | Golden tests weeks 2 & 10 | T2.2 |
| T2.6 | **Sheet parser: Plant Return** → utilization rows; fleet normalization + `plants_master` resolution (reuse plant-ETL normalizer). | Golden test; resolution rate reported; unresolved → `fleet_number_raw` kept + queue rows; row count matches sheet (±blank rows) | T2.2 |
| T2.7 | **Sheet parser: Diesel Consumption** (Sat–Fri days + totals). | Golden test; per-row day-sum == sheet total column (tolerance 0.01) else warning; sheet "Used This Week" reconciled | T2.2 |
| T2.8 | **Sheet parser: Cost Report** (categories, qty, rate, this-week amounts). | Golden test; cross-check: AGO line ≈ diesel litres × rate → warning if drift >5% | T2.2, T2.7 |
| T2.9 | **Sheet parsers: Certificate Status + Payments Recieved** (vendor spelling tolerated by manifest). | Golden tests; payment deduction math re-verified (gross − deductions == net ±0.01, else warning) | T2.2 |
| T2.10 | **Sheet parser: BEME** → bills/items upserted once per project; weekly progress rows append. | Golden test week 2; ingest week 3 → items NOT duplicated, progress rows added (test asserts counts) | T2.2 |
| T2.11 | **Sheet parsers: Bill 1 Summary + Bill 1 Payments.** | Golden tests | T2.2 |
| T2.12 | **Sheet parsers: Subcontractors, Labour Strength, Materials & Civils, Hired Vehicles, Precast.** | Golden test each (5 small parsers, one PR each is fine) | T2.2 |
| T2.13 | **Lists ingest:** reference items → `project_reference_lists` (once, idempotent); calendar → in-memory validation map (week_number+year → expected week_ending) used by all sheet parsers. | Test: week 10/2026 → 2026-03-06; workbook claiming wrong week-ending → submission warning | T2.2 |
| T2.14 | **Upload endpoint** `POST /api/v1/projects/upload-weekly-report` (admin, multipart: file/project_id/year/week_number): validates ext+size, stores to `reports` bucket `weekly-reports/projects/{project_id}/{year}-W{week:02d}/`, creates submission (`queued`), dispatches worker. | API tests: happy path (mocked storage), bad ext 422, non-admin 403, oversize 413 | T2.1 |
| T2.15 | **Worker `process_project_weekly_report`:** download → manifest check → parse all sheets → single transaction insert → status transitions queued→parsing→success/partial/failed with `sheets_processed` + `row_counts` + duration; failure = rollback + error_message + notification. | Integration test on Week 2 fixture end-to-end: submission `success`, every table row count > 0 and == parser output; forced mid-sheet exception → full rollback, status `failed` | T2.3–T2.13, T2.14 |
| T2.16 | **Idempotent re-upload:** same (project, year, week) → replace prior weekly_report row + children in one transaction. | Test: upload Week 10 ×3 → identical row counts every time | T2.15 |
| T2.17 | **Auto-create project:** unknown Contract Summary identity → create project (`register_source='weekly_report_inferred'`), upsert client, continue parse; probable fuzzy duplicate → queue row, no create. | Test with synthetic workbook (renamed project): project created + flagged; near-match workbook → queue not create | T2.15 |
| T2.18 | **Unmapped fleet queue:** `GET /projects/unmapped-fleet-numbers`, `POST .../link` (admin) → backfills `plant_id` on ALL historical rows for that raw number. | API test: link → historical rows updated (count asserted) | T2.6, T2.15 |
| T2.19 | **Submissions UI:** `/projects/submissions` list (status/project filters) + detail (per-sheet breakdown, row counts, errors, Retry, Soft-delete) with polling while queued/parsing. | Preview checklist: upload real Week 5 via UI → watch to success; retry a failed one; soft-delete cascades | T2.15 |
| T2.20 | **Batch validation:** ingest all 9 weeks; recompute to-date figures from our rows and reconcile vs workbook to-date columns (report drift, expected due to F3). | Acceptance report: ≥98% sheets `ok` across 9 files; documented reconciliation deltas | T2.15, T2.16 |
| T2.21 | **Compliance view** `v_project_submission_status` (mirror plant `v_weekly_submission_status`): expected vs received per active project per week. | View test: gaps for missing week 1 visible | T2.15 |

## Phase 3 — Roles, dashboards, alerts

| ID | Task | Acceptance test | Depends on |
|---|---|---|---|
| T3.1 | **Role migration:** extend role check constraint/enum to `admin,md,gpm,pm,plant_officer,site_engineer,management(legacy)`; map fonche@pwnigeria.com → `plant_officer`; keep `management` accepted everywhere `md/gpm/plant_officer` are (transition safety). | Migration test; auth regression: Friday's login still sees plants exactly as before | T2.1 |
| T3.2 | **Assignments API + admin UI:** CRUD on `user_project_assignments`. | API tests incl. duplicate guard; UI checklist | T3.1 |
| T3.3 | **Backend gating matrix:** dependencies `require_roles(...)` + assignment filtering on every projects read for pm/site_engineer. | **Table-driven test: (role × endpoint) → expected 200/403**, incl. pm requesting another project → 403/404 | T3.1, T3.2 |
| T3.4 | **Frontend role wiring:** landing redirect map, sidebar config per role (§6.1 PRD), `<ProtectedRoute>` role lists. Plant officer sees zero projects nav; PM sees no plants nav. | Preview checklist per role (test accounts for each role) | T3.1 |
| T3.5 | **Aggregate views:** money pipeline per project, portfolio rollup, league tables (plant productivity, diesel variance, cost efficiency), payment-lag per client, advance-recovery, plant-usage-by-project (feeds plant pages), own-vs-hire. | Each view: fixture-data test with hand-computed expected numbers | T2.20 |
| T3.6 | **Dashboard endpoints:** `/projects/{id}/dashboard` (KPI bundle), `/cost-breakdown`, `/cost-trend`, `/diesel`, `/plants` (joins plants_master + spare-parts spend), `/certificates`, `/payments`, `/beme`, `/labour`, `/materials`, `/subcontractors`, `/hired-vehicles`, `/weeks`; `/portfolio`; `/projects/alerts`. Number()-normalization layer in `lib/api/projects.ts`. | API tests per endpoint (shape + values vs fixtures); pm scoping re-verified | T3.3, T3.5 |
| T3.7 | **MD Executive Home** UI (money pipeline, net earnings %, red flags, fleet snapshot). | Preview checklist vs known DB values | T3.4, T3.6 |
| T3.8 | **GPM Projects Overview** UI (league tables, compliance board). | Preview checklist | T3.4, T3.6 |
| T3.9 | **PM project dashboard** UI (week-vs-week, lagging BEME, Plants-on-Site tab, own financials). | Preview checklist as pm test user | T3.4, T3.6 |
| T3.10 | **Alerts engine:** each alert type = pure function over views (silent site, overdue completion, diesel variance 3wk, B/D>30% 3wk, cost spike, APG expiry, retention overdue, certified-unpaid ageing) + compute-on-ingest hook + notifications. | Unit test per alert type with synthetic trigger + non-trigger data; integration: ingest → expected alerts | T3.5 |
| T3.11 | **Alerts UI:** nav badge + `/projects/alerts` + banner on project detail. | Preview checklist | T3.10 |
| T3.12 | **Excel exports:** per-project, portfolio, register mirror. | Round-trip test: exported values == API values | T3.6 |
| T3.13 | **Plant detail usage section** (plants module): hours/diesel/cost from project data on plant pages (visible to plant_officer). | Preview checklist as Friday's role | T3.5 |

## Phase 4 — AI layer

| ID | Task | Acceptance test | Depends on |
|---|---|---|---|
| T4.1 | **Read-only DB role** + curated semantic views + column-documentation file (the model's only schema source). | Test: readonly role SELECT ok, INSERT/UPDATE/DELETE fail | T3.5 |
| T4.2 | **SQL guard (pure fn):** validate model-generated SQL — single SELECT, allowlisted views only, LIMIT enforced, timeout set. | Unit tests incl. injection attempts (`; DROP`, CTE-wrapped writes, `pg_sleep`) → all rejected | — |
| T4.3 | **Chat endpoint:** Claude API tool-use loop (`run_sql` tool → guard → readonly pool), role-scoped (pm → assignment filter injected), every Q/SQL/answer logged. | Eval set: ≥20 question→expected-answer pairs green; pm cross-project question → scoped result; out-of-scope question → explicit "can't answer" | T4.1, T4.2 |
| T4.4 | **Chat UI:** panel with answer + collapsible generated-SQL + history. | Preview checklist | T4.3 |
| T4.5 | **Auto-narratives:** SQL computes weekly figures → model writes commentary; stored + shown on dashboards. | Test: every number in narrative regex-extracted and matched against the SQL payload (zero model-invented figures) | T4.3 |

## Phase 5 — Entry forms + photos

| ID | Task | Acceptance test | Depends on |
|---|---|---|---|
| T5.1 | **Draft API:** create/update/get drafts per (project, week, sheet-type); `submit` validates + converts to a submission (`source='manual'`) through the SAME worker path. | API tests: draft lifecycle; submitted manual data lands in same tables as Excel ingest | T2.15 |
| T5.2 | **Form UIs** mirroring sheets (order: Plant Return → Diesel → Labour → Materials → rest), dropdowns from `project_reference_lists`, draft→submit UX. | Preview checklist per form; invalid input blocked at entry | T5.1 |
| T5.3 | **Photos:** upload endpoint (Storage + metadata row), gallery per project/week on dashboard. | API test + preview checklist | T2.1 |
| T5.4 | **Site-engineer wiring:** assignment-scoped access to forms only. | Gating matrix extended | T3.3, T5.2 |

---

## Dependency spine (how it stacks)

```
T0.* (Docker+fixtures)
  → T1.1 golden baseline → T1.4–T1.7 pure fns → T1.8 parser v2 → T1.9–T1.13 (queue/UI/benchmarks)
      T1.2 migration → T1.3 backfill ┘
  → T2.1 migration → T2.2 anchors → T2.3 manifest → T2.4–T2.13 sheet parsers
      → T2.14 upload → T2.15 worker → T2.16–T2.21 (idempotency/auto-create/UI/batch/compliance)
  → T3.1 roles → T3.2/T3.3 gating → T3.4 FE wiring
      T3.5 views (needs T2.20 data) → T3.6 endpoints → T3.7–T3.9 dashboards → T3.10–T3.13
  → T4.1–T4.5 (needs T3.5 views)
  → T5.1–T5.4 (needs T2.15 pipeline; independent of Phase 4)
```

**Working order:** strictly Phase 0 → 1 → 2 → 3 → 4 → 5. Within a phase, pure-function tasks (T1.4–T1.7, T2.2, T3.10, T4.2) can be built and tested independently before their integration task.
