-- 006_switch_plant_shared_costs_to_ngn.sql
-- Applied: 2026-04-27
--
-- get_plant_shared_costs: per-PO sums switch to total_cost_ngn so cross-PO
-- comparisons remain meaningful with mixed currencies. Per-item JSON keeps
-- unit_cost / total_cost in original currency and now also includes the
-- 'currency' field so the UI can render the correct symbol per item.
--
-- Kept in a separate migration from 005 because the JSON shape changes
-- (added 'currency' key per item).

CREATE OR REPLACE FUNCTION public.get_plant_shared_costs(p_plant_id uuid)
RETURNS TABLE(po_number text, po_date date, items_subtotal numeric, total_amount numeric, po_vat numeric, po_discount numeric, po_other numeric, supplier_name text, shared_with text[], items jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH plant_info AS (
        SELECT fleet_number FROM plants_master WHERE id = p_plant_id
    ),
    new_shared_pos AS (
        SELECT DISTINCT sp.purchase_order_number
        FROM spare_parts sp, plant_info pi
        WHERE sp.shared_fleet_numbers IS NOT NULL
          AND pi.fleet_number = ANY(sp.shared_fleet_numbers)
          AND sp.purchase_order_number IS NOT NULL
    ),
    old_shared_pos AS (
        SELECT sp.purchase_order_number
        FROM spare_parts sp
        WHERE sp.plant_id = p_plant_id
          AND sp.purchase_order_number IS NOT NULL
          AND COALESCE(sp.is_po_overhead, false) = false
          AND sp.shared_fleet_numbers IS NULL
        GROUP BY sp.purchase_order_number
        HAVING (
            SELECT COUNT(DISTINCT sp2.plant_id) FILTER (WHERE sp2.plant_id IS NOT NULL)
            FROM spare_parts sp2
            WHERE sp2.purchase_order_number = sp.purchase_order_number
              AND COALESCE(sp2.is_po_overhead, false) = false
        ) > 1
        OR bool_or(COALESCE(sp.is_workshop, false))
        OR bool_or(COALESCE(sp.is_category, false))
    ),
    all_shared_pos AS (
        SELECT purchase_order_number FROM new_shared_pos
        UNION
        SELECT purchase_order_number FROM old_shared_pos
    ),
    po_details AS (
        SELECT
            sp.purchase_order_number,
            MAX(sp.po_date) AS po_date,
            SUM(sp.total_cost_ngn) FILTER (WHERE COALESCE(sp.is_po_overhead, false) = false) AS items_subtotal,
            SUM(sp.total_cost_ngn) AS total_amount,
            MAX(sp.vat_amount) FILTER (WHERE sp.is_po_overhead = true) AS po_vat,
            MAX(sp.discount_amount) FILTER (WHERE sp.is_po_overhead = true) AS po_discount,
            MAX(sp.other_costs) FILTER (WHERE sp.is_po_overhead = true) AS po_other,
            MAX(sup.name)::text AS supplier_name,
            (SELECT ARRAY_AGG(DISTINCT fn)
             FROM spare_parts sp3
             CROSS JOIN LATERAL unnest(
                 COALESCE(sp3.shared_fleet_numbers, ARRAY[
                     (SELECT pm2.fleet_number FROM plants_master pm2 WHERE pm2.id = sp3.plant_id)
                 ])
             ) fn
             WHERE sp3.purchase_order_number = sp.purchase_order_number
               AND COALESCE(sp3.is_po_overhead, false) = false
               AND fn IS NOT NULL
               AND fn != (SELECT fleet_number FROM plant_info)
            ) AS shared_with,
            JSONB_AGG(DISTINCT
                JSONB_BUILD_OBJECT(
                    'description', sp.part_description,
                    'qty', sp.quantity,
                    'unit_cost', sp.unit_cost,
                    'total_cost', sp.total_cost,
                    'currency', COALESCE(sp.currency, 'NGN')
                )
            ) FILTER (WHERE COALESCE(sp.is_po_overhead, false) = false) AS items
        FROM spare_parts sp
        JOIN all_shared_pos asp ON sp.purchase_order_number = asp.purchase_order_number
        LEFT JOIN suppliers sup ON sp.supplier_id = sup.id
        GROUP BY sp.purchase_order_number
    )
    SELECT
        pd.purchase_order_number::text,
        pd.po_date,
        pd.items_subtotal,
        pd.total_amount,
        COALESCE(pd.po_vat, 0::numeric),
        COALESCE(pd.po_discount, 0::numeric),
        COALESCE(pd.po_other, 0::numeric),
        pd.supplier_name,
        pd.shared_with,
        pd.items
    FROM po_details pd
    ORDER BY pd.po_date DESC;
END;
$$;
