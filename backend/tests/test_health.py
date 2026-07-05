"""Tests for health check endpoints."""


def test_health_check(client):
    """Test basic health check endpoint."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"


def test_health_ready(client):
    """Test readiness check endpoint (returns {ready: bool, timestamp})."""
    response = client.get("/api/v1/health/ready")
    assert response.status_code == 200
    data = response.json()
    assert data["ready"] is True
    assert "timestamp" in data


def test_health_live(client):
    """Test liveness check endpoint (returns {alive: bool, timestamp})."""
    response = client.get("/api/v1/health/live")
    assert response.status_code == 200
    data = response.json()
    assert data["alive"] is True
    assert "timestamp" in data
