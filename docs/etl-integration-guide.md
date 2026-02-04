# ETL Integration Guide for Backend

This guide explains how to integrate the ETL pipeline with the FastAPI backend.

---

## Overview

The system has two ETL modules:

| Module | Purpose | File |
|--------|---------|------|
| `WeeklyReportETL` | Process weekly Excel reports | `etl/weekly_report_etl.py` |
| `clean_spare_parts.py` | Import spare parts from Excel | `clean_spare_parts.py` |

---

## 1. Weekly Report ETL

### Usage in Backend

```python
from pathlib import Path
from supabase import create_client
from etl.weekly_report_etl import WeeklyReportETL

# Initialize
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
etl = WeeklyReportETL(supabase, parallel=False)  # Use parallel=False for single file

# Process a single uploaded file
stats = etl.process_file(Path("/tmp/uploads/ABUJA WEEK 5.xlsx"))

# Or process a directory of files
stats = etl.run(Path("weekly_reports/"))
```

### Return Value (ETLStats)

```python
@dataclass
class ETLStats:
    files_processed: int = 0
    plants_processed: int = 0
    plants_created: int = 0      # New plants added to plants_master
    plants_updated: int = 0      # Existing plants updated
    plants_migrated: int = 0     # Moved from archived_plants to plants_master
    weekly_records_created: int = 0
    location_changes: int = 0    # Plants that moved location
    errors: list = field(default_factory=list)
```

### What the ETL Does

1. **Extract** metadata from Excel:
   - Location (from "SITE LOCATION" row)
   - Week ending date
   - Week number

2. **Transform** each plant row:
   - Normalize fleet number (uppercase, no spaces)
   - Extract status from remarks (working, standby, breakdown, etc.)
   - Parse verification status (P/O, checkmarks)
   - Parse hours (hours_worked, standby_hours, breakdown_hours)
   - Parse transfers (transfer_from, transfer_to)

3. **Load** to database:
   - Create/update `plants_master` (current state)
   - Create `plant_weekly_records` (immutable snapshot)
   - Update `plant_location_history` (if location changed)
   - Create `weekly_report_submissions` (audit trail)

### Status Extraction Keywords

```python
STATUS_KEYWORDS = {
    'working': ['working', 'operational', 'running', 'in use'],
    'standby': ['standby', 'stand by', 'idle', 'available'],
    'breakdown': ['breakdown', 'broke down', 'not working', 'bd', 'b/d', 'for repairs'],
    'faulty': ['faulty', 'fault', 'no engine', 'no compressor'],
    'scrap': ['scrap', 'scrapped', 'write off', 'condemned'],
    'missing': ['missing', 'not seen', 'not found', 'not on site'],
    'stolen': ['stolen', 'theft'],
    'in_transit': ['transit', 'transferred', 'transfer to'],
    'off_hire': ['off hired', 'off hire', 'offhired'],
}
```

### Example API Endpoint

```python
from fastapi import UploadFile, BackgroundTasks
from etl.weekly_report_etl import WeeklyReportETL

@router.post("/reports/upload")
async def upload_report(
    file: UploadFile,
    background_tasks: BackgroundTasks,
    db: Client = Depends(get_supabase)
):
    # Save file to temp location
    temp_path = Path(f"/tmp/uploads/{file.filename}")
    with open(temp_path, "wb") as f:
        f.write(await file.read())

    # Create submission record
    submission = db.table("weekly_report_submissions").insert({
        "filename": file.filename,
        "status": "processing"
    }).execute()

    # Process in background
    background_tasks.add_task(
        process_report_task,
        temp_path,
        submission.data[0]["id"],
        db
    )

    return {"submission_id": submission.data[0]["id"], "status": "processing"}

async def process_report_task(file_path: Path, submission_id: str, db: Client):
    etl = WeeklyReportETL(db, parallel=False)
    try:
        stats = etl.process_file(file_path)
        db.table("weekly_report_submissions").update({
            "status": "completed",
            "plants_processed": stats.plants_processed,
            "plants_created": stats.plants_created,
            "plants_updated": stats.plants_updated
        }).eq("id", submission_id).execute()
    except Exception as e:
        db.table("weekly_report_submissions").update({
            "status": "failed",
            "error_message": str(e)
        }).eq("id", submission_id).execute()
    finally:
        file_path.unlink()  # Cleanup
```

---

## 2. Spare Parts Import

### For Ongoing Data Entry (Backend API)

The `clean_spare_parts.py` script is for **initial bulk import only**. For ongoing data entry, use direct database inserts:

```python
@router.post("/spare-parts")
async def add_spare_part(
    data: SparePartCreate,
    db: Client = Depends(get_supabase)
):
    # Look up plant_id
    plant = db.table("plants_master").select("id").eq(
        "fleet_number", data.fleet_number
    ).single().execute()

    if not plant.data:
        raise HTTPException(404, "Plant not found")

    # Look up location_id
    location = db.table("locations").select("id").eq(
        "name", data.location.upper()
    ).single().execute()

    # Insert spare part
    # Note: year, month, week_number are auto-populated by trigger
    result = db.table("spare_parts").insert({
        "plant_id": plant.data["id"],
        "location_id": location.data["id"] if location.data else None,
        "replaced_date": data.date,
        "part_description": data.description,
        "unit_cost": data.cost / data.quantity,  # Calculate unit cost
        "quantity": data.quantity,
        "supplier": data.supplier,
        "reason_for_change": data.reason,
        "purchase_order_number": data.po_number,
    }).execute()

    return result.data[0]
```

