-- 024: persist the workbook-verbatim columns surfaced during the user's
-- sheet-by-sheet preview audit (2026-07-14).
--
-- Materials & Civils: the sheet's own usage split column M ('Other Uses')
-- and its own loss detector, cols O/P ('Variance Qty'/'Variance Value') —
-- stored verbatim alongside our computed discrepancy_* (reported vs
-- recomputed, same convention as BEME reported-previous).
--
-- Certificate Status: tail columns R/S ('New Total', 'Less Previously
-- Certified without VAT') — completes the 19-column ledger.
--
-- Payments deduction-rate columns (L..P) are deliberately NOT persisted:
-- per-row constants derivable from the amounts (wht/gross etc.),
-- display-only in the preview.

BEGIN;

ALTER TABLE project_materials_stock
    ADD COLUMN IF NOT EXISTS used_other     numeric(18,3),
    ADD COLUMN IF NOT EXISTS variance_qty   numeric(18,3),
    ADD COLUMN IF NOT EXISTS variance_value numeric(18,2);

ALTER TABLE project_certificates
    ADD COLUMN IF NOT EXISTS new_total                  numeric(18,2),
    ADD COLUMN IF NOT EXISTS less_previously_certified  numeric(18,2);

COMMIT;
