-- 021: hierarchical BEME bills (Kaduna findings, 2026-07-12)
--
-- The company standard is hierarchical: a bill is a dotted code at ANY
-- depth with an ALL-CAPS name ('4' PAVEMENT in Akwa Ibom, '5.3'
-- SUPERSTRUCTURE in Kaduna); items sit one segment deeper. Integer
-- bill_no cannot represent that — bills are now keyed by bill_code text.
-- bill_no stays as a nullable legacy/display ordinal.

BEGIN;

ALTER TABLE project_beme_bills
    ADD COLUMN IF NOT EXISTS bill_code  text,
    ADD COLUMN IF NOT EXISTS sort_order integer;

UPDATE project_beme_bills
   SET bill_code = bill_no::text,
       sort_order = bill_no
 WHERE bill_code IS NULL;

ALTER TABLE project_beme_bills ALTER COLUMN bill_code SET NOT NULL;
ALTER TABLE project_beme_bills ALTER COLUMN bill_no DROP NOT NULL;

-- one bill per code per project
ALTER TABLE project_beme_bills
    DROP CONSTRAINT IF EXISTS project_beme_bills_project_id_bill_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_beme_bills_project_code
    ON project_beme_bills(project_id, bill_code);

-- cumulative view gains the code (bill_no kept for existing consumers).
-- DROP first: CREATE OR REPLACE cannot insert columns mid-view.
DROP VIEW IF EXISTS v_project_beme_cumulative;
CREATE VIEW v_project_beme_cumulative AS
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
SELECT i.project_id, b.bill_no, b.bill_code, b.sort_order,
       b.name AS bill_name,
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
