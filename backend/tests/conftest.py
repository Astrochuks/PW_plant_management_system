"""Pytest configuration and fixtures."""

import os
from typing import Generator
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Set test environment before importing app
os.environ["ENVIRONMENT"] = "development"
os.environ["SUPABASE_URL"] = "https://test.supabase.co"
os.environ["SUPABASE_ANON_KEY"] = "test-anon-key"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "test-service-role-key"


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
    """Mock management user data."""
    return {
        "id": "management-user-id",
        "email": "manager@example.com",
        "role": "management",
        "full_name": "Test Manager",
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
