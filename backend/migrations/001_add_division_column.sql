-- Migration: Add division column to plants_master
-- Purpose: Differentiate mining vs civil plants, primarily for Abuja (head office)
-- Values: 'mining' or NULL (NULL = civil, the default)

-- Step 1: Add the column
ALTER TABLE plants_master
ADD COLUMN IF NOT EXISTS division VARCHAR(20) DEFAULT NULL;

-- Step 2: Set mining plants in Abuja
-- First verify these fleet numbers exist and are in Abuja, then update
UPDATE plants_master
SET division = 'mining'
WHERE fleet_number IN (
    'AC187', 'EG289', 'EG290', 'EG291',
    'IC38', 'L75',
    'PT178', 'PT179',
    'P454', 'P455',
    'PWC1',
    'PF7', 'PF8',
    'T617',
    'VP48', 'VP49', 'VP50', 'VP51',
    'VPE289', 'VPE290', 'VPE291', 'VPE292',
    'WM100', 'WM99',
    'WP427', 'WP428',
    'W160'
)
AND current_location_id IN (
    SELECT id FROM locations WHERE LOWER(location_name) LIKE '%abuja%'
);

-- Step 3: Verify — check what was updated (run this SELECT manually to confirm)
-- SELECT fleet_number, division, current_location_id
-- FROM plants_master
-- WHERE division = 'mining'
-- ORDER BY fleet_number;

-- NOTE: If v_plants_summary uses explicit column lists (not pm.*),
-- you need to DROP and re-CREATE the view to include the new division column.
-- Run this in Supabase SQL editor:
--
-- Check current view definition first:
--   SELECT pg_get_viewdef('v_plants_summary'::regclass, true);
--
-- If it uses pm.*, no view change needed — the column flows through automatically.
-- If it lists columns explicitly, add pm.division to the SELECT list.
