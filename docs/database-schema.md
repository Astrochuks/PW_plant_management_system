# Database Schema Documentation

## Overview

The Plant Management System uses Supabase (PostgreSQL) with a data warehouse architecture designed for:
- Historical tracking of plant movements
- Weekly report snapshots
- Analytics and AI integration

---

## Tables

### 1. `locations`
Site locations where plants operate.

```sql
CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,  -- e.g., "ABUJA", "JOS, ZARIA RD"
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR(100) | Location name (UPPERCASE) |
| created_at | TIMESTAMPTZ | Record creation time |

**Current Count**: 27 locations

---

### 2. `fleet_number_prefixes`
Lookup table mapping fleet number prefixes to fleet types.

```sql
CREATE TABLE fleet_number_prefixes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prefix VARCHAR(20) NOT NULL UNIQUE,      -- e.g., "AC", "EG", "WP"
    fleet_type VARCHAR(100) NOT NULL,        -- e.g., "AIR COMPRESSOR"
    example_fleet_number VARCHAR(50),        -- e.g., "AC10"
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

| Column | Type | Description |
|--------|------|-------------|
| prefix | VARCHAR(20) | Letter prefix (AC, EG, WP, etc.) |
| fleet_type | VARCHAR(100) | Equipment type name |
| example_fleet_number | VARCHAR(50) | Example fleet number |

**Current Count**: 78 prefixes

**Key Mappings**:
| Prefix | Fleet Type |
|--------|-----------|
| AC | AIR COMPRESSOR |
| ACS | ASPHALT CUTTER |
| ASC | ASPHALT CUTTER |
| D | DOZERS |
| E | EXCAVATOR |
| EG | ELECTRIC GENERATOR |
| T | TRUCKS |
| WP | WATER PUMP |
| VPE | VIBRATING POCKER ENGINE |

---

### 3. `archived_plants`
Legacy plant data from Plant List 2021 (not yet seen in weekly reports).

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
    serial_m VARCHAR(100),                   -- M Serial Number
    serial_e VARCHAR(100),                   -- E Serial Number
    raw_data JSONB,                          -- Original row data
    cleaning_notes TEXT[],                   -- Transformations applied
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CHECK (year_of_manufacture IS NULL OR (year_of_manufacture >= 1900 AND year_of_manufacture <= 2100)),
    CHECK (purchase_cost IS NULL OR purchase_cost >= 0)
);

CREATE INDEX idx_archived_plants_fleet_number ON archived_plants(fleet_number);
CREATE INDEX idx_archived_plants_fleet_type ON archived_plants(fleet_type);
```

**Current Count**: ~480 plants (remaining legacy data not yet seen in reports)

**Migration Logic**: When a plant from archive appears in a weekly report:
1. Copy to `plants_master` with current location/status
2. Delete from `archived_plants`

---

### 4. `plants_master`
Current state of all active plants (the "live" table).

```sql
CREATE TABLE plants_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fleet_number VARCHAR(50) NOT NULL UNIQUE,

    -- Equipment details
    description TEXT,
    fleet_type VARCHAR(100),
    make VARCHAR(100),
    model VARCHAR(100),
    chassis_number VARCHAR(100),
    year_of_manufacture INTEGER,
    purchase_cost NUMERIC(15,2),
    serial_m VARCHAR(100),
    serial_e VARCHAR(100),

    -- Current state
    current_location_id UUID REFERENCES locations(id),
    status VARCHAR(20),                      -- working, standby, breakdown, etc.
    status_remarks TEXT,                     -- AI/ETL explanation
    physical_verification BOOLEAN DEFAULT FALSE,

    -- Verification tracking
    last_verified_date DATE,
    last_verified_year INTEGER,
    last_verified_week INTEGER,

    -- General
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_plants_master_fleet_number ON plants_master(fleet_number);
CREATE INDEX idx_plants_master_location ON plants_master(current_location_id);
CREATE INDEX idx_plants_master_status ON plants_master(status);
```

**Current Count**: ~1,599 plants

**Status Values**:
| Status | Description | Count |
|--------|-------------|-------|
| working | Operational, in use | 646 (40.4%) |
| missing | Cannot be located, not on site | 257 (16.1%) |
| standby | Available but not in use | 231 (14.4%) |
| unverified | No remarks provided | 145 (9.1%) |
| faulty | Has issues (no engine, no compressor, etc.) | 136 (8.5%) |
| breakdown | Currently broken, for repairs | 97 (6.1%) |
| scrap | Written off | 70 (4.4%) |
| off_hire | Equipment off-hired/not in service | 15 (0.9%) |
| in_transit | Being transferred | 1 |
| stolen | Reported stolen | 1 |

---

### 5. `plant_location_history`
Tracks plant movements between sites over time.

```sql
CREATE TABLE plant_location_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id UUID NOT NULL REFERENCES plants_master(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id),
    start_date DATE NOT NULL,
    end_date DATE,                           -- NULL = current location
    transfer_reason TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CHECK ((end_date IS NULL) OR (end_date >= start_date))
);

