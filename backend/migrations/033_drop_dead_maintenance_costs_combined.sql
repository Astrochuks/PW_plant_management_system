-- 033: drop get_maintenance_costs_combined.
--
-- It is dead AND broken:
--   · no caller anywhere — not in the API, not in the frontend, not in
--     another function or view
--   · it selects from v_purchase_order_costs, a view deleted long ago, so
--     calling it raises
--       UndefinedTableError: relation "v_purchase_order_costs" does not exist
--   · migrations 005 and 026 both noted it as dead code and left it in place
--
-- It also summed total_cost, the raw currency, rather than total_cost_ngn.
-- Left standing it is a trap: it looks like a maintenance-cost source, so
-- the next person reconciling figures has to work out that it is a ruin
-- before they can ignore it. Removing it means one fewer wrong answer
-- available to be found.
--
-- The live maintenance-cost source is get_maintenance_cost_analysis
-- (migration 032), guarded by backend/tests/test_spare_parts_money.py.

DROP FUNCTION IF EXISTS public.get_maintenance_costs_combined(integer, uuid, text);
