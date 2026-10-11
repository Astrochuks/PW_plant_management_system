-- 039: Project scope per user + assignments + document links + the
-- notification types the approval flow will use (PRD v2 §2, §3.4, §3.5,
-- §3.9; decision 2026-10-11).
--
-- users.project_scope says WHICH projects a user may see:
--   'all'       the General Project Manager (and every admin / plant
--               officer, for whom it is simply not consulted)
--   'assigned'  only the projects listed in user_project_assignments —
--               a project-scoped PM, and every site engineer
-- It is chosen on the user form, never implied by the absence of rows.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS project_scope text NOT NULL DEFAULT 'all';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_project_scope_check;
ALTER TABLE users ADD CONSTRAINT users_project_scope_check
  CHECK (project_scope IN ('all', 'assigned'));

-- site engineers are always project-scoped
UPDATE users SET project_scope = 'assigned' WHERE role = 'site_engineer';

-- assignments: who linked them and when a link ended (never deleted)
ALTER TABLE user_project_assignments
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS ended_at   timestamptz;
DO $$ BEGIN
  ALTER TABLE user_project_assignments
    ADD CONSTRAINT user_project_assignments_user_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_user_project_assignments_user_live
  ON user_project_assignments (user_id) WHERE ended_at IS NULL;

-- a document can point at the history row it evidences
ALTER TABLE project_documents
  ADD COLUMN IF NOT EXISTS linked_table text,
  ADD COLUMN IF NOT EXISTS linked_id    uuid;

-- notification types for phase B approvals + assignment changes
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'notifications'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%(type)%' LOOP
    EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'info', 'success', 'warning', 'error', 'report_processed', 'report_failed',
  'system', 'insight_alert',
  'approval_requested', 'approval_decided', 'assignment_changed'));

COMMIT;
