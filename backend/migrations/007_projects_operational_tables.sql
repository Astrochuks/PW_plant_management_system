-- 007_projects_operational_tables.sql
-- Applied: 2026-05-08
--
-- Projects Module v1 — operational tables for the 16-sheet weekly report.
-- 11 tables, each FK to projects(id) and project_weekly_reports(id).
-- Deleting a header row cascades to all children, so an admin can roll
-- back a single bad upload cleanly.
--
-- v1 scope per PRD: BEME line-items deferred to v2; for v1 we only
-- capture beme_pct_complete on the report header.

-- 1. project_weekly_reports — one row per uploaded report
CREATE TABLE project_weekly_reports (
    id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    year                 integer NOT NULL,
    week_number          integer NOT NULL,
    week_ending_date     date NOT NULL,
    source_file_path     text,
    source_file_name     text,
    source_file_size     bigint,
    status               text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','processing','completed','partial','failed')),
    submitted_at         timestamptz NOT NULL DEFAULT now(),
    submitted_by         uuid REFERENCES users(id) ON DELETE SET NULL,
    processing_started_at  timestamptz,
    processing_completed_at timestamptz,
    sheets_processed     jsonb DEFAULT '{}'::jsonb,
    errors               jsonb DEFAULT '[]'::jsonb,
    beme_pct_complete    numeric(5,2),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, year, week_number)
);
CREATE INDEX idx_proj_wr_project ON project_weekly_reports(project_id);
CREATE INDEX idx_proj_wr_year_week ON project_weekly_reports(year, week_number);
CREATE INDEX idx_proj_wr_status ON project_weekly_reports(status);

