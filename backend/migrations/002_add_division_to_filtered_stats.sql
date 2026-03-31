-- Migration: Add division parameter to get_filtered_plant_stats function
-- Purpose: Support filtering stats by mining/civil division
--
-- IMPORTANT: Before running this migration, first get the current function definition:
--   SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'get_filtered_plant_stats';
-- Compare the body below with the current implementation and merge any differences.
--
-- The only change from the original function is the addition of p_division (10th parameter)
-- and the corresponding division filter logic (lines marked with "-- NEW").

-- Step 0: Verify v_plants_summary includes division column.
-- Run this check first:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'v_plants_summary' AND column_name = 'division';
--
-- If it returns NO rows, the view uses explicit columns and needs updating.
-- Get the current view definition:
--   SELECT pg_get_viewdef('v_plants_summary'::regclass, true);
-- Then recreate it with pm.division added to the SELECT list.
--
-- If the view uses pm.* it should already include division automatically,
-- BUT PostgreSQL caches view column lists at CREATE time. If division was
-- added to plants_master AFTER the view was created, you MUST recreate the view
-- even if it uses pm.*. Run:
--   CREATE OR REPLACE VIEW v_plants_summary AS <paste current definition>;
-- This forces PostgreSQL to pick up the new column.

-- Step 1: Drop existing function (different param count = different overload, so we must drop first)
DROP FUNCTION IF EXISTS get_filtered_plant_stats(text[], text, text[], text, text, boolean, boolean, boolean, int[]);

CREATE OR REPLACE FUNCTION get_filtered_plant_stats(
    p_conditions text[] DEFAULT NULL,
    p_location_id text DEFAULT NULL,
    p_fleet_types text[] DEFAULT NULL,
    p_state text DEFAULT NULL,
    p_search text DEFAULT NULL,
    p_verified_only boolean DEFAULT false,
    p_unknown_location boolean DEFAULT false,
    p_pending_transfer boolean DEFAULT false,
    p_purchase_years int[] DEFAULT NULL,
    p_division text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    result jsonb;
    base_query text;
    where_clauses text[] := ARRAY[]::text[];
    state_location_ids uuid[];
BEGIN
    -- Build WHERE clauses
    IF p_conditions IS NOT NULL THEN
        where_clauses := array_append(where_clauses,
            format('pm.condition = ANY(%L::text[])', p_conditions));
    END IF;

    IF p_location_id IS NOT NULL THEN
        where_clauses := array_append(where_clauses,
            format('pm.current_location_id = %L::uuid', p_location_id));
    END IF;

    IF p_fleet_types IS NOT NULL THEN
        DECLARE
            ft_clauses text[] := ARRAY[]::text[];
            ft text;
        BEGIN
            FOREACH ft IN ARRAY p_fleet_types LOOP
                ft_clauses := array_append(ft_clauses,
                    format('pm.fleet_type ILIKE %L', '%' || ft || '%'));
            END LOOP;
            where_clauses := array_append(where_clauses,
                '(' || array_to_string(ft_clauses, ' OR ') || ')');
        END;
    END IF;

    IF p_state IS NOT NULL THEN
        SELECT array_agg(l.id) INTO state_location_ids
        FROM locations l
        JOIN states s ON s.id = l.state_id
        WHERE s.name ILIKE '%' || p_state || '%';

        IF state_location_ids IS NULL THEN
            RETURN jsonb_build_object(
                'total', 0,
                'by_condition', '{}'::jsonb,
                'by_location', '{}'::jsonb,
                'by_fleet_type', '{}'::jsonb,
                'by_state_fleet_type', '{}'::jsonb
            );
        END IF;

        where_clauses := array_append(where_clauses,
            format('pm.current_location_id = ANY(%L::uuid[])', state_location_ids));
    END IF;

    IF p_search IS NOT NULL AND p_search != '' THEN
        where_clauses := array_append(where_clauses,
            format('(pm.fleet_number ILIKE %L OR pm.description ILIKE %L)',
                '%' || p_search || '%', '%' || p_search || '%'));
    END IF;

    IF p_verified_only THEN
        where_clauses := array_append(where_clauses, 'pm.physical_verification = true');
    END IF;

    IF p_unknown_location THEN
        where_clauses := array_append(where_clauses, 'pm.current_location_id IS NULL');
    END IF;

    IF p_pending_transfer THEN
        where_clauses := array_append(where_clauses, 'pm.pending_transfer_to_id IS NOT NULL');
    END IF;

    IF p_purchase_years IS NOT NULL THEN
        where_clauses := array_append(where_clauses,
            format('pm.purchase_year = ANY(%L::int[])', p_purchase_years));
    END IF;

    -- Division filter
    IF p_division IS NOT NULL THEN
        IF p_division = 'mining' THEN
            where_clauses := array_append(where_clauses, 'pm.division = ''mining''');
        ELSE
            where_clauses := array_append(where_clauses,
                '(pm.division IS NULL OR pm.division = ''civil'')');
        END IF;
    END IF;

    -- Build final WHERE
    IF array_length(where_clauses, 1) > 0 THEN
        base_query := 'WHERE ' || array_to_string(where_clauses, ' AND ');
    ELSE
        base_query := '';
    END IF;

    -- Build result JSON
    EXECUTE format('
        WITH filtered AS (
            SELECT pm.*, l.location_name, s.name as state_name
            FROM plants_master pm
            LEFT JOIN locations l ON l.id = pm.current_location_id
            LEFT JOIN states s ON s.id = l.state_id
            %s
        )
        SELECT jsonb_build_object(
            ''total'', (SELECT count(*) FROM filtered),
            ''by_condition'', COALESCE((
                SELECT jsonb_object_agg(condition, cnt)
                FROM (SELECT condition, count(*) as cnt FROM filtered WHERE condition IS NOT NULL GROUP BY condition) x
            ), ''{}''::jsonb),
            ''by_location'', COALESCE((
                SELECT jsonb_object_agg(COALESCE(location_name, ''Unknown''), cnt)
                FROM (SELECT location_name, count(*) as cnt FROM filtered GROUP BY location_name) x
            ), ''{}''::jsonb),
            ''by_fleet_type'', COALESCE((
                SELECT jsonb_object_agg(COALESCE(fleet_type, ''Unknown''), cnt)
                FROM (SELECT fleet_type, count(*) as cnt FROM filtered GROUP BY fleet_type) x
            ), ''{}''::jsonb),
            ''by_state_fleet_type'', COALESCE((
                SELECT jsonb_object_agg(
                    COALESCE(state_name, ''Unknown''),
                    fleet_types
                )
                FROM (
                    SELECT state_name, jsonb_object_agg(COALESCE(fleet_type, ''Unknown''), cnt) as fleet_types
                    FROM (SELECT state_name, fleet_type, count(*) as cnt FROM filtered GROUP BY state_name, fleet_type) x
                    GROUP BY state_name
                ) y
            ), ''{}''::jsonb)
        )', base_query) INTO result;

    RETURN result;
END;
$$;
