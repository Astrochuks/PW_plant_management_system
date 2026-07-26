-- 030: one week number, ISO, everywhere.
--
-- ROOT CAUSE. populate_spare_parts_time_columns() is a BEFORE INSERT OR
-- UPDATE trigger that owns year/month/week_number/quarter. It computed
--
--     week_number := CEIL(EXTRACT(DOY FROM replaced_date) / 7.0)
--
-- day-of-year ÷ 7, which ignores which weekday the year starts on. Being
-- a BEFORE trigger it overwrote whatever the API set, so the
-- isocalendar() calls in spare_parts.py never actually reached the
-- column — the trigger always won. 405 of 1,853 rows (₦216.7m of spend)
-- sat one week LOW as a result, and a plain backfill bounced straight
-- off the trigger.
--
-- year, month and quarter were already right (EXTRACT from the date, 0
-- rows wrong in audit) and are left exactly as they are.
--
-- EXTRACT(WEEK ...) is the ISO-8601 week — the same value Python's
-- isocalendar()[1] returns and what every other table in this system
-- already stores.
--
-- No monetary figure changes: month, quarter and year totals come from
-- their own columns and are untouched, and the grand total is unmoved.
-- Only the week-by-week distribution shifts, into the correct weeks.

CREATE OR REPLACE FUNCTION public.populate_spare_parts_time_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.replaced_date IS NOT NULL THEN
        NEW.year := EXTRACT(YEAR FROM NEW.replaced_date)::INTEGER;
        NEW.month := EXTRACT(MONTH FROM NEW.replaced_date)::INTEGER;
        -- ISO-8601 week, not day-of-year ÷ 7
        NEW.week_number := EXTRACT(WEEK FROM NEW.replaced_date)::INTEGER;
        NEW.quarter := EXTRACT(QUARTER FROM NEW.replaced_date)::INTEGER;
    END IF;
    RETURN NEW;
END;
$function$;

-- now the backfill sticks
UPDATE spare_parts
SET week_number = EXTRACT(WEEK FROM replaced_date)::int
WHERE replaced_date IS NOT NULL
  AND week_number IS DISTINCT FROM EXTRACT(WEEK FROM replaced_date)::int;
