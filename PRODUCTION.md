# Production Architecture & Deployment

> For the complete system architecture, technology stack, and design decisions, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Database Connection Architecture

### Before: Supabase PostgREST (REST API Gateway)
```
Frontend -> FastAPI -> Supabase REST API (EU West) -> PostgreSQL
                       ~2-4s overhead per request
```

### After: Direct asyncpg via Supavisor
```
Frontend -> FastAPI -> asyncpg pool -> Supavisor (port 6543) -> PostgreSQL
                       ~1-5ms per query
```

**Result:** API response times dropped from 3.5-4.5s to 200-500ms per endpoint.

## Connection Setup

### Environment Variables
```env
# Direct PostgreSQL connection through Supavisor (transaction-mode pooler)
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-eu-west-1.pooler.supabase.com:6543/postgres

# Supabase SDK (still used for Auth API + Storage API)
SUPABASE_URL=https://[project-ref].supabase.co
SUPABASE_SERVICE_KEY=eyJ...
```

### asyncpg Pool Configuration (`backend/app/core/pool.py`)
- **min_size:** 2 connections
- **max_size:** 10 connections
- **command_timeout:** 15 seconds
- **statement_cache_size:** 0 (required for Supavisor transaction-mode pooling)

Pool is initialized during FastAPI lifespan startup and closed on shutdown.

## What Uses What

### Direct asyncpg (all database queries)
- All `SELECT`, `INSERT`, `UPDATE`, `DELETE` queries
- All PostgreSQL function calls (`SELECT * FROM func_name($1, ...)`)
- ~200 database operations across 19 files

### Supabase SDK (auth + storage only)
- **Auth API:** `sign_in_with_password`, `sign_out`, `create_user`, `update_user_by_id`, `refresh_session`
- **Storage API:** `storage.from_("reports").upload/download/create_signed_url` for file operations

## Key Files

| File | Purpose |
|---|---|
| `backend/app/core/pool.py` | asyncpg connection pool + query helpers |
| `backend/app/core/database.py` | Supabase SDK client (Auth + Storage only) |
| `backend/app/main.py` | Pool lifecycle in lifespan |
| `backend/app/config.py` | `database_url` setting |

## Monitoring

### Health Endpoints
- `GET /api/v1/health` — basic alive check
- `GET /api/v1/health/detailed` — pool stats, DB latency, component status
- `GET /api/v1/health/ready` — readiness probe (DB connectivity)
- `GET /api/v1/health/live` — liveness probe

### Pool Stats (from `/health/detailed`)
```json
{
  "database": {
    "status": "healthy",
    "latency_ms": 2.3,
    "pool": {
      "size": 4,
      "free": 2,
      "min": 2,
      "max": 10
    }
  }
}
```

## Query Patterns

### Parameterized Queries
All queries use `$1, $2, ...` placeholders (asyncpg binary protocol):
```python
row = await fetchrow("SELECT * FROM plants_master WHERE id = $1::uuid", plant_id)
rows = await fetch("SELECT * FROM plants_master WHERE fleet_type ILIKE $1", f"%{search}%")
```

### UUID Handling
- asyncpg returns UUID objects; `pool.py` auto-converts to strings via `_record_to_dict()`
- Pass string UUIDs with `::uuid` cast: `WHERE id = $1::uuid`

### Array Parameters (replaces Supabase `.in_()`)
```python
rows = await fetch(
    "SELECT * FROM plants_master WHERE id = ANY($1::uuid[])",
    list_of_ids,
)
```

### JSONB Parameters
```python
await execute(
    "UPDATE table SET data = $1::jsonb WHERE id = $2::uuid",
    json.dumps(python_dict), record_id,
)
```

### Batch Operations
```python
await executemany(
    "INSERT INTO table (col1, col2) VALUES ($1, $2)",
    [(val1a, val2a), (val1b, val2b), ...],
)
```

## Real-Time Data Sync (SSE)

Server-Sent Events push cache invalidation events to all connected clients.

### How It Works
```
Backend mutation → broadcast("plants", "update")
                → SSE pushes to all connected clients
                → Frontend invalidates matching React Query keys
                → UI auto-updates (no manual refresh)
```

### Key Files
| File | Purpose |
|---|---|
| `backend/app/core/events.py` | In-memory event bus (subscribe/broadcast) |
| `backend/app/api/v1/events.py` | SSE streaming endpoint (`GET /events/stream?token=JWT`) |
| `frontend/src/hooks/use-event-stream.ts` | EventSource hook + React Query invalidation |

### Broadcast Points
All mutation endpoints call `broadcast()`: plants (CRUD + transfer), transfers (create/confirm/cancel/reject), projects (import/CRUD), ETL worker (weekly report + PO processing).

### Scaling Note
Current implementation is in-memory (single-process). For multiple workers, swap for Redis Pub/Sub — see `docs/ARCHITECTURE.md` Section 15.

---

## Scaling Considerations

### Current Limits
- asyncpg pool: 10 max connections
- Supavisor: Scales automatically on Supabase Pro plan
- ETL worker: Single-threaded, processes one file at a time

### If Scaling Needed
1. **More concurrent API requests:** Increase `max_size` in pool config (up to Supavisor limit)
2. **More ETL throughput:** Run multiple workers with separate task queues
3. **Read-heavy:** Add read replicas and route SELECT queries to replicas
4. **Connection limits:** Supavisor handles pooling; if hitting Supabase connection limits, upgrade plan

## Deployment Checklist

1. Set `DATABASE_URL` in production environment
2. Ensure port 6543 is accessible (Supavisor pooler port)
3. Verify `GET /api/v1/health/detailed` returns healthy with pool stats
4. Confirm all CRUD operations work (plants, transfers, spare parts)
5. Test ETL upload + processing flow
6. Verify auth login/logout works (Supabase SDK)
7. Verify file upload/download works (Supabase Storage)
