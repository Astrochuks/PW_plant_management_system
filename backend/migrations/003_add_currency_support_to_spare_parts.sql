-- 003_add_currency_support_to_spare_parts.sql
-- Applied: 2026-04-27
--
-- Multi-currency support for purchase orders.
-- Strategy: frozen FX at PO entry. Each row stores its original currency,
-- the FX rate at entry time, and an auto-computed NGN-equivalent that all
-- aggregations read so historical totals never shift.

ALTER TABLE spare_parts
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'NGN',
  ADD COLUMN fx_rate_to_ngn NUMERIC(20, 6) NOT NULL DEFAULT 1
    CHECK (fx_rate_to_ngn > 0);

-- NGN-equivalent. Mirrors the total_cost formula × fx_rate_to_ngn.
-- We can't reference total_cost directly because PG forbids generated
-- columns referencing other generated columns.
ALTER TABLE spare_parts
  ADD COLUMN total_cost_ngn NUMERIC GENERATED ALWAYS AS (
    ROUND(
      (
        (
          (COALESCE(unit_cost, 0) * COALESCE(quantity, 1)::NUMERIC)
          + COALESCE(
              vat_amount,
              (COALESCE(unit_cost, 0) * COALESCE(quantity, 1)::NUMERIC) * COALESCE(vat_percentage, 0) / 100
            )
        )
        - COALESCE(
            discount_amount,
            (COALESCE(unit_cost, 0) * COALESCE(quantity, 1)::NUMERIC) * COALESCE(discount_percentage, 0) / 100
          )
        + COALESCE(other_costs, 0)
      ) * COALESCE(fx_rate_to_ngn, 1),
      2
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_spare_parts_currency_non_ngn
  ON spare_parts(currency) WHERE currency != 'NGN';

COMMENT ON COLUMN spare_parts.currency IS 'ISO 4217 code (NGN, GBP, USD, EUR, ...). Default NGN.';
COMMENT ON COLUMN spare_parts.fx_rate_to_ngn IS 'Exchange rate to NGN at PO entry time. Frozen — never recomputed after entry.';
COMMENT ON COLUMN spare_parts.total_cost_ngn IS 'Auto-computed NGN-equivalent of total_cost. Use this for all cross-currency aggregations.';