-- 2. project_plant_utilization — Plant Return sheet (Plant ↔ Project bridge)
CREATE TABLE project_plant_utilization (
    id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    weekly_report_id     uuid NOT NULL REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
    project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    year                 integer NOT NULL,
    week_number          integer NOT NULL,
    week_ending_date     date NOT NULL,
    fleet_number_raw     text,
    plant_id             uuid REFERENCES plants_master(id) ON DELETE SET NULL,
    description          text,
    plant_category       text,
    hours_worked         numeric(10,2) DEFAULT 0,
    standby_hours        numeric(10,2) DEFAULT 0,
    breakdown_hours      numeric(10,2) DEFAULT 0,
    rate_ngn             numeric(15,2),
    plant_cost           numeric(15,2),
    transferred_from     text,
    current_location     text,
    remarks              text,
    created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_proj_pu_project_week ON project_plant_utilization(project_id, year, week_number);
CREATE INDEX idx_proj_pu_plant ON project_plant_utilization(plant_id) WHERE plant_id IS NOT NULL;
CREATE INDEX idx_proj_pu_fleet_raw ON project_plant_utilization(fleet_number_raw);
CREATE INDEX idx_proj_pu_weekly_report ON project_plant_utilization(weekly_report_id);

-- 3. project_diesel_consumption — daily breakdown per fleet (Sat–Fri)
CREATE TABLE project_diesel_consumption (
    id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    weekly_report_id     uuid NOT NULL REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
    project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    year                 integer NOT NULL,
    week_number          integer NOT NULL,
    week_ending_date     date NOT NULL,
    fleet_number_raw     text,
    plant_id             uuid REFERENCES plants_master(id) ON DELETE SET NULL,
    description          text,
    plant_category       text,
    saturday_litres      numeric(10,2) DEFAULT 0,
    sunday_litres        numeric(10,2) DEFAULT 0,
    monday_litres        numeric(10,2) DEFAULT 0,
    tuesday_litres       numeric(10,2) DEFAULT 0,
    wednesday_litres     numeric(10,2) DEFAULT 0,
    thursday_litres      numeric(10,2) DEFAULT 0,
    friday_litres        numeric(10,2) DEFAULT 0,
    total_litres         numeric(10,2) GENERATED ALWAYS AS (
        COALESCE(saturday_litres,0) + COALESCE(sunday_litres,0) + COALESCE(monday_litres,0)
        + COALESCE(tuesday_litres,0) + COALESCE(wednesday_litres,0) + COALESCE(thursday_litres,0)
        + COALESCE(friday_litres,0)
    ) STORED,
    created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_proj_dc_project_week ON project_diesel_consumption(project_id, year, week_number);
CREATE INDEX idx_proj_dc_plant ON project_diesel_consumption(plant_id) WHERE plant_id IS NOT NULL;
CREATE INDEX idx_proj_dc_weekly_report ON project_diesel_consumption(weekly_report_id);

-- 4. project_certificates — Certificate Status sheet
CREATE TABLE project_certificates (
    id                              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    weekly_report_id                uuid NOT NULL REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
    project_id                      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    cert_number                     text NOT NULL,
    date_submitted                  date,
    gross_value_works_done          numeric(18,2),
    add_materials_on_site           numeric(18,2),
    less_materials_on_site          numeric(18,2),
    general_bill_1                  numeric(18,2),
    total_value_of_work_done        numeric(18,2),
    value_of_works_per_cert         numeric(18,2),
    total_retention_held            numeric(18,2),
    total_net_payment               numeric(18,2),
    date_vetted                     date,
    date_paid                       date,
    status                          text DEFAULT 'submitted'
                                    CHECK (status IN ('submitted','vetted','paid','disputed','cancelled')),
    notes                           text,
    created_at                      timestamptz NOT NULL DEFAULT now(),
    updated_at                      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, cert_number)
);
CREATE INDEX idx_proj_cert_project ON project_certificates(project_id);
CREATE INDEX idx_proj_cert_weekly_report ON project_certificates(weekly_report_id);

-- 5. project_payments — Payments Recieved sheet
CREATE TABLE project_payments (
    id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    weekly_report_id     uuid NOT NULL REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
    project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    payment_date         date,
    voucher_number       text,
    payment_type         text,
    gross_amount         numeric(18,2),
    wht                  numeric(18,2) DEFAULT 0,
    vat                  numeric(18,2) DEFAULT 0,
    vetting_fee          numeric(18,2) DEFAULT 0,
    stamp_duty           numeric(18,2) DEFAULT 0,
    other_deductions     numeric(18,2) DEFAULT 0,
    net_amount           numeric(18,2),
    cert_number          text,
    notes                text,
    created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_proj_pay_project ON project_payments(project_id);
CREATE INDEX idx_proj_pay_weekly_report ON project_payments(weekly_report_id);
CREATE INDEX idx_proj_pay_date ON project_payments(payment_date);

-- 6. project_cost_report — Cost Report sheet
CREATE TABLE project_cost_report (
    id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    weekly_report_id     uuid NOT NULL REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
    project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    year                 integer NOT NULL,
    week_number          integer NOT NULL,
    week_ending_date     date NOT NULL,
    section              text,
    description          text,
    cost_category        text,
    unit                 text,
    quantity_this_week   numeric(15,4),
    rate_ngn             numeric(15,2),
    amount_previous_week numeric(18,2) DEFAULT 0,
    amount_this_week     numeric(18,2) DEFAULT 0,
    amount_to_date       numeric(18,2) GENERATED ALWAYS AS (
        COALESCE(amount_previous_week,0) + COALESCE(amount_this_week,0)
    ) STORED,
    created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_proj_cr_project_week ON project_cost_report(project_id, year, week_number);
CREATE INDEX idx_proj_cr_category ON project_cost_report(cost_category);
CREATE INDEX idx_proj_cr_weekly_report ON project_cost_report(weekly_report_id);

-- 7. project_labour_strength — Labour Strength sheet
CREATE TABLE project_labour_strength (
    id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    weekly_report_id     uuid NOT NULL REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
    project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    year                 integer NOT NULL,
    week_number          integer NOT NULL,
    week_ending_date     date NOT NULL,
    department           text NOT NULL,
    manning_this_week    integer DEFAULT 0,
    manning_previous_week integer DEFAULT 0,
    movement             integer DEFAULT 0,
    comment              text,
    created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_proj_ls_project_week ON project_labour_strength(project_id, year, week_number);
CREATE INDEX idx_proj_ls_weekly_report ON project_labour_strength(weekly_report_id);

-- 8. project_subcontractors — Subcontractors sheet (text names in v1; master entity v2)
CREATE TABLE project_subcontractors (
    id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    weekly_report_id     uuid NOT NULL REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
    project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    year                 integer NOT NULL,
    week_number          integer NOT NULL,
    week_ending_date     date NOT NULL,
    subcontractor_name   text,
    description          text,
    location             text,
    unit                 text,
    agreed_rate          numeric(15,2),
    assigned_qty         numeric(15,4),
    previous_qty         numeric(15,4),
    qty_this_week        numeric(15,4),
    qty_to_date          numeric(15,4),
    amount_this_week     numeric(18,2),
    amount_to_date       numeric(18,2),
    balance_remaining    numeric(18,2),
    remarks              text,
    created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_proj_sub_project_week ON project_subcontractors(project_id, year, week_number);
CREATE INDEX idx_proj_sub_weekly_report ON project_subcontractors(weekly_report_id);

-- 9. project_materials_stock — Materials & Civils + Precast sheets (text names in v1)
CREATE TABLE project_materials_stock (
    id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    weekly_report_id     uuid NOT NULL REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
    project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    year                 integer NOT NULL,
    week_number          integer NOT NULL,
    week_ending_date     date NOT NULL,
    sheet_source         text CHECK (sheet_source IN ('precast','materials')),
    material_name        text,
    unit                 text,
    opening_stock        numeric(15,4),
    received             numeric(15,4),
    used                 numeric(15,4),
    closing_stock        numeric(15,4),
    unit_cost            numeric(15,2),
    total_cost           numeric(18,2),
    remarks              text,
    created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_proj_ms_project_week ON project_materials_stock(project_id, year, week_number);
CREATE INDEX idx_proj_ms_weekly_report ON project_materials_stock(weekly_report_id);

-- 10. project_hired_vehicles — Hired Vehicles sheet
CREATE TABLE project_hired_vehicles (
    id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    weekly_report_id     uuid NOT NULL REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
    project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    year                 integer NOT NULL,
    week_number          integer NOT NULL,
    week_ending_date     date NOT NULL,
    registration_no      text,
    description          text,
    section              text,
    owners               text,
    days_worked          numeric(5,2),
    rate_ngn             numeric(15,2),
    amount_ngn           numeric(18,2),
    remarks              text,
    created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_proj_hv_project_week ON project_hired_vehicles(project_id, year, week_number);
CREATE INDEX idx_proj_hv_weekly_report ON project_hired_vehicles(weekly_report_id);

-- 11. project_documents — PDF storage refs (Supabase Storage)
CREATE TABLE project_documents (
    id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_type        text NOT NULL
                          CHECK (document_type IN ('award_letter','completion_cert','certificate','contract','payment_voucher','other')),
    title                text,
    description          text,
    file_path            text NOT NULL,
    file_name            text NOT NULL,
    file_size            bigint,
    mime_type            text,
    uploaded_by          uuid REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at          timestamptz NOT NULL DEFAULT now(),
    created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_proj_docs_project ON project_documents(project_id);
CREATE INDEX idx_proj_docs_type ON project_documents(document_type);

-- updated_at triggers (uses existing public.update_updated_at function)
CREATE TRIGGER trg_proj_wr_updated_at BEFORE UPDATE ON project_weekly_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_proj_cert_updated_at BEFORE UPDATE ON project_certificates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE project_weekly_reports IS 'Header for each uploaded weekly report. Children FK back here for cascade delete on rollback.';
COMMENT ON TABLE project_plant_utilization IS 'Plant Return sheet rows — links plants to projects with per-week hours.';
COMMENT ON TABLE project_documents IS 'PDFs (award letters, certs, etc.) stored in Supabase Storage; this row is the index.';
