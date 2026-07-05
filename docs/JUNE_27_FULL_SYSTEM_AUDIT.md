# PW Plant Management System — Full System Audit

**Audit date:** 27 June 2026
**Repository:** `Astrochuks/PW_plant_management_system`
**Prepared by:** System audit (automated full-stack inventory)
**Scope:** Every tool, technology, layer, and integration point — frontend, backend, database, ETL, deployment, and the wiring between them.

---

## 1. Executive Summary

The PW Plant Management System is a **full-stack fleet, maintenance, and project-tracking platform** for a Nigerian plant & equipment operation. It tracks ~1,600 active plants across 27 locations / 37 states, weekly utilisation reports, spare-parts/purchase-order spend (multi-currency), plant transfers, and construction projects.

| Layer | Technology | Hosting |
|-------|-----------|---------|
| **Frontend** | Next.js 16 (App Router) + React 19 + TypeScript 5 + Tailwind 4 | Vercel |
| **Backend** | FastAPI (Python 3.11) + asyncpg | Render (Docker, Frankfurt EU) |
| **Database** | PostgreSQL (Supabase), accessed directly via asyncpg through Supavisor pooler | Supabase |
| **Auth** | Supabase Auth (JWT, ES256, local JWKS verification) | Supabase |
| **Storage** | Supabase Storage (buckets: `reports`, `documents`) | Supabase |
| **ETL** | Standalone Python (pandas/openpyxl) + in-app async workers | Local / backend |

**Architecture in one line:** Browser → Next.js (Vercel) → Axios+JWT → FastAPI (Render) → asyncpg pool → Supavisor (port 6543) → PostgreSQL (Supabase). Supabase SDK is used **only** for Auth and Storage; all data CRUD bypasses PostgREST and goes direct via asyncpg (2–5 ms vs 3–4 s).

---

## 2. Technology Stack & Tooling

### 2.1 Frontend dependencies (`frontend/package.json`)

| Category | Library | Version | Role |
|----------|---------|---------|------|
| Framework | `next` | 16.1.6 | App Router, SSR/RSC |
| | `react` / `react-dom` | 19.2.3 | UI runtime |
| | `typescript` | ^5 | Type safety |
| Server state | `@tanstack/react-query` | ^5.90 | Caching, sync, refetch |
| | `@tanstack/react-query-devtools` | ^5.91 | Dev panel |
| Client state | `zustand` | ^5.0 | UI filter store |
| HTTP | `axios` | ^1.13 | API client w/ interceptors |
| Forms | `react-hook-form` | ^7.71 | Form state |
| | `@hookform/resolvers` | ^5.2 | Schema resolvers |
| | `zod` | ^4.3 | Runtime validation |
| UI primitives | `radix-ui` | ^1.4 | Headless components (shadcn/ui base) |
| | `class-variance-authority` | ^0.7 | Variant styling |
| | `tailwind-merge` / `clsx` | ^3.4 / ^2.1 | Class merging |
| | `cmdk` | ^1.1 | Command palette |
| | `lucide-react` | ^0.563 | Icons |
| | `sonner` | ^2.0 | Toasts |
| Styling | `tailwindcss` | ^4 | Utility CSS |
| | `tw-animate-css` | ^1.4 | Animations |
| | `next-themes` | ^0.4 | Dark/light mode |
| Charts | `echarts` + `echarts-for-react` | ^6.0 / ^3.0 | Line/bar/donut/geo charts |
| Data | `date-fns` | ^4.1 | Date handling |
| | `xlsx` | ^0.18 | Client-side Excel parsing (bulk upload) |
| Lint | `eslint` + `eslint-config-next` | ^9 / 16.1.6 | Linting |

### 2.2 Backend dependencies (`backend/requirements.txt`)

