"""Health check endpoints for monitoring and load balancers."""

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends

from app.config import get_settings, Settings
from app.core.database import get_supabase_admin_client
from app.monitoring.metrics import get_metrics_collector

router = APIRouter()


@router.get("")
async def health_check() -> dict[str, Any]:
    """Basic health check endpoint.

    Returns:
        Simple health status for load balancers.
    """
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/detailed")
async def detailed_health_check(
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Detailed health check with component status.

    Returns:
        Health status of all system components.
    """
    checks = {
        "api": {"status": "healthy"},
        "database": await _check_database(),
        "metrics": _check_metrics(),
    }

    # Overall status is unhealthy if any component is unhealthy
    overall_status = "healthy" if all(
        c.get("status") == "healthy" for c in checks.values()
    ) else "unhealthy"

    return {
        "status": overall_status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "environment": settings.environment,
        "version": settings.api_version,
        "checks": checks,
    }


@router.get("/ready")
async def readiness_check() -> dict[str, Any]:
    """Readiness probe for Kubernetes/orchestrators.

    Returns:
        Ready status indicating if the service can accept traffic.
    """
    db_check = await _check_database()

    if db_check.get("status") != "healthy":
        return {
            "ready": False,
            "reason": "Database not available",
        }

    return {
        "ready": True,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/live")
async def liveness_check() -> dict[str, Any]:
    """Liveness probe for Kubernetes/orchestrators.

    Returns:
        Alive status indicating if the service process is running.
    """
    return {
        "alive": True,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


async def _check_database() -> dict[str, Any]:
    """Check database connectivity."""
    try:
        client = get_supabase_admin_client()
        result = client.rpc("get_dashboard_stats").execute()

        if result.data:
            return {
                "status": "healthy",
                "latency_ms": 0,  # Could measure this
                "stats": {
                    "plants": result.data.get("plants", {}).get("total", 0),
                    "locations": result.data.get("locations", {}).get("total", 0),
                },
            }
        return {"status": "healthy"}

    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e),
        }


def _check_metrics() -> dict[str, Any]:
    """Check metrics collector status."""
    try:
        collector = get_metrics_collector()
        stats = collector.get_stats()
        return {
            "status": "healthy",
            "pending_counters": len(stats.get("counters", {})),
            "pending_histograms": sum(stats.get("histogram_counts", {}).values()),
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e),
        }
