# PW Central Reporting System - Architecture & Technical Documentation

> **Version:** 2.0
> **Last Updated:** 2026-03-05
> **Status:** Production

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Technology Stack](#2-technology-stack)
3. [System Architecture](#3-system-architecture)
4. [Backend Architecture](#4-backend-architecture)
5. [Frontend Architecture](#5-frontend-architecture)
6. [Database Architecture](#6-database-architecture)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [Real-Time Data Sync (SSE)](#8-real-time-data-sync-sse)
9. [ETL & Data Pipeline](#9-etl--data-pipeline)
10. [AI Integration](#10-ai-integration)
11. [File Storage](#11-file-storage)
12. [Observability & Monitoring](#12-observability--monitoring)
13. [Deployment & Infrastructure](#13-deployment--infrastructure)
14. [API Reference](#14-api-reference)
15. [Scaling Strategy](#15-scaling-strategy)
16. [Key Design Decisions](#16-key-design-decisions)

---

## 1. System Overview

### What It Does

A **Central Reporting System** built for **P.W Nigeria Limited** — a construction and infrastructure company operating across 27+ project sites nationwide. Originally focused on plant and equipment management, the system has evolved into a comprehensive operational platform that centralises reporting, asset tracking, procurement, and project intelligence. The system handles:

- **Plant & equipment management** — 2,000+ plants with real-time location and condition monitoring across all sites
- **Weekly reporting** — Site engineers upload Excel reports; ETL pipeline parses, validates, and imports data
- **Transfer management** — Track equipment movements between sites with approval workflows
- **Spare parts & procurement** — Purchase order tracking, supplier management, cost analytics
- **Project management** — Award letters import, contract tracking, legacy project data (FERMA, state, and federal contracts)
- **Fleet Intelligence** — AI-powered insights engine for operational analytics
- **Site engineer portal** — Dedicated interface for field officers to submit reports and manage site-level operations
- **Audit trails** — Full change history for compliance

### User Roles

| Role | Access | Description |
|------|--------|-------------|
| `admin` | Full system | Manage users, upload reports, approve transfers, view all data |
| `management` | Read + limited write | View dashboards, reports, analytics across all sites |
| `site_engineer` | Site-scoped | Upload weekly reports, request transfers, view own site data |

---

## 2. Technology Stack

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| **Python** | 3.11+ | Runtime |
| **FastAPI** | >= 0.109 | REST API framework (async, auto-docs) |
| **Uvicorn** | >= 0.27 | ASGI server |
| **asyncpg** | >= 0.29 | Direct PostgreSQL driver (binary protocol, 1-5ms queries) |
| **Pydantic** | >= 2.5 | Request/response validation |
| **Pandas** | >= 2.0 | Excel parsing and data transformation |
| **openpyxl** | >= 3.1 | Excel file reading |
| **PyJWT** | >= 2.8 | Local JWT verification (ES256 via JWKS) |
| **structlog** | >= 24.1 | Structured JSON logging |
| **httpx** | >= 0.26 | Async HTTP client |
| **tenacity** | >= 8.2 | Retry logic with exponential backoff |
| **OpenAI SDK** | >= 1.3 | GPT-4 for remarks parsing and insights |
| **Google GenAI** | >= 0.8 | Gemini fallback for AI features |
| **Supabase SDK** | >= 2.3 | Auth API + Storage API only (NOT for DB queries) |
| **Pillow** | >= 10.0 | Image processing |

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| **Next.js** | 16.1 | React framework (App Router, SSR) |
| **React** | 19.2 | UI library |
| **TypeScript** | 5 | Type safety |
| **Tailwind CSS** | 4 | Utility-first styling |
| **shadcn/ui** | Latest | Accessible component library (Radix UI primitives) |
| **TanStack React Query** | 5.90 | Server state management, caching, background refetch |
| **Zustand** | 5.0 | Client-side UI state |
| **Axios** | 1.13 | HTTP client with JWT interceptor |
| **React Hook Form** | 7.71 | Form state management |
| **Zod** | 4.3 | Schema validation |
| **ECharts** | 6.0 | Data visualization and charts |
| **date-fns** | 4.1 | Date formatting and manipulation |
| **Lucide React** | 0.563 | Icon library |
| **Sonner** | 2.0 | Toast notifications |
| **cmdk** | 1.1 | Command palette (Ctrl+K search) |
| **next-themes** | 0.4 | Theme switching (light/dark) |

### Infrastructure

| Technology | Purpose |
|------------|---------|
| **PostgreSQL** | Primary database (via Supabase) |
| **Supavisor** | Connection pooler (port 6543, transaction-mode) |
| **Supabase Auth** | User authentication (JWT, session management) |
| **Supabase Storage** | File storage (weekly reports, documents) |
| **Render** | Backend hosting (Docker, Frankfurt EU) |
| **Vercel** | Frontend hosting (Next.js, edge network) |
| **Docker** | Backend containerization (Python 3.11-slim) |

### Dev Tools

| Tool | Purpose |
|------|---------|
| **Ruff** | Python linting + formatting |
| **mypy** | Python type checking |
| **ESLint** | TypeScript/React linting |
| **pytest** | Backend testing (async support) |
| **React Query DevTools** | Frontend cache debugging |

---

## 3. System Architecture

### High-Level Data Flow

```
Browser (React)
    |
    |  HTTPS (REST + SSE)
    v
Vercel (Next.js SSR)  ──>  Render (FastAPI + Uvicorn)
                                |           |
                    +-----------+-----------+-----------+
                    |           |           |           |
              asyncpg pool  Supabase    Supabase    OpenAI
              (port 6543)    Auth SDK   Storage     GPT-4
                    |                      |
              Supavisor                 S3-compat
              (pooler)                  bucket
                    |
              PostgreSQL
              (Supabase)
```

### Request Flow

```
1. Browser sends request with JWT in Authorization header
2. Axios interceptor attaches token from sessionStorage
3. FastAPI receives request → HTTPBearer extracts token
4. security.py verifies JWT locally (ES256 JWKS) → cache user data
5. Endpoint executes query via asyncpg pool → Supavisor → PostgreSQL
6. Response returns with _record_to_dict() auto-conversion
7. React Query caches response (staleTime: 2-10 min)
```

### Real-Time Flow (SSE)

```
1. Frontend opens EventSource to /api/v1/events/stream?token=JWT
2. Backend authenticates token, creates asyncio.Queue subscriber
3. When any mutation occurs (upload, create, transfer, etc.):
   a. Backend calls broadcast(entity, action)
   b. Event pushed to all subscriber queues
   c. SSE streams "data: {...}\n\n" to all connected clients
4. Frontend receives event → invalidates matching React Query keys
5. React Query refetches stale data in background
6. UI updates automatically — no manual refresh needed
```

---

## 4. Backend Architecture

### Directory Structure

```
backend/
  app/
    api/v1/                 # Route handlers (23 files)
      router.py             # Central router — includes all sub-routers
      auth.py               # Login, logout, user CRUD, token refresh
      plants.py             # Plant CRUD, search, transfer, bulk ops
      uploads.py            # File upload + ETL trigger
      transfers.py          # Transfer create, confirm, cancel, reject
      projects.py           # Project import (award letters), CRUD
      spare_parts.py        # PO management, cost analytics (largest: 83KB)
      locations.py          # Site management
      reports.py            # Report generation
      insights.py           # Fleet Intelligence queries
      site_report.py        # Site engineer endpoints
      events.py             # SSE streaming endpoint
      health.py             # Health/readiness probes
      notifications.py      # In-app notifications
      audit.py              # Audit log queries
      states.py             # State reference data
      fleet_types.py        # Fleet type management
      suppliers.py          # Supplier CRUD
      public_upload.py      # Unauthenticated file uploads
    core/                   # Framework-level modules
      pool.py               # asyncpg connection pool + helpers
      database.py           # Supabase SDK client (Auth + Storage)
      security.py           # JWT verification, role guards, user cache
      events.py             # In-memory SSE event bus (broadcast/subscribe)
      exceptions.py         # Custom exception hierarchy
      cache.py              # Caching utilities
    services/               # Business logic layer
      auth_service.py       # Auth business logic
      transfer_service.py   # Transfer workflow engine
      insights_service.py   # Fleet Intelligence AI engine (28KB)
      remarks_parser.py     # AI-powered plant condition parsing
      award_letters_parser.py  # Excel project import parser
      file_metadata_extractor.py  # Upload metadata extraction
      fleet_parser.py       # Fleet number normalization
      preview_service.py    # Report preview generation
      audit_service.py      # Audit trail recording
    workers/                # Background processing
      etl_worker.py         # ETL pipeline (128KB — weekly reports, POs, site submissions)
    models/                 # Pydantic models
      common.py, plant.py, project.py, upload.py
    monitoring/             # Observability
      logging.py            # structlog configuration
      metrics.py            # Custom metrics collection
      middleware.py         # Request logging + alerting middleware
    config.py               # Settings via pydantic-settings
    main.py                 # App factory, lifespan, middleware stack
```

### Key Patterns

**Database access** — All queries go through asyncpg helpers:
```python
from app.core.pool import fetch, fetchrow, fetchval, execute, executemany

# Single row
row = await fetchrow("SELECT * FROM plants_master WHERE id = $1::uuid", plant_id)

# Multiple rows with pagination
rows = await fetch("""
    SELECT *, count(*) OVER() AS _total_count
    FROM plants_master WHERE condition = $1
    LIMIT $2 OFFSET $3
""", condition, limit, offset)

# Batch insert
await executemany("INSERT INTO t (a, b) VALUES ($1, $2)", [(1, 2), (3, 4)])
```

**Auto-conversion** — `pool.py`'s `_record_to_dict()` converts UUID to str, Decimal to float, datetime to ISO string, date to ISO string automatically.

**Error handling** — Custom exceptions (`AppException`, `AuthenticationError`, `AuthorizationError`, `ValidationError`, `NotFoundError`) with consistent JSON error responses.

**Background tasks** — FastAPI `BackgroundTasks` for audit logging and ETL processing (no external task queue needed for single-process deployment).

### Middleware Stack (order matters)

```
Request → CORS → Alerting → RequestLogging → Route Handler → Response
```

---

## 5. Frontend Architecture

### Directory Structure

```
frontend/src/
  app/                      # Next.js App Router pages
    (dashboard)/            # Protected dashboard layout
      page.tsx              # Main dashboard (KPI cards, charts)
      plants/               # Plant list + detail pages
      locations/[id]/       # Location detail with plant breakdown
      spare-parts/          # PO management, cost reports
      transfers/            # Transfer tracking
      projects/             # Project management
      reports/              # Report generation
      insights/             # Fleet Intelligence
      admin/
        users/              # User management (admin only)
        transfers/          # Transfer approval queue
    (site)/                 # Site engineer layout
      dashboard/            # Site-specific dashboard
    login/                  # Public login page
  providers/                # React context providers
    index.tsx               # Root provider wrapper (Theme → Query → Auth)
    auth-provider.tsx       # JWT auth state, token refresh, SSE integration
    query-provider.tsx      # TanStack React Query config
    theme-provider.tsx      # Light/dark theme
  hooks/                    # Custom React hooks (17 files)
    use-plants.ts           # Plant CRUD + search
    use-locations.ts        # Location queries
    use-spare-parts.ts      # PO + cost queries
    use-transfers.ts        # Transfer management
    use-uploads.ts          # File upload state
    use-projects.ts         # Project queries
    use-reports.ts          # Report generation
    use-insights.ts         # Fleet Intelligence
    use-dashboard.ts        # Dashboard aggregation
    use-users.ts            # User management
    use-site-report.ts      # Site engineer data
    use-event-stream.ts     # SSE real-time updates
    use-notifications.ts    # Notifications
    use-audit.ts            # Audit logs
    use-suppliers.ts        # Supplier data
    use-states.ts           # State reference data
    use-debounce.ts         # Input debouncing (300ms)
  lib/api/                  # API client layer (17 files)
    client.ts               # Axios instance + JWT interceptor + auto-refresh
    auth.ts                 # Auth API calls
    plants.ts               # Plant API
    silent-refresh.ts       # Background token refresh
    [... one file per domain]
  components/               # React components
    ui/                     # shadcn/ui base components
    layout/                 # Header, Sidebar, navigation
    plants/                 # Plant-specific UI
    admin/                  # Admin panels
    charts/                 # ECharts visualizations
    site/                   # Site engineer components
    [... per-feature directories]
```

### State Management Strategy

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Server state** | React Query | API data caching, background refetch, optimistic updates |
| **Client state** | Zustand | UI state (filters, sidebar open, modals) |
| **Form state** | React Hook Form + Zod | Form validation, submission |
| **Auth state** | React Context | User session, JWT tokens (sessionStorage) |
| **URL state** | Next.js searchParams | Pagination, filters, sorting |

### React Query Configuration

```typescript
defaultOptions: {
  queries: {
    staleTime: 2 * 60 * 1000,      // 2 min — data considered fresh
    gcTime: 10 * 60 * 1000,         // 10 min — garbage collect unused
    refetchOnWindowFocus: false,     // SSE handles real-time sync
    refetchOnReconnect: 'always',    // Refetch all after network recovery
    retry: 1,
  }
}
```

### Key Frontend Patterns

**API client with auto-refresh:**
```
Request → Axios interceptor attaches JWT → API call
  ↓ (if 401)
  tryRefreshToken() → retry original request with new token
  ↓ (if refresh fails)
  hardLogout() → redirect to /login
```

**Protected routes:**
```tsx
<ProtectedRoute requiredRole="admin">
  <AdminPanel />
</ProtectedRoute>
```

**Debounced search:** All search inputs use `useDebounce(value, 300)` to avoid hammering the API.

---

## 6. Database Architecture

### Connection Path

```
asyncpg pool (2-10 connections)
    → Supavisor (port 6543, transaction-mode pooler)
    → PostgreSQL (Supabase-hosted, EU West)

Latency: 1-5ms per query (vs 3.5-4.5s with previous PostgREST approach)
```

### Pool Configuration

```python
min_size = 2
max_size = 10
command_timeout = 15  # seconds
statement_cache_size = 0  # Required for Supavisor transaction-mode
```

### Key Tables (20+)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `plants_master` | Equipment registry | `fleet_number`, `condition` (active), `current_location_id` |
| `locations` | Project sites (27) | `name`, `state_id`, `coordinates` |
| `plant_transfers` | Equipment movements | `from_location_id`, `to_location_id`, `status` |
| `spare_parts` | Maintenance parts | `fleet_number_raw`, `unit_cost`, `quantity` |
| `purchase_orders` | PO tracking | `po_number`, `supplier_id`, `total_amount` |
| `projects` | Contract/award data | `project_name`, `contract_sum`, `is_legacy` |
| `weekly_report_submissions` | Upload tracking | `status`, `plants_processed`, `errors` |
| `plants_history` | Condition snapshots | `plant_id`, `condition`, `recorded_at` |
| `plant_location_history` | Location timeline | `plant_id`, `location_id`, `start_date`, `end_date` |
| `audit_logs` | Change audit trail | `user_id`, `action`, `table_name`, `old_values`, `new_values` |
| `users` | System users | `email`, `role`, `location_id`, `is_active` |
| `notifications` | In-app alerts | `title`, `type`, `read_at` |
| `fleet_number_prefixes` | Fleet type lookup (78) | `prefix`, `fleet_type`, `description` |
| `states` | Nigerian states | `name`, `code` |
| `suppliers` | Vendor registry | `name`, `contact_info` |

### Key Views

| View | Purpose |
|------|---------|
| `v_plants_summary` | 27+ field denormalized plant view (joins location, fleet type, costs) |
| `v_location_stats` | Per-site plant counts by condition |
| `v_supplier_stats` | Supplier spend, item count, PO count |
| `v_purchase_orders_summary` | PO aggregation with location data |

### Key RPC Functions (10+)

| Function | Returns |
|----------|---------|
| `get_plant_maintenance_history(plant_id)` | Parts replaced with costs |
| `get_plant_movements(plant_id)` | Location history |
| `transfer_plant(plant_id, to, reason, user)` | Transfer result (JSON) |
| `get_transfer_stats_summary(since)` | Aggregated transfer stats (JSON) |
| `get_location_statistics(location_id)` | Condition breakdown |
| `calculate_maintenance_costs(...)` | Cost by period/location |

### Critical Column Note

On `plants_master`:
- **`condition`** — ACTIVE column, updated by weekly report ETL. Use this for queries.
- **`status`** — STALE/LEGACY. Do NOT use for counting or filtering.

---

## 7. Authentication & Authorization

### Architecture

```
Login → Supabase Auth API → JWT (ES256) + Refresh Token
                                    |
                              sessionStorage
                                    |
                  Axios interceptor attaches to all requests
                                    |
                  FastAPI HTTPBearer → _verify_token()
                                    |
                         Local JWKS verification (no network call)
                                    |
                         _get_user_data() → asyncpg (cached 5min)
```

### Token Lifecycle

1. **Login** — Supabase Auth returns `access_token` (1hr), `refresh_token`
2. **Storage** — Both stored in `sessionStorage` (per-tab isolation)
3. **Proactive refresh** — `AuthProvider` schedules refresh 5 min before expiry
4. **Reactive refresh** — 401 response triggers `tryRefreshToken()` in Axios interceptor
5. **Wake recovery** — `visibilitychange` + `online` events trigger immediate refresh + React Query invalidation
6. **Failure** — Hard logout → redirect to `/login`

### Role Guards (Backend)

```python
# Any authenticated user
current_user: Annotated[CurrentUser, Depends(get_current_user)]

# Management or admin
current_user: Annotated[CurrentUser, Depends(require_management_or_admin)]

# Admin only
current_user: Annotated[CurrentUser, Depends(require_admin)]
```

### User Cache

In-memory TTL cache (5 min) in `security.py` eliminates repeated DB lookups for the same JWT. Thread-safe with `threading.Lock`.

---

## 8. Real-Time Data Sync (SSE)

### Why SSE (not WebSocket)

| Factor | SSE | WebSocket |
|--------|-----|-----------|
| Direction | Server → Client (one-way) | Bidirectional |
| Complexity | Simple, uses HTTP | Requires upgrade protocol |
| Reconnect | Built-in (EventSource auto-reconnects) | Manual |
| Our use case | Cache invalidation (one-way push) | Overkill |
| Proxy support | Works through standard HTTP proxies | May need special config |

We only need to tell clients "data changed, refetch" — SSE is the right tool.

### Backend Implementation

**Event bus** (`app/core/events.py`):
```python
# In-memory pub/sub — no Redis needed for single-process
_subscribers: set[asyncio.Queue] = set()

def broadcast(entity: str, action: str, summary: str | None = None):
    """Push event to all connected SSE clients."""
    event = {"entity": entity, "action": action, "ts": time.time()}
    for q in _subscribers:
        q.put_nowait(json.dumps(event))
```

**SSE endpoint** (`app/api/v1/events.py`):
```
GET /api/v1/events/stream?token=JWT

Returns: text/event-stream
Keepalive: every 25 seconds (": keepalive\n\n")
Auth: JWT via query param (EventSource can't set headers)
Queue: 64 events max per client; slow clients evicted
```

**Broadcast points** — Every mutation endpoint calls `broadcast()`:

| Module | Events |
|--------|--------|
| `plants.py` | create, update, transfer, delete |
| `transfers.py` | create, confirm, cancel, reject |
| `projects.py` | import, create, update, delete |
| `etl_worker.py` | plants.import, spare_parts.import, uploads.complete |

### Frontend Implementation

**Hook** (`hooks/use-event-stream.ts`):
```typescript
// Connects EventSource when authenticated
// Maps entity names to React Query keys for targeted invalidation:
//   "plants" → invalidate ["plants"], ["locations"], ["reports"]
//   "transfers" → invalidate ["transfers"]
//   "uploads" → invalidate ["uploads"]
// Auto-reconnects on error (3s delay)
```

**Integration** — `useEventStream(!!user)` called in `AuthProvider`.

### Scaling Note

Current implementation is in-memory (single-process). If scaling to multiple workers:
- Swap `_subscribers` for **Redis Pub/Sub**
- Each worker subscribes to Redis channel
- `broadcast()` publishes to Redis instead of local queues
- SSE endpoints consume from Redis subscription

---

## 9. ETL & Data Pipeline

### Overview

The ETL system processes uploaded Excel files in the background. It's the core data ingestion mechanism.

```
User uploads Excel → FastAPI validates & stores in Supabase Storage
                  → BackgroundTask: etl_worker processes file
                  → Parse Excel with pandas + openpyxl
                  → Validate, clean, transform data
                  → INSERT/UPDATE via asyncpg
                  → broadcast() SSE event
                  → Create notification
```

### Pipeline Types

#### 1. Weekly Report Processing (`process_weekly_report`)
- **Input:** Excel file with plant conditions per location
- **Processing:** Parse fleet numbers, normalize conditions, detect transfers, run AI remarks parser
- **Output:** Updated `plants_master.condition`, `plants_history`, new `plant_transfers`
- **Error handling:** Row-by-row savepoints — one bad row doesn't kill the batch

#### 2. Purchase Order Processing (`process_purchase_order`)
- **Input:** Excel with PO data (part numbers, costs, suppliers)
- **Output:** `spare_parts`, `purchase_orders` records
- **Dedup:** Matches existing POs by number

#### 3. Award Letters Import (`projects.py` import endpoint)
- **Input:** Multi-sheet Excel (17 sheets, 15 columns, 218+ rows)
- **Parser:** `award_letters_parser.py` — handles extreme data quality issues:
  - Free-text dates ("Applied 9th October, 2014", "8TH MARCH, 2018")
  - Narrative contract sums ("Revised from X to Y", "NGN & USD amounts")
  - Shorthand amounts ("18.5 million", "74m")
  - Month typos ("Novemebr", "Septmber")
  - Noise detection (50+ patterns)
- **Transaction:** Batch attempt in savepoint → fallback to row-by-row savepoints

#### 4. Site Engineer Submission (`save_confirmed_weekly_report`, `process_direct_submission`)
- **Input:** Confirmed weekly data from site engineer UI
- **Processing:** Similar to weekly report but from structured form data

### Data Quality Pipeline

```
Raw Excel cell
  → Strip whitespace, normalize case
  → Detect noise values (50+ patterns: "N/A", "Nil", "Nill", "work on going", etc.)
  → Parse dates (handles ordinals, typos, narrative text, multiple formats)
  → Parse amounts (handles "million", "m", currency prefixes, dual-currency)
  → Truncate overlong fields
  → Validate against DB constraints
  → INSERT with savepoint (row-by-row fallback on batch failure)
```

---

## 10. AI Integration

### Remarks Parser (`services/remarks_parser.py`)

Uses GPT-4 (OpenAI) to parse free-text plant remarks into structured data:

```
Input:  "Compressor faulty. Sent to Sapele for repairs. Missing alternator belt."
Output: {
  condition: "under_repair",
  transfer_detected: true,
  transfer_destination: "Sapele",
  anomalies: ["faulty compressor", "missing alternator belt"],
  maintenance_needed: true
}
```

**Fallback:** Google Gemini if OpenAI unavailable.

### Fleet Intelligence (`services/insights_service.py`)

AI-powered analytics engine generating operational insights:
- Plant utilization patterns
- Maintenance cost trends
- Transfer frequency analysis
- Site performance comparisons

---

## 11. File Storage

### Architecture

```
Upload → FastAPI → Supabase Storage (S3-compatible bucket: "reports")
                                          |
                                    Public bucket
                                    (signed URLs for downloads)
```

### Storage Pattern

```python
# Upload
supabase.storage.from_("reports").upload(path, file_bytes)

# Download (in ETL worker)
response = supabase.storage.from_("reports").download(path)

# Signed URL (for frontend downloads)
url = supabase.storage.from_("reports").create_signed_url(path, expires_in=3600)
```

---

## 12. Observability & Monitoring

### Structured Logging

```python
import structlog
logger = structlog.get_logger(__name__)

logger.info("Plant updated", plant_id=plant_id, fleet_number=fn, user_id=user_id)
# Output: {"event": "Plant updated", "plant_id": "...", "fleet_number": "...", "timestamp": "..."}
```

### Health Endpoints

| Endpoint | Purpose | Response |
|----------|---------|----------|
| `GET /api/v1/health` | Basic alive check | `{"status": "ok"}` |
| `GET /api/v1/health/detailed` | Pool stats, DB latency, components | Full JSON |
| `GET /api/v1/health/ready` | Readiness probe (DB connectivity) | 200/503 |
| `GET /api/v1/health/live` | Liveness probe | 200 |

### Middleware

- **RequestLoggingMiddleware** — Logs every request with duration, status, user
- **AlertingMiddleware** — Tracks error rates; alerts if threshold exceeded (10 errors/60s)

### Audit Trail

Every admin action logged to `audit_logs`:
```python
await audit_service.log(
    user_id, user_email, action="update",
    table_name="plants_master", record_id=plant_id,
    old_values={...}, new_values={...},
    ip_address=ip, description="Updated plant XYZ-001"
)
```

---

## 13. Deployment & Infrastructure

### Architecture

```
GitHub (Astrochuks/PW_plant_management_system)
    |
    +--- Render (backend)
    |      Docker (Python 3.11-slim)
    |      Frankfurt, EU (close to Supabase DB)
    |      Free plan
    |      Health check: /api/v1/health
    |
    +--- Vercel (frontend)
    |      Next.js 16 (zero-config)
    |      Edge network (global CDN)
    |      Free plan
    |
    +--- Supabase (database + auth + storage)
           PostgreSQL (EU West)
           Supavisor pooler (port 6543)
           Auth API (JWT issuance)
           Storage (S3-compatible, "reports" bucket)
```

### Environment Variables

#### Backend (Render)
```env
DATABASE_URL=postgresql://postgres.[ref]:[pass]@pooler.supabase.com:6543/postgres
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...              # Optional fallback
CORS_ORIGINS=["https://your-app.vercel.app"]
ENVIRONMENT=production
LOG_LEVEL=INFO
```

#### Frontend (Vercel)
```env
NEXT_PUBLIC_API_URL=https://pw-plant-api.onrender.com
```

### Docker Build

```dockerfile
# Multi-stage build
FROM python:3.11-slim AS builder
# Install deps into virtualenv

FROM python:3.11-slim AS production
# Copy virtualenv, run as non-root (appuser)
# Health check: curl /api/v1/health
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 14. API Reference

### Route Prefix: `/api/v1`

| Prefix | Tag | Key Endpoints |
|--------|-----|---------------|
| `/health` | Health | GET `/`, `/detailed`, `/ready`, `/live` |
| `/auth` | Authentication | POST `/login`, `/logout`, `/refresh`, `/users` |
| `/plants` | Plants | GET `/`, `/{id}`, POST `/`, PATCH `/{id}`, DELETE `/{id}`, POST `/{id}/transfer` |
| `/uploads` | Uploads | POST `/weekly-report`, `/purchase-order`, GET `/`, `/{id}/status` |
| `/locations` | Sites | GET `/`, `/{id}`, `/{id}/plants`, `/{id}/stats` |
| `/transfers` | Transfers | GET `/`, `/pending`, POST `/`, `/{id}/confirm`, `/{id}/cancel`, `/{id}/reject` |
| `/projects` | Projects | GET `/`, POST `/`, POST `/import`, PATCH `/{id}`, DELETE `/{id}` |
| `/spare-parts` | Spare Parts | GET `/`, POST `/`, analytics endpoints, cost endpoints |
| `/fleet-types` | Fleet Types | GET `/` |
| `/suppliers` | Suppliers | GET `/`, `/{id}` |
| `/reports` | Reports | GET endpoints for various report types |
| `/insights` | Insights | GET `/`, `/{id}` |
| `/notifications` | Notifications | GET `/`, PATCH `/{id}/read` |
| `/audit` | Audit | GET `/` |
| `/events` | Events | GET `/stream` (SSE) |
| `/site` | Site Engineer | Site-scoped endpoints for field officers |
| `/states` | States | GET `/` (reference data) |

### Authentication

All endpoints (except `/health` and `/auth/login`) require a valid JWT:
- **Header:** `Authorization: Bearer <token>`
- **SSE:** `?token=<token>` query parameter (EventSource limitation)

---

## 15. Scaling Strategy

### Current Capacity

| Component | Limit | Notes |
|-----------|-------|-------|
| asyncpg pool | 10 connections | Handles ~100 concurrent requests |
| SSE event bus | In-memory | Single-process only |
| ETL worker | Single-threaded | One file at a time |
| Render free plan | 512MB RAM, shared CPU | Sufficient for current load |

### Scaling Path

#### Phase 1: Vertical (Current Load x5)
- Increase asyncpg `max_size` to 20-30
- Upgrade Render to paid plan (more RAM/CPU)
- Add Redis for SSE event bus (multi-worker support)

#### Phase 2: Horizontal (Current Load x20)
- Multiple Uvicorn workers behind load balancer
- Redis Pub/Sub for SSE across workers
- Celery/ARQ task queue for ETL (replaces BackgroundTasks)
- Read replicas for report queries

#### Phase 3: Enterprise (Current Load x100+)
- Kubernetes orchestration
- Dedicated ETL service
- Event streaming (Kafka/NATS)
- Database sharding by location
- CDN for static assets and file downloads

### What to Swap When

| Current | Replace With | When |
|---------|-------------|------|
| In-memory SSE bus | Redis Pub/Sub | Multiple workers |
| BackgroundTasks (ETL) | Celery + Redis | ETL queue > 10 files |
| Single Uvicorn | Gunicorn + workers | > 100 concurrent users |
| Supabase free | Supabase Pro / self-hosted PG | > 500MB DB or connection limits |
| Render free | Render paid / AWS ECS | Need guaranteed uptime |
| Vercel free | Vercel Pro | Custom domains, analytics |

---

## 16. Key Design Decisions

### 1. asyncpg over Supabase PostgREST
**Decision:** Direct PostgreSQL via asyncpg instead of Supabase REST API.
**Reason:** PostgREST added 3-4s overhead per request. asyncpg gives 1-5ms queries.
**Trade-off:** More SQL to write, but full control over queries and transactions.

### 2. SSE over WebSocket
**Decision:** Server-Sent Events for real-time cache invalidation.
**Reason:** We only push one-way (server → client). SSE is simpler, auto-reconnects, works through proxies. WebSocket is bidirectional — overkill for "please refetch."

### 3. React Query over Redux/Context for Server State
**Decision:** TanStack React Query for all API data.
**Reason:** Built-in caching, background refetch, deduplication, optimistic updates. Eliminates manual state management for server data.

### 4. Background Tasks over Task Queue
**Decision:** FastAPI `BackgroundTasks` instead of Celery/ARQ.
**Reason:** Single-process deployment on free tier. No Redis needed. ETL throughput is adequate (one file at a time). Easy to migrate to Celery later.

### 5. Local JWT Verification
**Decision:** Verify JWTs locally using JWKS (ES256) instead of calling Supabase Auth API.
**Reason:** Eliminates a network round-trip per request. JWKS public key cached on startup.

### 6. In-Memory User Cache
**Decision:** 5-minute TTL cache in `security.py` for user data.
**Reason:** Same user hits many endpoints per session. Cache hit = 0 DB queries for auth.

### 7. Pandas for Excel Parsing
**Decision:** Pandas + openpyxl for all Excel imports.
**Reason:** Handles messy real-world data (merged cells, missing headers, type coercion). Award letters parser needs heavy data cleaning that Pandas makes tractable.

### 8. Session Storage over Local Storage
**Decision:** JWT tokens stored in `sessionStorage` (not `localStorage`).
**Reason:** Per-tab isolation, cleared on tab close. Prevents stale tokens across tabs.

### 9. Currency: Nigerian Naira (NGN)
All monetary values are in Naira (₦). Frontend uses `en-NG` locale for formatting.

---

## Appendix: File Size Reference

The largest backend files indicate system complexity concentration:

| File | Size | What It Does |
|------|------|--------------|
| `etl_worker.py` | 128KB | Complete ETL pipeline (4 processing paths) |
| `spare_parts.py` | 83KB | 22+ endpoints for PO and cost management |
| `uploads.py` | 59KB | File upload with metadata extraction |
| `site_report.py` | 38KB | Site engineer endpoints |
| `insights_service.py` | 28KB | Fleet Intelligence AI engine |
| `award_letters_parser.py` | 25KB | Excel project import with data cleaning |
| `remarks_parser.py` | 21KB | AI-powered condition parsing |
| `plants.py` | 48KB | Plant CRUD, search, transfer |
