"""One spare-parts figure, wherever it is asked for.

The same money was being reported four different ways:

  Spare Parts / Purchase Orders   NGN 541,777,556.32   (2026)
  Reports > Maintenance Costs     NGN 529,328,325.07
  Suppliers                       NGN 666,641,592.74   (all time, vs 675,870,760.06)

Causes, all fixed:
  · get_maintenance_cost_analysis divided a shared PO by its fleet count
    without expanding the row, destroying NGN 12,449,231.25 in 2026
    (migration 032)
  · two overloads of that function with different cost logic — the
    varchar one is dropped (032)
  · v_supplier_stats summed total_cost, the raw currency, into a column
    the UI renders as naira (032)
  · v_purchase_orders_summary grouped POs by number alone (031)

These tests assert the invariant rather than the numbers, so they keep
holding as data is added.
"""

import pytest


async def _years(conn):
    return [
        r["y"] for r in await conn.fetch(
            "SELECT DISTINCT year AS y FROM spare_parts "
            "WHERE year IS NOT NULL ORDER BY 1"
        )
    ]


class TestOneFigureEverywhere:
    async def test_maintenance_costs_equal_actual_spend(self, db_conn):
        """Reports > Maintenance Costs, asked portfolio-wide, is total
        spend. Nothing may be apportioned away."""
        for y in await _years(db_conn):
            rows = await db_conn.fetch(
                "SELECT * FROM get_maintenance_cost_analysis($1,$2,$3,$4,$5)",
                y, None, "month", None, None,
            )
            reported = sum(float(r["total_cost"] or 0) for r in rows)
            actual = float(await db_conn.fetchval(
                """SELECT COALESCE(SUM(total_cost_ngn), 0) FROM spare_parts
                   WHERE year = $1 AND replaced_date IS NOT NULL""", y))
            assert reported == pytest.approx(actual, abs=0.01), (
                f"{y}: maintenance costs report NGN {reported:,.2f} != "
                f"actual spend NGN {actual:,.2f}"
            )

    async def test_every_grouping_gives_the_same_total(self, db_conn):
        """Month, quarter and year are three views of one number."""
        totals = {}
        for g in ("month", "quarter", "year"):
            rows = await db_conn.fetch(
                "SELECT * FROM get_maintenance_cost_analysis($1,$2,$3,$4,$5)",
                2026, None, g, None, None,
            )
            totals[g] = sum(float(r["total_cost"] or 0) for r in rows)
        assert totals["month"] == pytest.approx(totals["quarter"], abs=0.01)
        assert totals["month"] == pytest.approx(totals["year"], abs=0.01)

    async def test_supplier_spend_is_naira(self, db_conn):
        """v_supplier_stats.total_spend is rendered as naira by the UI, so
        it must be the converted figure."""
        view = float(await db_conn.fetchval(
            "SELECT COALESCE(SUM(total_spend), 0) FROM v_supplier_stats"))
        actual = float(await db_conn.fetchval(
            """SELECT COALESCE(SUM(total_cost_ngn), 0) FROM spare_parts
               WHERE supplier_id IS NOT NULL"""))
        assert view == pytest.approx(actual, abs=0.01)

    async def test_supplier_spend_columns_agree(self, db_conn):
        mismatched = await db_conn.fetchval(
            """SELECT count(*) FROM v_supplier_stats
               WHERE total_spend IS DISTINCT FROM total_spend_ngn""")
        assert mismatched == 0


class TestNoAmbiguousOverload:
    async def test_exactly_one_maintenance_cost_function(self, db_conn):
        """Two overloads with different cost logic meant the figure
        depended on how Postgres resolved parameter types."""
        n = await db_conn.fetchval(
            """SELECT count(*) FROM pg_proc p
               JOIN pg_namespace ns ON ns.oid = p.pronamespace
               WHERE ns.nspname = 'public'
                 AND p.proname = 'get_maintenance_cost_analysis'""")
        assert n == 1, f"{n} overloads — the figure is ambiguous again"


class TestPerPlantStillApportions:
    """Splitting a shared PO IS right for one plant's own cost — it just
    must never be applied to a portfolio total."""

    async def test_single_plant_query_apportions_shared_cost(self, db_conn):
        target = await db_conn.fetchrow(
            """SELECT pm.id AS plant_id, pm.fleet_number
               FROM spare_parts sp
               JOIN plants_master pm
                 ON pm.fleet_number = sp.shared_fleet_numbers[1]
               WHERE sp.shared_fleet_numbers IS NOT NULL
                 AND array_length(sp.shared_fleet_numbers, 1) > 1
                 AND sp.total_cost_ngn > 0
               LIMIT 1""")
        if target is None:
            pytest.skip("no multi-plant shared PO to check")

        rows = await db_conn.fetch(
            "SELECT * FROM get_maintenance_cost_analysis($1,$2,$3,$4,$5)",
            None, None, "year", target["plant_id"], None,
        )
        charged = sum(float(r["total_cost"] or 0) for r in rows)

        # mirror the function's own row filter, once apportioned and once not
        where = """
            FROM spare_parts sp
            WHERE (sp.plant_id = $1::uuid
                   OR (sp.shared_fleet_numbers IS NOT NULL
                       AND $2 = ANY(sp.shared_fleet_numbers)))
              AND sp.replaced_date IS NOT NULL"""
        apportioned = float(await db_conn.fetchval(
            f"""SELECT COALESCE(SUM(CASE
                    WHEN sp.shared_fleet_numbers IS NOT NULL
                        THEN sp.total_cost_ngn / array_length(sp.shared_fleet_numbers, 1)
                    ELSE sp.total_cost_ngn END), 0) {where}""",
            target["plant_id"], target["fleet_number"]))
        unapportioned = float(await db_conn.fetchval(
            f"SELECT COALESCE(SUM(sp.total_cost_ngn), 0) {where}",
            target["plant_id"], target["fleet_number"]))

        assert charged == pytest.approx(apportioned, abs=0.01), (
            "a single-plant query must charge the plant its SHARE of a "
            "shared PO"
        )
        assert apportioned < unapportioned, (
            "this fixture plant has no shared cost, so the test proves "
            "nothing — pick another"
        )
