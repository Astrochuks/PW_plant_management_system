# Data Warehouse Restructuring Plan

## Overview
Rebuild the plant management database with clean, analytics-ready data. Starting with creating an **archived_plants** table from the legacy Plant List 2021 data.

---

## Phase 1: Archive Table from Legacy Data

### Data Source
- **File**: `Plant List 2021.xlsx`
- **Sheet**: "Plants & Equipment"
- **Header Row**: Row 4 (0-indexed = 3)

### New Database Tables

#### 1. `fleet_number_prefixes` (Lookup Table)
Maps fleet number letter prefixes to fleet types.

```sql
CREATE TABLE fleet_number_prefixes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prefix VARCHAR(20) NOT NULL UNIQUE,      -- e.g., "AC", "EG", "WP"
    fleet_type VARCHAR(100) NOT NULL,        -- e.g., "AIR COMPRESSOR"
    example_fleet_number VARCHAR(50),        -- e.g., "AC10"
    plant_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Known Prefix Mappings** (from existing data):
| Prefix | Fleet Type | Count |
|--------|-----------|-------|
| AC | AIR COMPRESSOR | 75 |
| AD | ARTICULATED DUMPER | 16 |
| AF | ASPHALT FINISHER | 6 |
| AP | ASPHALT PLANT | 5 |
| ASC | ASPHALT CUTTER | 7 |
| BB | BAR BENDER | 18 |
| BCS | BULK CEMENT SILO | 2 |
| BM | BLOCK MOLDER | 4 |
| BP | BATCHING PLANT | 9 |
| BS | BENCH SAW | 16 |
| C | COMPACTOR | 4 |
| CC | CORE CUTTER | 1 |
| CD | CRAWLIER DRILL | 9 |
| CM | CONCRETE MIXER | 14 |
| CMB | CEMENT BLOWER COMPRESSOR | 3 |
| CP | CRUSHING PLANT | 6 |
| D | DOZERS | 28 |
| DT | DUMPER | 10 |
| E | EXCAVATOR | 55 |
| EBM | ELECTRIC BORING MACHINE | 2 |
| EG | ELECTRIC GENERATOR | 151 |
| FBT | FLAT BED TRAILER | 21 |
| FL | FORK LIFT | 3 |
| FM | FOLDING MACHINE | 2 |
| FMP | FUEL METER PUMP | 20 |
| FT | FARM TRACTOR | 12 |
| FTT | FUEL TRAILER TANKER | 1 |
| G | GRADER | 19 |
| GCM | GRASS CUTTING MACHINE | 5 |
| GM | GRINDING MACHINE | 1 |
| HB | HAMMER BREAKER | 4 |
| HP | HEATING PLANT | 1 |
| HPR | HYDRAULIC PILING RIG | 1 |
| HS | HACKSAW | 1 |
| IC | IRON CUTTER | 25 |
| L | PAY-LOADERS | 38 |
| LL | LOW-LOADER | 12 |
| LPM | LINE PAINTING MACHINE | 2 |
| LT | LUXURIOUS TRAILER | 10 |
| MB | MOTOR BIKE | 3 |
| MCM | MOBILE CONCRETE MIXER | 10 |
| MCP | MOBILE CRUSHER | 4 |
| MLS | MOBILE LIGHTING SET | 7 |
| MM | MILLING MACHINE | 2 |
| MS | MOBILE SCREEN | 1 |
| P | PICK-UPS | 100 |
| PB | PERSONAL BUS | 1 |
| PF | POWER FLOAT MACHINE | 5 |
| PM | PLAINNER | 1 |
| PR | PNEUMATIC ROLLER | 7 |
| PT | PERSONAL TRANSPORT | 30 |
| PTP | PRESURE TESTING PUMP | 1 |
| RB | ROAD BRUSH | 10 |
| RD | DUMP TRUCKS | 56 |
| RT | ROUGH TERRIAN CRANE | 8 |
| S | SCRAPER | 8 |
| SB | SAND BLASTER | 1 |
| SC | STIHL CUTTER | 30 |
| SM | SHAPPING MACHINES | 3 |
| SP | SLIPFORM PAVER | 1 |
| T | TRUCKS | 276 |
| TC | TOWER CRANE | 2 |
| TCS | TAIL BOARD CHIPPING SPREADER | 8 |
| TH | TELE HANDLER | 4 |
| TM | TURNING MACHINE | 8 |
| TST | TAR SPRAYING TRAILER | 1 |
| TT | TIPPING TRAILERS | 19 |
| VP | VIBRATING PLATE | 29 |
| VPE | VIBRATING POCKER ENGINE | 158 |
| VR | VIBRATING ROLLER | 58 |
| VSI | VERTICAL SHAFT IMPACTOR | 1 |
| W | WELDER | 75 |
| WM | WASHING MACHINE | 52 |
| WP | WATER PUMP | 260 |
| WT | WATER TANKER TRAILER | 6 |

#### 2. `archived_plants` (Master Legacy Data)
Cleaned and normalized legacy plant data.

```sql
CREATE TABLE archived_plants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fleet_number VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    fleet_type VARCHAR(100),
    fleet_type_source VARCHAR(20),           -- 'original', 'prefix_lookup', 'description'
    make VARCHAR(100),
    model VARCHAR(100),
    chassis_number VARCHAR(100),
    year_of_manufacture INTEGER,
    purchase_cost NUMERIC(15,2),
    -- NOTE: location NOT included (will be set when moved to current_plants via weekly reports)
    serial_m VARCHAR(100),                   -- M Serial Number
    serial_e VARCHAR(100),                   -- E Serial Number

    -- Audit fields
    raw_data JSONB,                          -- Original row data before cleaning
    cleaning_notes TEXT[],                   -- Notes about transformations applied
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CHECK (year_of_manufacture IS NULL OR (year_of_manufacture >= 1900 AND year_of_manufacture <= 2100)),
    CHECK (purchase_cost IS NULL OR purchase_cost >= 0)
);

