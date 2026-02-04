"""Fleet types management endpoints."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends

from app.core.database import get_supabase_admin_client
from app.core.exceptions import NotFoundError
from app.core.security import (
    CurrentUser,
    require_management_or_admin,
)
from app.monitoring.logging import get_logger

router = APIRouter()
logger = get_logger(__name__)


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
    client = get_supabase_admin_client()

    result = (
        client.table("fleet_types")
        .select("id, name, description, created_at")
        .order("name")
        .execute()
    )

    return {
        "success": True,
        "data": result.data,
    }


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
        client.table("fleet_types")
        .select("id, name, description, created_at")
        .eq("id", str(fleet_type_id))
        .single()
        .execute()
    )

    if not result.data:
        raise NotFoundError("Fleet type", str(fleet_type_id))

    return {
        "success": True,
        "data": result.data,
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
    fleet_type = (
        client.table("fleet_types")
        .select("id, name")
        .eq("id", str(fleet_type_id))
        .single()
        .execute()
    )

    if not fleet_type.data:
        raise NotFoundError("Fleet type", str(fleet_type_id))

    # Get plant count
    plants = (
        client.table("plants")
        .select("id", count="exact")
        .eq("fleet_type_id", str(fleet_type_id))
        .eq("status", "active")
        .execute()
    )

    return {
        "success": True,
        "data": {
            "fleet_type": fleet_type.data,
            "plant_count": plants.count or 0,
        },
    }
