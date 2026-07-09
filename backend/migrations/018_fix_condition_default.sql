-- 018: fix plant creation broken by migration 012.
--
-- 012 collapsed condition to six values + CHECK, but left the column
-- DEFAULT at 'unverified' — a value the new constraint forbids. Every
-- INSERT that omitted condition (i.e. the Add Plant form) failed with
-- a check-constraint violation.
--
-- Per the locked taxonomy: unknown condition = NULL (carry-forward).
ALTER TABLE plants_master ALTER COLUMN condition SET DEFAULT NULL;
