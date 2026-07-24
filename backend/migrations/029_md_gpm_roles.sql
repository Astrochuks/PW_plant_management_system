-- 029: Roles v2 — split 'management' into Managing Director + General
-- Project Manager (decision 2026-07-24).
--
-- 016 collapsed MD and GPM into one 'management' role because their view
-- was identical. They are now named separately so the two seats can be
-- told apart on screen (and, later, given different landing views).
-- Permissions are UNCHANGED: both are management-tier everywhere the API
-- asks for it (require_projects_access / require_management_or_admin).
--
-- 'management' stays in the enum — Postgres cannot drop an enum value —
-- but it is retired: no longer offered in the UI, no longer writable
-- through the API, and no rows carry it after this migration.
--
-- ADD VALUE cannot run in a transaction that also uses the new value, so
-- these statements are executed separately (no BEGIN/COMMIT), same as 016.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'managing_director';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'general_project_manager';

-- the column default was 'management'; retire it
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'general_project_manager';

-- carry the existing management seat over as MD (single row, 2026-07-24)
UPDATE users SET role = 'managing_director', updated_at = now()
WHERE role = 'management';
