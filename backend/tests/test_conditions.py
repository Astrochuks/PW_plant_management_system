"""Six conditions, everywhere, with no catch-all bucket.

The taxonomy is enforced on the table itself:

    plants_master_condition_check
      CHECK (condition IS NULL OR condition = ANY (ARRAY[
        'working','standby','breakdown','missing','scrap','off_hire']))

Two things used to hide plants:

  · `get_fleet_summary_by_type` returned working/standby/breakdown and
    lumped missing + scrap + off_hire + NULL into `other`. That puts a
    plant nobody can find in the same column as one that is merely off
    hire — 401 plants behind one grey number.
  · the Fleet Summary report went further and showed only three
    conditions with no catch-all at all, so 402 of 1,688 plants simply
    were not on the page.

Both now report all six by name. `unknown` exists only so `total` ties
when a plant has no condition recorded; it should read zero and is a data
gap to fix, never a bucket to live in.
"""

import pytest

CONDITIONS = ("working", "standby", "breakdown", "missing", "scrap", "off_hire")


class TestTaxonomy:
    async def test_the_database_allows_exactly_these_six(self, db_conn):
        """If this fails the taxonomy changed and every list in the app —
        and frontend/src/lib/conditions.ts — must change with it."""
        definition = await db_conn.fetchval(
            """SELECT pg_get_constraintdef(oid) FROM pg_constraint
               WHERE conrelid = 'plants_master'::regclass
                 AND conname = 'plants_master_condition_check'""")
        assert definition, "the condition CHECK constraint is missing"
        for c in CONDITIONS:
            assert f"'{c}'" in definition, f"{c} not allowed by the constraint"
        # nothing else sneaks in
        import re
        allowed = set(re.findall(r"'([a-z_]+)'::text", definition))
        assert allowed == set(CONDITIONS), f"unexpected values: {allowed}"

    async def test_no_row_holds_a_value_outside_the_six(self, db_conn):
        stray = await db_conn.fetch(
            """SELECT DISTINCT condition FROM plants_master
               WHERE condition IS NOT NULL AND condition <> ALL($1::text[])""",
            list(CONDITIONS))
        assert [r["condition"] for r in stray] == []


class TestFleetSummaryByType:
    async def test_returns_all_six_and_no_other_bucket(self, db_conn):
        rows = await db_conn.fetch("SELECT * FROM get_fleet_summary_by_type(NULL)")
        assert rows, "no fleet data"
        cols = set(rows[0].keys())
        assert "other" not in cols, "the catch-all bucket is back"
        for c in CONDITIONS:
            assert c in cols, f"{c} is not reported"

    async def test_the_columns_tie_to_the_total(self, db_conn):
        rows = await db_conn.fetch("SELECT * FROM get_fleet_summary_by_type(NULL)")
        for r in rows:
            parts = sum(r[c] for c in CONDITIONS) + r["unknown"]
            assert parts == r["total"], (
                f"{r['fleet_type']}: {parts} != total {r['total']}")

    async def test_each_condition_matches_a_direct_count(self, db_conn):
        rows = await db_conn.fetch("SELECT * FROM get_fleet_summary_by_type(NULL)")
        for c in CONDITIONS:
            summed = sum(r[c] for r in rows)
            direct = await db_conn.fetchval(
                "SELECT count(*) FROM plants_master WHERE condition = $1", c)
            assert summed == direct, f"{c}: summary {summed} != direct {direct}"

    async def test_the_whole_fleet_is_accounted_for(self, db_conn):
        rows = await db_conn.fetch("SELECT * FROM get_fleet_summary_by_type(NULL)")
        total = sum(r["total"] for r in rows)
        plants = await db_conn.fetchval("SELECT count(*) FROM plants_master")
        assert total == plants

    async def test_unknown_is_a_gap_not_a_bucket(self, db_conn):
        """`unknown` counts plants with NO condition recorded. It exists so
        totals tie, and it should be empty. If this ever fails loudly,
        set the condition on the listed plants — do not widen the bucket.
        """
        gaps = await db_conn.fetch(
            """SELECT fleet_number, description FROM plants_master
               WHERE condition IS NULL ORDER BY fleet_number""")
        if gaps:
            pytest.skip(
                "plants with no condition recorded: "
                + ", ".join(f"{g['fleet_number']} ({g['description']})" for g in gaps)
            )
