"""Health check endpoints for monitoring and load balancers."""

import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends

from app.config import get_settings, Settings
from app.core.pool import fetchval, get_pool
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
    """Check database connectivity via asyncpg pool."""
    try:
        start = time.monotonic()
        result = await fetchval("SELECT 1")
        latency_ms = round((time.monotonic() - start) * 1000, 1)

        pool = get_pool()
        return {
            "status": "healthy",
            "latency_ms": latency_ms,
            "pool": {
                "size": pool.get_size(),
                "free": pool.get_idle_size(),
                "min": pool.get_min_size(),
                "max": pool.get_max_size(),
            },
        }

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