### Time Columns (Auto-Populated)

The `spare_parts` table has a trigger that automatically populates:
- `year` - Extracted from `replaced_date`
- `month` - 1-12
- `week_number` - ISO week 1-53

No need to calculate these in the backend.

---

## 3. Database Tables Summary

### Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `plants_master` | Current plant state | fleet_number, current_location_id, status |
| `plant_weekly_records` | Immutable weekly snapshots | plant_id, year, week_number |
| `plant_location_history` | Movement tracking | plant_id, location_id, start_date, end_date |
| `spare_parts` | Parts replacement history | plant_id, location_id, replaced_date |

### Lookup Tables

| Table | Purpose |
|-------|---------|
| `locations` | Site locations (27 sites) |
| `fleet_number_prefixes` | Prefix → fleet type mapping |
| `archived_plants` | Legacy plants not yet in reports |

### Tracking Tables

| Table | Purpose |
|-------|---------|
| `weekly_report_submissions` | File upload tracking |
| `notifications` | User alerts |
| `plant_events` | Audit log |

---

## 4. Analytics Queries

The database has optimized indexes for these common queries:

### Spending by Time Period

```sql
-- Monthly spending
SELECT year, month, SUM(unit_cost * quantity) as total
FROM spare_parts
GROUP BY year, month
ORDER BY year, month;

-- Weekly spending
SELECT year, week_number, SUM(unit_cost * quantity) as total
FROM spare_parts
GROUP BY year, week_number;
```

### Spending by Location

```sql
SELECT l.name, SUM(sp.unit_cost * sp.quantity) as total
FROM spare_parts sp
JOIN locations l ON sp.location_id = l.id
GROUP BY l.name
ORDER BY total DESC;
```

### Plant Full Details

```sql
-- Get plant with spending summary
SELECT
    pm.*,
    l.name as location_name,
    (SELECT SUM(unit_cost * quantity) FROM spare_parts WHERE plant_id = pm.id) as total_spent,
    (SELECT COUNT(*) FROM spare_parts WHERE plant_id = pm.id) as parts_count
FROM plants_master pm
LEFT JOIN locations l ON pm.current_location_id = l.id
WHERE pm.fleet_number = 'T100';
```

### Top Spending Plants

```sql
SELECT
    pm.fleet_number,
    pm.fleet_type,
    l.name as location,
    SUM(sp.unit_cost * sp.quantity) as total_spent,
    COUNT(sp.id) as parts_count
FROM spare_parts sp
JOIN plants_master pm ON sp.plant_id = pm.id
LEFT JOIN locations l ON pm.current_location_id = l.id
GROUP BY pm.id, pm.fleet_number, pm.fleet_type, l.name
ORDER BY total_spent DESC
LIMIT 20;
```

---

## 5. Performance Notes

### Database Optimization

- **Indexes**: All tables have appropriate indexes for common queries
- **BRIN Index**: `spare_parts.replaced_date` has BRIN index for time-series queries
- **Full-text Search**: `spare_parts.part_description` has GIN index for search
- **Partial Indexes**: High-cost items, non-null values indexed separately

### Current Data Size

| Table | Rows | Size |
|-------|------|------|
| plant_weekly_records | 1,732 | 832 KB |
| plants_master | 1,601 | 936 KB |
| plant_location_history | 1,587 | 1.4 MB |
| spare_parts | 458 | 1 MB |

### Scaling Considerations

- Current size is small, can handle 100x growth easily
- Consider partitioning `plant_weekly_records` by year if >100K rows
- Consider archiving old `spare_parts` after 5+ years

---

## 6. Notifications

Create notifications for key events:

```python
def create_notification(db, user_id, type, title, message, data=None):
    db.table("notifications").insert({
        "user_id": user_id,
        "type": type,
        "title": title,
        "message": message,
        "data": data or {}
    }).execute()

# Examples:
create_notification(db, user_id, "report_submitted",
    "Report Uploaded", f"ABUJA Week 5 processed: 661 plants")

create_notification(db, user_id, "plant_moved",
    "Plant Transfer", f"T100 moved from ABUJA to JOS")

create_notification(db, user_id, "anomaly_detected",
    "Spending Alert", f"P415 has ₦6.9M spending but never verified")
```

---

## 7. Configuration

### Environment Variables

```env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=your-service-role-key
WEEKLY_REPORTS_DIR=/path/to/reports
```

### Config Class

```python
# etl/config.py
from dataclasses import dataclass
from pathlib import Path

@dataclass
class ETLConfig:
    supabase_url: str
    supabase_key: str
    weekly_reports_dir: Path
    legacy_file: Path = Path("data/Plant List 2021.xlsx")
    legacy_header_row: int = 3
```
