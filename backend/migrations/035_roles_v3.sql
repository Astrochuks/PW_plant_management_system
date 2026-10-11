-- 035: Roles v3 — the project manager seat (decision 2026-10-11, PRD v2 §2).
--
-- Four working roles from here on:
--   admin            everything
--   project_manager  the projects module, every site (picker in the UI),
--                    approves BEME revisions; NO plant-module access
--   site_engineer    their own assigned project only (assignments come
--                    with the register work; the plant-module site page
--                    this role used to land on is retired — nobody had
--                    started using it)
--   plant_officer    plant module only (unchanged)
--
-- managing_director / general_project_manager are PARKED, not deleted
-- (Postgres cannot drop an enum value): no longer offered or writable,
-- and the two accounts that carried them become project_manager. The
-- pre-029 'management' value stays retired as before.
--
-- ADD VALUE cannot run inside a transaction that also uses the new value,
-- so these statements run one by one with no BEGIN/COMMIT (same as 029).

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'project_manager';

-- new accounts default to the least-privileged seat
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'site_engineer';

-- the MD and GPM seats become the project manager (2 rows on 2026-10-11)
UPDATE users
   SET role = 'project_manager', updated_at = now()
 WHERE role IN ('managing_director', 'general_project_manager', 'management');

-- users.location_id stays, nullable: the one-engineer-per-location rule
-- was enforced in the API, not here, and is gone with the plant site page.
