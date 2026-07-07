-- 012_collapse_condition_taxonomy.sql
-- Applied: 2026-07-07
--
-- User decision (2026-07-07): the fleet has SIX conditions from now on —
--   working, standby, breakdown, missing, scrap, off_hire
--
-- Mapping:
--   under_repair   → breakdown   (was: being repaired)
--   faulty         → breakdown   (was: has a fault, partially functional)
--   gpm_assessment → breakdown   (was: needs GPM review)
--   unverified     → NULL        (it never described a physical state —
--                                 it meant "no information that week".
--                                 As-of reports carry the last known
--                                 condition forward past NULL rows.)
--
-- History is RELABELED, not rewritten: raw_remarks / raw_description /
-- parsed_condition_keywords on every weekly record remain untouched, so
-- the original evidence is always recoverable.
--
-- Idempotent: rerunning updates zero rows and re-creates constraints.

-- 1. Live plant state ---------------------------------------------------
UPDATE plants_master
SET condition = 'breakdown'
WHERE condition IN ('under_repair', 'faulty', 'gpm_assessment');

UPDATE plants_master SET condition = NULL WHERE condition = 'unverified';

-- 2. Historical weekly snapshots ----------------------------------------
UPDATE plant_weekly_records
SET condition = 'breakdown'
WHERE condition IN ('under_repair', 'faulty', 'gpm_assessment');

UPDATE plant_weekly_records SET condition = NULL WHERE condition = 'unverified';

-- parsed_condition mirrors what the parser suggested at the time; collapse
-- it the same way so filters/analytics never resurrect retired values.
UPDATE plant_weekly_records
SET parsed_condition = 'breakdown'
WHERE parsed_condition IN ('under_repair', 'faulty', 'gpm_assessment');

UPDATE plant_weekly_records
SET parsed_condition = NULL WHERE parsed_condition = 'unverified';

-- 3. Draft rows (in-app weekly entry) -----------------------------------
UPDATE weekly_report_draft_rows
SET condition = 'breakdown'
WHERE condition IN ('under_repair', 'faulty', 'gpm_assessment');

UPDATE weekly_report_draft_rows
SET condition = NULL WHERE condition = 'unverified';

-- 4. Constraints: only the six values (or NULL = unknown) ----------------
ALTER TABLE plants_master DROP CONSTRAINT IF EXISTS plants_master_condition_check;
ALTER TABLE plants_master ADD CONSTRAINT plants_master_condition_check
    CHECK (condition IS NULL OR condition IN
           ('working', 'standby', 'breakdown', 'missing', 'scrap', 'off_hire'));

ALTER TABLE plant_weekly_records DROP CONSTRAINT IF EXISTS plant_weekly_records_condition_check;
ALTER TABLE plant_weekly_records ADD CONSTRAINT plant_weekly_records_condition_check
    CHECK (condition IS NULL OR condition IN
           ('working', 'standby', 'breakdown', 'missing', 'scrap', 'off_hire'));
