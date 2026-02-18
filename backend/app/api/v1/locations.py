"""Location management endpoints."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request

from app.api.v1.auth import get_client_ip
from app.core.database import get_supabase_admin_client
from app.core.exceptions import NotFoundError, ValidationError
from app.core.security import (
    CurrentUser,
    require_admin,
    require_management_or_admin,
)
from app.monitoring.logging import get_logger
from app.services.audit_service import audit_service

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
        "meta": {
            "total": len(result.data) if result.data else 0,
        },
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
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    name: str = Query(..., min_length=2, description="Site name"),
    state_id: UUID | None = Query(None, description="State UUID (required for proper hierarchy)"),
) -> dict[str, Any]:
    """Create a new site (location).

    Args:
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.
        name: Site name.
        state_id: The state this site belongs to.

    Returns:
        Created site with ID.
    """
    client = get_supabase_admin_client()

    # Check for duplicate name (case-insensitive since we store uppercase)
    existing = (
        client.table("locations")
        .select("id")
        .eq("name", name.upper())
        .execute()
    )

    if existing.data:
        raise ValidationError(
            "Site with this name already exists",
            details=[{"field": "name", "message": "Already exists", "code": "DUPLICATE"}],
        )

    # Verify state exists if provided
    state_name = None
    if state_id:
        state = (
            client.table("states")
            .select("id, name")
            .eq("id", str(state_id))
            .execute()
        )
        if not state.data:
            raise NotFoundError("State", str(state_id))
        state_name = state.data[0]["name"]

    location_data = {
        "name": name.upper(),
        "state_id": str(state_id) if state_id else None,
        "state": state_name,  # Keep text field in sync for backwards compatibility
    }

    result = (
        client.table("locations")
        .insert(location_data)
        .execute()
    )

    created = result.data[0]

    logger.info(
        "Site created",
        location_id=created["id"],
        name=name,
        state_id=str(state_id) if state_id else None,
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="create",
        table_name="locations",
        record_id=created["id"],
        new_values=location_data,
        ip_address=get_client_ip(request),
        description=f"Created site {name.upper()}" + (f" in {state_name}" if state_name else ""),
    )

    return {
        "success": True,
        "data": created,
    }


@router.patch("/{location_id}")
async def update_location(
    location_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    name: str | None = Query(None, min_length=2),
    state_id: UUID | None = Query(None, description="New state UUID"),
) -> dict[str, Any]:
    """Update an existing site (location).

    Args:
        location_id: The site UUID.
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.
        name: New site name.
        state_id: New state UUID.

    Returns:
        Updated site.
    """
    client = get_supabase_admin_client()

    update_data = {}
    if name is not None:
        update_data["name"] = name.upper()
    if state_id is not None:
        # Verify state exists
        state = (
            client.table("states")
            .select("id, name")
            .eq("id", str(state_id))
            .execute()
        )
        if not state.data:
            raise NotFoundError("State", str(state_id))
        update_data["state_id"] = str(state_id)
        update_data["state"] = state.data[0]["name"]  # Keep text field in sync

    if not update_data:
        raise ValidationError("No fields to update")

    # Fetch current values for audit diff
    existing = (
        client.table("locations")
        .select("id, name, state_id, state")
        .eq("id", str(location_id))
        .execute()
    )

    if not existing.data:
        raise NotFoundError("Site", str(location_id))

    old_values = {k: existing.data[0].get(k) for k in update_data}

    result = (
        client.table("locations")
        .update(update_data)
        .eq("id", str(location_id))
        .execute()
    )

    logger.info(
        "Site updated",
        location_id=str(location_id),
        updated_fields=list(update_data.keys()),
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="update",
        table_name="locations",
        record_id=str(location_id),
        old_values=old_values,
        new_values=update_data,
        ip_address=get_client_ip(request),
        description=f"Updated site {existing.data[0]['name']}",
    )

    return {
        "success": True,
        "data": result.data[0],
    }


@router.delete("/{location_id}")
async def delete_location(
    location_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    force: bool = Query(False, description="Force delete by reassigning plants to NULL location"),
) -> dict[str, Any]:
    """Delete a location.

    Fails if plants are currently assigned to this location, unless force=true
    is specified (which sets their current_location_id to NULL).

    Historical records (weekly reports, location history, events) are preserved
    and will reference the deleted location's ID.

    Args:
        location_id: The location UUID.
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.
        force: If true, unassign plants from this location before deleting.

    Returns:
        Success message.
    """
    client = get_supabase_admin_client()

    # Verify location exists
    existing = (
        client.table("locations")
        .select("id, name")
        .eq("id", str(location_id))
        .single()
        .execute()
    )

    if not existing.data:
        raise NotFoundError("Location", str(location_id))

    location_name = existing.data["name"]

    # Check for plants currently at this location
    plants_at_location = (
        client.table("plants_master")
        .select("id", count="exact")
        .eq("current_location_id", str(location_id))
        .execute()
    )
    plant_count = plants_at_location.count or 0

    if plant_count > 0 and not force:
        raise ValidationError(
            f"Cannot delete location '{location_name}': {plant_count} plant(s) currently assigned. "
            f"Transfer them first or use force=true to unassign.",
            details=[{
                "field": "location_id",
                "message": f"{plant_count} plants assigned",
                "code": "HAS_DEPENDENCIES",
            }],
        )

    # Check for non-nullable historical records that would block deletion
    weekly_records = (
        client.table("plant_weekly_records")
        .select("id", count="exact")
        .eq("location_id", str(location_id))
        .limit(1)
        .execute()
    )
    weekly_count = weekly_records.count or 0

    submissions = (
        client.table("weekly_report_submissions")
        .select("id", count="exact")
        .eq("location_id", str(location_id))
        .limit(1)
        .execute()
    )
    submission_count = submissions.count or 0

    location_history = (
        client.table("plant_location_history")
        .select("id", count="exact")
        .eq("location_id", str(location_id))
        .limit(1)
        .execute()
    )
    history_count = location_history.count or 0

    if weekly_count > 0 or submission_count > 0 or history_count > 0:
        deps = []
        if weekly_count > 0:
            deps.append(f"{weekly_count} weekly record(s)")
        if submission_count > 0:
            deps.append(f"{submission_count} submission(s)")
        if history_count > 0:
            deps.append(f"{history_count} location history record(s)")
        raise ValidationError(
            f"Cannot delete location '{location_name}': has historical data ({', '.join(deps)}). "
            f"Locations with historical records cannot be deleted to preserve data integrity.",
            details=[{
                "field": "location_id",
                "message": "Has historical records",
                "code": "HAS_HISTORY",
            }],
        )

    # If force, unassign plants from this location
    if plant_count > 0 and force:
        client.table("plants_master").update(
            {"current_location_id": None}
        ).eq("current_location_id", str(location_id)).execute()

    # Delete the location (nullable FKs on upload_tokens, spare_parts, etc. auto-set to NULL)
    client.table("locations").delete().eq("id", str(location_id)).execute()

    logger.info(
        "Location deleted",
        location_id=str(location_id),
        name=location_name,
        plants_unassigned=plant_count if force else 0,
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="delete",
        table_name="locations",
        record_id=str(location_id),
        old_values={"name": location_name},
        ip_address=get_client_ip(request),
        description=f"Deleted location {location_name}"
        + (f" (force: {plant_count} plants unassigned)" if force and plant_count > 0 else ""),
    )

    return {
        "success": True,
        "message": f"Location '{location_name}' deleted successfully",
        "details": {
            "plants_unassigned": plant_count if force else 0,
        },
    }


@router.get("/{location_id}/plants")
async def get_location_plants(
    location_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: str | None = Query(None, pattern="^(working|standby|under_repair|breakdown|faulty|scrap|missing|off_hire|gpm_assessment|unverified)$"),
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


@router.get("/{location_id}/usage")
async def get_location_usage(
    location_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = Query(None, description="Filter by specific year"),
    week: int | None = Query(None, ge=1, le=53, description="Filter by specific week"),
    period: str | None = Query(None, pattern="^(week|month|quarter|year|all)$", description="Aggregate by period"),
) -> dict[str, Any]:
    """Get usage/utilization statistics for a location.

    Shows aggregated hours worked, standby, breakdown across all plants
    at this location for the specified period.

    Args:
        location_id: The location UUID.
        current_user: The authenticated user.
        year: Filter by year (defaults to current year if not specified).
        week: Filter by specific week number.
        period: Aggregation period: week, month, quarter, year, or all.

    Returns:
        Usage statistics for the location.
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

    # Build query for weekly records at this location
    query = (
        client.table("plant_weekly_records")
        .select("hours_worked, standby_hours, breakdown_hours, off_hire, year, week_number, plant_id")
        .eq("location_id", str(location_id))
    )

    if year:
        query = query.eq("year", year)
    if week:
        query = query.eq("week_number", week)

    result = query.execute()
    records = result.data or []

    # Aggregate statistics
    total_hours_worked = sum(float(r.get("hours_worked") or 0) for r in records)
    total_standby_hours = sum(float(r.get("standby_hours") or 0) for r in records)
    total_breakdown_hours = sum(float(r.get("breakdown_hours") or 0) for r in records)
    total_off_hire = sum(1 for r in records if r.get("off_hire"))

    # Count unique plants and weeks
    unique_plants = len(set(r.get("plant_id") for r in records if r.get("plant_id")))
    unique_weeks = len(set((r.get("year"), r.get("week_number")) for r in records))

    # Calculate utilization rate (hours worked / total available hours)
    total_hours = total_hours_worked + total_standby_hours + total_breakdown_hours
    utilization_rate = round((total_hours_worked / total_hours * 100) if total_hours > 0 else 0, 2)

    # Get period label
    if week and year:
        period_label = f"Week {week}, {year}"
    elif year:
        period_label = str(year)
    else:
        period_label = "All Time"

    return {
        "success": True,
        "data": {
            "location_id": str(location_id),
            "location_name": location.data["name"],
            "period_label": period_label,
            "hours_worked": round(total_hours_worked, 2),
            "standby_hours": round(total_standby_hours, 2),
            "breakdown_hours": round(total_breakdown_hours, 2),
            "utilization_rate": utilization_rate,
            "total_records": len(records),
            "unique_plants": unique_plants,
            "weeks_tracked": unique_weeks,
            "off_hire_count": total_off_hire,
        },
    }


