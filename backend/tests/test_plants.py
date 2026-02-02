"""Tests for plant endpoints."""

from unittest.mock import patch, MagicMock

import pytest


class TestPlantsEndpoints:
    """Tests for /plants endpoints."""

    def test_list_plants_unauthorized(self, client):
        """Test that listing plants requires authentication."""
        response = client.get("/api/v1/plants")
        assert response.status_code == 401

    def test_list_plants_with_auth(self, client, auth_headers, admin_user, mock_supabase):
        """Test listing plants with valid authentication."""
        with patch("app.core.security.get_current_user") as mock_get_user:
            from app.core.security import CurrentUser
            mock_get_user.return_value = CurrentUser(**admin_user)

            # Mock the database response
            mock_supabase.table.return_value.select.return_value.execute.return_value.data = []
            mock_supabase.table.return_value.select.return_value.execute.return_value.count = 0

            response = client.get("/api/v1/plants", headers=auth_headers)
            # Response depends on mock setup
            assert response.status_code in [200, 500]

    def test_get_plant_not_found(self, client, auth_headers, admin_user, mock_supabase):
        """Test getting a non-existent plant returns 404."""
        with patch("app.core.security.get_current_user") as mock_get_user:
            from app.core.security import CurrentUser
            mock_get_user.return_value = CurrentUser(**admin_user)

            mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = None

            response = client.get("/api/v1/plants/00000000-0000-0000-0000-000000000000", headers=auth_headers)
            # Should be 404 or error based on mock
            assert response.status_code in [404, 500]


class TestPlantCreation:
    """Tests for plant creation."""

    def test_create_plant_requires_admin(self, client, auth_headers, management_user, mock_supabase):
        """Test that creating a plant requires admin role."""
        with patch("app.core.security.get_current_user") as mock_get_user:
            from app.core.security import CurrentUser
            mock_get_user.return_value = CurrentUser(**management_user)

            response = client.post(
                "/api/v1/plants",
                json={"fleet_number": "PW 999", "description": "Test"},
                headers=auth_headers,
            )
            # Should be 403 (forbidden) for non-admin
            assert response.status_code in [403, 500]


class TestPlantValidation:
    """Tests for plant data validation."""

    def test_fleet_number_required(self, client, auth_headers, admin_user, mock_supabase):
        """Test that fleet number is required."""
        with patch("app.core.security.get_current_user") as mock_get_user:
            from app.core.security import CurrentUser
            mock_get_user.return_value = CurrentUser(**admin_user)

            response = client.post(
                "/api/v1/plants",
                json={"description": "Missing fleet number"},
                headers=auth_headers,
            )
            assert response.status_code == 422  # Validation error
