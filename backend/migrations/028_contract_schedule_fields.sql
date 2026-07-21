-- 028: the workbook's Contract Schedules block, fully on the register.
-- Already present: award_date, commencement_date, original_duration_months,
-- original_completion_date, extension_of_time_months (= EOT granted),
-- revised_completion_date. Missing pieces:

BEGIN;

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS eot_requested_months numeric(6,2),
    ADD COLUMN IF NOT EXISTS works_commenced_date date,
    ADD COLUMN IF NOT EXISTS retc boolean;

COMMIT;
