# System Audit - March 31, 2026

## Architecture Overview

### Backend
- **Framework**: FastAPI + asyncpg (direct PostgreSQL via Supavisor port 6543)
- **111 endpoints** across 17 routers
- **10 services**, 1 ETL worker, 3 monitoring modules
- **Auth**: JWT with local ES256 verification, JWKS caching, role-based (admin, management, site_engineer)
- **Real-time**: SSE event bus (in-memory, single-process)
- **Caching**: In-memory TTL cache for locations, fleet types

### Frontend
- **Framework**: Next.js 16 + React 19, App Router
- **37+ pages**, 70+ components, 19+ custom hooks
- **State**: React Query (5min stale, 10min gc), Zustand for dashboard filters
- **Auth**: Per-tab sessionStorage, token refresh mutex, proactive refresh
- **Real-time**: SSE with exponential backoff reconnect

### Data Flow
```
Upload (Excel) → Supabase Storage → ETL Worker → AI Parsing → Database
                                                              ↓
Frontend ← React Query ← API ← asyncpg ← PostgreSQL
    ↑
SSE Stream (entity change broadcasts)
```

---

## Critical Issues (Fix Now)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | Transfer confirm uses today's date, not transfer_date | transfers.py:373 | Wrong location history durations |
| 2 | Transfers don't create plant_events records | transfer_service.py | Events tab empty for transfers |
| 3 | Site engineer submissions don't update plant_location_history | site_report.py | Incomplete location timeline |
| 4 | No Error Boundaries in frontend | All pages | White screen on unhandled errors |
| 5 | Uploading older reports overwrites current_location_id | etl_worker.py | Current location gets stale |
| 6 | plant_location_history not properly maintained during ETL | etl_worker.py | Sites tab incomplete |

## Architecture Concerns (Plan For)

| # | Issue | Impact |
|---|-------|--------|
| 7 | Single-process (event bus, cache, metrics in-memory) | Can't scale horizontally |
| 8 | ETL: 1 file at a time, no task queue | Upload backlog under load |
| 9 | AI batch parsing no timeout/chunking | 500+ plants could timeout |
| 10 | No migration management (manual SQL) | Schema drift risk |
| 11 | No tests (backend or frontend) | Regression risk |

## Data Integrity Concerns

| # | Issue | Impact |
|---|-------|--------|
| 12 | Previous week remarks carryover without flagging | Stale conditions look current |
| 13 | Physical verification defaults true if column empty | Inflated verification rates |
| 14 | Unresolved transfer locations (NULL to_location_id) | Pending transfers stuck forever |
| 15 | Location conflicts silently dropped | Lost movement data |
| 16 | Float for financial fields instead of Decimal | Rounding errors |

## Frontend Polish

| # | Issue | Impact |
|---|-------|--------|
| 17 | Inconsistent loading states | Jarring UX |
| 18 | No success toasts on mutations | Users unsure if action worked |
| 19 | No unsaved form warning | Lost form data |
| 20 | Pending transfer card may not show on detail | Missing context |

## Security Concerns

- User cache TTL 5min (deactivated users can access for 5min)
- Site engineer location filtering not enforced in all queries
- No CSRF protection
- JWKS cache 600s (key rotation delay)
- No rate limiting on sensitive endpoints

## Endpoint Catalog

### Auth (17), Plants (22), Uploads (16), Projects (10), Transfers (10)
### Locations (11), States (7), Fleet Types (3), Spare Parts (29)
### Suppliers (6), Reports (12), Insights (5), Site Engineer (15)
### Notifications (5), Audit (2), Events/SSE (1), Health (4)

**Total: ~175 endpoints**

---

## Transfer System Issues (Detailed)

1. **Date mismatch**: `confirm_transfer()` uses `utcnow()` not `transfer_date`
2. **No events created**: Transfers update location_history but not plant_events
3. **Location history gaps**: Manual confirms create gaps in timeline
4. **Unresolved locations**: Transfers with NULL to_location_id stuck forever
5. **Old report uploads overwrite current location**: No week-ordering logic
6. **Site submissions skip location_history**: Only ETL updates it

## ETL Pipeline Issues

1. Large batch AI parsing could timeout (no chunking)
2. Previous week remarks carryover not flagged
3. Physical verification defaults to true
4. Location conflicts silently resolved (loser data dropped)
5. Fleet type resolution by prefix only (brittle)
6. No partial failure handling (1 bad row can fail entire upload)
