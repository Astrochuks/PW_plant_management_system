-- 014_phase2_weekly_ingest_tables.sql
-- Applied: 2026-07-07
--
-- Projects Phase 2 (PRD v2 §10, tasks T2.1): the weekly-report ingest
-- schema. Facts are stored THIS-WEEK-ONLY (PRD rule: workbook cumulative
-- columns are broken cross-file links; we recompute to-date ourselves).
-- Every child row cascades from its weekly report so a bad upload can be
-- rolled back by deleting one header row.
--
-- Fully idempotent.

-- 1. Submission audit (mirrors plant weekly_report_submissions) ----------
CREATE TABLE IF NOT EXISTS project_report_submissions (
    id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    year                 integer NOT NULL,
    week_number          integer NOT NULL,
    week_ending_date     date,
    file_name            text,
    file_hash            text,
    file_path            text,
    file_size            bigint,
    source               text NOT NULL DEFAULT 'excel'
                         CHECK (source IN ('excel', 'manual')),
    status               text NOT NULL DEFAULT 'queued'
                         CHECK (status IN ('queued', 'parsing', 'success',
                                           'partial', 'failed', 'deleted')),
    error_message        text,
    sheets_processed     jsonb,
    row_counts           jsonb,
    parse_duration_ms    integer,
    retry_count          integer NOT NULL DEFAULT 0,
    weekly_report_id     uuid REFERENCES project_weekly_reports(id) ON DELETE SET NULL,
    uploaded_by          uuid,
    uploaded_at          timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prs_project_week
    ON project_report_submissions(project_id, year, week_number);
CREATE INDEX IF NOT EXISTS idx_prs_status ON project_report_submissions(status);

-- 2. Reference lists from the workbook's Lists sheet (ingested once) -----
CREATE TABLE IF NOT EXISTS project_reference_lists (
    id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    list_name  text NOT NULL,
    item       text NOT NULL,
    detail     text,
    sort_order integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (list_name, item)
);

-- 3. BEME: bills + items (inserted once per project) + weekly progress ---
CREATE TABLE IF NOT EXISTS project_beme_bills (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    bill_no         integer NOT NULL,
    name            text,
    contract_amount numeric(18,2),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, bill_no)
);

CREATE TABLE IF NOT EXISTS project_beme_items (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    bill_id         uuid NOT NULL REFERENCES project_beme_bills(id) ON DELETE CASCADE,
    item_code       text,
    description     text NOT NULL,
    unit            text,
    contract_qty    numeric(18,3),
    rate            numeric(18,2),
    contract_amount numeric(18,2),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (bill_id, item_code, description)
);

CREATE TABLE IF NOT EXISTS project_beme_progress (
    id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    weekly_report_id uuid NOT NULL REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
    project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    item_id          uuid NOT NULL REFERENCES project_beme_items(id) ON DELETE CASCADE,
    year             integer NOT NULL,
    week_number      integer NOT NULL,
    week_ending_date date,
    qty_this_week    numeric(18,3),
    amount_this_week numeric(18,2),
    pct_complete     numeric(7,4),
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (item_id, weekly_report_id)
);
CREATE INDEX IF NOT EXISTS idx_beme_prog_report ON project_beme_progress(weekly_report_id);
CREATE INDEX IF NOT EXISTS idx_beme_prog_project_week
    ON project_beme_progress(project_id, year, week_number);

-- 4. Bill 1 ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_bill1_items (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    item_code       text,
    description     text NOT NULL,
    unit            text,
    contract_qty    numeric(18,3),
    rate            numeric(18,2),
    contract_amount numeric(18,2),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, item_code, description)
);

CREATE TABLE IF NOT EXISTS project_bill1_claims (
    id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    weekly_report_id uuid NOT NULL REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
    project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    bill1_item_id    uuid REFERENCES project_bill1_items(id) ON DELETE CASCADE,
    cert_number      text,
    qty              numeric(18,3),
    amount           numeric(18,2),
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bill1_claims_report ON project_bill1_claims(weekly_report_id);

CREATE TABLE IF NOT EXISTS project_bill1_payments (
    id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    weekly_report_id uuid NOT NULL REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
    project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    payment_date     date,
    description      text,
    reference        text,
    amount           numeric(18,2),
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bill1_pay_report ON project_bill1_payments(weekly_report_id);

-- 5. Precast stock (point-in-time quantities, not cumulative sums) --------
CREATE TABLE IF NOT EXISTS project_precast (
    id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    weekly_report_id  uuid NOT NULL REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
    project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    year              integer NOT NULL,
    week_number       integer NOT NULL,
    week_ending_date  date,
    description       text NOT NULL,
    size              text,
    uom               text,
    cast_this_week    numeric(18,3),
    used_this_week    numeric(18,3),
    balance_available numeric(18,3),
    closing_stock     numeric(18,3),
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_precast_report ON project_precast(weekly_report_id);

-- 6. Weekly Summary (long format: section / item / metric / value) --------
CREATE TABLE IF NOT EXISTS project_weekly_summary (
    id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    weekly_report_id uuid NOT NULL REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
    project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    year             integer NOT NULL,
    week_number      integer NOT NULL,
    week_ending_date date,
    section          text NOT NULL,
    item             text,
    metric           text NOT NULL,
    value            numeric(20,4),
    raw_value        text,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pws_report ON project_weekly_summary(weekly_report_id);
CREATE INDEX IF NOT EXISTS idx_pws_project_week
    ON project_weekly_summary(project_id, year, week_number);

-- 7. Contract Summary snapshot (thin; per-week contract evolution) --------
CREATE TABLE IF NOT EXISTS project_contract_summary_snapshot (
    id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    weekly_report_id        uuid NOT NULL UNIQUE
                            REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
    project_id              uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    year                    integer NOT NULL,
    week_number             integer NOT NULL,
    week_ending_date        date,
    original_contract_amount numeric(18,2),
    current_contract_amount numeric(18,2),
    works_certified         numeric(18,2),
    retention_held          numeric(18,2),
    advance_unrecovered     numeric(18,2),
    apg_expiry              date,
    raw                     jsonb,
    created_at              timestamptz NOT NULL DEFAULT now()
);

-- 8. Operational alerts ----------------------------------------------------
CREATE TABLE IF NOT EXISTS project_alerts (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id   uuid REFERENCES projects(id) ON DELETE CASCADE,
    alert_type   text NOT NULL,
    severity     text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    message      text NOT NULL,
    triggered_at timestamptz NOT NULL DEFAULT now(),
    resolved_at  timestamptz,
    resolved_by  uuid
);
CREATE INDEX IF NOT EXISTS idx_project_alerts_open
    ON project_alerts(project_id) WHERE resolved_at IS NULL;

-- 9. Site photo progress log (file in Storage; metadata here) --------------
CREATE TABLE IF NOT EXISTS project_photos (
    id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    weekly_report_id uuid REFERENCES project_weekly_reports(id) ON DELETE SET NULL,
    storage_path     text NOT NULL,
    caption          text,
    gps_lat          numeric(9,6),
    gps_lng          numeric(9,6),
    taken_at         timestamptz,
    uploaded_by      uuid,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_photos_project ON project_photos(project_id);

-- 10. Role scoping: which PM / site engineer belongs to which project ------
CREATE TABLE IF NOT EXISTS user_project_assignments (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         uuid NOT NULL,
    project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role_on_project text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, project_id)
);
