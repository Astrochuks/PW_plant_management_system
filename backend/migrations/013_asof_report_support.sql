-- 013_asof_report_support.sql
-- Applied: 2026-07-07
-- Index for as-of-date fleet snapshots (latest weekly record per plant
-- on/before a date) used by the rebuilt report generator.
CREATE INDEX IF NOT EXISTS idx_pwr_plant_weekend
    ON plant_weekly_records (plant_id, week_ending_date DESC);
