-- 026: multi-currency correctness on the READING side (2026-07-20).
--
-- spare_parts stores original-currency amounts (total_cost, unit_cost)
-- plus frozen conversion (fx_rate_to_ngn, total_cost_ngn) captured at
-- entry. The entry form and most aggregates already honour this; three
-- views and one RPC still summed/returned ORIGINAL currency amounts
-- into naira-labelled displays (a GBP part added £127 as if ₦127).
-- Every ₦-labelled aggregate below now uses COALESCE(total_cost_ngn,
-- total_cost). Original amounts + rate remain visible on PO pages.
--
-- NOTE: get_maintenance_costs_combined references the long-gone view
-- v_purchase_order_costs — it is dead (no API consumer, errors when
-- called) and deliberately left untouched.

BEGIN;

CREATE OR REPLACE VIEW v_plants_summary AS
 SELECT p.id,
    p.fleet_number,
    p.description,
    p.fleet_type,
    p.make,
    p.model,
    p.chassis_number,
    p.year_of_manufacture,
    p.purchase_year,
    p.purchase_month,
    p.purchase_cost,
    p.serial_m,
    p.serial_e,
    p.condition,
    p.physical_verification,
    p.current_location_id,
    l.name AS current_location,
    l.state_id,
    s.name AS state,
    s.code AS state_code,
    p.last_verified_date,
    p.last_verified_year,
    p.last_verified_week,
    p.remarks,
    p.created_at,
    p.updated_at,
    pt.to_location_id AS pending_transfer_to_id,
    ptl.name AS pending_transfer_to_location,
    COALESCE(m.total_maintenance_cost, 0::numeric) AS total_maintenance_cost,
    COALESCE(m.parts_replaced_count, 0::bigint) AS parts_replaced_count,
    m.last_maintenance_date,
    COALESCE(shared.shared_po_count, 0::bigint) AS shared_po_count,
    COALESCE(l.is_bua, false) AS is_bua,
    COALESCE(ptl.is_bua, false) AS pending_transfer_to_is_bua,
    p.purchase_day,
    p.engine_number,
    p.purchase_site,
    COALESCE(p.purchase_currency, 'NGN'::character varying) AS purchase_currency,
    COALESCE(p.components, '[]'::jsonb) AS components,
    p.capacity,
    p.manufacture_month,
    p.manufacture_day,
    p.division
   FROM plants_master p
     LEFT JOIN locations l ON p.current_location_id = l.id
     LEFT JOIN states s ON l.state_id = s.id
     LEFT JOIN plant_transfers pt ON p.pending_transfer_id = pt.id
     LEFT JOIN locations ptl ON pt.to_location_id = ptl.id
     LEFT JOIN ( SELECT spare_parts.plant_id,
            sum(COALESCE(spare_parts.total_cost_ngn, spare_parts.total_cost)) AS total_maintenance_cost,
            count(*) AS parts_replaced_count,
            max(spare_parts.replaced_date) AS last_maintenance_date
           FROM spare_parts
          WHERE spare_parts.plant_id IS NOT NULL AND spare_parts.cost_type = 'direct'::text AND COALESCE(spare_parts.is_po_overhead, false) = false
          GROUP BY spare_parts.plant_id) m ON p.id = m.plant_id
     LEFT JOIN ( SELECT fn.fn AS fleet_number,
            count(DISTINCT spare_parts.purchase_order_number) AS shared_po_count
           FROM spare_parts
             CROSS JOIN LATERAL unnest(spare_parts.shared_fleet_numbers) fn(fn)
          WHERE spare_parts.shared_fleet_numbers IS NOT NULL AND COALESCE(spare_parts.is_po_overhead, false) = false
          GROUP BY fn.fn
        UNION ALL
         SELECT pm2.fleet_number,
            count(DISTINCT sp2.purchase_order_number) AS count
           FROM plants_master pm2
             JOIN spare_parts sp2 ON sp2.plant_id = pm2.id AND sp2.cost_type = 'shared'::text AND sp2.shared_fleet_numbers IS NULL AND COALESCE(sp2.is_po_overhead, false) = false
          GROUP BY pm2.fleet_number) shared ON p.fleet_number::text = shared.fleet_number;

