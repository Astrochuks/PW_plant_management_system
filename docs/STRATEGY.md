# Plant Management System — Strategy & Architecture

> Last updated: 2026-04-08
> Status: Working draft — refine as we go

---

## 1. What This System Is (The Real Business Problem)

**P.W. Nigeria Ltd.** is a construction/civil engineering company operating across Nigerian states with a fleet of plants/equipment (excavators, dozers, trucks, generators, etc.) deployed to multiple project sites. They need to:

1. **Track every plant** — where it is, what condition it's in, who's using it
2. **Track every project** — contract value, milestones, payments, completion status
3. **Track maintenance costs** — spare parts, suppliers, costs per plant/project
4. **Process weekly reports** from each site (Excel files) showing plant status and movements
5. **Process award letters and project documents** to maintain a project registry
6. **Detect plant transfers** when equipment moves between sites
7. **Generate insights** for management decisions

The system replaces a manual Excel-based workflow that was slow, error-prone, and didn't scale.

---

## 2. Core Modules & How They Connect

```
┌─────────────────────────────────────────────────────────────┐
│                       USERS                                  │
│  Admin │ Management │ Site Engineer (location-scoped)        │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                    INPUTS (Data Sources)                     │
├─────────────────────────────────────────────────────────────┤
│ Weekly Reports (Excel) → ETL → plants_master, weekly_records│
│ Award Letters (Excel) → Parser → projects                   │
│ Purchase Orders (PDF/Manual) → spare_parts                  │
│ Site Engineer drafts → direct entry → weekly_records        │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                  CORE ENTITIES (Database)                    │
├─────────────────────────────────────────────────────────────┤
│ plants_master ←── plant_weekly_records ──→ locations        │
│       ↓                  ↓                       ↑          │
│ plant_transfers   plant_location_history    states          │
│       ↓                  ↓                       ↑          │
│ spare_parts ──→ suppliers                  projects         │
│       ↓                                          ↑          │
│ plant_events (audit log)              ←── linked            │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                  OUTPUTS (User-Facing)                       │
├─────────────────────────────────────────────────────────────┤
│ Dashboard │ Plant List │ Plant Detail │ Sites │ Projects   │
│ Reports │ Spare Parts │ Transfers │ Insights │ Notifications│
└─────────────────────────────────────────────────────────────┘
```

### Module Relationships

| Module | Owns | Reads From | Writes To | Key Pain Points |
|---|---|---|---|---|
| **Plants** | plants_master | weekly_records, transfers, locations | weekly_records, transfers, location_history, events | Condition derivation, transfer detection |
| **Weekly Reports** | weekly_report_submissions | plants_master, locations | plants_master, weekly_records, transfers, events | Inconsistent column headers, fleet number normalization |
| **Transfers** | plant_transfers | plants_master, locations | plants_master, location_history | Pending → confirmed flow, location resolution |
| **Projects** | projects | states, locations | linked_locations | Award letter parsing, no plant/spare parts link |
| **Locations/Sites** | locations | states, plants_master | linked to projects | Aliases for fuzzy matching |
| **Spare Parts** | spare_parts | plants_master, suppliers | maintenance costs | PO document storage, shared parts allocation |
| **Reports/Analytics** | (read-only) | all entities | (none) | Complex aggregations |
| **Auth** | users, auth_events | (Supabase Auth) | audit_logs | Pool dependency |

---

## 3. Architecture (Current State)

### Backend
- **FastAPI** (async Python 3.11)
- **asyncpg** direct PostgreSQL connection via Supavisor pooler (port 6543)
- **Supabase** for Auth + Storage only (NOT for DB queries — bypassed PostgREST)
- **In-memory** event bus, cache, metrics (single-process)
- **Background ETL worker** for file processing
- **Pydantic v2** for validation

### Frontend
- **Next.js 16** App Router + **React 19**
- **React Query** for data fetching (5min stale, 10min gc)
- **Tailwind 4** + **shadcn/ui** components
- **Axios** with interceptors for auth + retry
- **SSE** for real-time updates
- **Per-tab session isolation** (sessionStorage, not localStorage)

