# Database Schema Documentation

This document provides detailed information about the PostgreSQL database schema used by the Plant Management System.

## Schemas

| Schema | Purpose |
|--------|---------|
| `public` | Core application tables |
| `auth` | Supabase authentication (managed by Supabase) |
| `storage` | Supabase file storage (managed by Supabase) |
| `analytics` | Analytics views and materialized views |
| `monitoring` | Application logs and metrics |

---

## Core Tables

### plants

Main equipment registry containing all tracked machinery.

```sql
CREATE TABLE plants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fleet_number VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    category VARCHAR(100),
    subcategory VARCHAR(100),
    make VARCHAR(100),
    model VARCHAR(100),
    serial_number VARCHAR(100),
    year_of_manufacture INTEGER,
    engine_number VARCHAR(100),
    chassis_number VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active',
    current_location_id UUID REFERENCES locations(id),
    physical_verification BOOLEAN DEFAULT false,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_plants_fleet_number ON plants(fleet_number);
CREATE INDEX idx_plants_status ON plants(status);
CREATE INDEX idx_plants_location ON plants(current_location_id);
CREATE INDEX idx_plants_category ON plants(category);
```

**Status Values:**
- `active` - Currently in operation
- `maintenance` - Under repair
- `standby` - Available but not deployed
- `decommissioned` - No longer in service

---

### locations

Project sites and locations where equipment is deployed.

```sql
CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    code VARCHAR(50) UNIQUE,
    region VARCHAR(100),
    state VARCHAR(100),
    address TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_locations_name ON locations(name);
CREATE INDEX idx_locations_region ON locations(region);
CREATE INDEX idx_locations_active ON locations(is_active);
```

---

### spare_parts

Maintenance and replacement parts tracking.

```sql
CREATE TABLE spare_parts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id UUID NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
    part_description TEXT NOT NULL,
    part_number VARCHAR(100),
    supplier VARCHAR(200),
    replaced_date DATE,
    unit_cost NUMERIC(15, 2),
    quantity INTEGER DEFAULT 1,
    vat_percentage NUMERIC(5, 2) DEFAULT 0,
    discount_percentage NUMERIC(5, 2) DEFAULT 0,
    other_costs NUMERIC(15, 2) DEFAULT 0,
    total_cost NUMERIC(15, 2) GENERATED ALWAYS AS (
        COALESCE(unit_cost, 0) * COALESCE(quantity, 1) 
        * (1 + COALESCE(vat_percentage, 0) / 100) 
        * (1 - COALESCE(discount_percentage, 0) / 100) 
        + COALESCE(other_costs, 0)
    ) STORED,
    reason_for_change TEXT,
    purchase_order_number VARCHAR(100),
    remarks TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_spare_parts_plant ON spare_parts(plant_id);
CREATE INDEX idx_spare_parts_date ON spare_parts(replaced_date);
CREATE INDEX idx_spare_parts_supplier ON spare_parts(supplier);
CREATE INDEX idx_spare_parts_po ON spare_parts(purchase_order_number);
```

**Note:** `total_cost` is a **generated column** - it auto-calculates when `unit_cost`, `quantity`, `vat_percentage`, `discount_percentage`, or `other_costs` changes.

---

### fleet_types

Equipment categorization reference table.

```sql
CREATE TABLE fleet_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(100) NOT NULL,
    subcategory VARCHAR(100),
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Example data
INSERT INTO fleet_types (category, subcategory) VALUES
    ('EXCAVATOR', 'TRACKED'),
    ('EXCAVATOR', 'WHEELED'),
    ('DOZER', 'CRAWLER'),
    ('LOADER', 'WHEEL LOADER'),
    ('LOADER', 'BACKHOE'),
    ('CRANE', 'MOBILE'),
    ('CRANE', 'TOWER'),
    ('DUMP TRUCK', 'RIGID'),
    ('DUMP TRUCK', 'ARTICULATED'),
    ('GRADER', 'MOTOR GRADER'),
    ('ROLLER', 'VIBRATING'),
    ('ROLLER', 'PNEUMATIC');
```

