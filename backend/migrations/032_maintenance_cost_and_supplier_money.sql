-- 032: one maintenance-cost figure, and supplier spend in naira.
--
-- ─── 1. get_maintenance_cost_analysis destroyed money ────────────────
--
-- Its aggregate divided a shared PO by the number of fleet numbers on
-- it, but never expanded the row:
--
--     CASE WHEN sp.shared_fleet_numbers IS NOT NULL
--          THEN sp.total_cost_ngn / array_length(sp.shared_fleet_numbers, 1)
--          ELSE sp.total_cost_ngn END
--
-- A NGN 100,000 PO shared across 5 plants contributed NGN 20,000 to the
-- month and the remaining NGN 80,000 was simply lost. Across 2026 that
-- destroyed NGN 12,449,231.25 of NGN 65,548,502.24 of shared spend, so
-- the Reports > Maintenance Costs page showed NGN 529,328,325.07 where
-- the Spare Parts and Purchase Orders pages both showed
-- NGN 541,777,556.32.
--
-- Dividing is only meaningful when the question is "what did THIS plant
-- cost", i.e. when p_plant_id is supplied. Asked portfolio-wide, the
-- money was spent in full and must be counted in full.
--
-- ─── 2. the ambiguous overload ───────────────────────────────────────
--
-- Two overloads existed, (…text…) and (…character varying…), with
-- DIFFERENT cost logic — NGN 529,328,325.07 vs NGN 541,777,556.32 for
-- 2026. Which one ran depended on how Postgres resolved the parameter
-- types. The varchar one is dropped so only one definition can ever run.
--
-- ─── 3. v_supplier_stats reported raw currency as naira ──────────────
--
-- total_spend summed total_cost (the original currency) while the UI
-- renders it as naira, understating foreign-currency purchases by
-- NGN 9,229,167.32 overall. It now sums total_cost_ngn, matching every
-- other money figure. po_count also counted DISTINCT numbers; a PO is
-- its number AND its date (migration 031).

-- 1 + 2 ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_maintenance_cost_analysis(
    integer, uuid, character varying, uuid, character varying);

CREATE OR REPLACE FUNCTION public.get_maintenance_cost_analysis(
    p_year integer DEFAULT NULL::integer,
    p_location_id uuid DEFAULT NULL::uuid,
    p_group_by text DEFAULT 'month'::text,
    p_plant_id uuid DEFAULT NULL::uuid,
    p_fleet_type text DEFAULT NULL::text)
 RETURNS TABLE(group_key text, total_cost numeric, part_count bigint, avg_cost numeric)
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_fleet_number TEXT;
BEGIN
    IF p_plant_id IS NOT NULL THEN
        SELECT pm.fleet_number INTO v_fleet_number
        FROM plants_master pm WHERE pm.id = p_plant_id;
    END IF;

    RETURN QUERY
    SELECT
        CASE p_group_by
            WHEN 'week' THEN COALESCE(sp.year::text, EXTRACT(YEAR FROM sp.replaced_date)::text) || '-W' || LPAD(COALESCE(sp.week_number, EXTRACT(WEEK FROM sp.replaced_date)::integer)::text, 2, '0')
            WHEN 'month' THEN TO_CHAR(sp.replaced_date, 'YYYY-MM')
            WHEN 'quarter' THEN EXTRACT(YEAR FROM sp.replaced_date)::text || '-Q' || COALESCE(sp.quarter, EXTRACT(QUARTER FROM sp.replaced_date)::integer)::text
            WHEN 'year' THEN EXTRACT(YEAR FROM sp.replaced_date)::text
            WHEN 'fleet_type' THEN COALESCE(pm.fleet_type, 'UNKNOWN')
            WHEN 'location' THEN COALESCE(l.name, 'UNKNOWN')
            WHEN 'plant' THEN pm.fleet_number::text
        END AS group_key,
        -- Only apportion when the question is about ONE plant. Asked
        -- portfolio-wide, a shared PO was still bought in full.
        COALESCE(SUM(
            CASE
                WHEN p_plant_id IS NOT NULL AND sp.shared_fleet_numbers IS NOT NULL
                    THEN sp.total_cost_ngn / array_length(sp.shared_fleet_numbers, 1)
                ELSE sp.total_cost_ngn
            END
        ), 0) AS total_cost,
        COUNT(sp.id)::bigint AS part_count,
        COALESCE(ROUND(AVG(
            CASE
                WHEN p_plant_id IS NOT NULL AND sp.shared_fleet_numbers IS NOT NULL
                    THEN sp.total_cost_ngn / array_length(sp.shared_fleet_numbers, 1)
                ELSE sp.total_cost_ngn
            END
        ), 2), 0) AS avg_cost
    FROM public.spare_parts sp
    LEFT JOIN public.plants_master pm ON pm.id = sp.plant_id
    LEFT JOIN public.locations l ON l.id = sp.location_id
    WHERE
        (p_year IS NULL OR sp.year = p_year OR EXTRACT(YEAR FROM sp.replaced_date) = p_year)
        AND (p_location_id IS NULL OR sp.location_id = p_location_id)
        AND (p_plant_id IS NULL OR sp.plant_id = p_plant_id
             OR (sp.shared_fleet_numbers IS NOT NULL AND v_fleet_number = ANY(sp.shared_fleet_numbers)))
        AND (p_fleet_type IS NULL OR pm.fleet_type ILIKE '%' || p_fleet_type || '%')
        AND sp.replaced_date IS NOT NULL
    GROUP BY group_key
    ORDER BY group_key;
END;
$function$;

-- 3 ─────────────────────────────────────────────────────────────────
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
    -- naira, because that is what every consumer renders
    COALESCE(stats.total_spend_ngn, 0::numeric) AS total_spend,
    COALESCE(stats.total_spend_ngn, 0::numeric) AS total_spend_ngn
   FROM suppliers s
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS items_count,
            count(DISTINCT (sp.purchase_order_number, sp.po_date))::integer AS po_count,
            COALESCE(sum(sp.total_cost_ngn), 0::numeric) AS total_spend_ngn
           FROM spare_parts sp
          WHERE sp.supplier_id = s.id) stats ON true;
