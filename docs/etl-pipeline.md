# ETL Pipeline Documentation

## Overview

The ETL (Extract, Transform, Load) pipeline processes weekly Excel reports from site locations and updates the plant management database.

---

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     ETL PIPELINE                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │ EXTRACT  │───▶│TRANSFORM │───▶│   LOAD   │───▶│ VALIDATE │  │
│  │          │    │          │    │          │    │          │  │
│  │ - Excel  │    │ - Clean  │    │ - Upsert │    │ - Counts │  │
│  │ - Parse  │    │ - Status │    │ - History│    │ - Errors │  │
│  │ - Meta   │    │ - Lookup │    │ - Snapshot│   │ - Report │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. EXTRACT Phase

### 1.1 Metadata Extraction

```python
def extract_metadata(file_path: Path) -> ReportMetadata:
    """
    Scans rows 0-10 of Excel file to extract:
    - location: Site name from "SITE LOCATION - XXX"
    - week_ending_date: Date from "WEEK ENDING" or "DATE" row
    - week_number: Calculated from date (not from file)
    - header_row: Row containing column headers
    """
```

**Date Formats Handled:**
| Format | Example |
|--------|---------|
| DD/MM/YY | 25/01/26 |
| DD-MM-YY | 25-01-26 |
| DD/MM/YYYY | 25/01/2026 |
| DD-Mon-YYYY | 25-Jan-2026 |
| Datetime | 2026-01-25 00:00:00 |
| With spaces | 25 /01/26 |

**Location Extraction:**
- Searches for "SITE LOCATION" text
- Extracts text after "-" or in adjacent cell
- Falls back to filename if not found
- Normalized to UPPERCASE

### 1.2 Column Mapping

The ETL handles various column name variations:

| Target | Variations |
|--------|-----------|
| fleet_number | fleetnumber, fleet number, fleet no, fleet . no. |
| description | fleetdescription, fleet description, description |
| hours_worked | hours worked, hoursworked, hrs worked |
| standby_hours | s/b hour, s/b hours, standby hours |
| breakdown_hours | b/d hour, b/d hours, breakdown hours |
| remarks | remark, remarks, comment, comments |
| verification | physical plant, verification, physical plant verification |
| transfer_from | transf. from, transfer from, transferd from |
| transfer_to | transf. to, transfer to, transfered to |

### 1.3 Fleet Number Normalization

```python
def normalize_fleet_number(value: str) -> str:
    """
    - Uppercase
    - Remove spaces ("AC 10" → "AC10")
    - Filter invalid values (NaN, None, empty)
    """
```

**Invalid Fleet Numbers (Excluded):**
```python
INVALID_FLEET_NUMBERS = {
    "ATLASCOPCO", "ITELTOWER", "KACHER", "LUTIAN",
    "NOFLEET", "PWMINNING", "TRIMER", "FFF", "FF", "WPNOFLEET"
}
```

Also excluded:
- Compound references containing ">" (e.g., "FBT22>T249")
- Serial number patterns starting with "BKD"

---

## 2. TRANSFORM Phase

### 2.1 Status Extraction

The ETL extracts plant status from the REMARK column using keyword matching:

```python
STATUS_KEYWORDS = {
    'working': ['working', 'operational', 'running', 'in use'],
    'standby': ['standby', 'stand by', 'standing by', 'idle', 'available'],
    'breakdown': ['breakdown', 'broke down', 'broken', 'not working', 'down', 'bd', 'b/d'],
    'faulty': ['faulty', 'fault', 'defective', 'problem', 'issue'],
    'scrap': ['scrap', 'scrapped', 'write off', 'written off', 'condemned'],
    'missing': ['missing', 'not seen', 'cannot locate', 'not found', 'not on site', 'not seen on site'],
    'stolen': ['stolen', 'theft'],
    'in_transit': ['transit', 'transferred', 'transfer to', 'moving to', 'in route'],
    'off_hire': ['off hired', 'off hire', 'offhired', 'off-hired', 'offhire'],
}
```

