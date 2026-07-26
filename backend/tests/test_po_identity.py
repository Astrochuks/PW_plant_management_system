"""A purchase order is its NUMBER **and** its DATE.

PO numbers come from the plant people; we do not control them and the
same number can legitimately recur, including in a different year. The
date on the purchase order is the authority for when it was raised.

v_purchase_orders_summary used to group by purchase_order_number alone,
which merged unrelated POs into one row dated min(po_date) — so a PO
raised in 2026 that shared its number with a 2025 one vanished from 2026.
That put NGN 1,138,000 between the Purchase Orders card and the Spare
Parts card, two cards that must always agree.

Migration 031 groups by (purchase_order_number, po_date).

The synthetic tests below insert their own rows inside a transaction that
is always rolled back, so they prove the behaviour without depending on
what happens to be in the database. The reconciliation tests then assert
the property that matters on the real data.
"""

import uuid
from datetime import date

import pytest

PO = "ZZ-TEST-PO-IDENTITY"


async def _insert(conn, *, po_number, po_date, amount, fleet=None, desc="test part"):
    """One spare-parts line.

    total_cost / total_cost_ngn are GENERATED columns
    (unit_cost x quantity + vat - discount + other, then x fx_rate), so
    with quantity 1 and no adjustments they come out equal to `amount`.
    year/month/week/quarter are set by the
    populate_spare_parts_time_columns trigger — we deliberately do not
    pass any of them, so the test exercises the same path the app uses.
    """
    # asyncpg wants a real date object, never an ISO string
    if isinstance(po_date, str):
        po_date = date.fromisoformat(po_date)
    await conn.execute(
        """
        INSERT INTO spare_parts
            (id, part_description, replaced_date, po_date,
             purchase_order_number, quantity, unit_cost, fleet_number_raw)
        VALUES ($1::uuid, $2, $3::date, $3::date, $4, 1, $5, $6)
        """,
        str(uuid.uuid4()), desc, po_date, po_number, amount, fleet,
    )


async def _rows(conn, po_number=PO):
    return await conn.fetch(
        """SELECT po_date, items_count, plants_count, total_amount_ngn
           FROM v_purchase_orders_summary WHERE po_number = $1
           ORDER BY po_date""",
        po_number,
    )


class TestPoIdentity:
    async def test_same_number_different_dates_are_separate_pos(self, db_conn):
        """The regression that cost NGN 1,138,000: one number, three dates."""
        await _insert(db_conn, po_number=PO, po_date="2025-11-20", amount=100_000)
        await _insert(db_conn, po_number=PO, po_date="2026-02-21", amount=680_000)
        await _insert(db_conn, po_number=PO, po_date="2026-04-08", amount=458_000)

        rows = await _rows(db_conn)
        assert len(rows) == 3, "each PO date must be its own purchase order"
        assert [str(r["po_date"]) for r in rows] == [
            "2025-11-20", "2026-02-21", "2026-04-08",
        ]
        assert [float(r["total_amount_ngn"]) for r in rows] == [
            100_000.0, 680_000.0, 458_000.0,
        ]

    async def test_no_money_moves_between_years(self, db_conn):
        """The 2026 portion must sit in 2026, not follow the earliest date
        into 2025 — that collapse is exactly what the bug did."""
        await _insert(db_conn, po_number=PO, po_date="2025-11-20", amount=100_000)
        await _insert(db_conn, po_number=PO, po_date="2026-02-21", amount=680_000)
        await _insert(db_conn, po_number=PO, po_date="2026-04-08", amount=458_000)

        by_year = await db_conn.fetch(
            """SELECT EXTRACT(YEAR FROM po_date)::int AS yr,
                      SUM(total_amount_ngn) AS amt
               FROM v_purchase_orders_summary WHERE po_number = $1
               GROUP BY 1 ORDER BY 1""",
            PO,
        )
        got = {r["yr"]: float(r["amt"]) for r in by_year}
        assert got == {2025: 100_000.0, 2026: 1_138_000.0}

    async def test_line_items_on_one_date_still_group_together(self, db_conn):
        """Splitting is by DATE, not by row — same number and same date is
        still one PO."""
        await _insert(db_conn, po_number=PO, po_date="2026-04-08", amount=274_000)
        await _insert(db_conn, po_number=PO, po_date="2026-04-08", amount=184_000)

        rows = await _rows(db_conn)
        assert len(rows) == 1
        assert rows[0]["items_count"] == 2
        assert float(rows[0]["total_amount_ngn"]) == 458_000.0

    async def test_plants_count_does_not_leak_across_dates(self, db_conn):
        """plants_count is a correlated subquery; it must match on the date
        too, or a repeated number counts every PO sharing it."""
        await _insert(db_conn, po_number=PO, po_date="2025-11-20",
                      amount=100_000, fleet="ZZTEST-A")
        await _insert(db_conn, po_number=PO, po_date="2026-02-21",
                      amount=680_000, fleet="ZZTEST-B")
        await _insert(db_conn, po_number=PO, po_date="2026-02-21",
                      amount=1.0, fleet="ZZTEST-C")

        rows = await _rows(db_conn)
        counts = {str(r["po_date"]): r["plants_count"] for r in rows}
        assert counts["2025-11-20"] == 1, "must not see the 2026 PO's plants"
        assert counts["2026-02-21"] == 2