CREATE INDEX idx_location_history_plant ON plant_location_history(plant_id);
CREATE INDEX idx_location_history_location ON plant_location_history(location_id);
CREATE INDEX idx_location_history_dates ON plant_location_history(start_date, end_date);
```

**Logic**:
- Each plant has ONE open record (end_date = NULL) = current location
- When plant moves: close old record (set end_date), create new record
- Historical queries: find all locations a plant has been

---

### 6. `plant_weekly_records`
Immutable weekly snapshots (audit trail).

```sql
CREATE TABLE plant_weekly_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id UUID NOT NULL REFERENCES plants_master(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id),
    submission_id UUID REFERENCES weekly_report_submissions(id),

    -- Time
    year INTEGER NOT NULL,
    week_number INTEGER NOT NULL,
    week_ending_date DATE NOT NULL,

    -- Status
    physical_verification BOOLEAN DEFAULT FALSE,
    remarks TEXT,
    raw_remarks TEXT,                        -- Original before AI processing

    -- Hours
    hours_worked NUMERIC(10,2) DEFAULT 0,
    standby_hours NUMERIC(10,2) DEFAULT 0,
    breakdown_hours NUMERIC(10,2) DEFAULT 0,
    off_hire BOOLEAN DEFAULT FALSE,

    -- Transfers
    transfer_from VARCHAR(100),
    transfer_to VARCHAR(100),

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (plant_id, year, week_number)
);

CREATE INDEX idx_weekly_records_plant ON plant_weekly_records(plant_id);
CREATE INDEX idx_weekly_records_week ON plant_weekly_records(year, week_number);
CREATE INDEX idx_weekly_records_location ON plant_weekly_records(location_id);
```

**Purpose**:
- Never modified after creation (immutable snapshots)
- Allows time-travel queries ("What was T100's status in Week 3?")
- Analytics on hours worked, verification rates, etc.

---

### 7. `weekly_report_submissions`
Tracks file uploads and processing status.

```sql
CREATE TABLE weekly_report_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename VARCHAR(255) NOT NULL,
    location_id UUID REFERENCES locations(id),

    -- Time
    year INTEGER,
    week_number INTEGER,
    week_ending_date DATE,

    -- Status
    status VARCHAR(20) DEFAULT 'pending',    -- pending, processing, completed, failed
    error_message TEXT,

    -- Stats
    plants_processed INTEGER DEFAULT 0,
    plants_created INTEGER DEFAULT 0,
    plants_updated INTEGER DEFAULT 0,
    plants_migrated INTEGER DEFAULT 0,

    -- Audit
    uploaded_by UUID REFERENCES users(id),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Relationships