CREATE INDEX idx_archived_plants_fleet_number ON archived_plants(fleet_number);
CREATE INDEX idx_archived_plants_fleet_type ON archived_plants(fleet_type);
```

---

## Data Cleaning Logic

### Stage 1: Load to Staging
1. Read Excel file `Plant List 2021.xlsx`, sheet "Plants & Equipment"
2. Skip to header row 4
3. Get all columns
4. Normalize ALL column names to UPPERCASE
5. Normalize ALL text values to UPPERCASE (trim whitespace)

### Stage 2: Transform & Clean

#### 2.1 Remove Duplicates
- Group by `fleet_number`
- **Keep the most complete record** (row with most non-null values)
- Log duplicates with counts for audit trail

#### 2.2 Extract Fleet Number Prefix
```python
def extract_prefix(fleet_number: str) -> str:
    """Extract letter prefix from fleet number.

    Examples:
        "AC10"    -> "AC"
        "VPE102"  -> "VPE"
        "T385"    -> "T"
        "WP399"   -> "WP"
    """
    import re
    match = re.match(r'^([A-Z]+)', fleet_number.upper())
    return match.group(1) if match else None
```

#### 2.3 Build Prefix-to-FleetType Mapping
1. For each unique prefix:
   - Find first row with that prefix AND a valid fleet_type (not NULL, not "<<Add New Item>>")
   - Record: prefix -> fleet_type
2. Store in `fleet_number_prefixes` table

#### 2.4 Fill Missing Fleet Types
For rows where `fleet_type` is NULL or "<<Add New Item>>":
1. Extract prefix from fleet_number
2. Look up prefix in mapping table
3. If found: use mapped fleet_type, set `fleet_type_source = 'prefix_lookup'`
4. If not found AND it's the only one with that prefix: use description as fleet_type, set `fleet_type_source = 'description'`
5. If still not found: leave as NULL, add to cleaning_notes

#### 2.5 Handle "<<Add New Item>>" Values
| Column | Action |
|--------|--------|
| fleet_type | Use prefix lookup (see 2.4) |
| description | Use fleet_type value from others with same prefix |
| Other columns | Replace with NULL |

#### 2.6 Specific Fixes
| Fleet Number | Column | Current Value | Fix To |
|--------------|--------|---------------|--------|
| WP399 | description | `3"` | `3" WATER PUMP` |
| WP253 | description | `WP` | `WATER PUMP` |

#### 2.6.1 Prefix Fleet Type Overrides
These prefixes had incorrect fleet_type values in the source data:

| Prefix | Source Value | Corrected To |
|--------|-------------|--------------|
| EBM | `<< ADD NEW ITEM >>` | `ELECTRIC BORING MACHINE` |
| FM | `<< ADD NEW ITEM >>` | `FOLDING MACHINE` |
| GM | `<< ADD NEW ITEM >>` | `GRINDING MACHINE` |
| PC | `PERSONAL BUS` | `PERSONNEL CARRIER` |

#### 2.7 Handle Invalid Fleet Numbers
Fleet numbers that don't follow the standard pattern (no clear prefix):
- `ATLASCOPCO`, `ITELTOWER`, `KACHER`, `LUTIAN`, `NOFLEET`, `PWMINNING`, `TRIMER`
- `FBT18>T526`, `T508>WP296` (compound references)
- `BKD9063038`, `BKD9063039`, etc. (looks like serial numbers)

**Action**: **Exclude entirely** - These records will not be imported into the archived_plants table.

---

## Implementation Steps

### Step 1: Create Database Tables
```sql
-- 1. Create fleet_number_prefixes table
-- 2. Create archived_plants table
```

### Step 2: Build Prefix Mapping
```python
# 1. Query existing plants for prefix -> fleet_type mappings
# 2. Insert into fleet_number_prefixes table
```

### Step 3: ETL Pipeline for Legacy Data
```python
# 1. Extract: Read Plant List 2021.xlsx
# 2. Transform: Apply all cleaning logic
# 3. Load: Insert into archived_plants table
```

---

## Phase 2: Plants Master Table (Complete)

### Table Structure

```sql
CREATE TABLE plants_master (
    -- Identity
    id UUID PRIMARY KEY,
    fleet_number VARCHAR(50) NOT NULL UNIQUE,

    -- Equipment details
    description TEXT,
    fleet_type VARCHAR(100),           -- From prefix lookup (no FK)
    make VARCHAR(100),
    model VARCHAR(100),
    chassis_number VARCHAR(100),
    year_of_manufacture INTEGER,
    purchase_cost NUMERIC(15,2),
    serial_m VARCHAR(100),
    serial_e VARCHAR(100),

    -- Location
    current_location_id UUID REFERENCES locations(id),

    -- Status (AI-derived from remarks)
    status VARCHAR(20),                -- working, standby, breakdown, faulty,
                                       -- scrap, disposed, missing, stolen, unverified
    status_remarks TEXT,               -- AI explanation

    -- Verification tracking
    last_verified_date DATE,
    last_verified_year INTEGER,
    last_verified_week INTEGER,

    -- General
    remarks TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);