@router.get("/{location_id}/weekly-records")
async def get_location_weekly_records(
    location_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = Query(None, description="Filter by year"),
    week: int | None = Query(None, ge=1, le=53, description="Filter by week number"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(50, ge=1, le=200, description="Items per page"),
) -> dict[str, Any]:
    """Get weekly records for all plants at a location.

    Shows detailed per-plant usage for each week.

    Args:
        location_id: The location UUID.
        current_user: The authenticated user.
        year: Filter by year.
        week: Filter by week.
        page: Page number.
        limit: Items per page.

    Returns:
        Paginated weekly records with plant details.
    """
    client = get_supabase_admin_client()

    query = (
        client.table("plant_weekly_records")
        .select("*, plants_master(fleet_number, description)", count="exact")
        .eq("location_id", str(location_id))
    )

    if year:
        query = query.eq("year", year)
    if week:
        query = query.eq("week_number", week)

    # Apply ordering and pagination
    offset = (page - 1) * limit
    query = query.order("year", desc=True).order("week_number", desc=True).order("plants_master(fleet_number)")
    query = query.range(offset, offset + limit - 1)

    result = query.execute()
    total = result.count or 0

    # Transform to flatten plant info
    records = []
    for item in result.data or []:
        plant = item.pop("plants_master", None) or {}
        item["fleet_number"] = plant.get("fleet_number")
        item["description"] = plant.get("description")
        records.append(item)

    return {
        "success": True,
        "data": records,
        "meta": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
            "has_more": page * limit < total,
            "year": year,
            "week": week,
        },
    }