```
┌─────────────────────┐
│     locations       │
└─────────────────────┘
         │
         │ 1:N
         ▼
┌─────────────────────┐       ┌─────────────────────┐
│   plants_master     │◄──────│   archived_plants   │
│  (current state)    │migrate│   (legacy data)     │
└─────────────────────┘       └─────────────────────┘
         │
         │ 1:N
         ├──────────────────────────┐
         ▼                          ▼
┌─────────────────────┐    ┌─────────────────────┐
│plant_location_history│    │ plant_weekly_records│
│  (movement history) │    │   (weekly snapshots)│
└─────────────────────┘    └─────────────────────┘
```

---

## Data Flow

```
Excel File Upload
       │
       ▼
┌──────────────────┐
│  ETL Pipeline    │
│  - Extract       │
│  - Transform     │
│  - Load          │
└──────────────────┘
       │
       ├─────────────────────────────────────┐
       ▼                                     ▼
┌──────────────────┐                ┌──────────────────┐
│  plants_master   │                │plant_weekly_records│
│  (UPDATE/INSERT) │                │    (INSERT)      │
└──────────────────┘                └──────────────────┘
       │
       ▼ (if location changed)
┌──────────────────┐
│plant_location_   │
│    history       │
│ (close old,      │
│  open new)       │
└──────────────────┘
```

---

## Key Queries

### Get plant current status
```sql
SELECT
    pm.fleet_number,
    pm.description,
    pm.fleet_type,
    l.name as location,
    pm.status,
    pm.last_verified_date,
    pm.physical_verification
FROM plants_master pm
JOIN locations l ON pm.current_location_id = l.id
WHERE pm.fleet_number = 'T100';
```

### Get plant location history
```sql
SELECT
    l.name as location,
    plh.start_date,
    plh.end_date,
    CASE WHEN plh.end_date IS NULL THEN 'Current' ELSE 'Past' END as status
FROM plant_location_history plh
JOIN locations l ON plh.location_id = l.id
WHERE plh.plant_id = (SELECT id FROM plants_master WHERE fleet_number = 'T100')
ORDER BY plh.start_date DESC;
```

### Get weekly history for a plant
```sql
SELECT
    pwr.year,
    pwr.week_number,
    pwr.week_ending_date,
    l.name as location,
    pwr.physical_verification,
    pwr.remarks,
    pwr.hours_worked
FROM plant_weekly_records pwr
JOIN locations l ON pwr.location_id = l.id
WHERE pwr.plant_id = (SELECT id FROM plants_master WHERE fleet_number = 'T100')
ORDER BY pwr.year DESC, pwr.week_number DESC;
```

### Plants at a location
```sql
SELECT
    pm.fleet_number,
    pm.fleet_type,
    pm.status,
    pm.physical_verification
FROM plants_master pm
WHERE pm.current_location_id = (SELECT id FROM locations WHERE name = 'ABUJA')
ORDER BY pm.fleet_type, pm.fleet_number;
```

### Status summary by location
```sql
SELECT
    l.name as location,
    pm.status,
    COUNT(*) as count
FROM plants_master pm
JOIN locations l ON pm.current_location_id = l.id
GROUP BY l.name, pm.status
ORDER BY l.name, count DESC;
```

---

### 8. `spare_parts`
Tracks spare parts purchases and maintenance costs.

