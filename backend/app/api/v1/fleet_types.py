"""Fleet types management endpoints."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends

from app.core import cache
from app.core.pool import fetch, fetchrow, fetchval
from app.core.exceptions import NotFoundError
from app.core.security import (
    CurrentUser,
    require_management_or_admin,
)
from app.monitoring.logging import get_logger

router = APIRouter()
logger = get_logger(__name__)

FLEET_TYPES_CACHE_KEY = "fleet_types:list"


@router.get("")
async def list_fleet_types(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """List all fleet types.

    Args:
        current_user: The authenticated user.

    Returns:
        List of fleet types ordered by name.
    """
    # Serve from cache if available (fleet types almost never change)
    cached = cache.get(FLEET_TYPES_CACHE_KEY)
    if cached is not None:
        return cached

    rows = await fetch(
        "SELECT id, fleet_type, prefix, created_at FROM fleet_number_prefixes ORDER BY fleet_type"
    )

    # Transform fleet_type to name for API response
    data = [
        {
            "id": item["id"],
            "name": item["fleet_type"],
            "prefix": item["prefix"],
            "created_at": item["created_at"],
        }
        for item in rows
    ]

    response = {
        "success": True,
        "data": data,
    }
    cache.put(FLEET_TYPES_CACHE_KEY, response, ttl_seconds=600)  # 10 min
    return response


@router.get("/{fleet_type_id}")
async def get_fleet_type(
    fleet_type_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get a single fleet type by ID.

    Args:
        fleet_type_id: The fleet type UUID.
        current_user: The authenticated user.

    Returns:
        Fleet type details.
    """
    row = await fetchrow(
        "SELECT id, fleet_type, prefix, created_at FROM fleet_number_prefixes WHERE id = $1::uuid",
        str(fleet_type_id),
    )

    if not row:
        raise NotFoundError("Fleet type", str(fleet_type_id))

    # Transform fleet_type to name for API response
    data = {
        "id": row["id"],
        "name": row["fleet_type"],
        "prefix": row["prefix"],
        "created_at": row["created_at"],
    }

    return {
        "success": True,
        "data": data,
    }


@router.get("/{fleet_type_id}/plants")
async def get_fleet_type_plants(
    fleet_type_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get count of plants for a fleet type.

    Args:
        fleet_type_id: The fleet type UUID.
        current_user: The authenticated user.

    Returns:
        Plant count for this fleet type.
    """
    # Get fleet type
    fleet_type_row = await fetchrow(
        "SELECT id, fleet_type FROM fleet_number_prefixes WHERE id = $1::uuid",
        str(fleet_type_id),
    )

    if not fleet_type_row:
        raise NotFoundError("Fleet type", str(fleet_type_id))

    fleet_type_name = fleet_type_row["fleet_type"]

    # Get plant count
    plant_count = await fetchval(
        "SELECT count(*) FROM plants_master WHERE fleet_type = $1 AND status IS NOT NULL",
        fleet_type_name,
    ) or 0

    # Transform for API response
    fleet_type_data = {
        "id": fleet_type_row["id"],
        "name": fleet_type_name,
    }

    return {
        "success": True,
        "data": {
            "fleet_type": fleet_type_data,
            "plant_count": plant_count,
        },
    }
