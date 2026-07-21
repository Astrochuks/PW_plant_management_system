-- 027: Overview KPI dashboard needs
--
-- 1. Persist the BEME tail (ADD CONTINGENCY / ADD VOP / ADD VAT /
--    SUB-TOTALs / GRAND TOTAL rows) per weekly report. The parser has
--    always extracted it (weekly_report_sheets.parse_beme -> "tail");
--    the import dropped it. The Overview's physical-progress ladder
--    (Contingency incl. VAT, TOTAL WORKS DONE incl. VAT & Contingency)
--    reads it workbook-verbatim.
--
-- 2. Sheet flags become resolvable: the admin Issues tab lists open
--    flags; resolving stamps who/when/why instead of deleting evidence.

BEGIN;

ALTER TABLE project_weekly_reports
    ADD COLUMN IF NOT EXISTS beme_tail jsonb;

ALTER TABLE project_sheet_flags
    ADD COLUMN IF NOT EXISTS resolved_at     timestamptz,
    ADD COLUMN IF NOT EXISTS resolved_by     text,
    ADD COLUMN IF NOT EXISTS resolution_note text;

CREATE INDEX IF NOT EXISTS idx_psf_unresolved
    ON project_sheet_flags(project_id, severity)
    WHERE resolved_at IS NULL;

COMMIT;
