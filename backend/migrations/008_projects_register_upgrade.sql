-- 008_projects_register_upgrade.sql
-- Applied: 2026-07-05
--
-- Projects Module v2, Phase 1 (PRD v2 §10, tasks T1.2):
--   1. clients master table (normalised from projects.client strings)
--   2. projects register columns: client_id, location_id (project↔site
--      bridge, 1 project = 1 site), project_type + work_nature (D2
--      taxonomy), scope fields (benchmarking), register_source, APG fields
--   3. project_register_review_queue — every cell the parser cannot
--      confidently parse lands here with its raw value; resolving writes
--      the corrected value back to projects. No silent data loss.
--
-- Fully idempotent: safe to run multiple times.

-- 1. Clients master --------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
    id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name             text NOT NULL,
    normalized_name  text NOT NULL UNIQUE,
    client_type      text CHECK (client_type IN ('govt', 'private', 'agency')),
    default_state_id uuid REFERENCES states(id),
    notes            text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE clients IS 'Normalised client master; projects.client string kept as denormalised cache';

-- 2. Projects register columns ---------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type text
    CHECK (project_type IN ('road', 'bridge', 'drainage', 'building',
                            'airport', 'water', 'infrastructure', 'other'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS work_nature text
    CHECK (work_nature IN ('construction', 'dualization', 'rehabilitation',
                           'maintenance', 'emergency_repair', 'completion'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS scope_quantity numeric;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS scope_unit text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS register_source text
    CHECK (register_source IN ('award_letters_workbook', 'manual', 'weekly_report_inferred'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS apg_amount numeric;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS apg_expiry date;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS apg_renewal_expiry date;

COMMENT ON COLUMN projects.location_id IS 'Project↔site bridge (1 project = 1 site); enables plant/spare-parts rollups';

-- Backfill register_source for existing rows (idempotent: only fills NULLs)
UPDATE projects
SET register_source = CASE
        WHEN import_batch_id IS NOT NULL THEN 'award_letters_workbook'
        ELSE 'manual'
    END
WHERE register_source IS NULL;

-- 3. Review queue -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_register_review_queue (
    id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    import_batch_id  uuid,
    sheet_name       text,
    row_number       integer,
    project_id       uuid REFERENCES projects(id) ON DELETE SET NULL,
    field            text NOT NULL,
    raw_value        text,
    reason           text NOT NULL,
    suggested_value  text,
    resolved         boolean NOT NULL DEFAULT false,
    resolved_by      uuid,
    resolved_at      timestamptz,
    resolution_value text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE project_register_review_queue IS 'Parser cells that need a human decision; raw value always preserved';

-- 4. Indexes ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_location_id ON projects(location_id);
CREATE INDEX IF NOT EXISTS idx_projects_project_type ON projects(project_type);
CREATE INDEX IF NOT EXISTS idx_review_queue_open
    ON project_register_review_queue(resolved, reason);
CREATE INDEX IF NOT EXISTS idx_review_queue_batch
    ON project_register_review_queue(import_batch_id);
