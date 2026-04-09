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

---

## Fix #10: Smart preview — carry over verified condition when remarks unchanged

**Date:** 2026-04-09
**Files:**
- `backend/app/services/preview_service.py` (added `compare_remarks_with_previous()`, normalize helper, status constants)
- `backend/app/api/v1/uploads.py` (preview endpoint enhanced)
- `frontend/src/lib/api/uploads.ts` (added `compare_status`, `previous_remarks`, `previous_week_ending_date`, `compare_breakdown` types)
- `frontend/src/app/(dashboard)/uploads/page.tsx` (Status column, badge, filter, summary card, row tinting)

**Status:** Done

### Problem
When previewing a weekly report upload, the parser auto-detects each plant's condition from remarks. The parser isn't 100% accurate, so admin manually fixes errors before confirming. But many plants have IDENTICAL remarks week after week (e.g., "WORKING SITE"), and the user has to re-verify the same parser output every week. This is slow and tedious.

### Solution
Compare each plant's new remarks against its **most recent** weekly record (any week — Option A semantics):
- **Same remarks** → reuse previous condition (skip parser entirely). User already verified it last time.
- **Empty remarks this week** → still reuse previous condition (don't re-verify just because the report was sparse).
- **Different remarks** → run parser as usual, but flag as "Changed" so user knows to double-check.
- **No previous record** → run parser, flag as "New".

### Implementation
**Backend (`uploads.py` preview endpoint):**
1. After fetching `existing_plants_map`, run ONE additional query:
   ```sql
   SELECT DISTINCT ON (plant_id) plant_id, remarks, condition, year, week_number, week_ending_date
   FROM plant_weekly_records
   WHERE plant_id = ANY($1::uuid[])
   ORDER BY plant_id, year DESC, week_number DESC
   ```
2. Build `latest_records_by_plant_id` hashmap.
3. In the per-row loop, BEFORE running parser:
   - Look up plant's previous record
   - Call `compare_remarks_with_previous()`
   - If carry over → set `detected_condition.condition = previous_condition`, skip parser
   - Else → run parser as usual
4. Add `compare_status`, `previous_remarks`, `previous_week_ending_date` to plant_preview dict
5. Add `compare_breakdown` counts to summary

**Performance:**
- 1 extra DB query (DISTINCT ON, ~10ms for 600 plants)
- Hashmap lookups are O(1)
- For ~70% of plants (typical), the parser is SKIPPED entirely → preview is FASTER overall

**Frontend (`uploads/page.tsx`):**
1. New summary card "Carried Over" (counts `carried_over` + `empty_carried`)
2. New summary card "Remarks Changed" (replaces "Medium" — more actionable)
3. New "Status" filter dropdown: All / Remarks Changed / Carried Over / Empty / New Plant
4. New "Status" column in preview table with `CompareStatusBadge`:
   - **Same** (green) — same remarks as previous week
   - **Empty** (light green) — empty remarks, kept previous
   - **Changed** (orange) — remarks differ, parser ran, please verify
   - **New** (blue) — first time seeing this plant
5. Rows with `Changed` status are tinted orange for visibility
6. Hover tooltip on badge shows previous remarks + week ending date

### How to test
1. Upload a weekly report for a location with existing data (e.g., ABUJA Week 4)
2. The preview should show most plants as "Same" (green) — these had identical remarks last week
3. Plants with new/different remarks should show as "Changed" (orange) — parser ran, verify
4. Plants with no previous record should show as "New" (blue)
5. Open the "Status" filter and choose "Remarks Changed (Review)" to focus only on the ones needing attention
6. The "Carried Over" summary card shows how many plants saved you a manual review
7. Hover any badge to see the previous remarks for context
8. Confirm — the carried-over conditions should be saved as-is (no re-verification needed)

### Edge cases handled
- Whitespace-only remarks: treated as empty
- Case differences ("Working" vs "WORKING"): normalized before compare
- Internal whitespace ("WORKING  SITE" vs "WORKING SITE"): collapsed
- Plant moved sites but same remarks: still carries over (remarks tell the story)
- New remarks empty + previous had remarks: still carries over (user requested)
- Previous condition was NULL: doesn't carry over, runs parser
- Plant in file but not in plants_master yet: treated as new_plant
- Out-of-order uploads: uses most recent record by (year, week_number) DESC

---

## Fix #11: Sites tab empty + Events wiped on re-upload + Transfers not registered

**Date:** 2026-04-09
**Files:**
- `backend/app/workers/etl_worker.py` (`rebuild_location_timeline`, `save_confirmed_weekly_report`)
- `backend/app/api/v1/uploads.py` (preview endpoint)
**Status:** Done + backfilled Jebbu Bassa data

### Symptoms (reported by user)
1. Uploaded Jebbu Bassa Week 13 with 6 plants newly arrived from Jos
2. Preview correctly showed them as "transferred from Jos"
3. After confirm:
   - ❌ Transfers page: nothing recorded
   - ❌ Plant detail Sites tab: empty
   - ✓ Plant detail Events tab: events recorded
4. Re-uploaded same week:
   - Preview no longer showed "from Jos" (correct, plants are now at Jebbu Bassa)
   - But still showed plants as "New" (confusing)
   - After confirm:
     - ❌ Sites tab: still empty
     - ❌ Events tab: now EMPTY (got wiped)

### Root causes (4 distinct bugs)

**Bug A: `rebuild_location_timeline` was silently failing on date type binding**
- The rebuild function reads `plant_weekly_records` via `fetch()` which calls `_record_to_dict`. That converts `date` columns to ISO strings.
- The rebuild then INSERTs strings into `plant_location_history` (which has `timestamptz` columns).
- asyncpg is strict about type binding — it raises a DataError on string-to-timestamptz binding without explicit casts.
- The error was caught by a generic try/except logging only a warning. Function continued silently.
- **Result:** Sites tab was always empty after every confirmed upload.

**Bug B: `cleanup_submission_data` deletes events on re-upload**
- On re-upload, the confirm endpoint detects existing submission and calls `cleanup_submission_data(submission_id)`.
- That function does `DELETE FROM plant_events WHERE submission_id = $1`.
- Wipes ALL events tagged with this submission, regardless of type ('new', 'movement', etc.)
- Then save_confirmed re-creates events. But movement events were ALSO failing for the same reason (Bug A) — because rebuild was deleting/recreating them with broken date casts.

**Bug C: Movement events created in BOTH save_confirmed and rebuild → race conditions**
- save_confirmed_weekly_report had explicit code to create 'movement' events with submission_id
- rebuild_location_timeline ALSO creates 'movement' events
- On re-upload: cleanup deletes save_confirmed's events, save_confirmed recreates them, rebuild deletes its own and creates new ones — duplicates and inconsistencies.

**Bug D: `is_new` label shown even on re-upload**
- `is_new = fleet_num not in prev_week_fleet_numbers` — based on PREVIOUS week's data.
- On re-upload of the same week, the plant is already saved for the current week, but the previous week is still the same — so still flagged "new".

### Fixes

**Fix A:** `rebuild_location_timeline`:
1. Added explicit `::timestamptz` and `::date` casts to all INSERT statements
2. Two-pass insert pattern to avoid the `close_previous_location` trigger conflict:
   - Pass 1: insert ALL spans with explicit end_dates (no NULLs)
   - Pass 2: UPDATE the spans matching `plants_master.current_location_id` to set `end_date = NULL`
3. Made it the **single source of truth** for movement events and history
4. Also creates `plant_transfers` records for detected movements (so Transfers page works)

**Fix B/C:** `save_confirmed_weekly_report`:
- Removed inline movement event creation (4 places — plain movement, outbound, inbound, missing-transferred)
- Now only creates 'new', 'returned', 'missing' events
- Movement events come exclusively from `rebuild_location_timeline`
- Notification counters still track outbound/inbound from validated_plants

**Fix D:** `preview_weekly_report`:
- Added query for plants already saved for THIS location + THIS week
- `is_new` now requires both: not in prev_week AND not in current_week_saved

### Architecture (after fix)

```
save_confirmed_weekly_report (one submission)
  ├─ Insert/update plants_master
  ├─ Insert plant_weekly_records
  ├─ Insert plant_transfers (from preview's transfer_from/transfer_to fields)
  ├─ Create events: 'new', 'returned', 'missing' (with submission_id)
  └─ Call rebuild_location_timeline(affected plants)
      ├─ Read all weekly_records for these plants (chronological)
      ├─ Compute history spans (merge consecutive weeks at same location)
      ├─ Detect movements (where consecutive weeks differ)
      ├─ Delete + recreate plant_location_history
      ├─ Delete own movement events (NULL submission_id), recreate
      └─ Insert plant_transfers for detected movements (deduped)
```

### Backfill
- Manually rebuilt `plant_location_history`, `plant_events`, `plant_transfers` for Jebbu Bassa plants via SQL
- 7 plants now have correct sites, events, and transfers data

### How to test
1. Pick any site you've uploaded recently — open a plant's detail page
2. **Sites tab** should show all locations the plant has been at, with proper start/end dates
3. **Events tab** should show movement events for each location change
4. **Transfers page** should show inbound transfers when plants arrive at a new site
5. Re-upload the same week — events should NOT disappear
6. Plants already saved for the week should NOT show "New" badge in preview

---

## Fix #12: Auto-confirm pending transfers + system-wide backfill

**Date:** 2026-04-09
**Files:**
- `backend/app/workers/etl_worker.py` (`rebuild_location_timeline`)
- `docs/TRANSFER_STATES.md` (NEW — full architecture doc)
**Status:** Done + system-wide backfill executed

### What changed in rebuild_location_timeline
- Now reads ALL existing transfers for affected plants
- Builds a **strict 3-way pending lookup** map: `(plant_id, from_location_id, to_location_id) → pending_transfer_id`
- For each detected movement (Plant moved from A to B):
  1. If exact `(plant, from, to, date)` already exists → skip (true duplicate)
  2. If a **pending** transfer for the same route `(plant, from, to)` exists → **auto-confirm it** (UPDATE status='confirmed', actual_arrival_date)
  3. Otherwise → INSERT new confirmed transfer (with `source_remarks='AUTO_REBUILD_FROM_WEEKLY_RECORDS'` marker)
- Returns `transfers_inserted` and `transfers_confirmed` counts separately

### Why "strict" matching
Strict (`plant + from + to`) prevents confusing two different transfers to the same destination. If we matched only on `plant + to`, plant moving A→B then B→C then back to B would have ambiguous matches.

### Why the marker `AUTO_REBUILD_FROM_WEEKLY_RECORDS`
Lets us distinguish auto-detected transfers from admin-manually-created ones. Manually-created transfers have NO source_submission_id AND NO source_remarks, so they can be preserved on system-wide backfills.

### System-wide backfill executed
1. **Cleared** non-admin transfers (preserved 12 admin manual + 10 cancelled audit trail)
2. **Cleared** all `plant_location_history` (was empty anyway due to Bug A in Fix #11)
3. **Cleared** all `plant_events` of type 'movement'
4. **Rebuilt** for all 1,654 plants from `plant_weekly_records`:
   - 1,756 location_history records (1,654 current + 102 closed historical spans)
   - 102 movement events
   - 93 new auto-rebuilt confirmed transfers
   - 22 manually-created/cancelled transfers preserved
   - **Total: 115 transfers** in the system now

### Verification
- Spot-checked 5 plants from JEBBU BASSA — all have correct sites/movements/transfers
- T605 timeline: AKWA IBOM (2026-01-25) → JOS (2026-03-08 → 2026-03-22) → JEBBU BASSA (2026-03-29 → current)
- Properly chronological regardless of upload order

### Going forward (new uploads)
- save_confirmed creates: 'new', 'returned', 'missing' events + outbound pending + inbound confirmed transfers from preview
- rebuild creates: 'movement' events + auto-confirms matching pending OR creates new confirmed transfers
- Out-of-order uploads work correctly (rebuild always uses chronological order from weekly_records)
- Re-uploads no longer wipe events (cleanup only deletes non-movement events; rebuild handles movement events idempotently)

### See also
- `docs/TRANSFER_STATES.md` — full explanation of all 5 transfer sources, the 3 statuses, and the decision tree

---

## Fix #13: Events ordering, Transfers ordering+Week column, Sites empty after re-upload

**Date:** 2026-04-09
**Files:**
- `backend/app/api/v1/plants.py` (events query ordering)
- `backend/app/api/v1/transfers.py` (transfers query ordering + week computation)
- `backend/app/workers/etl_worker.py` (rebuild date binding fix + aggressive logging)
- `frontend/src/app/(dashboard)/locations/[id]/page.tsx` (hide AUTO_REBUILD marker, show "Auto-detected")
**Status:** Done

### Symptoms (reported by user)
1. Plant detail Events tab: events not in chronological order — they were sorted by `created_at` (when the row was inserted) instead of by the actual event date/week
2. Transfers admin page: Week column showing "-" for all rows; dates not in order
3. Site detail Transfers tab: same issues (uses same endpoint)
4. After re-uploading Jebbu Bassa Week 13: Sites tab EMPTY again, even though Events tab worked

### Root causes

**A. Events sort by `created_at`** — when rebuild runs, it creates events with the current timestamp, so all events end up clustered by upload time, not by actual week.

**B. Transfers sort by `created_at` + Week column unpopulated** — auto-detected transfers have no `source_submission_id`, so the JOIN to `weekly_report_submissions` returned NULL for the week. Frontend correctly showed "-".

**C. Sites tab empty after re-upload** — `rebuild_location_timeline` was failing silently because:
   - The function read `plant_weekly_records` via `_record_to_dict` which converts `date` columns to ISO strings
   - It then inserted those strings into `plant_location_history` (timestamptz column) and `plant_events` (date column) **without explicit type casts** in some code paths
   - asyncpg is strict about type binding — the insert raised, the exception was caught and only logged as a warning, so the function appeared to "complete"
   - Sites tab was therefore always empty after re-upload (even though the previous upload had populated it before the rebuild's deletes ran)

### Fixes

**Events ordering** (`plants.py`):
```sql
ORDER BY pe.year DESC NULLS LAST,
         pe.week_number DESC NULLS LAST,
         pe.event_date DESC NULLS LAST,
         pe.created_at DESC
```
Applied to both `/plants/events` (admin list) and `/plants/{id}/events` (plant detail).

**Transfers ordering + Week column** (`transfers.py`):
```sql
SELECT ...,
  COALESCE(ws.week_number, EXTRACT(week FROM t.transfer_date)::int) AS source_week,
  COALESCE(ws.year, EXTRACT(isoyear FROM t.transfer_date)::int) AS source_year,
  COALESCE(ws.week_ending_date, t.transfer_date) AS week_ending_date,
  ...
ORDER BY t.transfer_date DESC NULLS LAST, t.created_at DESC
```
Applied to `/transfers` (list) and `/transfers/site-requests`. Now the Week column shows the correct week even for auto-rebuild transfers (computed from transfer_date when there's no source submission), and rows are sorted newest-first.

**Rebuild bulletproofing** (`etl_worker.py`):
1. Convert string `plant_ids` to strings explicitly at function entry
2. Parse `_record_to_dict`'s ISO date strings back into Python `date` objects via `date.fromisoformat()` so asyncpg can bind them correctly
3. Add `try/except` around EVERY query inside rebuild with full traceback logging — no more silent failures
4. Add aggressive `logger.info` calls before/after each step so we can trace exactly where the rebuild reaches in the logs
5. Promote the wrapper exception in `save_confirmed_weekly_report` from `logger.warning` to `logger.error` with full traceback
6. Convert all UUID/location values to `str()` at the boundaries before the executemany batches

**Frontend display** (`locations/[id]/page.tsx`):
- Hide the internal `AUTO_REBUILD_FROM_WEEKLY_RECORDS` marker from the Remarks column
- Show "Auto-detected" (italic, muted) instead

### Backfilled current state
For the 7 Jebbu Bassa plants whose data was lost in the latest re-upload:
- `plant_location_history`: 14 records (2 sites for most, 3 for T605 which has AKWA IBOM → JOS → JEBBU BASSA)
- `plant_events` of type 'movement': 8 records
- `plant_transfers`: 8 records (1 per movement)
- All visible on plant detail Sites + Events tabs

### How to test (after backend restart)
1. Restart the backend (so the rebuild fix is loaded)
2. Re-upload any week's report
3. Open the backend logs — should see "rebuild_location_timeline START/DONE" with counts
4. Check plant detail Sites tab → should still show full timeline
5. Check plant detail Events tab → should be ordered by week (most recent first), not by upload time
6. Check Transfers page → Week column should show "Wk 13" for auto-detected transfers; rows sorted by date desc
7. Check site detail Transfers tab → same ordering and week column