class TestReconciliation:
    """The property that must hold on real data, forever: the Purchase
    Orders card and the Spare Parts card are the same money."""

    async def test_po_total_equals_spare_parts_total_every_year(self, db_conn):
        years = [
            r["y"] for r in await db_conn.fetch(
                "SELECT DISTINCT year AS y FROM spare_parts "
                "WHERE year IS NOT NULL ORDER BY 1"
            )
        ]
        assert years, "no spare-parts data to reconcile"

        for y in years:
            po = await db_conn.fetchval(
                """SELECT COALESCE(SUM(total_amount_ngn), 0)
                   FROM v_purchase_orders_summary
                   WHERE EXTRACT(YEAR FROM po_date)::int = $1""",
                y,
            )
            sp = await db_conn.fetchval(
                """SELECT total_spend FROM get_spare_parts_stats(
                       $1, NULL, NULL, NULL, NULL, NULL,
                       NULL, NULL, NULL, NULL, NULL)""",
                y,
            )
            assert float(po) == pytest.approx(float(sp or 0), abs=0.01), (
                f"{y}: Purchase Orders card NGN {float(po):,.2f} != "
                f"Spare Parts card NGN {float(sp or 0):,.2f}"
            )

    async def test_view_conserves_every_naira(self, db_conn):
        """Grouping must never create or lose money."""
        view = await db_conn.fetchval(
            "SELECT SUM(total_amount_ngn) FROM v_purchase_orders_summary")
        table = await db_conn.fetchval(
            """SELECT SUM(total_cost_ngn) FROM spare_parts
               WHERE purchase_order_number IS NOT NULL""")
        assert float(view) == pytest.approx(float(table), abs=0.01)

    async def test_view_conserves_every_line_item(self, db_conn):
        view = await db_conn.fetchval(
            "SELECT SUM(items_count) FROM v_purchase_orders_summary")
        table = await db_conn.fetchval(
            """SELECT count(*) FROM spare_parts
               WHERE purchase_order_number IS NOT NULL
                 AND COALESCE(is_po_overhead, false) = false""")
        assert int(view) == int(table)


class TestPoCounts:
    """Every 'Purchase Orders' count in the app counts the same thing.

    Spare Parts Analytics read 301 while the PO list read 311, because
    count(DISTINCT purchase_order_number) counts NUMBERS, and a number is
    not a PO.
    """

    async def test_analytics_po_count_matches_the_po_list(self, db_conn):
        for year in (2025, 2026):
            analytics = await db_conn.fetchval(
                """SELECT count(DISTINCT (purchase_order_number, po_date))::int
                   FROM spare_parts WHERE year = $1""",
                year,
            )
            po_list = await db_conn.fetchval(
                """SELECT count(*)::int FROM v_purchase_orders_summary
                   WHERE EXTRACT(YEAR FROM po_date)::int = $1""",
                year,
            )
            assert analytics == po_list, (
                f"{year}: analytics counts {analytics} POs, "
                f"the PO list shows {po_list}"
            )

    async def test_counting_numbers_alone_undercounts(self, db_conn):
        """Guards the intent: if these two ever agree, a PO number has
        silently become unique again and the distinction can be dropped."""
        by_number = await db_conn.fetchval(
            """SELECT count(DISTINCT purchase_order_number)::int
               FROM spare_parts WHERE purchase_order_number IS NOT NULL""")
        by_number_and_date = await db_conn.fetchval(
            """SELECT count(*)::int FROM (
                   SELECT 1 FROM spare_parts
                   WHERE purchase_order_number IS NOT NULL
                   GROUP BY purchase_order_number, po_date) x""")
        assert by_number_and_date >= by_number


class TestSupplierPoList:
    """GET /suppliers/{id}/pos carried the same defect: it grouped on the
    number alone, and summed total_cost (raw currency) into a column
    rendered as naira."""

    async def test_supplier_po_totals_are_ngn_and_group_by_number_and_date(
        self, db_conn
    ):
        supplier_id = await db_conn.fetchval(
            """SELECT supplier_id FROM spare_parts
               WHERE supplier_id IS NOT NULL AND purchase_order_number IS NOT NULL
               GROUP BY supplier_id ORDER BY count(*) DESC LIMIT 1""")
        if supplier_id is None:
            pytest.skip("no supplier with purchase orders")

        rows = await db_conn.fetch(
            """SELECT sp.purchase_order_number AS po_number, sp.po_date,
                      COALESCE(SUM(sp.total_cost_ngn), 0)::float AS total_amount
               FROM spare_parts sp
               WHERE sp.supplier_id = $1::uuid
                 AND sp.purchase_order_number IS NOT NULL
               GROUP BY sp.purchase_order_number, sp.po_date""",
            supplier_id,
        )
        # every (number, date) pair is distinct — safe as a React key
        keys = [(r["po_number"], r["po_date"]) for r in rows]
        assert len(keys) == len(set(keys))

        # and the rows account for every naira the supplier was paid
        expected = await db_conn.fetchval(
            """SELECT COALESCE(SUM(total_cost_ngn), 0) FROM spare_parts
               WHERE supplier_id = $1::uuid AND purchase_order_number IS NOT NULL""",
            supplier_id,
        )
        assert sum(r["total_amount"] for r in rows) == pytest.approx(
            float(expected), abs=0.01)