**Logic:**
```python
def extract_status_from_remarks(remarks: str, transfer_to: str) -> tuple[str, str]:
    # 1. If transfer_to is filled → in_transit
    if transfer_to:
        return 'in_transit', f'Transfer to {transfer_to}'

    # 2. Check keywords in order
    for status, keywords in STATUS_KEYWORDS.items():
        for keyword in keywords:
            if keyword.upper() in remarks.upper():
                return status, f'Keyword "{keyword}" found'

    # 3. Has remarks but no keywords → assume working
    if remarks:
        return 'working', 'Has remarks but no status keywords'

    # 4. No remarks → unverified
    return 'unverified', 'No remarks provided'
```

### 2.2 Physical Verification Parsing

```python
def parse_verification(value) -> bool:
    """
    Returns True for:
    - P, YES, Y, TRUE, 1
    - ✓, ✔, ☑, ✅ (checkmarks)

    Returns False for:
    - O, NO, N, FALSE, 0
    - ✗, ✕, ×, ☒, ❌ (X marks)
    - NULL, empty
    """
```

### 2.3 Fleet Type Lookup

```python
def extract_prefix(fleet_number: str) -> str:
    """Extract letter prefix: AC10 → AC, VPE102 → VPE"""
    match = re.match(r'^([A-Z]+)', fleet_number.upper())
    return match.group(1) if match else None

def get_fleet_type(fleet_number: str) -> str:
    """Look up fleet type from prefix cache"""
    prefix = extract_prefix(fleet_number)
    return prefix_cache.get(prefix)  # e.g., "AC" → "AIR COMPRESSOR"
```

---

## 3. LOAD Phase

### 3.1 Plant Categorization

For each plant in the report:

```python
if fleet_number in plants_master_cache:
    # EXISTS in master → UPDATE
    plants_to_update.append(plant)

elif fleet_number in archived_plants_cache:
    # EXISTS in archive → MIGRATE to master
    plants_to_migrate.append(plant)

else:
    # NEW plant → CREATE in master
    plants_to_create.append(plant)
```

### 3.2 Batch Operations

**Create New Plants:**
```python
# Batch upsert with conflict handling
supabase.table("plants_master").upsert(
    batch, on_conflict="fleet_number"
).execute()
```

**Migrate from Archive:**
```python
# 1. Insert to master
supabase.table("plants_master").upsert(batch).execute()

# 2. Delete from archive
supabase.table("archived_plants").delete().in_("fleet_number", fleet_numbers).execute()
```

**Update Existing:**
```python
# Only update if report is newer
if report_date >= plant.last_verified_date:
    supabase.table("plants_master").update({
        'current_location_id': location_id,
        'status': status,
        'physical_verification': verified,
        'last_verified_date': report_date,
        'last_verified_week': week_number,
        'remarks': remarks
    }).eq("id", plant_id).execute()
```

### 3.3 Location History

```python
if location_changed:
    # Close previous location (set end_date)
    if old_location_id:
        existing = supabase.table("plant_location_history")
            .select("start_date")
            .eq("plant_id", plant_id)
            .is_("end_date", "null")
            .execute()

        # Only close if end_date >= start_date
        if report_date >= existing.start_date:
            supabase.table("plant_location_history")
                .update({'end_date': report_date})
                .eq("plant_id", plant_id)
                .is_("end_date", "null")
                .execute()

    # Create new location record
    supabase.table("plant_location_history").insert({
        'plant_id': plant_id,
        'location_id': new_location_id,
        'start_date': report_date
    }).execute()
```

### 3.4 Weekly Snapshots

```python
# Always save (immutable record)
supabase.table("plant_weekly_records").upsert({
    'plant_id': plant_id,
    'location_id': location_id,
    'year': year,
    'week_number': week_number,
    'week_ending_date': report_date,
    'physical_verification': verified,
    'remarks': remarks,
    'hours_worked': hours,
    'standby_hours': standby,
    'breakdown_hours': breakdown,
    'transfer_from': transfer_from,
    'transfer_to': transfer_to
}, on_conflict="plant_id,year,week_number").execute()
```

