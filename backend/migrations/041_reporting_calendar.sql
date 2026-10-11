-- 041: The reporting calendar (docs/CALENDAR.md, decision 2026-10-11).
--
-- 1. week_anchor(d): the THURSDAY of the week that ends on d. A week
--    belongs to the month / quarter / year of its Thursday — ISO's own
--    anchor, and the rule behind the head-office month table (Jan 2026 =
--    weeks 1–5, Feb = 6–9 … Dec = 49–53). Works for project weeks (end
--    Friday) and plant weeks (end Sunday) alike.
-- 2. Project weeks end on FRIDAY. The two 2025 reports were stored with
--    the site's Saturday report date (the 2025 Lists calendar labelled
--    Saturday with the outgoing week): Kaduna W09/2025 1 Mar → 28 Feb,
--    Akwa W43/2025 25 Oct → 24 Oct. Same week numbers, same figures; only
--    the date key moves, in every per-week table. A CHECK keeps it so.
-- 3. prepared_on: the "Date" the site typed on its Contract Summary — the
--    day the report was prepared, kept as a fact, never a grouping key.

BEGIN;

CREATE OR REPLACE FUNCTION week_anchor(d date) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  -- dow: Sunday=0 … Thursday=4 … Saturday=6
  SELECT d - (((extract(dow FROM d)::int - 4) + 7) % 7)
$$;
COMMENT ON FUNCTION week_anchor(date) IS
  'Thursday of the reporting week ending on d; month/quarter/year of a week = those of week_anchor(week_ending_date)';

ALTER TABLE project_weekly_reports ADD COLUMN IF NOT EXISTS prepared_on date;
COMMENT ON COLUMN project_weekly_reports.prepared_on IS
  'The Date cell the site typed on its Contract Summary: when the report was prepared. Never a grouping key.';

-- the two Saturday-dated 2025 weeks → their Fridays, everywhere
UPDATE project_weekly_reports        SET week_ending_date = week_ending_date - 1 WHERE week_ending_date IN ('2025-03-01','2025-10-25');
UPDATE project_report_submissions    SET week_ending_date = week_ending_date - 1 WHERE week_ending_date IN ('2025-03-01','2025-10-25');
UPDATE project_beme_progress         SET week_ending_date = week_ending_date - 1 WHERE week_ending_date IN ('2025-03-01','2025-10-25');
UPDATE project_cost_report           SET week_ending_date = week_ending_date - 1 WHERE week_ending_date IN ('2025-03-01','2025-10-25');
UPDATE project_contract_summary_snapshot SET week_ending_date = week_ending_date - 1 WHERE week_ending_date IN ('2025-03-01','2025-10-25');
UPDATE project_diesel_consumption    SET week_ending_date = week_ending_date - 1 WHERE week_ending_date IN ('2025-03-01','2025-10-25');
UPDATE project_hired_vehicles        SET week_ending_date = week_ending_date - 1 WHERE week_ending_date IN ('2025-03-01','2025-10-25');
UPDATE project_labour_strength       SET week_ending_date = week_ending_date - 1 WHERE week_ending_date IN ('2025-03-01','2025-10-25');
UPDATE project_materials_stock       SET week_ending_date = week_ending_date - 1 WHERE week_ending_date IN ('2025-03-01','2025-10-25');
UPDATE project_plant_utilization     SET week_ending_date = week_ending_date - 1 WHERE week_ending_date IN ('2025-03-01','2025-10-25');
UPDATE project_precast               SET week_ending_date = week_ending_date - 1 WHERE week_ending_date IN ('2025-03-01','2025-10-25');
UPDATE project_subcontractors        SET week_ending_date = week_ending_date - 1 WHERE week_ending_date IN ('2025-03-01','2025-10-25');
UPDATE project_weekly_summary        SET week_ending_date = week_ending_date - 1 WHERE week_ending_date IN ('2025-03-01','2025-10-25');

-- from here on a project week can only end on a Friday
ALTER TABLE project_weekly_reports DROP CONSTRAINT IF EXISTS project_weekly_reports_week_ends_friday;
ALTER TABLE project_weekly_reports ADD CONSTRAINT project_weekly_reports_week_ends_friday
  CHECK (extract(dow FROM week_ending_date) = 5);

COMMIT;