| Category | Library | Role |
|----------|---------|------|
| Web framework | `fastapi`, `uvicorn[standard]` | ASGI API server |
| Validation | `pydantic`, `pydantic-settings`, `email-validator` | Models & config |
| Database | `asyncpg` | Direct PostgreSQL (primary data path) |
| Supabase | `supabase` SDK | **Auth + Storage only** |
| Auth | `PyJWT` | Local JWT (ES256) verification |
| Data processing | `pandas`, `openpyxl`, `xlrd`, `Pillow` | Excel/image parsing in ETL |
| HTTP | `httpx` | Shared HTTP/2 client (Supabase calls) |
| Resilience | `tenacity` | Retries |
| Logging | `structlog`, `python-json-logger` | Structured JSON logs |
| Config | `python-dotenv` | Env loading |
| AI (optional/unused) | `openai` | Kept for future remarks parsing; current parsing is keyword-based |
| Multipart | `python-multipart` | File uploads |

**Dev/test tooling (`pyproject.toml`):** `pytest`, `pytest-asyncio`, `pytest-cov`, `factory-boy`, `faker`, `respx`, `freezegun`, `ruff` (lint, line-length 100), `mypy` (strict, pydantic plugin). Build backend: `hatchling`.

### 2.3 Platform / DevOps tooling

| Tool | Purpose |
|------|---------|
| **Render** | Backend host (Docker, Frankfurt EU; free plan; health check `/api/v1/health`) — `render.yaml` |
| **Vercel** | Frontend host (zero-config Next.js) |
| **Supabase** | Postgres DB, Auth, Storage (project ref `hbyktxbyfgvemlamvpqp`) |
| **Supavisor** | Transaction-mode connection pooler (port 6543) |
| **GitHub** | Source control (`Astrochuks/PW_plant_management_system`) |
| **Docker** | Backend container (`backend/Dockerfile`) |
| **MCP (`.mcp.json`)** | Supabase MCP server wired for AI tooling |

---

