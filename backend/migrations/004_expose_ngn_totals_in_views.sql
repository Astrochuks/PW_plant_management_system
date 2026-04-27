-- 004_expose_ngn_totals_in_views.sql
-- Applied: 2026-04-27
--
-- Add NGN-equivalent totals + currency to the two main aggregation views.
-- Existing columns (total_amount, subtotal, total_spend) stay as-is so
-- per-row displays in original currency keep working. Cross-currency
-- aggregations should switch to the *_ngn columns.
--
-- CREATE OR REPLACE VIEW only allows appending columns at the end, so
-- new columns sit after the original column order.

CREATE OR REPLACE VIEW v_purchase_orders_summary AS
SELECT sp.purchase_order_number AS po_number,
    min(sp.po_date) AS po_date,
    (array_agg(sp.supplier_id ORDER BY sp.created_at) FILTER (WHERE (sp.supplier_id IS NOT NULL)))[1] AS supplier_id,
    min((s.name)::text) AS vendor,
    (array_agg(sp.location_id ORDER BY sp.created_at) FILTER (WHERE (sp.location_id IS NOT NULL)))[1] AS location_id,
    min((sp.requisition_number)::text) AS req_no,
    count(*) FILTER (WHERE (COALESCE(sp.is_po_overhead, false) = false)) AS items_count,
    ( SELECT count(DISTINCT sub.fn) AS count
           FROM ( SELECT sp2.fleet_number_raw AS fn
                   FROM spare_parts sp2
                  WHERE (((sp2.purchase_order_number)::text = (sp.purchase_order_number)::text) AND (sp2.fleet_number_raw IS NOT NULL) AND (NOT COALESCE(sp2.is_po_overhead, false)))
                UNION
                 SELECT unnest(sp2.shared_fleet_numbers) AS unnest
                   FROM spare_parts sp2
                  WHERE (((sp2.purchase_order_number)::text = (sp.purchase_order_number)::text) AND (sp2.shared_fleet_numbers IS NOT NULL))) sub) AS plants_count,
    COALESCE(sum(sp.total_cost), (0)::numeric) AS total_amount,
    COALESCE(sum((sp.unit_cost * (sp.quantity)::numeric)) FILTER (WHERE (COALESCE(sp.is_po_overhead, false) = false)), (0)::numeric) AS subtotal,
    bool_or(COALESCE(sp.is_workshop, false)) AS has_workshop,
    bool_or(COALESCE(sp.is_category, false)) AS has_category,
    CASE
        WHEN ((count(DISTINCT sp.plant_id) FILTER (WHERE (sp.plant_id IS NOT NULL)) = 1) AND (NOT bool_or(COALESCE(sp.is_workshop, false))) AND (NOT bool_or(COALESCE(sp.is_category, false))) AND (NOT bool_or((sp.shared_fleet_numbers IS NOT NULL)))) THEN 'direct'::text
        ELSE 'shared'::text
    END AS cost_type,
    min(sp.year) AS year,
    min(sp.month) AS month,
    min(sp.week_number) AS week_number,
    min(sp.quarter) AS quarter,
    min(sp.created_at) AS created_at,
    max(sp.updated_at) AS updated_at,
    -- New: NGN-equivalent + currency metadata
    COALESCE(sum(sp.total_cost_ngn), (0)::numeric) AS total_amount_ngn,
    COALESCE(sum((sp.unit_cost * (sp.quantity)::numeric * COALESCE(sp.fx_rate_to_ngn, 1))) FILTER (WHERE (COALESCE(sp.is_po_overhead, false) = false)), (0)::numeric) AS subtotal_ngn,
    min(COALESCE(sp.currency, 'NGN')) AS currency,
    min(COALESCE(sp.fx_rate_to_ngn, 1)) AS fx_rate_to_ngn
FROM (spare_parts sp
 LEFT JOIN suppliers s ON ((sp.supplier_id = s.id)))
WHERE (sp.purchase_order_number IS NOT NULL)
GROUP BY sp.purchase_order_number;

CREATE OR REPLACE VIEW v_supplier_stats AS
SELECT s.id,
    s.name,
    s.name_normalized,
    s.contact_person,
    s.phone,
    s.email,
    s.address,
    s.is_active,
    s.created_at,
    s.updated_at,
    COALESCE(stats.items_count, 0) AS items_count,
    COALESCE(stats.po_count, 0) AS po_count,
    COALESCE(stats.total_spend, (0)::numeric) AS total_spend,
    COALESCE(stats.total_spend_ngn, (0)::numeric) AS total_spend_ngn
FROM (suppliers s
 LEFT JOIN LATERAL ( SELECT (count(*))::integer AS items_count,
        (count(DISTINCT sp.purchase_order_number))::integer AS po_count,
        COALESCE(sum(sp.total_cost), (0)::numeric) AS total_spend,
        COALESCE(sum(sp.total_cost_ngn), (0)::numeric) AS total_spend_ngn
       FROM spare_parts sp
      WHERE (sp.supplier_id = s.id)) stats ON (true));