---

## 4. Performance

### Current Metrics

| Metric | Value |
|--------|-------|
| Single file | ~10 seconds |
| 27 files (parallel, 3 workers) | ~206 seconds |
| Plants per file | 6-661 |
| Batch size | 100 records |

### Parallel Processing

```python
MAX_WORKERS = 3  # Concurrent file processing

with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
    futures = {executor.submit(process_file, f): f for f in files}
    for future in as_completed(futures):
        result = future.result()
```

**Thread Safety:**
- `_cache_lock`: Protects shared caches (plants_master_cache, etc.)
- `_stats_lock`: Protects statistics counters
- Database handles its own concurrency

---

## 5. Error Handling

### Validation Errors

| Error | Action |
|-------|--------|
| Invalid file format | Reject upload |
| No date found | Reject file |
| No header row | Reject file |
| Invalid fleet number | Skip row |
| Duplicate in batch | Deduplicate |

### Database Errors

| Error | Action |
|-------|--------|
| Duplicate key | Upsert handles it |
| FK violation | Skip record |
| Connection timeout | Log error, continue |

### Recovery

- Failed uploads tracked in `weekly_report_submissions`
- Partial processing is safe (upserts are idempotent)
- Re-running same file overwrites with latest data

---

## 6. Status Extraction Analysis

### Current Keyword-Based System

**Strengths:**
- Fast (no API calls)
- Deterministic
- Covers 80%+ of cases

**Weaknesses:**
- Misses complex remarks like "Steering pump removed, waiting for parts"
- Can't understand context ("BD" might mean "Bad" or "Breakdown")
- No severity detection

### Examples of Challenging Remarks

| Remark | Current Status | Ideal Status |
|--------|---------------|--------------|
| "BD" | breakdown | breakdown ✓ |
| "Working" | working | working ✓ |
| "Not on site" | missing | missing ✓ |
| "Off hired" | off_hire | off_hire ✓ |
| "Pump faulty, still operational" | faulty | working (degraded) |
| "Sent to workshop for service" | unverified | maintenance |
| "Clutch problem, starter issue" | faulty | faulty ✓ |
| "Removed battery, waiting" | unverified | standby |
| "Back from repairs, running" | working | working ✓ |

### AI Enhancement Recommendation

**When to add AI:**
1. If >10% of plants have wrong status
2. If business needs severity levels
3. If predictive maintenance is required

**Suggested AI approach:**
```python
# Only call AI for ambiguous cases
if status == 'unverified' and remarks:
    ai_status = await analyze_with_ai(remarks)
    # Store AI response for audit
    status_remarks = f"AI: {ai_status.explanation}"
```

**AI prompt example:**
```
Analyze this plant equipment remark and extract:
1. Status: working, standby, breakdown, faulty, missing, scrap, off_hire, in_transit, stolen
2. Confidence: high, medium, low
3. Issues found (list)
4. Recommended action

Remark: "Removed steering pump, air booster and hand brake. Tank leakage."
```

---

## 7. Configuration

### Environment Variables

```env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=your-service-role-key
WEEKLY_REPORTS_DIR=/path/to/reports
MAX_WORKERS=3
BATCH_SIZE=100
```

### ETL Config

```python
# etl/config.py
class ETLConfig:
    supabase_url: str
    supabase_key: str
    weekly_reports_dir: Path
    archive_file: Path = Path("data/Plant List 2021.xlsx")
```

---

## 8. Usage

### Run Archive ETL (one-time)
```bash
python etl/archive_etl.py
```

### Run Weekly Report ETL
```bash
python etl/weekly_report_etl.py
```

### Programmatic Usage
```python
from etl.weekly_report_etl import WeeklyReportETL
from supabase import create_client

supabase = create_client(url, key)
etl = WeeklyReportETL(supabase, parallel=True)
stats = etl.run(Path("new plants"))

print(f"Processed: {stats.plants_processed}")
print(f"Created: {stats.plants_created}")
print(f"Errors: {stats.errors}")
```
