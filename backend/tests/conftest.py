"""Pytest configuration and fixtures."""

import os
from pathlib import Path
from typing import Generator
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Set test environment before importing app
os.environ["ENVIRONMENT"] = "development"
os.environ["SUPABASE_URL"] = "https://test.supabase.co"
os.environ["SUPABASE_ANON_KEY"] = "test-anon-key"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "test-service-role-key"


def _database_url() -> str | None:
    """Real DATABASE_URL for integration tests: env first, then backend/.env."""
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    try:
        from dotenv import dotenv_values

        return dotenv_values(Path(__file__).parent.parent / ".env").get("DATABASE_URL")
    except Exception:
        return None


@pytest.fixture
async def db_conn():
    """Real database connection wrapped in an always-rolled-back transaction.

    Integration tests write freely; NOTHING persists after the test ends.
    Skips (not fails) when no database is reachable, so unit tests stay
    runnable offline.
    """
    import asyncpg

    url = _database_url()
    if not url:
        pytest.skip("no DATABASE_URL available for integration test")

    try:
        conn = await asyncpg.connect(url, statement_cache_size=0, timeout=15)
    except Exception as exc:
        pytest.skip(f"database unreachable: {exc}")

    tr = conn.transaction()
    await tr.start()
    try:
        yield conn
    finally:
        try:
            await tr.rollback()
        finally:
            await conn.close()


@pytest.fixture(scope="session")
def mock_supabase():
    """Mock Supabase client for tests."""
    mock_client = MagicMock()

    # Mock common operations
    mock_client.table.return_value.select.return_value.execute.return_value.data = []
    mock_client.table.return_value.insert.return_value.execute.return_value.data = [{"id": "test-id"}]
    mock_client.table.return_value.update.return_value.execute.return_value.data = [{"id": "test-id"}]
    mock_client.table.return_value.delete.return_value.execute.return_value.data = []
    mock_client.rpc.return_value.execute.return_value.data = []

    return mock_client


@pytest.fixture(scope="session")
def app(mock_supabase):
    """Create test application."""
    with patch("app.core.database.create_client", return_value=mock_supabase):
        from app.main import app
        yield app


@pytest.fixture
def client(app) -> Generator[TestClient, None, None]:
    """Create test client."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth_headers():
    """Headers with mock authentication token."""
    return {"Authorization": "Bearer test-token"}


@pytest.fixture
def admin_user():
    """Mock admin user data."""
    return {
        "id": "admin-user-id",
        "email": "admin@example.com",
        "role": "admin",
        "full_name": "Test Admin",
        "is_active": True,
    }


@pytest.fixture
def management_user():
    """Mock management-tier user — the MD seat (029 split MD from GPM;
    both roles pass the same gates)."""
    return {
        "id": "management-user-id",
        "email": "manager@example.com",
        "role": "managing_director",
        "full_name": "Test Manager",
        "is_active": True,
    }


@pytest.fixture
def plant_officer_user():
    """Mock plant officer — management-tier for plants, no projects access."""
    return {
        "id": "plant-officer-user-id",
        "email": "officer@example.com",
        "role": "plant_officer",
        "full_name": "Test Plant Officer",
        "is_active": True,
    }


@pytest.fixture
def sample_plant():
    """Sample plant data for tests."""
    return {
        "id": "plant-test-id",
        "fleet_number": "PW 001",
        "description": "Test Plant",
        "status": "active",
        "physical_verification": True,
        "current_location_id": "location-test-id",
    }


@pytest.fixture
def sample_location():
    """Sample location data for tests."""
    return {
        "id": "location-test-id",
        "name": "TEST LOCATION",
        "code": "TST",
        "is_active": True,
    }


@pytest.fixture
def sample_spare_part():
    """Sample spare part data for tests."""
    return {
        "id": "part-test-id",
        "plant_id": "plant-test-id",
        "part_description": "Test Part",
        "replaced_date": "2024-01-15",
        "unit_cost": 100.0,
        "quantity": 1,
    }