---

## Weekly Tracking Tables

### plant_weekly_records

Weekly snapshots of plant status and usage metrics.

```sql
CREATE TABLE plant_weekly_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id UUID NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id),
    submission_id UUID REFERENCES weekly_report_submissions(id),
    year INTEGER NOT NULL,
    week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 53),
    week_ending_date DATE NOT NULL,
    physical_verification BOOLEAN DEFAULT false,
    hours_worked NUMERIC(10, 2) DEFAULT 0,
    standby_hours NUMERIC(10, 2) DEFAULT 0,
    breakdown_hours NUMERIC(10, 2) DEFAULT 0,
    off_hire BOOLEAN DEFAULT false,
    transfer_from VARCHAR(200),
    transfer_to VARCHAR(200),
    remarks TEXT,
    raw_description TEXT,
    raw_remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_plant_week UNIQUE (plant_id, year, week_number)
);

-- Indexes
CREATE INDEX idx_weekly_records_plant ON plant_weekly_records(plant_id);
CREATE INDEX idx_weekly_records_location ON plant_weekly_records(location_id);
CREATE INDEX idx_weekly_records_year_week ON plant_weekly_records(year, week_number);
CREATE INDEX idx_weekly_records_date ON plant_weekly_records(week_ending_date);
```

---

### plant_events

Tracks significant events like movements, new plants, missing plants.

```sql
CREATE TABLE plant_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id UUID NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    event_date DATE NOT NULL,
    year INTEGER,
    week_number INTEGER,
    from_location_id UUID REFERENCES locations(id),
    to_location_id UUID REFERENCES locations(id),
    details JSONB,
    remarks TEXT,
    is_acknowledged BOOLEAN DEFAULT false,
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_events_plant ON plant_events(plant_id);
CREATE INDEX idx_events_type ON plant_events(event_type);
CREATE INDEX idx_events_date ON plant_events(event_date);
CREATE INDEX idx_events_acknowledged ON plant_events(is_acknowledged);
```

**Event Types:**
- `movement` - Plant moved between locations
- `new` - New plant first recorded
- `missing` - Plant not seen at expected location
- `off_hire` - Plant taken off hire
- `decommissioned` - Plant decommissioned

---

### plant_location_history

Complete history of plant movements.

```sql
CREATE TABLE plant_location_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id UUID NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id),
    start_date DATE NOT NULL,
    end_date DATE,
    transfer_reason TEXT,
    transferred_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_location_history_plant ON plant_location_history(plant_id);
CREATE INDEX idx_location_history_location ON plant_location_history(location_id);
CREATE INDEX idx_location_history_dates ON plant_location_history(start_date, end_date);
```

---

## Submission Tables

### weekly_report_submissions

Tracks uploaded weekly reports and their processing status.

```sql
CREATE TABLE weekly_report_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year INTEGER NOT NULL,
    week_number INTEGER NOT NULL,
    week_ending_date DATE NOT NULL,
    location_id UUID NOT NULL REFERENCES locations(id),
    submitted_by_name VARCHAR(200),
    submitted_by_email VARCHAR(200),
    upload_token_id UUID REFERENCES upload_tokens(id),
    source_type VARCHAR(50) DEFAULT 'upload',
    source_file_path TEXT,
    source_file_name VARCHAR(255),
    source_file_size INTEGER,
    status VARCHAR(20) DEFAULT 'pending',
    processing_started_at TIMESTAMPTZ,
    processing_completed_at TIMESTAMPTZ,
    plants_processed INTEGER DEFAULT 0,
    plants_created INTEGER DEFAULT 0,
    plants_updated INTEGER DEFAULT 0,
    errors JSONB,
    warnings JSONB,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_weekly_submission UNIQUE (year, week_number, location_id)
);

-- Indexes
CREATE INDEX idx_submissions_status ON weekly_report_submissions(status);
CREATE INDEX idx_submissions_location ON weekly_report_submissions(location_id);
CREATE INDEX idx_submissions_date ON weekly_report_submissions(submitted_at);
```