### Database
- **PostgreSQL** (Supabase-managed)
- **20+ tables**, **4+ views**, **10+ RPC functions**
- All accessed via asyncpg with parameterized queries
- JSON/JSONB columns for flexible data (components, parsed remarks)

### Deployment
- **Backend → Render** (Docker, Frankfurt, free tier)
- **Frontend → Vercel** (free)
- **DB → Supabase** (free tier)

### What Architecture We Are NOT Using
- ❌ ORM (SQLAlchemy, Tortoise) — direct SQL is faster
- ❌ Redis (event bus is in-memory — won't scale to multiple instances)
- ❌ Celery/RQ task queue (background tasks are in-process)
- ❌ Migration tool (Alembic) — manual SQL migrations in `backend/migrations/`
- ❌ AI/LLM (remarks parsing is keyword-based)
- ❌ Tests (NONE — biggest risk)

---

## 4. What Features We Have

### ✅ Working Well
- Plant CRUD with 22+ endpoints, filtering, sorting, pagination, export
- Weekly report ETL (Excel parsing with auto-detect headers)
- Site engineer direct entry (draft system, batch save)
- Project CRUD + award letter bulk import
- Spare parts CRUD with PO grouping, supplier tracking, cost analytics
- Location/site management with state grouping
- Real-time SSE updates
- Role-based access (admin, management, site_engineer)
- Audit logging
- Notification system
- Token refresh with mutex (no "Already Used" errors)
- Per-tab auth isolation
- Pool auto-recovery (no logout on DB blip)

### ⚠️ Partially Working / Has Bugs
- **Transfer detection** — works on chronological uploads, broken on out-of-order uploads (fixed)
- **Plant location history** — was incremental, now rebuilt from weekly records (fixed)
- **Movement events** — were missing, now generated from weekly records (fixed)
- **Award letter parsing** — handles narrative text but loses data on edge cases
- **Physical verification** — defaults to true if column empty (inflated rates)
- **Previous week remarks carryover** — uses stale data without flagging
- **Location conflicts** — silently dropped instead of recorded
- **Unresolved transfer locations** — created with NULL location_id, stuck forever

### ❌ Missing Entirely
- **Tests** (no unit, integration, or e2e tests)
- **CI/CD** pipeline
- **Plant ↔ Project link** (no way to know which plants are on which project)
- **Spare parts ↔ Project link** (no per-project cost rollup)
- **Award letter document storage** (only boolean flag)
- **Frontend Error Boundaries** (white screen on crash)
- **Form unsaved warning** (lose data on navigation)
- **Migration management** (manual SQL)
- **Monitoring/alerting** (no Sentry or similar)
- **Backup/restore strategy**

---

## 5. What We Want To Build (Vision)

### Phase 1 — Core Stability (CURRENT)
- ✅ Fix transfer/events/sites timeline
- ✅ Fix pool crash logouts
- ✅ Fix division/exclusion filters
- ✅ Remove dead code (Gemini)
- 🚧 Re-investigate weekly reports
- 🚧 Improve award letter parser
- ⏳ Add tests (unit + integration for ETL)
- ⏳ Add CI pipeline (lint + test on push)
- ⏳ Frontend Error Boundaries

### Phase 2 — Project Lifecycle
- Plant → Project allocation (which plants on which project, when)
- Spare parts → Project rollup (cost per project)
- Award letter document upload (PDF storage in Supabase)
- Project milestone notifications (overdue alerts)
- Project budget vs actual variance
- Soft delete for projects (audit trail)

### Phase 3 — Operational Intelligence
- Dashboard insights (AI-generated weekly briefing)
- Maintenance prediction (recurring breakdowns flag)
- Site compliance tracking (which sites submit reports on time)
- Fleet utilization analytics (idle time, hours/week trends)
- Cost-per-hour analysis

### Phase 4 — Production Hardening
- Migration tooling (Alembic)
- Sentry error tracking
- Database backup automation
- Multi-instance scaling (extract event bus to Redis)
- Load testing
- Penetration testing

---

## 6. Testing Strategy (CRITICAL — currently zero tests)

### Test Pyramid

```
                    ┌──────┐
                    │ E2E  │  ← 5-10 critical user flows
                    └──┬───┘     (Playwright)
                       │
                ┌──────┴───────┐
                │ Integration  │  ← 30-50 tests
                │   API tests  │     (pytest + httpx)
                └──────┬───────┘
                       │
              ┌────────┴────────┐
              │      Unit       │  ← 100-200 tests
              │  Pure functions │     (pytest)
              └─────────────────┘
```

### Unit Tests (Highest priority)
**What to test:**
- `remarks_parser.fallback_parse()` — keyword detection logic
- `award_letters_parser.parse_free_text_date()` — handles all date formats
- `award_letters_parser.parse_contract_sum()` — handles narrative amounts
- `award_letters_parser.parse_amount()` — handles "74m", "100,042 NGN", etc.
- ETL `_normalize_fleet_number()` — strips spaces correctly
- ETL `_resolve_state_for_row()` — sheet → state mapping
- `derive_condition()` — combines hours + AI parsing + off_hire
- `transfer_service.resolve_location()` — alias lookup
- Pool helpers `_record_to_dict()` — UUID/Decimal/datetime conversion
- Auth `_verify_token_locally()` — JWT verification

**Where:** `backend/tests/unit/`
**Tool:** pytest

### Integration Tests (API level)
**What to test:**
- Login flow (email → token → /auth/me works)
- Plant CRUD lifecycle (create → list → update → delete)
- Filter combinations (condition + state + division)
- Pagination correctness (page 2 returns different data)
- Export with filters (Excel matches list)
- Weekly report upload end-to-end (file → parse → DB rows)
- Transfer creation → confirmation flow
- Pool recovery (kill connection, retry succeeds)
- Auth: expired token → refresh → retry
- Auth: invalid token → 401, NOT logged out

**Where:** `backend/tests/integration/`
**Tool:** pytest + httpx + test database

### E2E Tests (Critical user journeys)
1. **Login → Dashboard loads** (under 5s after first paint)
2. **Upload weekly report → ETL completes → plant updated**
3. **Site engineer submits draft → admin sees it**
4. **Create project → link to location → see in detail page**
5. **Filter plants by mining + Abuja → export Excel → matches**
6. **Spare part PO with 5 plants → cost split correctly**
7. **Plant transfer detection (out-of-order uploads)**
8. **Pool crash → user stays logged in → recovers**

**Where:** `frontend/tests/e2e/`
**Tool:** Playwright

### Test Data
- Use real sample files from `new plants/` and `project files/` directories
- Snapshot expected outputs (golden files)
- Seed test database with anonymized real data

---

## 7. CI/CD Strategy

### CI Pipeline (GitHub Actions)
**On every push/PR:**
```yaml
1. Lint backend (ruff)
2. Type check backend (mypy)
3. Unit tests backend (pytest)
4. Lint frontend (eslint)
5. Type check frontend (tsc --noEmit)
6. Integration tests (pytest with test DB)
7. Build frontend (next build)
8. Build Docker image (don't push)
```

**On merge to main:**
```yaml
1. All of above
2. E2E tests (Playwright)
3. Auto-deploy to staging
4. Smoke tests on staging
5. Manual approval → deploy to production
```

### CD Pipeline
- **Frontend → Vercel** (auto-deploys on main push, already configured)
- **Backend → Render** (auto-deploys on main push, needs to be enabled)
- **Database migrations → manual** (run via Supabase SQL editor or MCP)

### Branch Strategy
- `main` — production (always deployable)
- Feature branches → PR → review → merge
- No direct commits to main

---

## 8. Worst-Case Scenarios & Graceful Degradation

| Failure | Current Behavior | Desired Behavior |
|---|---|---|
| **DB pool dies** | ✅ Auto-recovery, frontend retries 503s, expired cache used for auth | (Done) |
| **Supabase Auth API down** | Login fails completely | Show clear error, allow retry |
| **ETL crashes mid-upload** | Submission marked failed, but partial data may be in DB | Wrap in transaction, rollback on failure |
| **Excel file has bad encoding** | Parser may crash | Catch + log + return partial results |
| **Excel column missing** | KeyError | Default to None, log warning |
| **Plant has 1000+ weekly records** | rebuild_location_timeline could be slow | Add LIMIT or batch processing |
| **AI provider rate limited** | N/A (we don't use AI) | — |
| **User uploads 50MB file** | OOM crash | Reject before processing (config max_size) |
| **Two admins edit same plant** | Last write wins, no warning | Optimistic locking with `updated_at` check |
| **Concurrent token refresh** | ✅ Mutex prevents race | (Done) |
| **Render free tier cold start** | 30-60s wait | ✅ Healthcheck start-period 120s (Done) |
| **Vercel function timeout (10s)** | Frontend stays loading forever | Set apiClient timeout to 30s, show retry button |
| **Backend deploys mid-request** | Request fails | Frontend retries with 503 handling |
| **Site engineer offline** | Can't submit | Local draft (already exists), syncs when back online |
| **Bad migration** | DB inconsistent | Always run migrations in transaction, test on staging first |
| **Lost JWT secret** | All sessions invalidated | Document secret rotation procedure |
| **Supabase free tier exceeds limits** | Random failures | Monitor usage, plan upgrade |

---

## 9. Error Handling Philosophy

### Backend
1. **All inputs validated** at API boundary (Pydantic)
2. **Domain errors** as `AppException` subclasses (404, 409, 422 etc.)
3. **Pool errors** as `DatabaseUnavailableError` → 503
4. **Unexpected errors** caught by global handler → 500 with request_id
5. **Always log** with structured context (request_id, user_id, action)
6. **Never** swallow exceptions silently — log at minimum

### Frontend
1. **Error Boundaries** at root, page, and component level (TODO)
2. **Toast notifications** for user-facing errors
3. **Retry logic** for 503/network errors
4. **Form validation** before submit (Zod schemas)
5. **Loading states** for every async operation
6. **Empty states** for missing data (not just blank screens)

### ETL
1. **Wrap each row** in try/except — bad row doesn't fail whole batch
2. **Track errors** in submission record (errors_count, error_details JSONB)
3. **Status states**: pending → processing → completed | failed | partial
4. **Idempotent** — re-running same upload should produce same result
5. **Atomic where possible** — use savepoints

---

## 10. Files I've Already Inspected (Sample Data)

I have access to:
- ✅ `project files/Copy of Award letters Completion Certs.2017 (1).xlsx` — 17 sheets, multi-state, has free-text dates and contract sums
- ✅ `new plants/ABUJA WEEK 4.xlsx` — sample weekly report (674 rows, 15 cols, header on row 4)
- ✅ All other `new plants/*.xlsx` weekly reports for 28 sites
- ✅ `purchase-orders/*.pdf` — PO documents
- ✅ `project files/Week 09 Weekly Progress Report-...xlsx` — different format (project progress, not weekly plant returns)
- ✅ `Plant List 2021.xlsx` — historical plant register

I've confirmed the structures are consistent enough to work with. Specific issues:
- Weekly reports: header detection works (row 4 typically), fleet number normalization needed (e.g., "AC 10" → "AC10")
- Award letters: 17 sheet workbook, mix of state-named and client-named sheets, narrative text in date/amount columns

---

## 11. Open Questions for User

1. **Plant ↔ Project link** — should plants be assigned to projects? Or is location the proxy for project?
2. **Award letter PDFs** — do you want to upload original PDFs and link them to project records?
3. **Spare parts per project** — should spare parts be tagged with a project_id for cost rollup?
4. **Site engineer permissions** — should they only see their own location, or also projects at their location?
5. **Multi-tenancy** — is this single-company (P.W. Nigeria only) or multi-tenant in future?
6. **Backup frequency** — daily? weekly? Where stored?
7. **Test data** — can I use anonymized real data, or do you need synthetic?
8. **Notification channels** — in-app only, or also email/SMS?

---

## 12. Immediate Next Steps (Recommended Order)

1. **Re-investigate weekly reports** — verify the new rebuild functions work correctly with real data
2. **Improve award letter parser** — fix the cleaning issues you mentioned (which specific issues? need examples)
3. **Add unit tests** for ETL parsers (highest risk, no current safety net)
4. **Add Error Boundaries** to frontend (prevents white screens)
5. **Set up CI pipeline** (GitHub Actions: lint + tests on push)
6. **Plant ↔ Project link** (start with simple `project_id` FK on plants)
7. **Migration tooling** (Alembic, so DB changes are versioned)

We should NOT try to do all of this at once. Pick 1-2 per session.
