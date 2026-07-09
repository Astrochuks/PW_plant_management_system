-- 019: purge retired condition values from every DB function and view.
--
-- Migration 012 collapsed conditions to six values (unknown = NULL), but
-- these objects still referenced the retired values:
--   under_repair / faulty / gpm_assessment  → merged into 'breakdown'
--   unverified                              → NULL (unknown)
-- Retired buckets returned 0 forever (silently wrong dashboards) and
-- NULL conditions were mislabelled 'unverified' — a value the API filter
-- rejects, which would break the plants-page chips for newly created
-- plants (condition defaults to NULL since 018).
--
-- Every definition below is the live original with ONLY the
-- retired-value lines changed. No other semantics touched.

BEGIN;

-- ── 1. dashboard plant stats: six + unknown (shape change → drop) ──────
DROP FUNCTION IF EXISTS get_dashboard_plant_stats();
CREATE FUNCTION get_dashboard_plant_stats()
RETURNS TABLE(
    total_plants bigint, working_plants bigint, standby_plants bigint,
    breakdown_plants bigint, missing_plants bigint, scrap_plants bigint,
    off_hire_plants bigint, unknown_condition_plants bigint,
    verified_plants bigint, unverified_plants bigint)
LANGUAGE plpgsql STABLE AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE p.condition = 'working')::bigint,
    COUNT(*) FILTER (WHERE p.condition = 'standby')::bigint,
    COUNT(*) FILTER (WHERE p.condition = 'breakdown')::bigint,
    COUNT(*) FILTER (WHERE p.condition = 'missing')::bigint,
    COUNT(*) FILTER (WHERE p.condition = 'scrap')::bigint,
    COUNT(*) FILTER (WHERE p.condition = 'off_hire')::bigint,
    COUNT(*) FILTER (WHERE p.condition IS NULL)::bigint,
    COUNT(*) FILTER (WHERE p.physical_verification = true)::bigint,
    COUNT(*) FILTER (WHERE p.physical_verification = false
                        OR p.physical_verification IS NULL)::bigint
  FROM plants_master p;
END;
$function$;

-- ── 2. dashboard stats jsonb: six + unknown keys ───────────────────────
CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE AS $function$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_plants', (SELECT COUNT(*) FROM plants_master)::bigint,
    'total_locations', (SELECT COUNT(*) FROM locations)::bigint,
    'condition_breakdown', (
      SELECT jsonb_build_object(
        'working',   COUNT(*) FILTER (WHERE condition = 'working'),
        'standby',   COUNT(*) FILTER (WHERE condition = 'standby'),
        'breakdown', COUNT(*) FILTER (WHERE condition = 'breakdown'),
        'missing',   COUNT(*) FILTER (WHERE condition = 'missing'),
        'scrap',     COUNT(*) FILTER (WHERE condition = 'scrap'),
        'off_hire',  COUNT(*) FILTER (WHERE condition = 'off_hire'),
        'unknown',   COUNT(*) FILTER (WHERE condition IS NULL)
      )
      FROM plants_master
    )
  ) INTO result;
  RETURN result;
END;
$function$;

-- ── 3. filter stats: NULL condition labelled 'unknown' ─────────────────
CREATE OR REPLACE FUNCTION get_plant_filter_stats(p_location_id uuid DEFAULT NULL)
RETURNS json LANGUAGE sql STABLE AS $function$
  SELECT json_build_object(
    'total', COUNT(*),
    'by_condition', COALESCE(
      (SELECT json_object_agg(cond, cnt) FROM (
        SELECT COALESCE(condition, 'unknown') as cond, COUNT(*) as cnt
        FROM plants_master
        WHERE (p_location_id IS NULL OR current_location_id = p_location_id)
        GROUP BY COALESCE(condition, 'unknown')
      ) sub),
      '{}'::json
    ),
    'unknown_location', COUNT(*) FILTER (WHERE current_location_id IS NULL),
    'pending_transfers', COUNT(*) FILTER (WHERE pending_transfer_id IS NOT NULL)
  )
  FROM plants_master
  WHERE (p_location_id IS NULL OR current_location_id = p_location_id);
$function$;