```

### Architecture: Weekly Snapshot Flow

```
Weekly Report → plant_weekly_records (immutable snapshot)
                        ↓
              plants_master (current state updated)
                        ↓
              plant_location_history (if location changed)
```

### Update Logic When Report Arrives

| Scenario | Action |
|----------|--------|
| Plant at same location | Update `last_verified_*` if verified |
| Plant at new location | Update `current_location_id`, add to history |
| Remarks changed | Update `remarks`, AI extracts new `status` |
| Plant not in report | Don't update (becomes stale/unverified) |

### Weekly Report Upload Logic

1. Parse incoming weekly report
2. For each fleet_number:
   - Check `plants_master` - if exists, update current state
   - If not in master, check `archived_plants`
   - If in archive: copy to master, delete from archive
   - If not anywhere: create new in master with fleet_type from prefix lookup
3. AI analyzes remarks to set status
4. Record snapshot in `plant_weekly_records`

---

## Phase 3: Weekly Report ETL Pipeline

### Data Quality Challenges

| Issue | Example | Solution |
|-------|---------|----------|
| Header row varies | Row 3 or 4 | Search rows 2-5 for "fleetnumber" |
| Location in different columns | Col 6 vs Col 8 | Search for text after "SITE LOCATION" |
| Case variations | "OGUN (Papalanto)" | Normalize to uppercase |
| Date formats | 25/01/26, 25-1-26, 25-jan-2026, 1/25/26 | Parse with dateutil, dayfirst=True |
| Wrong week numbers | Week 5 when date=25/01/26 | Calculate from date, ignore file's week |
| File name ≠ Sheet location | File: FOKE, Sheet: ABEOKUTA | Use sheet location |
| Fleet number spaces | "AC 10" vs "AC10" | Remove spaces, uppercase |

### Tables Involved

```
locations              → Site locations (auto-create if new)
plants_master          → Current state (update if report is newer)
plant_weekly_records   → Weekly snapshots (always saved)
plant_location_history → Location changes with dates
archived_plants        → Legacy data (migrate to master when seen)
fleet_number_prefixes  → Fleet type lookup from prefix
```

### ETL Pipeline Steps

```
STEP 1: EXTRACT METADATA
├── Scan rows 0-5 for week_ending_date (handles all formats)
├── Calculate week_number from date (ignore file's week)
├── Extract location from sheet (after "SITE LOCATION")
├── Normalize location to UPPERCASE
├── Lookup/create in locations table
└── Find header row (contains "fleetnumber")

STEP 2: EXTRACT & NORMALIZE PLANT DATA
├── Read from header_row + 1
├── Normalize fleet_number (remove spaces, uppercase)
├── Parse hours (handle NaN, empty, text)
└── Extract physical_verification (P = true)

STEP 3: RESOLVE PLANT IDENTITY
For each fleet_number:
├── Check plants_master → if exists, note it
├── Check archived_plants → if exists, migrate to master
└── Not found → create new in master (fleet_type from prefix)

STEP 4: AI STATUS EXTRACTION
Analyze REMARK + TRANSF columns:
├── "working" → working
├── "standby", "standing by" → standby
├── "broke down", "breakdown" → breakdown
├── "faulty", "fault" → faulty
├── "scrap" → scrap
├── "stolen" → stolen
├── "missing", "not seen" → missing
├── TRANSF_TO filled → in_transit
└── No remark → unverified

STEP 5: SAVE DATA
├── INSERT plant_weekly_records (snapshot - always)
├── UPDATE plants_master (only if report is newer)
└── INSERT plant_location_history (if location changed)
```

### Update Logic: Most Recent Takes Precedence

```python
# Only update plants_master if this report is newer
if report.week_ending_date >= plant.last_verified_date:
    update plants_master
else:
    # Still save snapshot, but don't update master
    save to plant_weekly_records only
```

### Duplicate Plant Same Week (2 locations)

When plant appears in multiple reports for same week:
1. AI analyzes remarks to determine true location
2. "Transferred from X" → plant is at current report's location
3. "In transit to Y" → plant is in_transit
4. Both claim "Working" → flag for manual review

### Status Values

```
working     - Operational, in use
standby     - Available but not in use
breakdown   - Currently broken
faulty      - Has issues, partially functional
scrap       - Written off
missing     - Cannot be located
stolen      - Reported stolen
unverified  - Not verified this week
in_transit  - Being transferred between sites
```

---

## Verification Checklist

- [x] All fleet_numbers are unique (no duplicates) - 21 duplicates removed
- [x] All text values are UPPERCASE
- [x] No "<<Add New Item>>" values remain
- [x] Fleet types filled for all rows - 1903/1903 have fleet_type (30 via prefix lookup, 2 via description)
- [x] WP399 and WP253 descriptions fixed
- [x] Invalid fleet numbers excluded (FFF, etc.)
- [x] Raw data preserved in `raw_data` column
- [x] Cleaning transformations logged in `cleaning_notes`

### ETL Results (Phase 1 Complete)

| Metric | Value |
|--------|-------|
| Total source rows | 1925 |
| Invalid excluded | 2 (FFF, FF) |
| Duplicates removed | 21 |
| Fleet types filled from prefix | 30 |
| Specific fixes applied | 2 |
| Prefix overrides applied | 4 (EBM, FM, GM, PC) |
| **Records loaded** | **1,902** |
| **Prefix mappings** | **78** |
| **Unique fleet types** | **77** |

---

## Design Decisions (Confirmed)

1. **Duplicate handling**: Keep the most complete record (row with most non-null values)
2. **Invalid fleet numbers**: Exclude entirely from import
3. **Location data**: Do not include - location will be set when plants are moved to current_plants via weekly reports