**Status Values:**
- `pending` - Uploaded, waiting for processing
- `processing` - Currently being processed
- `completed` - Successfully processed
- `partial` - Processed with some errors
- `failed` - Processing failed

---

### upload_tokens

Token-based authentication for site officers.

```sql
CREATE TABLE upload_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    token VARCHAR(100) NOT NULL UNIQUE,
    location_id UUID REFERENCES locations(id),
    allowed_upload_types TEXT[] DEFAULT ARRAY['weekly_report', 'purchase_order'],
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    use_count INTEGER DEFAULT 0,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_tokens_token ON upload_tokens(token);
CREATE INDEX idx_tokens_active ON upload_tokens(is_active);
CREATE INDEX idx_tokens_location ON upload_tokens(location_id);
```

---

## User Management

### users

System users (admins and management).

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,  -- Matches Supabase auth.users.id
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(200),
    role VARCHAR(50) NOT NULL DEFAULT 'management',
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
```

---

### notifications

In-app notifications for admins.

```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,
    data JSONB,
    target_user_id UUID REFERENCES users(id),
    target_role VARCHAR(50),
    read BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_notifications_user ON notifications(target_user_id);
CREATE INDEX idx_notifications_role ON notifications(target_role);
CREATE INDEX idx_notifications_read ON notifications(read);
CREATE INDEX idx_notifications_created ON notifications(created_at);
```

---

## Key Functions

### generate_upload_token

Creates a new upload token for site officers.

```sql
CREATE OR REPLACE FUNCTION generate_upload_token(
    p_name VARCHAR,
    p_location_id UUID DEFAULT NULL,
    p_upload_types TEXT[] DEFAULT ARRAY['weekly_report', 'purchase_order'],
    p_expires_in_days INTEGER DEFAULT NULL,
    p_created_by UUID DEFAULT NULL
) RETURNS TABLE (
    id UUID,
    name VARCHAR,
    token VARCHAR,
    location_id UUID,
    location_name VARCHAR,
    expires_at TIMESTAMPTZ
) AS $$
DECLARE
    v_token VARCHAR;
    v_expires_at TIMESTAMPTZ;
    v_id UUID;
BEGIN
    -- Generate random token
    v_token := encode(gen_random_bytes(16), 'hex');
    
    -- Calculate expiration
    IF p_expires_in_days IS NOT NULL THEN
        v_expires_at := NOW() + (p_expires_in_days || ' days')::INTERVAL;
    END IF;
    
    -- Insert token
    INSERT INTO upload_tokens (name, token, location_id, allowed_upload_types, expires_at, created_by)
    VALUES (p_name, v_token, p_location_id, p_upload_types, v_expires_at, p_created_by)
    RETURNING upload_tokens.id INTO v_id;
    
    -- Return result
    RETURN QUERY
    SELECT 
        t.id,
        t.name,
        t.token,
        t.location_id,
        l.name AS location_name,
        t.expires_at
    FROM upload_tokens t
    LEFT JOIN locations l ON t.location_id = l.id
    WHERE t.id = v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### validate_upload_token

Validates an upload token and returns its details.