-- ── 4. fleet summary by type: six-value buckets, NULL-safe 'other' ─────
DROP FUNCTION IF EXISTS get_fleet_summary_by_type(uuid);
CREATE FUNCTION get_fleet_summary_by_type(p_location_id uuid DEFAULT NULL)
RETURNS TABLE(
    fleet_type text, total bigint, working bigint, standby bigint,
    breakdown bigint, other bigint)
LANGUAGE plpgsql STABLE AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(p.fleet_type, 'Unknown')::text AS fleet_type,
    COUNT(p.id)::bigint AS total,
    COUNT(p.id) FILTER (WHERE p.condition = 'working')::bigint AS working,
    COUNT(p.id) FILTER (WHERE p.condition = 'standby')::bigint AS standby,
    COUNT(p.id) FILTER (WHERE p.condition = 'breakdown')::bigint AS breakdown,
    -- missing / scrap / off_hire / unknown (NOT IN drops NULLs — handle)
    COUNT(p.id) FILTER (WHERE p.condition IS NULL
                           OR p.condition NOT IN ('working','standby','breakdown'))::bigint AS other
  FROM plants_master p
  WHERE (p_location_id IS NULL OR p.current_location_id = p_location_id)
  GROUP BY COALESCE(p.fleet_type, 'Unknown')
  HAVING COUNT(p.id) > 0
  ORDER BY COUNT(p.id) DESC;
END;
$function$;

