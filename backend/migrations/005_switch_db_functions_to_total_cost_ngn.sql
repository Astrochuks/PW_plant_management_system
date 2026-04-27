-- 005_switch_db_functions_to_total_cost_ngn.sql
-- Applied: 2026-04-27
--
-- Switch every cross-row aggregation in actively-used DB functions
-- from total_cost (original currency) to total_cost_ngn (NGN equivalent),
-- so foreign-currency POs aggregate correctly.
--
-- Functions covered (all callers verified in backend/app/api/v1/):
--   get_top_suppliers, get_high_cost_plants, get_spare_parts_stats,
--   get_plant_costs_by_period, get_maintenance_cost_analysis (2 overloads),
--   search_plants
--
-- get_plant_shared_costs is updated separately in 006 because its return
-- type changed (added 'currency' to per-item JSON).
-- get_maintenance_costs_combined is dead code (references a deleted view)
-- and is not updated.

CREATE OR REPLACE FUNCTION public.get_top_suppliers(
    p_limit integer DEFAULT 10,
    p_year integer DEFAULT NULL,
    p_month integer DEFAULT NULL,
    p_quarter integer DEFAULT NULL,
    p_location_id uuid DEFAULT NULL
)
RETURNS TABLE(supplier_id uuid, supplier_name text, total_spend numeric, parts_count bigint, avg_part_cost numeric, plants_serviced bigint, po_count bigint)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        sp.supplier_id,
        s.name::TEXT AS supplier_name,
        SUM(sp.total_cost_ngn)::NUMERIC AS total_spend,
        COUNT(*)::BIGINT AS parts_count,
        ROUND(AVG(sp.total_cost_ngn), 2)::NUMERIC AS avg_part_cost,
        COUNT(DISTINCT sp.plant_id)::BIGINT AS plants_serviced,
        COUNT(DISTINCT sp.purchase_order_number)::BIGINT AS po_count
    FROM spare_parts sp
    JOIN suppliers s ON s.id = sp.supplier_id
    WHERE
        sp.supplier_id IS NOT NULL
        AND (p_year IS NULL OR sp.year = p_year)
        AND (p_month IS NULL OR sp.month = p_month)
        AND (p_quarter IS NULL OR sp.quarter = p_quarter)
        AND (p_location_id IS NULL OR sp.location_id = p_location_id)
    GROUP BY sp.supplier_id, s.name
    ORDER BY total_spend DESC
    LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_high_cost_plants(
    p_limit integer DEFAULT 10,
    p_year integer DEFAULT NULL
)
RETURNS TABLE(plant_id uuid, fleet_number text, plant_description text, current_location text, maintenance_cost numeric, parts_count bigint, last_maintenance date)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH direct_costs AS (
    SELECT
      p.id AS plant_id,
      p.fleet_number::TEXT,
      p.description::TEXT AS plant_description,
      l.name::TEXT AS current_location,
      SUM(sp.total_cost_ngn) AS direct_cost,
      COUNT(sp.id) AS direct_parts_count,
      MAX(sp.replaced_date) AS last_direct_maintenance
    FROM plants_master p
    INNER JOIN spare_parts sp ON sp.plant_id = p.id
    LEFT JOIN locations l ON l.id = p.current_location_id
    WHERE
      (p_year IS NULL OR EXTRACT(YEAR FROM sp.replaced_date) = p_year)
    GROUP BY p.id, p.fleet_number, p.description, l.name
  ),
  shared_costs AS (
    SELECT
      p.id AS plant_id,
      SUM(sp.total_cost_ngn / array_length(sp.shared_fleet_numbers, 1)) AS shared_cost,
      COUNT(sp.id) AS shared_parts_count,
      MAX(sp.replaced_date) AS last_shared_maintenance
    FROM plants_master p
    INNER JOIN spare_parts sp ON p.fleet_number = ANY(sp.shared_fleet_numbers)
    WHERE
      sp.shared_fleet_numbers IS NOT NULL
      AND COALESCE(sp.is_po_overhead, false) = false
      AND (p_year IS NULL OR EXTRACT(YEAR FROM sp.replaced_date) = p_year)
    GROUP BY p.id
  )
  SELECT
    COALESCE(dc.plant_id, sc.plant_id) AS plant_id,
    COALESCE(dc.fleet_number, pm.fleet_number::text) AS fleet_number,
    COALESCE(dc.plant_description, pm.description::text) AS plant_description,
    COALESCE(dc.current_location, l.name::text) AS current_location,
    (COALESCE(dc.direct_cost, 0) + COALESCE(sc.shared_cost, 0))::NUMERIC AS maintenance_cost,
    (COALESCE(dc.direct_parts_count, 0) + COALESCE(sc.shared_parts_count, 0))::BIGINT AS parts_count,
    GREATEST(dc.last_direct_maintenance, sc.last_shared_maintenance)::DATE AS last_maintenance
  FROM direct_costs dc
  FULL OUTER JOIN shared_costs sc ON dc.plant_id = sc.plant_id
  LEFT JOIN plants_master pm ON pm.id = COALESCE(dc.plant_id, sc.plant_id)
  LEFT JOIN locations l ON l.id = pm.current_location_id
  ORDER BY maintenance_cost DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_spare_parts_stats(
    p_year integer DEFAULT NULL,
    p_month integer DEFAULT NULL,
    p_week integer DEFAULT NULL,
    p_quarter integer DEFAULT NULL,
    p_location_id uuid DEFAULT NULL,
    p_supplier_id uuid DEFAULT NULL,
    p_fleet_number text DEFAULT NULL,
    p_supplier_name text DEFAULT NULL,
    p_search text DEFAULT NULL,
    p_date_from date DEFAULT NULL,
    p_date_to date DEFAULT NULL
)
RETURNS TABLE(total_parts bigint, total_spend numeric, avg_cost_per_part numeric, unique_plants bigint, unique_suppliers bigint, parts_in_period bigint, spend_in_period numeric, direct_parts bigint, direct_spend numeric, shared_parts bigint, shared_spend numeric)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    WITH filtered AS (
        SELECT
            sp.id,
            sp.plant_id,
            sp.supplier_id,
            sp.total_cost_ngn AS part_total_cost,
            sp.cost_type
        FROM spare_parts sp
        LEFT JOIN plants_master pm ON pm.id = sp.plant_id
        LEFT JOIN suppliers s ON s.id = sp.supplier_id
        WHERE
            (p_year IS NULL OR sp.year = p_year)
            AND (p_month IS NULL OR sp.month = p_month)
            AND (p_week IS NULL OR sp.week_number = p_week)
            AND (p_quarter IS NULL OR sp.quarter = p_quarter)
            AND (p_location_id IS NULL OR sp.location_id = p_location_id)
            AND (p_supplier_id IS NULL OR sp.supplier_id = p_supplier_id)
            AND (p_fleet_number IS NULL OR (
                pm.fleet_number ILIKE '%' || p_fleet_number || '%'
                OR UPPER(p_fleet_number) = ANY(sp.shared_fleet_numbers)
            ))
            AND (p_supplier_name IS NULL OR s.name ILIKE '%' || p_supplier_name || '%')
            AND (p_search IS NULL OR (
                sp.part_description ILIKE '%' || p_search || '%'
                OR sp.part_number ILIKE '%' || p_search || '%'
            ))
            AND (p_date_from IS NULL OR sp.replaced_date >= p_date_from)
            AND (p_date_to IS NULL OR sp.replaced_date <= p_date_to)
    )
    SELECT
        COUNT(*)::BIGINT AS total_parts,
        COALESCE(SUM(f.part_total_cost), 0)::NUMERIC AS total_spend,
        COALESCE(ROUND(AVG(f.part_total_cost), 2), 0)::NUMERIC AS avg_cost_per_part,
        COUNT(DISTINCT f.plant_id)::BIGINT AS unique_plants,
        COUNT(DISTINCT f.supplier_id)::BIGINT AS unique_suppliers,
        COUNT(*)::BIGINT AS parts_in_period,
        COALESCE(SUM(f.part_total_cost), 0)::NUMERIC AS spend_in_period,
        COUNT(*) FILTER (WHERE f.cost_type = 'direct')::BIGINT AS direct_parts,
        COALESCE(SUM(f.part_total_cost) FILTER (WHERE f.cost_type = 'direct'), 0)::NUMERIC AS direct_spend,
        COUNT(*) FILTER (WHERE f.cost_type = 'shared')::BIGINT AS shared_parts,
        COALESCE(SUM(f.part_total_cost) FILTER (WHERE f.cost_type = 'shared'), 0)::NUMERIC AS shared_spend
    FROM filtered f;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_plant_costs_by_period(
    p_plant_id uuid,
    p_year integer DEFAULT NULL,
    p_month integer DEFAULT NULL,
    p_quarter integer DEFAULT NULL,
    p_week integer DEFAULT NULL
)
RETURNS TABLE(total_cost numeric, parts_count bigint, po_count bigint, period_start date, period_end date)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM(sp.total_cost_ngn), 0) AS total_cost,
        COUNT(sp.id) AS parts_count,
        COUNT(DISTINCT sp.purchase_order_number) AS po_count,
        MIN(sp.replaced_date) AS period_start,
        MAX(sp.replaced_date) AS period_end
    FROM spare_parts sp
    WHERE sp.plant_id = p_plant_id
      AND sp.cost_type = 'direct'
      AND COALESCE(sp.is_po_overhead, false) = false
      AND (p_year IS NULL OR sp.year = p_year)
      AND (p_month IS NULL OR sp.month = p_month)
      AND (p_quarter IS NULL OR sp.quarter = p_quarter)
      AND (p_week IS NULL OR sp.week_number = p_week);
