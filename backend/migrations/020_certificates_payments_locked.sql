-- 020: Certificates + Payments locked decisions (sheet review 2026-07-11)
--
-- Findings this implements:
-- 1. Certificate rows are CUMULATIVE valuations (gross = running total at
--    that cert; retention = exactly 5% of it). Per-cert increments are
--    computed, never stored.
-- 2. The sheet's hidden commercial columns (L..Q) matter for the
--    executive view: retention released, contingency used, fluctuation,
--    advances received, total works executed, advance recovery.
-- 3. Payments are a per-report ledger — a bare SUM over project_payments
--    multiplies by the number of stored workbooks. v_project_payments_latest
--    makes forgetting the latest-report filter impossible.
-- 4. Contract Summary's client-position block is FROZEN (~2023): its
--    works-certified figures sit between certs 2 and 3 and its retention
--    released says 0 vs the ledger's ₦294.6M. Certified/paid/outstanding
--    must come from the ledgers; snapshot figures are cross-checks only.

BEGIN;

-- ── 1. commercial columns from the cert sheet's L..Q ───────────────────
ALTER TABLE project_certificates
    ADD COLUMN IF NOT EXISTS retention_released     numeric(18,2),
    ADD COLUMN IF NOT EXISTS contingency_used       numeric(18,2),
    ADD COLUMN IF NOT EXISTS contingency_deducted   numeric(18,2),
    ADD COLUMN IF NOT EXISTS fluctuation_materials  numeric(18,2),
    ADD COLUMN IF NOT EXISTS advance_received       numeric(18,2),
    ADD COLUMN IF NOT EXISTS total_works_executed   numeric(18,2),
    ADD COLUMN IF NOT EXISTS advance_recovery       numeric(18,2);

-- ── 2. certificate view: increments + retention check + flags ──────────
CREATE OR REPLACE VIEW v_project_certificates AS
WITH ordered AS (
    SELECT c.*,
           CASE WHEN c.cert_number ~ '^[0-9]+$'
                THEN c.cert_number::numeric END AS cert_sort
    FROM project_certificates c
)
SELECT o.*,
       o.gross_value_works_done
         - COALESCE(lag(o.gross_value_works_done) OVER w, 0) AS value_this_cert,
       CASE WHEN COALESCE(o.gross_value_works_done, 0) <> 0
            THEN round(o.total_retention_held / o.gross_value_works_done * 100, 2)
       END AS retention_pct,
       (o.gross_value_works_done IS NOT DISTINCT FROM
        lag(o.gross_value_works_done) OVER w)                AS is_zero_increment
FROM ordered o
WINDOW w AS (PARTITION BY o.project_id
             ORDER BY o.cert_sort NULLS LAST, o.cert_number);

-- ── 3. payments guard view: latest report's ledger only ────────────────
CREATE OR REPLACE VIEW v_project_payments_latest AS
SELECT p.*
FROM project_payments p
JOIN (
    SELECT DISTINCT ON (project_id) id, project_id
    FROM project_weekly_reports
    ORDER BY project_id, year DESC, week_number DESC
) latest ON latest.id = p.weekly_report_id;

COMMIT;
