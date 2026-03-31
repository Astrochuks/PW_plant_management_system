# Fixes Log

Track all fixes with before/after behavior and testing instructions.

---

## Fix #1: ETL - Don't overwrite current_location_id with older week data

**Date:** 2026-03-31
**Files:** `backend/app/workers/etl_worker.py`
**Status:** Done (was already partially implemented)

**Before:** Uploading a Week 8 report after Week 12 could overwrite `current_location_id` to Week 8's location.
**After:** The ETL already had `is_latest` gating (line ~1435-1438, comparing `(year, week_number) >= existing_latest`). The `save_confirmed_weekly_report` path also had this check (line ~2340-2370). Both paths correctly skip location overwrites for older uploads.

**What was actually missing:** Even though current_location wasn't overwritten, the **location history and events were not built** for older uploads. This is addressed by Fixes #2 and #3.

**How to test:**
1. Find a plant currently at Site A (from a recent week, e.g., Week 12)
2. Upload an older report (e.g., Week 8) from Site B that includes the same plant
3. Verify: `plants_master.current_location_id` still points to Site A
4. Verify: `plant_weekly_records` has entries for both weeks
5. Verify: Sites tab now shows the full timeline (Fix #2)

---

## Fix #2: ETL - Rebuild location history from weekly records

**Date:** 2026-03-31
**Files:** `backend/app/workers/etl_worker.py`
**Status:** Done

**New function:** `rebuild_location_history_for_plants(plant_ids)`

**Before:** `plant_location_history` was maintained incrementally during ETL — only updated when movement detected in the "latest" week. Uploading older reports didn't create history entries. Sites tab showed only 1 entry.

**After:** After every upload (both ETL paths), location history is **deleted and rebuilt from scratch** using `plant_weekly_records` as the source of truth. Consecutive weeks at the same location are merged into one entry. The latest location entry has `end_date = NULL` (current).

**Implementation:**
1. Query all `plant_weekly_records` for affected plants, ordered by (year, week_number)
2. Group by plant_id, merge consecutive weeks at same location into spans
3. Delete existing `plant_location_history` for those plants
4. Insert new history records with correct start/end dates
5. Last span at current location gets `end_date = NULL`

**Called from:**
- `_record_plant_locations()` — standard ETL path (line ~1818)
- `save_confirmed_weekly_report()` — admin confirmed upload path (line ~2867)

**How to test:**
1. Upload reports for Weeks 8, 9, 10 from Site A, then Week 11 from Site B
2. Check Sites tab: should show Site A (Week 8 → Week 10) and Site B (Week 11 → current)
3. Now upload Week 7 from Site C for the same plant
4. Check Sites tab: should show Site C (Week 7) → Site A (Weeks 8-10) → Site B (Week 11 → current)

---

## Fix #3: ETL - Generate movement events from weekly records

**Date:** 2026-03-31
**Files:** `backend/app/workers/etl_worker.py`
**Status:** Done

**New function:** `rebuild_movement_events_for_plants(plant_ids)`

**Before:** `plant_events` (type=movement) only created during latest-week ETL processing. If `prev_locations` didn't exist (e.g., uploading out of order), no events were generated. Events tab was empty.

**After:** After every upload, movement events are **generated from `plant_weekly_records`** by comparing consecutive weeks. If a plant was at Location A in week N and Location B in week N+1, a movement event is created. Existing events are skipped (idempotent via dedup key: plant_id + event_date + from_location + to_location).

**Implementation:**
1. Query all `plant_weekly_records` for affected plants, ordered chronologically
2. For each plant, compare consecutive weeks — different location = movement
3. Check existing `plant_events` to avoid duplicates
4. Insert new movement events only

**Called from:** Same two locations as Fix #2.

**How to test:**
1. Upload reports showing a plant at Site A (Week 8-10) then Site B (Week 11)
2. Check Events tab: should show "Movement" event for Site A → Site B
3. Upload Week 7 from Site C
4. Check Events tab: should now also show "Movement" event for Site C → Site A

---

## Fix #4: Transfer confirm uses transfer_date not utcnow()

**Date:** 2026-03-31
**Files:** `backend/app/api/v1/transfers.py`
**Status:** Done

**Before:** `confirm_transfer()` set location history dates to `datetime.utcnow().date()`. If a transfer happened March 20 but was confirmed March 25, the old location showed as ending March 25.

**After:** Uses `actual_arrival_date` (if set) or `transfer_date` from the transfer record. Falls back to `utcnow()` only if both are NULL.

**Code change (line ~373):**
```python
# Before:
today = datetime.utcnow().date()

# After:
effective_date = (
    transfer.get("actual_arrival_date")
    or transfer.get("transfer_date")
    or datetime.utcnow().date()
)
```

**How to test:**
1. Create a pending transfer with transfer_date = 2026-03-20
2. Confirm it today (2026-03-31)
3. Check `plant_location_history`: old location end_date should be 2026-03-20, NOT 2026-03-31
4. New location start_date should also be 2026-03-20

---

## Fix #5: Division filter not working (earlier session)

**Date:** 2026-03-30
**Files:** `backend/app/api/v1/plants.py`, DB migrations
**Status:** Done

**Before:** Division column missing from `v_plants_summary` view, `get_filtered_plant_stats` DB function didn't accept division parameter, `/plants/filtered-stats` endpoint missing division param.

**After:** View updated, function updated (now 12 params), endpoint accepts division.

---

## Fix #6: Export not passing all filters (earlier session)

**Date:** 2026-03-30
**Files:** `backend/app/api/v1/plants.py`, `frontend/src/lib/api/plants.ts`, `frontend/src/app/(dashboard)/plants/page.tsx`
**Status:** Done

**Before:** Export endpoint missing `division`, `exclude_location_ids`, `has_maintenance` params. Frontend `exportParams` didn't include division or purchase_year.

**After:** All active filters are now passed to export. Export produces correct filtered results.

---

## Fix #7: Exclude Sites filter (new feature, earlier session)

**Date:** 2026-03-30
**Files:** Multiple frontend + backend files
**Status:** Done

**New feature:** Multi-select "Exclude Sites" filter. Works across list, stats, and export endpoints. Excluded sites show as red badges.

---

## Fix #8: Has Maintenance filter (new feature, earlier session)

**Date:** 2026-03-31
**Status:** Done

---

## Fix #9: Random logouts caused by database pool crash

**Date:** 2026-03-31
**Files:** `backend/app/core/pool.py`, `backend/app/core/security.py`, `backend/app/main.py`, `frontend/src/lib/api/client.ts`
**Status:** Done

**Root cause:** The asyncpg connection pool would occasionally die (Supavisor restart, connection timeout, network blip). When this happened:
1. Auth middleware called `fetchrow()` → `get_pool()` raised `RuntimeError("Database pool not initialized")`
2. `get_current_user()` caught this as a generic Exception and re-raised it as `AuthenticationError` (401)
3. Frontend saw 401, tried to refresh token, refresh also hit dead pool → 401
4. Frontend gave up and called `hardLogout()` → user on login page
5. Pool auto-recovered 3 seconds later, but user was already logged out

**Three-layer fix:**

**Layer 1 — Pool auto-recovery (`pool.py`):**
- New `DatabaseUnavailableError` exception (distinct from RuntimeError)
- New `_try_recover_pool()` function triggered automatically on pool death
- All query helpers (`fetch`, `fetchrow`, `execute`, etc.) wrapped in `_exec_with_recovery()`:
  - If pool is None: triggers background recovery, raises `DatabaseUnavailableError`
  - If query fails with connection error (OSError, InterfaceError): triggers recovery, raises `DatabaseUnavailableError`

**Layer 2 — Auth graceful degradation (`security.py`):**
- `_get_user_data()` catches `DatabaseUnavailableError` and falls back to **expired cache**
  - If user logged in recently, their data is still in cache (even if TTL expired)
  - Returns expired cache entry so user stays authenticated during pool recovery
  - New `UserCache.get_expired()` method returns data regardless of TTL
- `get_current_user()` lets `DatabaseUnavailableError` propagate (not wrapped as 401)

**Layer 3 — HTTP 503 handling (`main.py` + `client.ts`):**
- New exception handler: `DatabaseUnavailableError` → HTTP 503 with `Retry-After: 3`
- Frontend interceptor: On 503, **retries up to 3 times** with 3s delay between
- Does NOT logout on 503 — only on 401 after refresh fails
- After 3 retries, lets error propagate (shows toast, not login redirect)

**How to test:**
1. Start the backend, login to frontend
2. Kill the Supabase Supavisor connection (e.g., `kill` the backend process and restart)
3. Navigate around the frontend
4. Verify: requests may briefly fail (toast error) but user is NOT logged out
5. After pool recovers (~3s), requests succeed normally
6. Check backend logs: should see "Pool is dead — attempting auto-recovery" then "Pool auto-recovery succeeded"

**Date:** 2026-03-31
**Files:** Multiple frontend + backend files
**Status:** Done

**New feature:** Toggle to show only plants with `total_maintenance_cost > 0`. Works across list, stats, and export.