## 3. System Architecture & Data Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                              USERS / ROLES                               │
│   admin  ·  management  ·  site_engineer        (Supabase Auth + JWT)    │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ HTTPS
                ┌───────────────▼────────────────┐
                │   FRONTEND  (Next.js 16 / Vercel)│
                │  App Router · React Query · Zustand
                │  Axios client + JWT interceptor  │
                │  silent-refresh mutex/circuit-brk │
                └───────────────┬────────────────┘
                                │  Bearer JWT, /api/v1/*
                ┌───────────────▼────────────────┐
                │   BACKEND  (FastAPI / Render)    │
                │  18 routers · services · workers │
                │  Local ES256 JWT verify + cache  │
                └──────┬───────────────────┬──────┘
                       │ asyncpg pool       │ Supabase SDK
                       │ (data CRUD/RPC)    │ (Auth + Storage)
            ┌──────────▼─────────┐  ┌───────▼──────────┐
            │  Supavisor :6543   │  │ Supabase Auth     │
            │  PostgreSQL        │  │ Supabase Storage  │
            │  (Supabase)        │  │  reports/documents│
            └────────────────────┘  └──────────────────┘
                       ▲
                       │ batch load
            ┌──────────┴──────────┐
            │  ETL (standalone)    │  Excel: weekly reports, legacy list,
            │  pandas/openpyxl     │  spare-parts tracking → DB tables
            └─────────────────────┘
```

**Authentication path:** Login → Supabase Auth issues `access_token` (ES256 JWT, ~1 h) + rotating `refresh_token` → frontend stores in `sessionStorage` → every request carries `Authorization: Bearer` → backend verifies JWT **locally** against cached JWKS (no Supabase round-trip on cache hit) → user record fetched via asyncpg + cached (TTL 300 s).

**Token refresh path:** Frontend uses a **global mutex + circuit breaker** (`silent-refresh.ts`) because Supabase rotates the refresh token on every use. Refresh is proactive (10 min before expiry), preflight (2 min before a request), reactive (on 401), and triggered on tab-focus / network-reconnect.

---

## 4. Frontend Inventory (`frontend/src`)

### 4.1 Structure
```
src/
├── app/            App Router pages (route groups: (dashboard), (site))
├── components/     UI primitives (shadcn) + feature components by domain
├── hooks/          ~30 files, 100+ React Query hooks
├── lib/api/        18 Axios API modules + client/silent-refresh/auth
├── lib/map/        Nigeria GeoJSON (state map)
├── providers/      Auth, Query, Theme, root composition
└── globals.css     Tailwind 4 entry
```

### 4.2 Pages / Routes
**Auth:** `/login`, `/access-denied`

**Dashboard group `(dashboard)`** (admin/management, sidebar+header layout):
- `/` dashboard (KPI cards, condition donut, fleet bar, Nigeria map, cost trend, events)
- `/plants` + `[id]`, `[id]/edit`, `create`
- `/projects` + `[id]`, `[id]/edit`, `create`
- `/locations` + `[id]`, `[id]/edit`, `create`
- `/spare-parts` + `create`, `analytics`, `price-catalog`, `repeat-purchases`, `pos`, `po/[poNumber]`
- `/suppliers` + `create`, `[id]`
- `/transfers`
- `/uploads` + `submissions/[id]`, `tokens`
- `/reports` + `fleet-summary`, `maintenance-costs`, `compliance`, `verification`, `trends`, `unverified`, `generate`, `export`
- `/notifications`, `/insights`, `/profile`
- `/admin/users` (+ `create`, `[id]/edit`), `/admin/states` (+ CRUD), `/admin/transfers`, `/admin/audit`

**Site engineer group `(site)`** (role `site_engineer`):
- `/site/dashboard`, `/site/report`, `/site/submissions`, `/site/transfers`

Total ~44 page files.

### 4.3 Components (65+)
- **UI primitives (24, shadcn "new-york" / radix):** button, input, textarea, select, label, form, card, separator, badge, progress, avatar, dialog, alert-dialog, popover, dropdown-menu, tooltip, command, table, tabs, skeleton, switch, sonner.
- **Feature domains:** `plants/` (table, 31 KB form, filters, detail modal, maintenance table, weekly usage chart, events feed, location history, stats cards, pagination), `projects/` (table, 26 KB form, filters, location link, milestone timeline, stats, import-award-letters dialog), `spare-parts/` (table, filters, detail modal, supplier combobox), `dashboard/` (KPI cards, filters, condition donut, fleet bar, cost trend, Nigeria geo map, print view), `locations/`, `admin/` (users table/form/filters), `transfers/`, `insights/`, `notifications/` (SSE bell), `site/`, `charts/`, `layout/` (dashboard-layout, sidebar, header).

### 4.4 API client layer (`lib/api/`)
- **`client.ts`** — Axios instance (`NEXT_PUBLIC_API_URL/api/v1`), request interceptor (Bearer + preflight refresh), response interceptor (401 retry, 503 exponential backoff, FastAPI error parsing).
- **`silent-refresh.ts`** — global refresh mutex + circuit breaker; deduplicates concurrent refreshes; broadcasts `auth:session-expired`.
- **`auth.ts`** — login/logout/getCurrentUser/changePassword + token-expiry helpers.
- **18 domain modules:** `plants`, `spare-parts` (largest, ~37 KB), `dashboard`, `projects`, `locations`, `suppliers`, `transfers`, `uploads`, `reports`, `site-report`, `audit`, `admin`, `notifications`, `insights`, `report-generator`.

### 4.5 Hooks (100+ across ~30 files)
Per domain: `use-plants`, `use-dashboard`, `use-spare-parts` (largest), `use-projects`, `use-locations`, `use-suppliers`, `use-transfers`, `use-uploads`, `use-reports`, `use-audit`, `use-insights`, `use-site-report`, `use-notifications`, `use-users`, `use-states`. Utilities: `use-event-stream` (SSE), `use-debounce`, `use-dashboard-filters` (Zustand), `use-url-filters`. All use React Query (staleTime 5 min default, gcTime 10 min, retry 1, refetchOnReconnect always).

### 4.6 Providers & state
- `auth-provider.tsx` — auth context, proactive refresh, visibility/online handlers, session-expired routing.
- `query-provider.tsx` — React Query config + devtools.
- `theme-provider.tsx` — next-themes, per-tab isolation (`pw-theme`).
- **Zustand:** single store `useDashboardFilters` (locationId, stateId, fleetType, year). Server state lives in React Query; no Redux.

### 4.7 Frontend config & env
- `next.config.ts` — minimal. `tsconfig` — strict, `@/*` → `src/*`. `components.json` — shadcn new-york, lucide, neutral base. `postcss.config.mjs` — Tailwind 4.
- **Env:** `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`.

---

## 5. Backend Inventory (`backend/app`)

### 5.1 Structure
```
app/
├── api/v1/        18 routers + router.py aggregator
├── core/          pool, security, database, cache, exceptions, events
├── services/      auth, audit, transfer, insights, preview, remarks_parser,
│                  fleet_parser, award_letters_parser, file_metadata_extractor
├── models/        plant, project, common, upload (Pydantic)
├── workers/       etl_worker.py (async weekly-report / PO processing)
├── monitoring/    logging, metrics
├── main.py        app setup, CORS, middleware, exception handlers, lifespan
└── config.py      pydantic-settings
```

### 5.2 Core infrastructure (`app/core`)
- **`pool.py`** — asyncpg pool to Supavisor:6543; helpers `fetch/fetchrow/fetchval/execute/executemany`; JSON/JSONB codecs; `statement_cache_size=0` (required for transaction-mode pooling); `DatabaseUnavailableError` handling.
- **`security.py`** — local ES256 JWT verification via Supabase JWKS; `CurrentUser` model; `get_current_user()`, `require_admin()`, `require_management_or_admin()`; user cache (TTL 300 s) + `invalidate_user_cache()`.
- **`database.py`** — Supabase client init (anon + service-role); shared httpx HTTP/2 client; configurable PostgREST/Storage/Function timeouts. Used for Auth + Storage only.
- **`cache.py`** — caching utilities. **`exceptions.py`** — exception hierarchy mapped to HTTP codes (401/403/404/409/422/429/502/503). **`events.py`** — broadcast for real-time updates (SSE).

### 5.3 Services
| Service | Role |
|---------|------|
| `auth_service` | Rate limiting (5 fails → 15 min lockout), login attempt + auth event logging, lockout management |
| `audit_service` | CRUD/admin action audit trail (old/new values, IP, description) |
| `transfer_service` | Plant location transfer lifecycle (pending/confirm/reject/cancel) |
| `insights_service` | Analytics: utilisation, costs, fleet distribution, trends |
| `preview_service` | Keyword condition detection, transfer detection from remarks, location fuzzy-match, hours/off-hire parsing |
| `remarks_parser` | Batch keyword-based remarks → condition/anomalies (no AI currently) |
| `fleet_parser` | Excel fleet metadata extraction & normalisation |
| `award_letters_parser` | Award-letter PDF parsing → equipment lists |
| `file_metadata_extractor` | Auto-detect location/week + preview sample data from uploads |

### 5.4 API endpoints (~180 across 18 routers, prefix `/api/v1`)
- **auth** — login, refresh, logout, me (GET/PATCH), change-password, skip-password-change; admin user CRUD + reset-password; auth events, login-attempts, lockouts (+unlock).
- **health** — `/health`, `/detailed`, `/ready`, `/live`.
- **plants** — CRUD, by-fleet, transfer, maintenance-history, location-history, weekly-records, events, usage; analytics (search, stats, filtered-stats, usage summary/breakdowns, utilization, purchase-years, events, acknowledge); exports (excel, fleet-types).
- **locations** — CRUD + plants, usage, weekly-records, submissions.
- **states** — CRUD + plants, sites.
- **fleet-types** — CRUD + plants.
- **spare-parts** — CRUD, by-po (GET/PATCH), draft workflow (get/submit/rows CRUD/batch), bulk, pos list, PO document (GET/POST/DELETE); analytics (by-period, repeat-purchases [+detail], year-over-year, price-catalog).
- **suppliers** — CRUD + pos.
- **transfers** — pending, confirm/reject/cancel, get, incoming, pull-request(s).
- **uploads** — public token uploads (weekly-report, purchase-order, status); admin uploads + preview/confirm/rebuild-timeline; submission management; token generate/list.
- **public_upload** — public HTML upload form (`/upload`).
- **reports** — generate, exports, weekly-brief, weekly-trend, top-sites, top-suppliers, maintenance-costs, high-cost-plants, plant-movement, unverified-plants, verification-status, recently-purchased.
- **audit** — logs, per-record history, submission export/records, submission-compliance.
- **insights** — dashboard/summary, analytics by-period, fleet-summary/distribution, states-summary, site-requests, plant/location costs, shared-costs.
- **site_report** — entry, generate, upload page, submissions (+ weekly, export).
- **events** — list, stream (SSE).
- **notifications** — list, unread-count, mark-all-read, mark read, delete.
- **projects** — CRUD + milestones.

### 5.5 Models (Pydantic)
- `plant.py` — `PlantBase/Create/Update/Plant`; condition enum (working|standby|under_repair|breakdown|faulty|scrap|missing|off_hire|gpm_assessment|unverified); division (mining|civil|null).
- `project.py`, `upload.py` (UploadResponse/Status: pending|processing|completed|failed|partial), `common.py`.

### 5.6 Workers / background jobs (`workers/etl_worker.py`)
- `process_weekly_report(job_id, storage_path, location_id)` — download from Storage, parse Excel, map columns, normalise fleet numbers, update `plants_master`, write `plant_weekly_records`, create `plant_transfers`, set submission status.
- `process_purchase_order(job_id, storage_path)` — parse PO, extract parts + costs, link suppliers.
- `save_confirmed_weekly_report(...)` — chunked batch insert + timeline rebuild + transfer confirmation.
- `rebuild_location_timeline(plant_ids)` — recompute `plant_location_history`, detect transfers.
- `cleanup_submission_data(submission_id)` — reset for reprocessing.

### 5.7 App setup (`main.py`)
- Lifespan: init asyncpg pool (with retries) + metrics flush task on startup; cancel/flush/close on shutdown.
- CORS: origins from `CORS_ORIGINS`; methods GET/POST/PUT/PATCH/DELETE/OPTIONS; max_age 3600.
- Middleware: `AlertingMiddleware` (10 errors / 60 s threshold), `RequestLoggingMiddleware`.
- Exception handlers: `AppException` → structured JSON + request_id; `DatabaseUnavailableError` → 503 + Retry-After; generic → 500.
- Routers mounted at `/api/v1`; public upload at `/upload`.

### 5.8 Backend config / env vars
**Required:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`.
**Optional/tuning:** `SUPABASE_JWT_SECRET`, `ENVIRONMENT`, `DEBUG`, `API_TITLE/VERSION/PREFIX`, `CORS_ORIGINS`, `TRUST_PROXY`, `USER_CACHE_TTL_SECONDS`, `SUPABASE_*_TIMEOUT`, `RATE_LIMIT_*`, `MAX_UPLOAD_SIZE_MB`, `ALLOWED_UPLOAD_EXTENSIONS`, `LOG_LEVEL/LOG_TO_DATABASE/LOG_SAMPLE_RATE`, `JOB_MAX_RETRIES/JOB_RETRY_DELAY_SECONDS`, `METRICS_ENABLED/METRICS_FLUSH_INTERVAL_SECONDS`, `OPENAI_API_KEY`.

### 5.9 Tests (`backend/tests`)
`test_auth.py`, `test_etl_worker.py`, `test_health.py`, `test_plants.py`, `conftest.py`. pytest asyncio mode auto, coverage on `app`. (e2e/integration/unit dirs scaffolded, currently empty.)

---

## 6. Database Inventory (Supabase PostgreSQL)

### 6.1 Connection
Direct asyncpg pool → Supavisor transaction pooler (port 6543) → PostgreSQL. All SELECT/INSERT/UPDATE/DELETE and all RPC calls go this route (~200 operations across the backend). Supabase SDK touches DB only for Auth and Storage.

### 6.2 Core tables (~14)
| Table | Purpose / key columns | ~Rows |
|-------|----------------------|------|
| `plants_master` | Live plant state; fleet_number (unique), description, fleet_type, make/model, chassis, year/cost, current_location_id, **condition** (active), status (legacy/stale), physical_verification, division, pending_transfer_to_id | ~1,599 |
| `archived_plants` | Legacy pre-report plants; + fleet_type_source, serials, raw_data JSONB, cleaning_notes | ~478 |
| `plant_location_history` | Movement spans; plant_id, location_id, start/end_date, transfer_reason | ~1,584 |
| `plant_weekly_records` | Immutable weekly snapshots; hours_worked/standby/breakdown, off_hire, transfer_from/to, remarks | ~1,732 |
| `weekly_report_submissions` | Upload tracking + processing counts/status | ETL-filled |
| `purchase_order_submissions` | PO upload tracking | — |
| `spare_parts` | Parts/maintenance spend; PO number/date, part, supplier, qty, unit_cost, VAT/discount/other, **total_cost** (generated), **currency**, **fx_rate_to_ngn**, **total_cost_ngn** (generated), cost_type (direct/shared), is_workshop/is_category, shared_fleet_numbers[], fleet_number_raw | ~458 |
| `suppliers` | Vendor master; name, name_normalized, contacts, is_active | — |
| `locations` | 27 sites; name (unique, uppercase), state_id | 27 |
| `states` | Nigerian states; name, code | 37 |
| `fleet_types` | Fleet type master (DOZERS, EXCAVATORS, …) | — |
| `fleet_number_prefixes` | Prefix → fleet type map (AC, EG, WP, …) | 78 |
| `projects` | Construction/contract register; contract sums, award/commencement/completion/maintenance dates, vetted/certified, payments, outstanding, cost_to_date, status, state_id | — |
| `users` | System users (auth mirror); email, name, role | 2 |

**Plus auth/operational tables** referenced by services: `upload_tokens`, `login_attempts`, auth-events/lockouts, `audit_logs`, `notifications`, `insights`, `plant_transfers`, `plant_events`.

### 6.3 Projects Module v1 — 11 operational tables (migration 007, 2026-05-08)
All FK to `projects` + `project_weekly_reports` with cascade delete:
`project_weekly_reports` (header), `project_plant_utilization`, `project_diesel_consumption` (Sat–Fri + generated total), `project_certificates` (state machine), `project_payments`, `project_cost_report` (generated to-date), `project_labour_strength`, `project_subcontractors`, `project_materials_stock` (precast/materials), `project_hired_vehicles`, `project_documents` (Storage index). Schema complete; ETL feed pending. BEME line-items deferred to v2 (`beme_pct_complete` captured on header only).

### 6.4 Views
| View | Aggregates |
|------|-----------|
| `v_plants_summary` | plants_master + locations + states (27+ fields incl. total_maintenance_cost, parts_replaced_count) |
| `v_purchase_orders_summary` | per-PO totals incl. NGN equivalents (total_amount_ngn, subtotal_ngn, currency, fx_rate), location_id |
| `v_supplier_stats` | per-supplier total_spend / total_spend_ngn, items_count, po_count |
| `v_location_stats` | per-location condition breakdown (under_repair, missing, scrap, gpm_assessment) |

### 6.5 RPC functions (~8+ analytical)
`get_filtered_plant_stats` (dynamic dashboard filtering incl. division), `get_top_suppliers`, `get_high_cost_plants`, `get_spare_parts_stats`, `get_plant_costs_by_period`, `get_maintenance_cost_analysis` (text + varchar overloads, dynamic group_by), `get_plant_shared_costs` (JSONB items w/ currency), `search_plants` (ts_rank full-text), plus `get_plant_maintenance_history`. All cost RPCs aggregate on `total_cost_ngn`.

### 6.6 Migrations (`backend/migrations`, 001–007)
1. `001` — add `division` to plants_master (mining/civil).
2. `002` — division filter in `get_filtered_plant_stats`.
3. `003` — multi-currency on spare_parts (currency, fx_rate_to_ngn frozen at entry, total_cost_ngn generated).
4. `004` — expose `*_ngn` totals in `v_purchase_orders_summary` + `v_supplier_stats`.
5. `005` — switch 7 cost functions to `total_cost_ngn`.
6. `006` — `get_plant_shared_costs` → NGN + per-item currency in JSON.
7. `007` — Projects Module v1: 11 operational tables.

### 6.7 Storage buckets
- **`reports`** — weekly reports & POs (`weekly-reports/{location}/{week}/...`, `purchase-orders/...`).
- **`documents`** — spare-parts PDFs / PO receipts (public).
- **`projects`** (planned) — award letters / certs for the projects module.

---

## 7. ETL Pipeline (`/etl`, root scripts)

**Entry points:** `run_etl.py` (CLI: `--clear`, `--dry-run`, `--debug`), `etl/pipeline.py` (orchestrator), `clean_data_v2.py`, `clean_spare_parts.py`, `fix_physical_verification.py`.

**Phases:**
1. **Extract** — `WeeklyReportExtractor` (from `new plants/*.xlsx`), `LegacyPlantExtractor` (`Plant List 2021.xlsx`), `SparePartsExtractor` (`PlantandEquipmentSparePartsTracking.xlsx`, one sheet per fleet; ditto-mark resolution).
2. **Validate** — `PlantValidator`, `SparePartValidator` (uniqueness, required fields, dates).
3. **Load plants** — upsert with merge precedence Current > Legacy > existing DB; auto-create locations/fleet_types; update `plant_location_history`.
4. **Create plants for orphan parts** — auto-create plant rows for parts without a matching fleet.
5. **Load spare parts** — batch insert; DB triggers derive year/month/week/quarter/cost_type; compute `total_cost_ngn`.

**Inputs:** `Plant List 2021.xlsx` (legacy), `PlantandEquipmentSparePartsTracking.xlsx`, `new plants/` weekly files.
**Outputs:** `plants_master`, `plant_weekly_records`, `plant_location_history`, `spare_parts`, `locations`, `fleet_types`, `weekly_report_submissions`.

**Helpers (`etl/cleaners.py`):** normalize_fleet_number, normalize_location, parse_date, clean_cost, clean_quantity, parse_week_ending_date, extract_fleet_from_sheet_name.

**Two ETL modes coexist:** (a) the standalone batch pipeline above for bulk/historical loads, and (b) the in-app async `etl_worker.py` triggered by file uploads through the API.

---

## 8. Deployment & Environments

| Component | Host | Config | Notes |
|-----------|------|--------|-------|
| Backend | Render | `render.yaml` (Docker, Frankfurt, free) | Health `/api/v1/health`; secrets set in dashboard (`sync: false`) |
| Frontend | Vercel | zero-config Next.js | `NEXT_PUBLIC_API_URL` → backend |
| DB/Auth/Storage | Supabase | project `hbyktxbyfgvemlamvpqp` | Supavisor :6543 |
| CI/source | GitHub | — | `Astrochuks/PW_plant_management_system` |

CORS_ORIGINS accepts a JSON array or comma-separated list and is set manually in Render.

---

## 9. Cross-Layer Linkage Map

| Frontend artefact | → Backend endpoint | → DB object |
|-------------------|--------------------|--------------|
| `use-plants` / `lib/api/plants.ts` | `/plants/*` | `plants_master`, `v_plants_summary`, `search_plants`, `get_filtered_plant_stats` |
| `use-spare-parts` | `/spare-parts/*` | `spare_parts`, `v_purchase_orders_summary`, `get_spare_parts_stats`, `get_top_suppliers`, `get_high_cost_plants` |
| `use-dashboard` | `/insights`, `/reports`, `/plants/stats` | `v_location_stats`, `get_filtered_plant_stats`, `states` |
| `use-uploads` / `use-site-report` | `/uploads/*`, `/site/*` | `weekly_report_submissions`, `plant_weekly_records` (via `etl_worker`) |
| `use-projects` | `/projects/*` | `projects` (+ 11 v1 tables, pending feed) |
| `use-transfers` | `/transfers/*` | `plant_transfers`, `plant_location_history` (via `transfer_service`) |
| `use-audit` / `use-notifications` / `use-event-stream` | `/audit/*`, `/notifications/*`, `/events/stream` | `audit_logs`, `notifications`, `plant_events` (SSE) |
| `auth-provider` + `silent-refresh` | `/auth/*` | Supabase Auth + `users`, `login_attempts`, lockouts |

---

## 10. Security & Auth Posture

- **JWT:** ES256, verified locally against Supabase JWKS — no Supabase call on cache hit. User record cached (TTL 300 s).
- **Roles:** `admin`, `management`, `site_engineer` — enforced backend (`require_admin` / `require_management_or_admin`) and frontend (route groups + `ProtectedRoute`).
- **Rate limiting / lockout:** 5 failed logins → 15-min lockout; full login-attempt + auth-event audit.
- **Audit trail:** all CRUD + admin actions logged with old/new values, IP, actor.
- **Upload tokens:** scoped public upload tokens (location + types + expiry) for site staff without accounts.

### ⚠️ Audit findings to remediate
1. **Secrets in repo.** `.mcp.json` contains a live Supabase access token (`sbp_...`) in plaintext, and a root `.env` holds `SUPABASE_*` keys including `SERVICE_ROLE_KEY` and `DATABASE_URL`. Confirm these are git-ignored / rotate the exposed MCP token and service-role key. **Treat the committed token as compromised and rotate.**
2. **`status` vs `condition` on `plants_master`.** `status` is stale/legacy; `condition` is the live column updated by the weekly ETL. All current views/RPCs use `condition` — new queries must too.
3. **Empty test scaffolds.** `tests/{e2e,integration,unit}` exist but are empty; only 4 backend test modules carry coverage. Frontend has no test harness.
4. **Projects v1 tables have no ETL feed yet** — 11 tables defined but unpopulated; BEME line-items deferred to v2.
5. **OpenAI dependency unused** — `openai` is installed and keyed but remarks parsing is keyword-based; either wire it up or drop the dependency/key to reduce surface area.

---

## 11. Inventory Totals

| Metric | Count |
|--------|-------|
| Backend routers | 18 |
| Backend API endpoints | ~180 |
| Backend services | 9 |
| Backend core modules | 6 |
| Frontend pages | ~44 |
| Frontend components | 65+ (24 UI primitives) |
| Frontend hooks | 100+ (~30 files) |
| Frontend API modules | 18 |
| Core DB tables | ~14 (+ 11 projects v1 + auth/ops tables) |
| DB views | 4 |
| DB RPC functions | 8+ |
| DB migrations | 7 (001–007) |
| ETL extractors | 3 |
| Storage buckets | 2 active (+1 planned) |
| Roles | 3 (admin, management, site_engineer) |
| Frontend prod deps | 26 |
| Backend deps | ~18 |

---

*End of audit — 27 June 2026.*