```sql
CREATE OR REPLACE FUNCTION validate_upload_token(
    p_token VARCHAR,
    p_upload_type VARCHAR
) RETURNS TABLE (
    valid BOOLEAN,
    token_id UUID,
    location_id UUID,
    location_name VARCHAR,
    error_message VARCHAR
) AS $$
DECLARE
    v_token_record RECORD;
BEGIN
    -- Find token
    SELECT t.*, l.name AS loc_name
    INTO v_token_record
    FROM upload_tokens t
    LEFT JOIN locations l ON t.location_id = l.id
    WHERE t.token = p_token;
    
    -- Token not found
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::VARCHAR, 'Invalid token'::VARCHAR;
        RETURN;
    END IF;
    
    -- Token inactive
    IF NOT v_token_record.is_active THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::VARCHAR, 'Token is deactivated'::VARCHAR;
        RETURN;
    END IF;
    
    -- Token expired
    IF v_token_record.expires_at IS NOT NULL AND v_token_record.expires_at < NOW() THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::VARCHAR, 'Token has expired'::VARCHAR;
        RETURN;
    END IF;
    
    -- Check upload type allowed
    IF NOT (p_upload_type = ANY(v_token_record.allowed_upload_types)) THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::VARCHAR, 'Upload type not allowed for this token'::VARCHAR;
        RETURN;
    END IF;
    
    -- Update usage stats
    UPDATE upload_tokens 
    SET last_used_at = NOW(), use_count = use_count + 1 
    WHERE id = v_token_record.id;
    
    -- Return success
    RETURN QUERY SELECT 
        true,
        v_token_record.id,
        v_token_record.location_id,
        v_token_record.loc_name::VARCHAR,
        NULL::VARCHAR;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### get_spare_parts_stats

Returns aggregate statistics for spare parts.

```sql
CREATE OR REPLACE FUNCTION get_spare_parts_stats(
    p_year INTEGER DEFAULT NULL,
    p_location_id UUID DEFAULT NULL
) RETURNS TABLE (
    total_parts BIGINT,
    total_cost NUMERIC,
    avg_cost_per_part NUMERIC,
    unique_plants INTEGER,
    unique_suppliers INTEGER,
    most_common_part TEXT,
    highest_cost_plant_fleet VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    WITH filtered AS (
        SELECT sp.*
        FROM spare_parts sp
        JOIN plants p ON sp.plant_id = p.id
        WHERE (p_year IS NULL OR EXTRACT(YEAR FROM sp.replaced_date) = p_year)
        AND (p_location_id IS NULL OR p.current_location_id = p_location_id)
    )
    SELECT
        COUNT(*)::BIGINT,
        COALESCE(SUM(f.total_cost), 0)::NUMERIC,
        COALESCE(AVG(f.total_cost), 0)::NUMERIC,
        COUNT(DISTINCT f.plant_id)::INTEGER,
        COUNT(DISTINCT f.supplier)::INTEGER,
        (SELECT part_description FROM filtered GROUP BY part_description ORDER BY COUNT(*) DESC LIMIT 1),
        (SELECT p.fleet_number FROM filtered f2 JOIN plants p ON f2.plant_id = p.id GROUP BY p.fleet_number ORDER BY SUM(f2.total_cost) DESC LIMIT 1)
    FROM filtered f;
END;
$$ LANGUAGE plpgsql;
```

---

## Row-Level Security (RLS)

### Policy Examples

```sql
-- Enable RLS on plants table
ALTER TABLE plants ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all plants
CREATE POLICY "Allow authenticated read" ON plants
    FOR SELECT
    TO authenticated
    USING (true);

-- Allow only admins to insert/update/delete
CREATE POLICY "Allow admin write" ON plants
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );
```

---

## Triggers

### Auto-update timestamps

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER plants_updated_at
    BEFORE UPDATE ON plants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER spare_parts_updated_at
    BEFORE UPDATE ON spare_parts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
```

---

## Migrations

All migrations are stored in Supabase and can be viewed via:

```sql
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
```

Current migrations:
1. `create_initial_schema` - Foundation tables
2. `create_core_tables` - Plants, locations, spare_parts
3. `create_monitoring_schema` - Logs and metrics
4. `enable_rls_and_create_policies` - Security policies
5. `create_plant_weekly_tracking_v2` - Weekly records and events
6. `enhance_plant_weekly_tracking_for_usage` - Usage metrics columns
7. `create_plant_tracking_functions_v2` - Movement and transfer functions
