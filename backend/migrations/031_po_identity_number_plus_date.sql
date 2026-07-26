-- 031: a purchase order is its NUMBER **and** its DATE.
--
-- PO numbers come from the plant people. We do not control how they are
-- written, and the same number can legitimately recur — including in a
-- different year. The authority for when a PO was raised is the date on
-- the purchase order itself, which is what `po_date` holds.
--
-- v_purchase_orders_summary grouped by purchase_order_number ALONE, so
-- every PO sharing a number was merged into one row, and the merged row
-- was dated min(po_date) — the earliest of them. A PO raised in 2026 and
-- sharing its number with one raised in 2025 therefore disappeared from
-- 2026 entirely.
--
-- Live example: PW-PO201125-08 covers 2025-11-20 (NGN 100,000),
-- 2026-02-21 (NGN 680,000) and 2026-04-08 (NGN 458,000). All NGN
-- 1,238,000 was filed under 2025, so the Purchase Orders card read
-- NGN 540,639,556.32 for 2026 while the Spare Parts card, which counts
-- line items by their own date, read NGN 541,777,556.32 — a
-- NGN 1,138,000 gap between two cards that should agree.
--
-- Grouping by (purchase_order_number, po_date) makes them reconcile
-- EXACTLY: 2026 becomes NGN 541,777,556.32 on both, and every PO lands
-- in the period it was actually raised in.
--
-- NO DATA CHANGES. Not one date, not one amount. Only how rows are
-- grouped for display.
--
-- 14 PO numbers currently cover more than one date; they become separate
-- rows, so the 2026 PO count goes 300 -> 311.

CREATE OR REPLACE VIEW v_purchase_orders_summary AS
SELECT sp.purchase_order_number AS po_number,
    sp.po_date,
    (array_agg(sp.supplier_id ORDER BY sp.created_at) FILTER (WHERE sp.supplier_id IS NOT NULL))[1] AS supplier_id,
    min(s.name::text) AS vendor,
    (array_agg(sp.location_id ORDER BY sp.created_at) FILTER (WHERE sp.location_id IS NOT NULL))[1] AS location_id,
    min(sp.requisition_number::text) AS req_no,
    count(*) FILTER (WHERE COALESCE(sp.is_po_overhead, false) = false) AS items_count,
    -- must correlate on the DATE too, or a repeated number counts the
    -- plants of every PO sharing it
    ( SELECT count(DISTINCT sub.fn) AS count
           FROM ( SELECT sp2.fleet_number_raw AS fn
                   FROM spare_parts sp2
                  WHERE sp2.purchase_order_number::text = sp.purchase_order_number::text
                    AND sp2.po_date IS NOT DISTINCT FROM sp.po_date
                    AND sp2.fleet_number_raw IS NOT NULL
                    AND NOT COALESCE(sp2.is_po_overhead, false)
                UNION
                 SELECT unnest(sp2.shared_fleet_numbers) AS unnest
                   FROM spare_parts sp2
                  WHERE sp2.purchase_order_number::text = sp.purchase_order_number::text
                    AND sp2.po_date IS NOT DISTINCT FROM sp.po_date
                    AND sp2.shared_fleet_numbers IS NOT NULL) sub) AS plants_count,
    COALESCE(sum(sp.total_cost), 0::numeric) AS total_amount,
    COALESCE(sum(sp.unit_cost * sp.quantity::numeric) FILTER (WHERE COALESCE(sp.is_po_overhead, false) = false), 0::numeric) AS subtotal,
    bool_or(COALESCE(sp.is_workshop, false)) AS has_workshop,
    bool_or(COALESCE(sp.is_category, false)) AS has_category,
        CASE
            WHEN count(DISTINCT sp.plant_id) FILTER (WHERE sp.plant_id IS NOT NULL) = 1 AND NOT bool_or(COALESCE(sp.is_workshop, false)) AND NOT bool_or(COALESCE(sp.is_category, false)) AND NOT bool_or(sp.shared_fleet_numbers IS NOT NULL) THEN 'direct'::text
            ELSE 'shared'::text
        END AS cost_type,
    min(sp.year) AS year,
    min(sp.month) AS month,
    min(sp.week_number) AS week_number,
    min(sp.quarter) AS quarter,
    min(sp.created_at) AS created_at,
    max(sp.updated_at) AS updated_at,
    COALESCE(sum(sp.total_cost_ngn), 0::numeric) AS total_amount_ngn,
    COALESCE(sum(sp.unit_cost * sp.quantity::numeric * COALESCE(sp.fx_rate_to_ngn, 1::numeric)) FILTER (WHERE COALESCE(sp.is_po_overhead, false) = false), 0::numeric) AS subtotal_ngn,
    min(COALESCE(sp.currency, 'NGN'::text)) AS currency,
    min(COALESCE(sp.fx_rate_to_ngn, 1::numeric)) AS fx_rate_to_ngn
   FROM spare_parts sp
     LEFT JOIN suppliers s ON sp.supplier_id = s.id
  WHERE sp.purchase_order_number IS NOT NULL
  GROUP BY sp.purchase_order_number, sp.po_date;