CREATE OR REPLACE VIEW v_plant_costs AS
 SELECT p.id AS plant_id,
    p.fleet_number,
    p.description AS plant_description,
    p.fleet_type,
    l.name AS current_location,
    count(sp.id) AS parts_count,
    COALESCE(sum(COALESCE(sp.total_cost_ngn, sp.total_cost)), 0::numeric) AS total_maintenance_cost,
    min(sp.replaced_date) AS first_maintenance_date,
    max(sp.replaced_date) AS last_maintenance_date,
    count(DISTINCT sp.purchase_order_number) AS po_count
   FROM plants_master p
     LEFT JOIN locations l ON p.current_location_id = l.id
     LEFT JOIN spare_parts sp ON sp.plant_id = p.id
  GROUP BY p.id, p.fleet_number, p.description, p.fleet_type, l.name;

CREATE OR REPLACE VIEW v_plant_utilization AS
 SELECT pm.id,
    pm.fleet_number,
    pm.description,
    pm.fleet_type,
    pm.condition,
    pm.current_location_id,
    l.name AS current_location,
    COALESCE(usage.total_hours_worked, 0::numeric) AS total_hours_worked,
    COALESCE(usage.total_standby_hours, 0::numeric) AS total_standby_hours,
    COALESCE(usage.total_breakdown_hours, 0::numeric) AS total_breakdown_hours,
    COALESCE(usage.weeks_tracked, 0::bigint) AS weeks_tracked,
        CASE
            WHEN (COALESCE(usage.total_hours_worked, 0::numeric) + COALESCE(usage.total_standby_hours, 0::numeric) + COALESCE(usage.total_breakdown_hours, 0::numeric)) > 0::numeric THEN round(COALESCE(usage.total_hours_worked, 0::numeric) / (COALESCE(usage.total_hours_worked, 0::numeric) + COALESCE(usage.total_standby_hours, 0::numeric) + COALESCE(usage.total_breakdown_hours, 0::numeric)) * 100::numeric, 1)
            ELSE 0::numeric
        END AS utilization_rate,
    COALESCE(sp_agg.total_maintenance_cost, 0::numeric) AS total_maintenance_cost,
    COALESCE(sp_agg.parts_replaced_count, 0) AS parts_replaced_count,
    pm.purchase_cost,
    pm.year_of_manufacture
   FROM plants_master pm
     LEFT JOIN locations l ON pm.current_location_id = l.id
     LEFT JOIN LATERAL ( SELECT sum(plant_weekly_records.hours_worked) AS total_hours_worked,
            sum(plant_weekly_records.standby_hours) AS total_standby_hours,
            sum(plant_weekly_records.breakdown_hours) AS total_breakdown_hours,
            count(*) AS weeks_tracked
           FROM plant_weekly_records
          WHERE plant_weekly_records.plant_id = pm.id) usage ON true
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(COALESCE(spare_parts.total_cost_ngn, spare_parts.total_cost)), 0::numeric) AS total_maintenance_cost,
            count(*)::integer AS parts_replaced_count
           FROM spare_parts
          WHERE spare_parts.plant_id = pm.id) sp_agg ON true;

CREATE OR REPLACE FUNCTION public.get_plant_maintenance_history(p_plant_id uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, replaced_date date, part_number text, part_description text, supplier text, reason_for_change text, unit_cost numeric, quantity integer, total_cost numeric, purchase_order_number text, remarks text, shared_fleet_numbers text[], cost_type text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_fleet_number TEXT;
BEGIN
    -- Look up this plant's fleet number for shared item matching
    SELECT pm.fleet_number INTO v_fleet_number
    FROM plants_master pm WHERE pm.id = p_plant_id;

    RETURN QUERY
    SELECT
        sp.id,
        sp.replaced_date,
        sp.part_number::TEXT,
        sp.part_description::TEXT,
        COALESCE(sup.name, sp.supplier)::TEXT,
        sp.reason_for_change::TEXT,
        (sp.unit_cost * COALESCE(sp.fx_rate_to_ngn, 1))::numeric AS unit_cost,
        sp.quantity,
        COALESCE(sp.total_cost_ngn, sp.total_cost) AS total_cost,
        sp.purchase_order_number::TEXT,
        sp.remarks::TEXT,
        sp.shared_fleet_numbers,
        sp.cost_type::TEXT
    FROM spare_parts sp
    LEFT JOIN suppliers sup ON sup.id = sp.supplier_id
    WHERE (
        sp.plant_id = p_plant_id
        OR (sp.shared_fleet_numbers IS NOT NULL
            AND v_fleet_number = ANY(sp.shared_fleet_numbers))
    )
    AND COALESCE(sp.is_po_overhead, false) = false
    ORDER BY sp.replaced_date DESC NULLS LAST, sp.created_at DESC
    LIMIT p_limit;
END;
$function$;

COMMIT;
