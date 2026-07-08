-- 017: KPI rebuild — locked parse spec (BEME research 2026-07-07/08)
--
-- 1. project_ledger_adjustments: baseline + gap facts for BEME and Cost
--    Report. "This-week-only" gets exactly two principled exceptions:
--    the earliest workbook's reported-previous (baseline) and derived
--    movement between non-consecutive stored weeks (gap). Recomputed
--    from stored reported-previous columns whenever the set of stored
--    weeks changes — never frozen at ingest.
-- 2. project_sheet_flags: per-week per-sheet cross-check results,
--    staleness detection, variances. Powers upload preview badges.
-- 3. reported-previous columns on beme progress (cost report already
--    has amount_previous_week).
-- 4. diesel: naira amount + cost-centre marker (MECHANICS, CIVIL, ...).
-- 5. contract summary snapshot: the reliable overview fields.
-- 6. sheet content hashes on the weekly report header (stale-copy
--    detection compares against the previous stored week).

BEGIN;

-- 1 ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_ledger_adjustments (
    id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ledger        text NOT NULL CHECK (ledger IN ('beme', 'cost')),
    kind          text NOT NULL CHECK (kind IN ('baseline', 'gap')),
    -- exactly one of these identifies the row the fact belongs to
    beme_item_id  uuid REFERENCES project_beme_items(id) ON DELETE CASCADE,
    cost_key      text,          -- section || '|' || category || '|' || description
    -- the span this fact covers (baseline: everything before covers_to)
    covers_from_year integer,
    covers_from_week integer,
    covers_to_year   integer NOT NULL,
    covers_to_week   integer NOT NULL,
    qty           numeric(18,3),
    amount        numeric(18,2) NOT NULL,
    derived_from_report uuid REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (ledger = 'beme' AND beme_item_id IS NOT NULL AND cost_key IS NULL) OR
        (ledger = 'cost' AND cost_key IS NOT NULL AND beme_item_id IS NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_pla_project ON project_ledger_adjustments(project_id, ledger);

-- 2 ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_sheet_flags (
    id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    weekly_report_id uuid NOT NULL REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
    project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    sheet_name       text NOT NULL,
    flag_type        text NOT NULL CHECK (flag_type IN (
                        'cross_check_pass', 'cross_check_fail', 'stale_copy',
                        'frozen_column', 'variance', 'chain_break',
                        'qty_rate_violation', 'info')),
    severity         text NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
    message          text NOT NULL,
    detail           jsonb,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_psf_report ON project_sheet_flags(weekly_report_id);
CREATE INDEX IF NOT EXISTS idx_psf_project ON project_sheet_flags(project_id, severity);

-- 3 ─────────────────────────────────────────────────────────────────────
ALTER TABLE project_beme_progress
    ADD COLUMN IF NOT EXISTS qty_previous_reported    numeric(18,3),
    ADD COLUMN IF NOT EXISTS amount_previous_reported numeric(18,2);
-- % complete is computed in views from cumulative/contract — never stored
ALTER TABLE project_beme_progress DROP COLUMN IF EXISTS pct_complete;

-- 4 ─────────────────────────────────────────────────────────────────────
ALTER TABLE project_diesel_consumption
    ADD COLUMN IF NOT EXISTS amount_ngn     numeric(18,2),
    ADD COLUMN IF NOT EXISTS is_cost_centre boolean NOT NULL DEFAULT false;

-- 5 ─────────────────────────────────────────────────────────────────────
ALTER TABLE project_contract_summary_snapshot
    ADD COLUMN IF NOT EXISTS client_name               text,
    ADD COLUMN IF NOT EXISTS contract_name             text,
    ADD COLUMN IF NOT EXISTS short_name                text,
    ADD COLUMN IF NOT EXISTS award_date                date,
    ADD COLUMN IF NOT EXISTS commencement_date         date,
    ADD COLUMN IF NOT EXISTS original_duration_months  numeric(6,2),
    ADD COLUMN IF NOT EXISTS eot_requested_months      numeric(6,2),
    ADD COLUMN IF NOT EXISTS eot_granted_months        numeric(6,2),
    ADD COLUMN IF NOT EXISTS revised_duration_months   numeric(6,2),
    ADD COLUMN IF NOT EXISTS overdue_weeks             numeric(8,2),
    ADD COLUMN IF NOT EXISTS works_submitted_not_vetted numeric(18,2),
    ADD COLUMN IF NOT EXISTS total_works_submitted     numeric(18,2),
    ADD COLUMN IF NOT EXISTS retention_released        numeric(18,2),
    ADD COLUMN IF NOT EXISTS advance_recovered         numeric(18,2),
    ADD COLUMN IF NOT EXISTS gross_certified           numeric(18,2),
    ADD COLUMN IF NOT EXISTS apg_amount                numeric(18,2),
    ADD COLUMN IF NOT EXISTS bill1_requested           numeric(18,2),
    ADD COLUMN IF NOT EXISTS bill1_paid                numeric(18,2),
    ADD COLUMN IF NOT EXISTS bill1_outstanding         numeric(18,2);

-- 6 ─────────────────────────────────────────────────────────────────────
ALTER TABLE project_weekly_reports
    ADD COLUMN IF NOT EXISTS sheet_hashes jsonb;

-- cumulative view: baseline + gaps + this-week facts, % computed here
CREATE OR REPLACE VIEW v_project_beme_cumulative AS
WITH movement AS (
    SELECT project_id, item_id,
           sum(COALESCE(qty_this_week, 0))    AS qty_weeks,
           sum(COALESCE(amount_this_week, 0)) AS amount_weeks
    FROM project_beme_progress GROUP BY project_id, item_id
),
adj AS (
    SELECT project_id, beme_item_id AS item_id,
           sum(COALESCE(qty, 0))    AS qty_adj,
           sum(COALESCE(amount, 0)) AS amount_adj
    FROM project_ledger_adjustments WHERE ledger = 'beme'
    GROUP BY project_id, beme_item_id
)
SELECT i.project_id, b.bill_no, b.name AS bill_name,
       i.id AS item_id, i.item_code, i.description, i.unit,
       i.contract_qty, i.rate, i.contract_amount,
       COALESCE(m.qty_weeks, 0)    + COALESCE(a.qty_adj, 0)    AS qty_done,
       COALESCE(m.amount_weeks, 0) + COALESCE(a.amount_adj, 0) AS amount_done,
       CASE WHEN COALESCE(i.contract_amount, 0) <> 0
            THEN round(((COALESCE(m.amount_weeks, 0) + COALESCE(a.amount_adj, 0))
                        / i.contract_amount) * 100, 2)
       END AS pct_complete,
       (COALESCE(i.contract_qty, 0) <> 0 AND
        COALESCE(m.qty_weeks, 0) + COALESCE(a.qty_adj, 0) > i.contract_qty * 1.001)
           AS is_overrun,
       (i.contract_qty IS NULL OR i.contract_qty = 0) AS no_contract_qty
FROM project_beme_items i
JOIN project_beme_bills b ON b.id = i.bill_id
LEFT JOIN movement m ON m.item_id = i.id
LEFT JOIN adj a ON a.item_id = i.id;

COMMIT;

-- 7 ─────────────────────────────────────────────────────────────────────
-- The workbook reuses item code 3.07 for two different rows (same
-- description, different qty/rate) — dup_seq keeps both as items.
ALTER TABLE project_beme_items
    ADD COLUMN IF NOT EXISTS dup_seq integer NOT NULL DEFAULT 0;
-- applied live: UNIQUE (bill_id, item_code, description) replaced by
-- UNIQUE (bill_id, item_code, description, dup_seq)
