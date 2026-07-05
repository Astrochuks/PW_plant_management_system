"""T1.3 — clients backfill: normalizer contract + database post-conditions."""

from scripts.backfill_clients import backfill, normalize_client_name


class TestNormalizeClientName:
    def test_punctuation_and_case_collapse(self):
        assert normalize_client_name("Plateau State Govt.") == "PLATEAU STATE GOVT"
        assert normalize_client_name("PLATEAU STATE GOVT") == "PLATEAU STATE GOVT"

    def test_whitespace_collapse(self):
        assert normalize_client_name("  Taraba   State\tGovt ") == "TARABA STATE GOVT"

    def test_ampersands_and_slashes(self):
        assert (
            normalize_client_name("Ministry of Works & Housing")
            == "MINISTRY OF WORKS HOUSING"
        )
        assert normalize_client_name("FCDA/Abuja") == "FCDA ABUJA"

    def test_variants_collapse_to_same_key(self):
        assert normalize_client_name("Akwa Ibom state Govt") == normalize_client_name(
            "AKWA IBOM STATE GOVT."
        )


class TestBackfillPostConditions:
    """Read/write against the real DB — inside the rolled-back transaction."""

    async def test_all_projects_with_client_string_are_linked(self, db_conn):
        unmatched = await db_conn.fetchval(
            """SELECT count(*) FROM projects
               WHERE client_id IS NULL AND client IS NOT NULL AND btrim(client) <> ''"""
        )
        assert unmatched == 0

    async def test_clients_normalized_names_are_distinct_and_nonempty(self, db_conn):
        rows = await db_conn.fetch("SELECT normalized_name FROM clients")
        names = [r["normalized_name"] for r in rows]
        assert len(names) == len(set(names))
        assert all(n and n == n.strip().upper() for n in names)

    async def test_every_client_id_points_at_real_client(self, db_conn):
        orphans = await db_conn.fetchval(
            """SELECT count(*) FROM projects p
               LEFT JOIN clients c ON c.id = p.client_id
               WHERE p.client_id IS NOT NULL AND c.id IS NULL"""
        )
        assert orphans == 0

    async def test_rerun_is_noop(self, db_conn):
        """Running backfill again (inside the test transaction) changes nothing."""
        stats = await backfill(db_conn)
        assert stats["clients_inserted"] == 0
        assert stats["projects_linked"] == 0
        assert stats["projects_unmatched"] == 0