END;
$$;

-- get_maintenance_cost_analysis has two overloads (text and varchar args)
CREATE OR REPLACE FUNCTION public.get_maintenance_cost_analysis(
    p_year integer DEFAULT NULL,
    p_location_id uuid DEFAULT NULL,
    p_group_by text DEFAULT 'month',
    p_plant_id uuid DEFAULT NULL,
    p_fleet_type text DEFAULT NULL
)
RETURNS TABLE(group_key text, total_cost numeric, part_count bigint, avg_cost numeric)
LANGUAGE plpgsql AS $$
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
        COALESCE(SUM(
            CASE
                WHEN sp.shared_fleet_numbers IS NOT NULL THEN sp.total_cost_ngn / array_length(sp.shared_fleet_numbers, 1)
                ELSE sp.total_cost_ngn
            END
        ), 0) AS total_cost,
        COUNT(sp.id)::bigint AS part_count,
        COALESCE(ROUND(AVG(
            CASE
                WHEN sp.shared_fleet_numbers IS NOT NULL THEN sp.total_cost_ngn / array_length(sp.shared_fleet_numbers, 1)
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
$$;

CREATE OR REPLACE FUNCTION public.get_maintenance_cost_analysis(
    p_year integer DEFAULT NULL,
    p_location_id uuid DEFAULT NULL,
    p_group_by varchar DEFAULT 'month',
    p_plant_id uuid DEFAULT NULL,
    p_fleet_type varchar DEFAULT NULL
)
RETURNS TABLE(group_key text, total_cost numeric, part_count bigint, avg_cost numeric)
LANGUAGE plpgsql AS $$
BEGIN
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
        COALESCE(SUM(sp.total_cost_ngn), 0) AS total_cost,
        COUNT(sp.id)::bigint AS part_count,
        COALESCE(ROUND(AVG(sp.total_cost_ngn), 2), 0) AS avg_cost
    FROM public.spare_parts sp
    LEFT JOIN public.plants_master pm ON pm.id = sp.plant_id
    LEFT JOIN public.locations l ON l.id = sp.location_id
    WHERE
        (p_year IS NULL OR sp.year = p_year OR EXTRACT(YEAR FROM sp.replaced_date) = p_year)
        AND (p_location_id IS NULL OR sp.location_id = p_location_id)
        AND (p_plant_id IS NULL OR sp.plant_id = p_plant_id)
        AND (p_fleet_type IS NULL OR pm.fleet_type ILIKE '%' || p_fleet_type || '%')
        AND sp.replaced_date IS NOT NULL
    GROUP BY group_key
    ORDER BY group_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_plants(
    p_search_term text,
    p_condition text DEFAULT NULL,
    p_location_id uuid DEFAULT NULL,
    p_fleet_type text DEFAULT NULL,
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, fleet_number text, description text, fleet_type text, make text, model text, condition text, current_location text, current_location_id uuid, state text, state_code text, physical_verification boolean, total_maintenance_cost numeric, rank real)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.fleet_number::text,
        p.description::text,
        p.fleet_type::text,
        p.make::text,
        p.model::text,
        p.condition::text,
        l.name::text AS current_location,
        p.current_location_id,
        s.name::text AS state,
        s.code::text AS state_code,
        p.physical_verification,
        COALESCE(sp.total_cost, 0) AS total_maintenance_cost,
        ts_rank(
            to_tsvector('english',
                COALESCE(p.fleet_number, '') || ' ' ||
                COALESCE(p.description, '') || ' ' ||
                COALESCE(p.make, '') || ' ' ||
                COALESCE(p.model, '')
            ),
            plainto_tsquery('english', p_search_term)
        ) AS rank
    FROM public.plants_master p
    LEFT JOIN public.locations l ON l.id = p.current_location_id
    LEFT JOIN public.states s ON s.id = l.state_id
    LEFT JOIN LATERAL (
        SELECT SUM(sp2.total_cost_ngn) AS total_cost
        FROM public.spare_parts sp2
        WHERE sp2.plant_id = p.id
    ) sp ON TRUE
    WHERE
        (
            to_tsvector('english',
                COALESCE(p.fleet_number, '') || ' ' ||
                COALESCE(p.description, '') || ' ' ||
                COALESCE(p.make, '') || ' ' ||
                COALESCE(p.model, '')
            ) @@ plainto_tsquery('english', p_search_term)
            OR p.fleet_number ILIKE '%' || p_search_term || '%'
            OR p.description ILIKE '%' || p_search_term || '%'
        )
        AND (p_condition IS NULL OR p.condition::text = p_condition)
        AND (p_location_id IS NULL OR p.current_location_id = p_location_id)
        AND (p_fleet_type IS NULL OR p.fleet_type ILIKE '%' || p_fleet_type || '%')
    ORDER BY rank DESC, p.fleet_number
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;
