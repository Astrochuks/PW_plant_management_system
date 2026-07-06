-- 010_client_types_and_register_reset.sql
-- Applied: 2026-07-06
--
-- User findings from the register walk-through (2026-07-06):
--   1. Client categories are state_government / federal_government / private
--      (derived from sheet: state-named sheets → state; FAAN/FMW/FERMA/FCDA
--      → federal; PRIVATE CLIENTS sheet → private).
--   2. Sheet names are NOT clients. Row 2 of each sheet is a group label;
--      the Client column holds real clients; blanks inherit the group.
--   3. Everything from the workbook is status='legacy', never 'active'.
--   4. Active projects are created manually from now on; all existing
--      projects (including manually-created ones) removed; site links
--      cleared. The RESET below is intentionally destructive and runs
--      once — rerunning it is harmless (idempotent deletes).
--
-- Schema shape unchanged; only the client_type value set changes.

-- 1. Client type taxonomy ---------------------------------------------------
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_client_type_check;
ALTER TABLE clients ADD CONSTRAINT clients_client_type_check
    CHECK (client_type IN ('state_government', 'federal_government', 'private'));

-- 2. Full register reset ----------------------------------------------------
-- Unlink every project from sites (both directions of the link)
UPDATE locations SET project_id = NULL WHERE project_id IS NOT NULL;
UPDATE projects  SET location_id = NULL WHERE location_id IS NOT NULL;

-- Review queue: everything goes (resolutions of the flawed import are moot)
DELETE FROM project_register_review_queue;

-- All projects: legacy imports AND manually-created actives (user decision:
-- active projects will be re-entered manually going forward)
DELETE FROM projects;

-- Clients rebuild from scratch with correct names/types on next import
DELETE FROM clients;
