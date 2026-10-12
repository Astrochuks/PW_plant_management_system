-- 042: Two project statuses only — 'active' (shown as Ongoing) and 'archived'
-- (decision 2026-10-12: "there are only two we use now").
--
-- The PRD v2 §4 lifecycle (awarded → mobilised → active → suspended →
-- substantially_complete → finally_complete → closed) is retired. Every
-- project is either ongoing or archived; WHEN it moved is what matters, and
-- project_status_events keeps every dated move (append-only, 036), so a
-- report for any period still sees the project as it was then.
--
-- Mapping of the old values (data and defaults):
--   awarded, mobilised, active, suspended            → active
--   substantially_complete, finally_complete, closed → archived
-- Rewritten history rows keep the old label in their note
-- ("recorded as closed before 042") so nothing is silently forgotten.
--
-- Postgres cannot drop enum labels, so the old labels stay in the type but
-- CHECK constraints on both tables make them unwritable. Audit of this
-- change-set (app + pg_proc + pg_views + column defaults):
--   pg_enum project_status      : + 'archived'
--   projects.status             : CHECK (active|archived), DEFAULT 'active'
--   project_status_events.status: CHECK (active|archived)
--   seed_project_history_on_insert(): default 'active'
--   views: none name a status; project_status_as_at(): unchanged
--   app: project_register.py (STATUSES, transitions, ONGOING, StatusEventIn,
--        ongoing query), models/project.py (default/pattern),
--        projects.py (stats counts), award_letters_parser.py (import default)
--
-- Apply with:  python scripts/apply_migration.py 042
-- STEP 1 must be committed on its own before STEP 2 can use the new label;
-- the runner splits on the STEP markers.

-- ── STEP 1 (autocommit) ───────────────────────────────────────────────────
ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'archived';

-- ── STEP 2 (one transaction) ──────────────────────────────────────────────
BEGIN;

-- history rows: rewrite the value, remember the old label in the note
ALTER TABLE project_status_events DISABLE TRIGGER trg_status_events_append_only;
ALTER TABLE project_status_events DISABLE TRIGGER trg_status_events_cache;
UPDATE project_status_events
   SET note   = concat_ws(' · ', note, 'recorded as ' || status::text || ' before 042'),
       status = CASE WHEN status IN ('awarded', 'mobilised', 'active', 'suspended')
                     THEN 'active'::project_status ELSE 'archived'::project_status END
 WHERE status NOT IN ('active', 'archived');
ALTER TABLE project_status_events ENABLE TRIGGER trg_status_events_append_only;
ALTER TABLE project_status_events ENABLE TRIGGER trg_status_events_cache;
ALTER TABLE project_status_events
  ADD CONSTRAINT project_status_events_two_values CHECK (status IN ('active', 'archived'));

-- the cache on projects: same mapping, new CHECK, new default
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
UPDATE projects
   SET status = CASE WHEN status IN ('awarded', 'mobilised', 'active', 'suspended')
                     THEN 'active' ELSE 'archived' END
 WHERE status NOT IN ('active', 'archived');
ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE projects ADD CONSTRAINT projects_status_check CHECK (status IN ('active', 'archived'));

-- the insert seed (038) defaulted the opening status to 'awarded'
CREATE OR REPLACE FUNCTION seed_project_history_on_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.seed_history', true) = 'off' THEN
    RETURN NEW;  -- the caller writes the history rows in this transaction
  END IF;

  INSERT INTO project_status_events (project_id, status, effective_date, note, created_by)
  VALUES (NEW.id,
          COALESCE(NEW.status, 'active')::project_status,
          COALESCE(NEW.commencement_date, NEW.award_date, current_date),
          'opening status recorded with the project',
          NEW.created_by);

  IF COALESCE(NEW.original_contract_sum, NEW.current_contract_sum) IS NOT NULL THEN
    INSERT INTO project_contract_sums
      (project_id, kind, amount, basis, effective_date, note, created_by)
    VALUES (NEW.id, 'original',
            COALESCE(NEW.original_contract_sum, NEW.current_contract_sum),
            'unknown',
            COALESCE(NEW.award_date, NEW.commencement_date, current_date),
            'original contract sum recorded with the project',
            NEW.created_by);
  END IF;
  RETURN NEW;
END $$;

COMMIT;
