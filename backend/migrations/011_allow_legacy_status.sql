-- 011_allow_legacy_status.sql
-- Applied: 2026-07-06
--
-- The workbook import writes status='legacy' (user decision: register rows
-- are never 'active'), but projects_status_check never allowed it — all
-- 218 inserts failed silently as CHECK violations on 2026-07-06.
-- Idempotent: drop + recreate with the full value set.

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check
    CHECK (status::text = ANY (ARRAY[
        'active', 'completed', 'on_hold', 'cancelled',
        'retention_period', 'legacy'
    ]::text[]));
