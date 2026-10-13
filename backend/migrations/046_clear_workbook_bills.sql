-- 046: Clear the bills the weekly workbooks had established for the three
-- projects (decision 2026-10-13, "go clear bills"). Data only; the admin
-- will enter or import each project's bill properly on the Bill of
-- Quantities tab, and a workbook upload later rebuilds a bill if wanted.
--
-- What goes, through the existing ON DELETE CASCADE chain:
--   project_beme_revisions (3 rows, revision 1 of each project)
--     -> project_beme_bills            (19)
--        -> project_beme_items          (239)
--           -> project_beme_progress    (~1,015 weekly BEME progress rows)
--           -> project_ledger_adjustments (~306)
--   projects.current_beme_revision_id -> NULL (ON DELETE SET NULL)
-- Everything else from the weekly reports (cost report, labour, plant,
-- diesel, payments, the reports themselves) stays untouched.
--
-- Apply with:  python scripts/apply_migration.py 046

BEGIN;

DELETE FROM project_beme_revisions r
 USING projects p
 WHERE p.id = r.project_id
   AND p.short_name IN ('6TH BRIDGE OVER RIVER KADUNA', 'AKWA IBOM AIRPORT APRON', 'MARU - LUGGA ROAD');

COMMIT;
