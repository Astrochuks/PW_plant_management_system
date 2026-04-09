# Plant Transfer States & Logic

> **Last updated:** 2026-04-09
> **Audience:** Developers, admins, anyone debugging transfers

This document explains how the plant transfer system works — where transfers come from, what each state means, and how they're created/confirmed automatically.

---

## 1. The 3 Transfer Statuses

| Status | Meaning | Visual |
|---|---|---|
| **`pending`** | Plant is in transit. Source location's report says it left, but destination hasn't reported it yet. | Amber/yellow on UI |
| **`confirmed`** | Plant has been seen at the destination. Movement is complete and verified. | Green on UI |
| **`cancelled`** | Admin (or system) cancelled the transfer. Pending transfer that won't be confirmed. | Gray on UI |

---

## 2. Where Transfers Come From (5 sources)

### Source A — **Admin manually created** (status: confirmed)
- Created via `POST /api/v1/transfers` from the admin Transfers page
- Used when an admin wants to record a movement directly (e.g., paperwork shows a transfer that wasn't in any weekly report)
- **Identifier:** `source_submission_id IS NULL` AND `source_remarks IS NULL` AND `is_pull_request = false`
- **Lifecycle:** Created → confirmed (immediately). Can be cancelled by admin.

### Source B — **Outbound from preview** (status: pending)
- Created by `save_confirmed_weekly_report()` when admin fills `transfer_to_location_id` in the preview screen
- Means: "this plant is leaving this site, going to Site X"
- **Identifier:** `source_submission_id IS NOT NULL` AND `direction = 'outbound'` AND `status = 'pending'`
- **Lifecycle:** Created as pending → auto-confirmed when the destination's report includes the plant (Source D)

### Source C — **Inbound from preview** (status: confirmed)
- Created by `save_confirmed_weekly_report()` when admin fills `transfer_from_location_id` in the preview screen
- Means: "this plant just arrived here from Site Y"
- **Identifier:** `source_submission_id IS NOT NULL` AND `direction = 'inbound'` AND `status = 'confirmed'`
- **Lifecycle:** Created as confirmed (immediately)
- If a matching pending transfer exists (Source B), it's marked confirmed instead of creating a duplicate

### Source D — **Auto-detected from weekly records** (status: confirmed)
- Created by `rebuild_location_timeline()` after every upload
- Detected when consecutive weeks for a plant show different `location_id`
  - e.g., Plant T605 was at Jos in Week 12, appears at Jebbu Bassa in Week 13 → confirmed transfer Jos → Jebbu Bassa
- **Identifier:** `source_remarks = 'AUTO_REBUILD_FROM_WEEKLY_RECORDS'` AND `direction = 'inbound'` AND `status = 'confirmed'`
- **Lifecycle:** Always confirmed (the plant has clearly arrived, that's how we detected it)
- Auto-confirms any matching pending transfer (Source B) instead of creating a duplicate

### Source E — **Site engineer pull request** (status: pending)
- Created by site engineer requesting a specific plant from another location
- **Identifier:** `is_pull_request = true`
- **Lifecycle:** Pending → admin can approve (confirmed) or reject (cancelled)

---

## 3. How Auto-Confirmation Works

When a movement is detected from weekly records (Source D), the rebuild function checks if there's already a pending transfer for the same plant + same route (strict 3-way match):

```
Movement detected: Plant T605 from Jos to Jebbu Bassa
                              ↓
Look for existing transfer where:
  plant_id = T605
  AND from_location_id = Jos
  AND to_location_id = Jebbu Bassa
  AND status = 'pending'
                              ↓
  Match found?     No match?
       ↓               ↓
  UPDATE          INSERT new
  set confirmed   confirmed transfer
```

### Why "strict" matching?
Strict (`plant + from + to`) prevents false positives. If we matched only on `plant + to`, we might confuse two different transfers (e.g., plant moved A→B then B→C and back to B — multiple legit transfers to B).

### What if the parser guessed the wrong "from"?
Then auto-confirm won't fire — a new confirmed transfer is created instead. The pending one stays as pending. Admin can manually clean it up.

---

## 4. Architecture: 2 Sources Coexist

```
                    Plant Weekly Report Upload
                              ↓
              ┌───────────────┴───────────────┐
              ↓                               ↓
    save_confirmed_weekly_report     rebuild_location_timeline
              ↓                               ↓
   Creates from PREVIEW fields:    Creates from WEEKLY RECORDS:
   - Outbound pending (Source B)    - Confirmed inbound (Source D)
   - Inbound confirmed (Source C)   - Auto-confirms pending matches
   These have submission_id          These have AUTO_REBUILD marker
```

Both sources can coexist for the same plant:
- Admin marks "Plant X going to B" in preview → pending Source B
- Next week, B's report includes Plant X → rebuild detects it → finds pending Source B → marks confirmed
- Result: ONE transfer in confirmed state, no duplicate

---

## 5. Out-of-Order Uploads

The rebuild function uses `ORDER BY year, week_number` from `plant_weekly_records` — so timeline is always built chronologically by ACTUAL week, not upload order.

**Example:**
1. You upload Week 13 first (Site B) → Plant T605 appears at B → confirmed transfer Jos → B (date=Week 13)
2. Later you upload Week 11 (Site A, Jos) → Plant T605 was at Jos → already correct
3. Then you upload Week 12 (Site A, Jos) → still at Jos → no change
4. Then you upload Week 10 (Site C) → Plant T605 was at C — rebuild now detects 2 movements:
   - Week 10 → Week 11: C → Jos (confirmed)
   - Week 12 → Week 13: Jos → B (already exists, not duplicated)

The rebuild handles this idempotently because it always re-derives from the full `plant_weekly_records` history.

---

## 6. What `current_location_id` Reflects

`plants_master.current_location_id` is **only updated by the most recent week** for each plant. Older uploads do NOT overwrite it.

So:
- Sites tab (location history) shows the FULL chronological timeline
- Plant detail current location always reflects the latest week
- Out-of-order uploads fill in history gaps without affecting "current" state

---

## 7. Admin Actions Available

| Action | When | Status Change |
|---|---|---|
| **Confirm** | Admin reviews a pending transfer and marks it complete | pending → confirmed |
| **Cancel** | Admin decides a pending transfer didn't actually happen | pending → cancelled |
| **Manual create** | Admin records a transfer that no report captured | (new) → confirmed |

There is **no** "delete" — cancelled transfers stay as audit trail.

---

## 8. Decision Tree (For Debugging)

Q: A plant moved from A to B. What should happen?

```
Did Site B's weekly report include this plant?
├─ YES (rebuild will detect it)
│   └─ Was there a pending transfer (plant, A, B)?
│       ├─ YES → UPDATE pending to confirmed (Source B + auto-confirm)
│       └─ NO → INSERT new confirmed (Source D)
│
└─ NO (still in transit)
    └─ Does Site A's report mention "transferred to B"?
        ├─ YES → save_confirmed creates pending (Source B)
        └─ NO → No transfer record exists yet (admin must manually create)
```

---

## 9. Identifying Sources in SQL

```sql
SELECT
  CASE
    WHEN is_pull_request THEN 'pull_request'
    WHEN source_remarks = 'AUTO_REBUILD_FROM_WEEKLY_RECORDS' THEN 'auto_rebuild'
    WHEN source_submission_id IS NOT NULL THEN 'preview_upload'
    ELSE 'admin_manual'
  END AS source,
  status,
  count(*)
FROM plant_transfers
GROUP BY 1, 2;
```

---

## 10. Notes for Future Improvements

- Consider adding a `confidence` score for auto-detected transfers (e.g., if there's a gap between Site A and Site B in weekly records, lower confidence)
- Surface "in-transit" plants more prominently (sum of pending transfers grouped by destination)
- Allow admin to "re-route" a pending transfer (e.g., destination changed)
