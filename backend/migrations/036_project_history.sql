-- 036: Project history — contract sums and statuses as dated, append-only
-- facts (PRD v2 §3.2–3.3, §4–5; decision 2026-10-11).
--
-- Two history tables. Rows are inserted, never updated or deleted (triggers
-- refuse). The "current" value of each is cached on projects by trigger so
-- every existing reader (status = 'active', current_contract_sum) keeps
-- working unchanged:
--
--   projects.status                ← latest project_status_events row
--   projects.status_since          ← its effective_date
--   projects.current_contract_sum  ← latest project_contract_sums row
--
-- projects.status keeps its column name (every query and the register UI
-- filter on it) but takes the new vocabulary; 'legacy' becomes 'closed'
-- (the is_legacy flag already marks those rows). 037 backfills.

BEGIN;

-- ── vocabularies ─────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE project_status AS ENUM (
    'awarded', 'mobilised', 'active', 'suspended',
    'substantially_complete', 'finally_complete', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE contract_sum_kind AS ENUM ('original', 'variation', 'revision', 'correction');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE contract_sum_basis AS ENUM ('all_in', 'ex_vat', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── contract sums ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_contract_sums (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id),
  kind           contract_sum_kind NOT NULL,
  -- the RESULTING contract sum after this instrument (reads like the
  -- head-office list); the delta is derived in v_project_contract_sums
  amount         numeric(18,2) NOT NULL CHECK (amount >= 0),
  basis          contract_sum_basis NOT NULL DEFAULT 'unknown',
  effective_date date NOT NULL,
  instrument_ref text,
  document_path  text,
  note           text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- a correction must say what it corrects
  CONSTRAINT contract_sum_correction_needs_note
    CHECK (kind <> 'correction' OR (note IS NOT NULL AND length(trim(note)) > 0))
);

-- at most one original per project
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_contract_sums_original
  ON project_contract_sums (project_id) WHERE kind = 'original';
CREATE INDEX IF NOT EXISTS ix_project_contract_sums_project_eff
  ON project_contract_sums (project_id, effective_date DESC, created_at DESC);

-- ── status events ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_status_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id),
  status         project_status NOT NULL,
  effective_date date NOT NULL,
  note           text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_project_status_events_project_eff
  ON project_status_events (project_id, effective_date DESC, created_at DESC);

-- ── append-only guard ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION history_is_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: add a correction row instead of % on %',
    TG_TABLE_NAME, TG_OP, OLD.id
    USING ERRCODE = 'restrict_violation';
END $$;

DROP TRIGGER IF EXISTS trg_contract_sums_append_only ON project_contract_sums;
CREATE TRIGGER trg_contract_sums_append_only
  BEFORE UPDATE OR DELETE ON project_contract_sums
  FOR EACH ROW EXECUTE FUNCTION history_is_append_only();

DROP TRIGGER IF EXISTS trg_status_events_append_only ON project_status_events;
CREATE TRIGGER trg_status_events_append_only
  BEFORE UPDATE OR DELETE ON project_status_events
  FOR EACH ROW EXECUTE FUNCTION history_is_append_only();

-- ── caches on projects ───────────────────────────────────────────────────

ALTER TABLE projects ADD COLUMN IF NOT EXISTS status_since date;

-- the status column takes the new vocabulary; 037 rewrites the old values.
-- Drop the old CHECK whatever it is called (it listed the pre-v2 values).
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'projects'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%(status)%' LOOP
    EXECUTE format('ALTER TABLE projects DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE projects ALTER COLUMN status DROP DEFAULT;
UPDATE projects SET status = 'closed' WHERE status = 'legacy';
UPDATE projects SET status = 'closed' WHERE status IN ('completed', 'cancelled');
UPDATE projects SET status = 'suspended' WHERE status = 'on_hold';
UPDATE projects SET status = 'substantially_complete' WHERE status = 'retention_period';
ALTER TABLE projects ADD CONSTRAINT projects_status_check CHECK (status IN (
  'awarded', 'mobilised', 'active', 'suspended',
  'substantially_complete', 'finally_complete', 'closed'));
ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'awarded';

CREATE OR REPLACE FUNCTION refresh_project_contract_sum_cache() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE projects p
     SET current_contract_sum = s.amount,
         updated_at = now()
    FROM (SELECT amount FROM project_contract_sums
           WHERE project_id = NEW.project_id
           ORDER BY effective_date DESC, created_at DESC LIMIT 1) s
   WHERE p.id = NEW.project_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_contract_sums_cache ON project_contract_sums;
CREATE TRIGGER trg_contract_sums_cache
  AFTER INSERT ON project_contract_sums
  FOR EACH ROW EXECUTE FUNCTION refresh_project_contract_sum_cache();

CREATE OR REPLACE FUNCTION refresh_project_status_cache() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE projects p
     SET status = s.status::text,
         status_since = s.effective_date,
         updated_at = now()
    FROM (SELECT status, effective_date FROM project_status_events
           WHERE project_id = NEW.project_id
           ORDER BY effective_date DESC, created_at DESC LIMIT 1) s
   WHERE p.id = NEW.project_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_status_events_cache ON project_status_events;
CREATE TRIGGER trg_status_events_cache
  AFTER INSERT ON project_status_events
  FOR EACH ROW EXECUTE FUNCTION refresh_project_status_cache();

-- ── read views ───────────────────────────────────────────────────────────

-- contract sums with the derived delta and a "current" marker
CREATE OR REPLACE VIEW v_project_contract_sums AS
SELECT s.*,
       s.amount - COALESCE(lag(s.amount) OVER w, 0)                     AS delta,
       row_number() OVER (PARTITION BY s.project_id
                          ORDER BY s.effective_date DESC, s.created_at DESC) = 1 AS is_current
  FROM project_contract_sums s
WINDOW w AS (PARTITION BY s.project_id ORDER BY s.effective_date, s.created_at);

-- "status as at D": the register at any date (PRD §4)
CREATE OR REPLACE FUNCTION project_status_as_at(p_project uuid, p_date date)
RETURNS project_status LANGUAGE sql STABLE AS $$
  SELECT status FROM project_status_events
   WHERE project_id = p_project AND effective_date <= p_date
   ORDER BY effective_date DESC, created_at DESC LIMIT 1
$$;

-- one merged timeline for the History tab
CREATE OR REPLACE VIEW v_project_history AS
SELECT 'contract_sum'::text AS entry_type, s.id, s.project_id, s.effective_date,
       s.kind::text AS label, s.amount AS amount, s.basis::text AS detail,
       s.instrument_ref, s.document_path, s.note, s.created_by, s.created_at
  FROM project_contract_sums s
UNION ALL
SELECT 'status', e.id, e.project_id, e.effective_date,
       e.status::text, NULL, NULL, NULL, NULL, e.note, e.created_by, e.created_at
  FROM project_status_events e;

COMMIT;
