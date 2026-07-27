-- 034: fleet summary by type reports all six conditions, never "other".
--
-- get_fleet_summary_by_type returned
--     total, working, standby, breakdown, other
-- where `other` lumped together missing + scrap + off_hire + NULL. That
-- hides a MISSING plant behind one that is merely OFF HIRE, and those are
-- very different problems: one is an asset nobody can find, the other is
-- an asset earning its keep somewhere else.
--
-- The taxonomy is exactly six values, enforced on the table itself:
--   plants_master_condition_check
--     CHECK (condition IS NULL OR condition = ANY (ARRAY[
--       'working','standby','breakdown','missing','scrap','off_hire']))
--
-- so all six are now returned by name. `unknown` is returned as well —
-- NOT as a catch-all, but because a plant with no condition at all must
-- still be visible somewhere or `total` stops tying out. It should read
-- zero; anything else is a data gap to fix, not a bucket to live in.
-- (At the time of writing exactly one plant, AC127 STATIC COMPRESSOR, has
-- a NULL condition.)
--
-- Column order matches the dashboard's own order so the table, the chart
-- and the report all read the same way.

DROP FUNCTION IF EXISTS get_fleet_summary_by_type(uuid);

CREATE FUNCTION get_fleet_summary_by_type(p_location_id uuid DEFAULT NULL)
RETURNS TABLE(
    fleet_type text, total bigint,
    working bigint, standby bigint, breakdown bigint,
    missing bigint, scrap bigint, off_hire bigint,
    unknown bigint)
LANGUAGE plpgsql STABLE AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(p.fleet_type, 'Unknown')::text AS fleet_type,
    COUNT(p.id)::bigint AS total,
    COUNT(p.id) FILTER (WHERE p.condition = 'working')::bigint   AS working,
    COUNT(p.id) FILTER (WHERE p.condition = 'standby')::bigint   AS standby,
    COUNT(p.id) FILTER (WHERE p.condition = 'breakdown')::bigint AS breakdown,
    COUNT(p.id) FILTER (WHERE p.condition = 'missing')::bigint   AS missing,
    COUNT(p.id) FILTER (WHERE p.condition = 'scrap')::bigint     AS scrap,
    COUNT(p.id) FILTER (WHERE p.condition = 'off_hire')::bigint  AS off_hire,
    COUNT(p.id) FILTER (WHERE p.condition IS NULL)::bigint       AS unknown
  FROM plants_master p
  WHERE (p_location_id IS NULL OR p.current_location_id = p_location_id)
  GROUP BY COALESCE(p.fleet_type, 'Unknown')
  HAVING COUNT(p.id) > 0
  ORDER BY COUNT(p.id) DESC;
END;
$function$;
