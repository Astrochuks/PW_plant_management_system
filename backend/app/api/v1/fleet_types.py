"""Fleet types management endpoints."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends

from app.core import cache
from app.core.database import get_supabase_admin_client
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

    client = get_supabase_admin_client()

    result = (
        client.table("fleet_number_prefixes")
        .select("id, fleet_type, prefix, created_at")
        .order("fleet_type")
        .execute()
    )

    # Transform fleet_type to name for API response
    data = [
        {
            "id": item["id"],
            "name": item["fleet_type"],
            "prefix": item["prefix"],
            "created_at": item["created_at"],
        }
        for item in result.data
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
    client = get_supabase_admin_client()

    result = (
        client.table("fleet_number_prefixes")
        .select("id, fleet_type, prefix, created_at")
        .eq("id", str(fleet_type_id))
        .single()
        .execute()
    )

    if not result.data:
        raise NotFoundError("Fleet type", str(fleet_type_id))

    # Transform fleet_type to name for API response
    data = {
        "id": result.data["id"],
        "name": result.data["fleet_type"],
        "prefix": result.data["prefix"],
        "created_at": result.data["created_at"],
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
    client = get_supabase_admin_client()

    # Get fleet type
    fleet_type_result = (
        client.table("fleet_number_prefixes")
        .select("id, fleet_type")
        .eq("id", str(fleet_type_id))
        .single()
        .execute()
    )

    if not fleet_type_result.data:
        raise NotFoundError("Fleet type", str(fleet_type_id))

    fleet_type_name = fleet_type_result.data["fleet_type"]

    # Get plant count
    plants = (
        client.table("plants_master")
        .select("id", count="exact")
        .eq("fleet_type", fleet_type_name)
        .not_.is_("status", "null")
        .execute()
    )

    # Transform for API response
    fleet_type_data = {
        "id": fleet_type_result.data["id"],
        "name": fleet_type_name,
    }

    return {
        "success": True,
        "data": {
            "fleet_type": fleet_type_data,
            "plant_count": plants.count or 0,
        },
    }
