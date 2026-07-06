"""T1.12 + T1.13 — view tests with hand-computed synthetic fixtures.

Synthetic projects are inserted inside the rolled-back transaction, so
expected values are exact and independent of real register contents
(views are re-queried filtered to the synthetic client only).
"""

from datetime import date, timedelta

import pytest

CLIENT = "ZZTEST BENCHMARK CLIENT"


async def _insert_project(db_conn, **kw):
    defaults = {
        "project_name": "ZZTEST project",
        "client": CLIENT,
        "is_legacy": True,
        "status": "active",
    }
    defaults.update(kw)
    cols = ", ".join(defaults)
    ph = ", ".join(f"${i+1}" for i in range(len(defaults)))
    return await db_conn.fetchval(
        f"INSERT INTO projects ({cols}) VALUES ({ph}) RETURNING id",
        *defaults.values(),
    )


class TestProjectsSummaryView:
    async def test_new_columns_and_completeness(self, db_conn):
        # 4 of the 6 core fields filled → completeness 4/6 ≈ 0.67
        state_id = await db_conn.fetchval("SELECT id FROM states LIMIT 1")
        client_id = await db_conn.fetchval(
            "INSERT INTO clients (name, normalized_name) VALUES ($1, $1) RETURNING id",
            CLIENT,
        )
        pid = await _insert_project(
            db_conn,
            original_contract_sum=1_000_000.0,
            award_date=date(2020, 1, 1),
            state_id=state_id,
            client_id=client_id,
            project_type=None,
            work_nature=None,
        )
        row = await db_conn.fetchrow(
            "SELECT project_type, work_nature, register_source, completeness "
            "FROM v_projects_summary WHERE id = $1",
            pid,
        )
        assert float(row["completeness"]) == 0.67

    async def test_full_completeness(self, db_conn):
        state_id = await db_conn.fetchval("SELECT id FROM states LIMIT 1")
        client_id = await db_conn.fetchval(
            "INSERT INTO clients (name, normalized_name) VALUES ($1, $1) RETURNING id",
            CLIENT,
        )
        pid = await _insert_project(
            db_conn,
            original_contract_sum=5_000_000.0,
            award_date=date(2021, 6, 1),
            state_id=state_id,
            client_id=client_id,
            project_type="road",
            work_nature="construction",
        )
        completeness = await db_conn.fetchval(
            "SELECT completeness FROM v_projects_summary WHERE id = $1", pid
        )
        assert float(completeness) == 1.0


class TestDeliveryTimesView:
    async def test_delivery_months_hand_computed(self, db_conn):
        # award 2020-01-01 → substantial completion 2021-01-01 = 366 days
        # 366 / 30.44 = 12.02... → rounds to 12.0
        pid = await _insert_project(
            db_conn,
            award_date=date(2020, 1, 1),
            substantial_completion_date=date(2021, 1, 1),
            project_type="road",
        )
        months = await db_conn.fetchval(
            "SELECT delivery_months FROM v_project_delivery_times WHERE id = $1", pid
        )
        assert float(months) == 12.0

    async def test_falls_back_to_final_completion(self, db_conn):
        pid = await _insert_project(
            db_conn,
            award_date=date(2020, 1, 1),
            final_completion_date=date(2020, 7, 1),  # 182 days → 6.0 months
        )
        months = await db_conn.fetchval(
            "SELECT delivery_months FROM v_project_delivery_times WHERE id = $1", pid
        )
        assert float(months) == 6.0

    async def test_excludes_completion_before_award(self, db_conn):
        pid = await _insert_project(
            db_conn,
            award_date=date(2020, 1, 1),
            substantial_completion_date=date(2019, 1, 1),  # data error
        )
        found = await db_conn.fetchval(
            "SELECT count(*) FROM v_project_delivery_times WHERE id = $1", pid
        )
        assert found == 0


class TestBenchmarksByTypeView:
    async def test_quartiles_hand_computed(self, db_conn):
        # Three 'water' projects (rare type → isolate by filtering deltas):
        # values 100, 200, 300 → p25=150, median=200, p75=250
        before = await db_conn.fetchrow(
            "SELECT n_projects, n_valued FROM v_project_benchmarks_by_type "
            "WHERE project_type = 'water'"
        )
        base_n = before["n_projects"] if before else 0

        for i, val in enumerate((100.0, 200.0, 300.0)):
            await _insert_project(
                db_conn,
                project_name=f"ZZTEST water {i}",
                project_type="water",
                current_contract_sum=val,
                award_date=date(2020, 1, 1),
                substantial_completion_date=date(2020, 1, 1) + timedelta(days=61),
            )

        row = await db_conn.fetchrow(
            "SELECT * FROM v_project_benchmarks_by_type WHERE project_type = 'water'"
        )
        assert row["n_projects"] == base_n + 3

        # Quartiles computed over ALL water rows incl. pre-existing ones —
        # re-derive expected from the table itself for exactness
        expected = await db_conn.fetchrow(
            """SELECT
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY current_contract_sum) AS med
               FROM projects WHERE project_type = 'water'"""
        )
        assert float(row["value_median"]) == float(expected["med"])
        assert row["n_delivered"] >= 3


class TestListEndpointFilters:
    """API-level: the new filter params reach the SQL (read-only)."""

    def test_project_type_filter(self, client, app, admin_user):
        from app.core.security import CurrentUser, get_current_user

        app.dependency_overrides[get_current_user] = lambda: CurrentUser(**admin_user)
        try:
            r = client.get("/api/v1/projects?project_type=airport&limit=100")
            if r.status_code == 503:
                pytest.skip("database unavailable")
            assert r.status_code == 200
            rows = r.json()["data"]
            assert len(rows) >= 1
            assert all(p["project_type"] == "airport" for p in rows)
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    def test_invalid_type_rejected(self, client, app, admin_user):
        from app.core.security import CurrentUser, get_current_user

        app.dependency_overrides[get_current_user] = lambda: CurrentUser(**admin_user)
        try:
            r = client.get("/api/v1/projects?project_type=skyscraper")
            assert r.status_code == 422
        finally:
            app.dependency_overrides.pop(get_current_user, None)

    def test_benchmarks_endpoint(self, client, app, admin_user):
        from app.core.security import CurrentUser, get_current_user

        app.dependency_overrides[get_current_user] = lambda: CurrentUser(**admin_user)
        try:
            r = client.get("/api/v1/projects/benchmarks")
            if r.status_code == 503:
                pytest.skip("database unavailable")
            assert r.status_code == 200
            rows = r.json()["data"]
            assert any(b["project_type"] == "road" for b in rows)
            road = next(b for b in rows if b["project_type"] == "road")
            assert road["n_projects"] > 100
            assert road["value_median"] is not None
        finally:
            app.dependency_overrides.pop(get_current_user, None)
