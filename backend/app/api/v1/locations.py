"""Location management endpoints."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.core.database import get_supabase_admin_client
from app.core.exceptions import NotFoundError, ValidationError
from app.core.security import (
    CurrentUser,
    require_admin,
    require_management_or_admin,
)
from app.monitoring.logging import get_logger

router = APIRouter()
logger = get_logger(__name__)


@router.get("")
async def list_locations(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """List all locations.

    Args:
        current_user: The authenticated user.

    Returns:
        List of locations with summary stats.
    """
    client = get_supabase_admin_client()

    result = (
        client.table("v_location_stats")
        .select("*")
        .order("location_name")
        .execute()
    )

    return {
        "success": True,
        "data": result.data,
    }


@router.get("/{location_id}")
async def get_location(
    location_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get a single location by ID.

    Args:
        location_id: The location UUID.
        current_user: The authenticated user.

    Returns:
        Location details with stats.
    """
    client = get_supabase_admin_client()

    result = (
        client.table("v_location_stats")
        .select("*")
        .eq("id", str(location_id))
        .single()
        .execute()
    )

    if not result.data:
        raise NotFoundError("Location", str(location_id))

    return {
        "success": True,
        "data": result.data,
    }


@router.post("", status_code=201)
async def create_location(
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    name: str,
    code: str | None = None,
    address: str | None = None,
) -> dict[str, Any]:
    """Create a new location.

    Args:
        current_user: The authenticated admin user.
        name: Location name.
        code: Short code for the location.
        address: Physical address.

    Returns:
        Created location with ID.
    """
    client = get_supabase_admin_client()

    # Check for duplicate name
    existing = (
        client.table("locations")
        .select("id")
        .eq("name", name)
        .execute()
    )

    if existing.data:
        raise ValidationError(
            "Location with this name already exists",
            details=[{"field": "name", "message": "Already exists", "code": "DUPLICATE"}],
        )

    # Create location
    result = (
        client.table("locations")
        .insert({
            "name": name.upper(),
            "code": code.upper() if code else name[:3].upper(),
            "address": address,
            "is_active": True,
        })
        .execute()
    )

    logger.info(
        "Location created",
        location_id=result.data[0]["id"],
        name=name,
        user_id=current_user.id,
    )

    return {
        "success": True,
        "data": result.data[0],
    }


@router.patch("/{location_id}")
async def update_location(
    location_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    name: str | None = None,
    code: str | None = None,
    address: str | None = None,
    is_active: bool | None = None,
) -> dict[str, Any]:
    """Update an existing location.

    Args:
        location_id: The location UUID.
        current_user: The authenticated admin user.
        name: New location name.
        code: New short code.
        address: New address.
        is_active: Active status.

    Returns:
        Updated location.
    """
    client = get_supabase_admin_client()

    # Check location exists
    existing = (
        client.table("locations")
        .select("id")
        .eq("id", str(location_id))
        .execute()
    )

    if not existing.data:
        raise NotFoundError("Location", str(location_id))

    # Build update data
    update_data = {}
    if name is not None:
        update_data["name"] = name.upper()
    if code is not None:
        update_data["code"] = code.upper()
    if address is not None:
        update_data["address"] = address
    if is_active is not None:
        update_data["is_active"] = is_active

    if not update_data:
        raise ValidationError("No fields to update")

    update_data["updated_at"] = "now()"

    result = (
        client.table("locations")
        .update(update_data)
        .eq("id", str(location_id))
        .execute()
    )

    logger.info(
        "Location updated",
        location_id=str(location_id),
        updated_fields=list(update_data.keys()),
        user_id=current_user.id,
    )

    return {
        "success": True,
        "data": result.data[0],
    }


@router.get("/{location_id}/plants")
async def get_location_plants(
    location_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: str | None = Query(None, pattern="^(active|archived|disposed)$"),
) -> dict[str, Any]:
    """Get plants at a specific location.

    Args:
        location_id: The location UUID.
        current_user: The authenticated user.
        page: Page number.
        limit: Items per page.
        status: Filter by plant status.

    Returns:
        Paginated list of plants at this location.
    """
    client = get_supabase_admin_client()

    # Verify location exists
    location = (
        client.table("locations")
        .select("id, name")
        .eq("id", str(location_id))
        .single()
        .execute()
    )

    if not location.data:
        raise NotFoundError("Location", str(location_id))

    # Get plants
    query = (
        client.table("v_plants_summary")
        .select("*", count="exact")
        .eq("current_location_id", str(location_id))
    )

    if status:
        query = query.eq("status", status)

    offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)
    query = query.order("fleet_number")

    result = query.execute()
    total = result.count or 0

    return {
        "success": True,
        "data": result.data,
        "location": location.data,
        "meta": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        },
    }


@router.get("/{location_id}/submissions")
async def get_location_submissions(
    location_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """Get weekly report submissions for a location.

    Args:
        location_id: The location UUID.
        current_user: The authenticated user.
        year: Filter by year.
        limit: Maximum results.

    Returns:
        List of submissions for this location.
    """
    client = get_supabase_admin_client()

    query = (
        client.table("weekly_report_submissions")
        .select("*")
        .eq("location_id", str(location_id))
        .order("submitted_at", desc=True)
        .limit(limit)
    )

    if year:
        query = query.eq("year", year)

    result = query.execute()

    return {
        "success": True,
        "data": result.data,
    }