```sql
CREATE TABLE spare_parts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id UUID NOT NULL REFERENCES plants_master(id),
    location_id UUID REFERENCES locations(id),  -- WHERE purchased
    submission_id UUID REFERENCES purchase_order_submissions(id),

    -- PO Details
    purchase_order_number VARCHAR(100),
    po_date DATE,                               -- Date on PO document
    requisition_number VARCHAR(100),            -- REQ NO from PO

    -- Part Details
    part_number VARCHAR(100),
    part_description TEXT,
    supplier VARCHAR(255),
    reason_for_change VARCHAR(255),
    quantity INTEGER DEFAULT 1,

    -- Costs
    unit_cost NUMERIC(15,2),
    vat_percentage NUMERIC(5,2) DEFAULT 0,
    discount_percentage NUMERIC(5,2) DEFAULT 0,
    other_costs NUMERIC(15,2) DEFAULT 0,
    total_cost NUMERIC(15,2) GENERATED ALWAYS AS (
        ROUND((unit_cost * quantity) * (1 + vat_percentage/100)
              * (1 - discount_percentage/100) + other_costs, 2)
    ) STORED,

    -- Audit
    replaced_date DATE,
    remarks TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Key Fields:**
| Field | Description |
|-------|-------------|
| location_id | WHERE the PO was raised (may differ from plant's current location) |
| po_date | Date on the Purchase Order document |
| total_cost | Auto-calculated: (unit × qty) × (1+VAT%) × (1-discount%) + other |

**Current Count**: 458 parts records (100% with dates, 100% with location)

**Time Columns** (auto-populated by trigger):
- `year` - Extracted from `replaced_date`
- `month` - 1-12
- `week_number` - ISO week 1-53

**Location Tracking Logic**:
- Weekly reports are the **PRIMARY** source for `current_location_id` in plants_master
- Spare parts track **historical** location via `location_id` (WHERE purchase was made)
- For plants NOT in weekly reports (e.g., P401, P415):
  - `current_location_id` = NULL (unknown until they appear in a weekly report)
  - Historical location available in spare_parts data
- `unit_cost` is calculated as `total_cost / quantity` from Excel data

**Time-Based Query Examples**:
```sql
-- Monthly spending
SELECT year, month, SUM(unit_cost * quantity) as total
FROM spare_parts GROUP BY year, month;

-- Weekly spending at a location
SELECT week_number, SUM(unit_cost * quantity) as total
FROM spare_parts WHERE location_id = 'xxx' AND year = 2025
GROUP BY week_number;
```

---

### 9. `plant_spending_anomalies` (View)
Detects suspicious patterns in spare parts spending.

```sql
CREATE VIEW plant_spending_anomalies AS
SELECT
    fleet_number, fleet_type, status, current_location,
    parts_count, total_spent, first_purchase, last_purchase,
    CASE
        WHEN current_location_id IS NULL THEN 'NO_LOCATION'
        WHEN last_verified_date IS NULL THEN 'NEVER_VERIFIED'
        WHEN status IN ('missing', 'stolen') THEN 'MISSING_STOLEN'
        WHEN status = 'unverified' AND total_spent > 1000000 THEN 'HIGH_SPEND_UNVERIFIED'
        ELSE 'OK'
    END as anomaly_flag
FROM spare_parts sp
JOIN plants_master pm ON sp.plant_id = pm.id;
```

**Anomaly Flags:**
| Flag | Meaning |
|------|---------|
| NO_LOCATION | Plant has no location, never appeared in reports |
| NEVER_VERIFIED | Plant has parts but never verified |
| MISSING_STOLEN | Plant marked missing/stolen but has spending |
| HIGH_SPEND_UNVERIFIED | >₦1M spent but status is unverified |

---

## Current Statistics

| Table | Count | Purpose |
|-------|-------|---------|
| locations | 27 | Site locations |
| fleet_number_prefixes | 79 | Prefix → fleet type mapping |
| plants_master | 1,601 | Current plant state |
| archived_plants | 478 | Legacy plants pending first report |
| plant_weekly_records | 1,732 | Weekly snapshots (immutable) |
| plant_location_history | 1,584 | Movement tracking |
| spare_parts | 458 | Parts history (329 with dates, 449 with location) |
| users | 2 | System users |
| weekly_report_submissions | 0 | Upload tracking (ETL creates) |
| upload_tokens | 0 | Site officer auth |
| notifications | 0 | User alerts |
| purchase_order_submissions | 0 | PO tracking |
| plant_events | 0 | Event audit log |