-- ── 5. filtered plant stats (original body; only the two changed lines) ─
CREATE OR REPLACE FUNCTION public.get_filtered_plant_stats(p_condition text[] DEFAULT NULL::text[], p_location_id uuid DEFAULT NULL::uuid, p_fleet_type text[] DEFAULT NULL::text[], p_state text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_verified_only boolean DEFAULT false, p_unknown_location boolean DEFAULT false, p_pending_transfer boolean DEFAULT false, p_purchase_year integer[] DEFAULT NULL::integer[], p_division text DEFAULT NULL::text, p_exclude_location_ids text[] DEFAULT NULL::text[], p_has_maintenance boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  WITH filtered AS (
    SELECT
      COALESCE(v.condition, 'unknown') AS cond,
      COALESCE(v.current_location, 'Unknown') AS loc,
      COALESCE(v.fleet_type, 'Unknown') AS ft
    FROM v_plants_summary v
    WHERE
      (p_condition IS NULL OR v.condition = ANY(p_condition)
         OR ('unknown' = ANY(p_condition) AND v.condition IS NULL))
      AND (p_location_id IS NULL OR v.current_location_id = p_location_id)
      AND (p_fleet_type IS NULL OR v.fleet_type = ANY(p_fleet_type))
      AND (p_state IS NULL OR v.state ILIKE ('%' || p_state || '%'))
      AND (p_search IS NULL OR (
        v.fleet_number ILIKE ('%' || p_search || '%')
        OR v.description ILIKE ('%' || p_search || '%')
      ))
      AND (NOT p_verified_only OR v.physical_verification = true)
      AND (NOT p_unknown_location OR v.current_location_id IS NULL)
      AND (NOT p_pending_transfer OR v.pending_transfer_to_id IS NOT NULL)
      AND (p_purchase_year IS NULL OR v.purchase_year = ANY(p_purchase_year))
      AND (p_division IS NULL OR (
        CASE
          WHEN p_division = 'mining' THEN v.division = 'mining'
          ELSE (v.division IS NULL OR v.division = 'civil')
        END
      ))
      AND (p_exclude_location_ids IS NULL OR (
        v.current_location_id IS NULL OR v.current_location_id::text != ALL(p_exclude_location_ids)
      ))
      AND (NOT p_has_maintenance OR v.total_maintenance_cost > 0)
  ),
  agg_condition AS (
    SELECT jsonb_object_agg(cond, cnt) AS val
    FROM (SELECT cond, count(*) AS cnt FROM filtered GROUP BY cond) sub
  ),
  agg_location AS (
    SELECT jsonb_object_agg(loc, cnt) AS val
    FROM (SELECT loc, count(*) AS cnt FROM filtered GROUP BY loc) sub
  ),
  agg_fleet AS (
    SELECT COALESCE(jsonb_object_agg(ft, cond_map), '{}'::jsonb) AS val
    FROM (
      SELECT ft, jsonb_object_agg(cond, cnt) AS cond_map
      FROM (SELECT ft, cond, count(*) AS cnt FROM filtered GROUP BY ft, cond) inner_sub
      GROUP BY ft
    ) outer_sub
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'by_condition', COALESCE((SELECT val FROM agg_condition), '{}'::jsonb),
    'by_location', COALESCE((SELECT val FROM agg_location), '{}'::jsonb),
    'by_fleet_type', (SELECT val FROM agg_fleet),
    'by_state_fleet_type', '{}'::jsonb
  );
$function$;

-- ── 6. v_location_stats (original; retired columns → unknown) ──────────
DROP VIEW IF EXISTS v_location_stats;
CREATE VIEW v_location_stats AS
SELECT l.id,
    l.name AS location_name,
    l.state_id,
    l.project_id,
    s.name AS state_name,
    s.code AS state_code,
    s.region,
    l.created_at,
    l.is_bua,
    l.is_active,
    proj.project_name AS linked_project_name,
    proj.id AS linked_project_id,
    proj.client AS linked_project_client,
    proj.status AS linked_project_status,
    count(p.id) AS total_plants,
    count(p.id) FILTER (WHERE (p.condition = 'working'::text)) AS working_plants,
    count(p.id) FILTER (WHERE (p.condition = 'standby'::text)) AS standby_plants,
    count(p.id) FILTER (WHERE (p.condition = 'breakdown'::text)) AS breakdown_plants,
    count(p.id) FILTER (WHERE (p.condition = 'missing'::text)) AS missing_plants,
    count(p.id) FILTER (WHERE (p.condition = 'scrap'::text)) AS scrap_plants,
    count(p.id) FILTER (WHERE (p.condition = 'off_hire'::text)) AS off_hire_plants,
    count(p.id) FILTER (WHERE (p.condition IS NULL)) AS unknown_condition_plants
   FROM locations l
     LEFT JOIN plants_master p ON p.current_location_id = l.id
     LEFT JOIN states s ON l.state_id = s.id
     LEFT JOIN projects proj ON proj.id = l.project_id
  GROUP BY l.id, l.name, l.state_id, l.project_id, l.is_bua, l.is_active,
           s.name, s.code, s.region, l.created_at,
           proj.project_name, proj.id, proj.client, proj.status;

-- ── 7. plant_spending_anomalies (original; unverified → unknown) ───────
CREATE OR REPLACE VIEW plant_spending_anomalies AS
SELECT pm.fleet_number,
    pm.fleet_type,
    pm.condition,
    l.name AS current_location,
    pm.current_location_id,
    pm.last_verified_date,
    count(sp.id) AS parts_count,
    sum((sp.unit_cost * (sp.quantity)::numeric)) AS total_spent,
    min(sp.replaced_date) AS first_purchase,
    max(sp.replaced_date) AS last_purchase,
        CASE
            WHEN (pm.current_location_id IS NULL) THEN 'NO_LOCATION'::text
            WHEN (pm.last_verified_date IS NULL) THEN 'NEVER_VERIFIED'::text
            WHEN (pm.condition = 'missing'::text) THEN 'MISSING'::text
            WHEN ((pm.condition IS NULL) AND (sum((sp.unit_cost * (sp.quantity)::numeric)) > (1000000)::numeric)) THEN 'HIGH_SPEND_UNKNOWN_CONDITION'::text
            ELSE 'OK'::text
        END AS anomaly_flag
   FROM ((spare_parts sp
     JOIN plants_master pm ON ((sp.plant_id = pm.id)))
     LEFT JOIN locations l ON ((pm.current_location_id = l.id)))
  GROUP BY pm.id, pm.fleet_number, pm.fleet_type, pm.condition, l.name, pm.current_location_id, pm.last_verified_date;

-- (get_chronic_breakdown_plants / get_fleet_type_reliability /
--  get_site_utilization_scores keep their IN-lists: retired values in
--  an IN() simply never match — behaviour already correct.)

COMMIT;
