-- 022: the four promotions (dossiers 9-13, locked 2026-07-13)
-- Hired Vehicles, Labour Strength, Subcontractors, Materials & Civils
-- move from stored-only to parsed. Tables existed from the v1 era;
-- this aligns them with the locked specs.

BEGIN;

-- ── Labour Strength: two blocks, fixed dept slots ───────────────────────
ALTER TABLE project_labour_strength
    ADD COLUMN IF NOT EXISTS block     text NOT NULL DEFAULT 'permanent'
        CHECK (block IN ('permanent', 'casual')),
    ADD COLUMN IF NOT EXISTS dept_slot integer;

-- ── Subcontractors: full value columns (per-report ledger) ─────────────
ALTER TABLE project_subcontractors
    ADD COLUMN IF NOT EXISTS value_previous      numeric(18,2),
    ADD COLUMN IF NOT EXISTS value_to_completion numeric(18,2);

-- read like payments: the latest report carries the cumulative truth
CREATE OR REPLACE VIEW v_project_subcontractors_latest AS
SELECT s.*
FROM project_subcontractors s
JOIN (
    SELECT DISTINCT ON (project_id) id, project_id
    FROM project_weekly_reports
    ORDER BY project_id, year DESC, week_number DESC
) latest ON latest.id = s.weekly_report_id;

-- ── Materials & Civils: stock cycle + usage split + loss detector ──────
ALTER TABLE project_materials_stock
    ADD COLUMN IF NOT EXISTS available_for_use  numeric(18,3),
    ADD COLUMN IF NOT EXISTS used_works         numeric(18,3),
    ADD COLUMN IF NOT EXISTS used_precast       numeric(18,3),
    ADD COLUMN IF NOT EXISTS used_mobilisation  numeric(18,3),
    ADD COLUMN IF NOT EXISTS discrepancy_qty    numeric(18,3),
    ADD COLUMN IF NOT EXISTS discrepancy_value  numeric(18,2),
    ADD COLUMN IF NOT EXISTS stock_maintained   boolean;

COMMIT;
