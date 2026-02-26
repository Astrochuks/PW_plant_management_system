"""Location management endpoints."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request

from app.api.v1.auth import get_client_ip
from app.core import cache
from app.core.pool import fetch, fetchrow, fetchval, execute
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

LOCATIONS_CACHE_KEY = "locations:list"


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
    # Serve from cache if available (locations rarely change)
    cached = cache.get(LOCATIONS_CACHE_KEY)
    if cached is not None:
        return cached

    data = await fetch(
        "SELECT * FROM v_location_stats ORDER BY location_name"
    )

    response = {
        "success": True,
        "data": data,
        "meta": {
            "total": len(data),
        },
    }
    cache.put(LOCATIONS_CACHE_KEY, response, ttl_seconds=300)  # 5 min
    return response


@router.get("/unlinked")
async def list_unlinked_locations(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """List locations that have no project linked (for linking UI)."""
    data = await fetch(
        "SELECT id, name, state FROM locations WHERE project_id IS NULL ORDER BY name"
    )
    return {"success": True, "data": data}


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
    row = await fetchrow(
        "SELECT * FROM v_location_stats WHERE id = $1::uuid",
        str(location_id),
    )

    if not row:
        raise NotFoundError("Location", str(location_id))

    return {
        "success": True,
        "data": row,
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
    # Check for duplicate name (case-insensitive since we store uppercase)
    existing = await fetch(
        "SELECT id FROM locations WHERE name = $1",
        name.upper(),
    )

    if existing:
        raise ValidationError(
            "Site with this name already exists",
            details=[{"field": "name", "message": "Already exists", "code": "DUPLICATE"}],
        )

    # Verify state exists if provided
    state_name = None
    if state_id:
        state = await fetchrow(
            "SELECT id, name FROM states WHERE id = $1::uuid",
            str(state_id),
        )
        if not state:
            raise NotFoundError("State", str(state_id))
        state_name = state["name"]

    created = await fetchrow(
        """INSERT INTO locations (name, state_id, state)
           VALUES ($1, $2::uuid, $3)
           RETURNING *""",
        name.upper(),
        str(state_id) if state_id else None,
        state_name,
    )

    logger.info(
        "Site created",
        location_id=created["id"],
        name=name,
        state_id=str(state_id) if state_id else None,
        user_id=current_user.id,
    )

    location_data = {"name": name.upper(), "state_id": str(state_id) if state_id else None, "state": state_name}
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

    cache.invalidate(LOCATIONS_CACHE_KEY)

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
    project_id: str | None = Query(None, description="Link project UUID, or 'unlink' to clear"),
) -> dict[str, Any]:
    """Update an existing site (location).

    Args:
        location_id: The site UUID.
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.
        name: New site name.
        state_id: New state UUID.
        project_id: Link a project (UUID) or 'unlink' to clear the link.

    Returns:
        Updated site.
    """
    update_data: dict[str, Any] = {}
    if name is not None:
        update_data["name"] = name.upper()
    if state_id is not None:
        # Verify state exists
        state = await fetchrow(
            "SELECT id, name FROM states WHERE id = $1::uuid",
            str(state_id),
        )
        if not state:
            raise NotFoundError("State", str(state_id))
        update_data["state_id"] = str(state_id)
        update_data["state"] = state["name"]
    if project_id is not None:
        if project_id == "unlink":
            update_data["project_id"] = None
        else:
            # Verify project exists
            proj = await fetchrow(
                "SELECT id FROM projects WHERE id = $1::uuid", project_id
            )
            if not proj:
                raise NotFoundError("Project", project_id)
            # Verify no other location has this project (1:1)
            conflict = await fetchrow(
                "SELECT id, name FROM locations WHERE project_id = $1::uuid AND id != $2::uuid",
                project_id, str(location_id),
            )
            if conflict:
                raise ValidationError(
                    f"Project already linked to site '{conflict['name']}'",
                )
            update_data["project_id"] = project_id

    if not update_data:
        raise ValidationError("No fields to update")

    # Fetch current values for audit diff
    existing = await fetchrow(
        "SELECT id, name, state_id, state FROM locations WHERE id = $1::uuid",
        str(location_id),
    )

    if not existing:
        raise NotFoundError("Site", str(location_id))

    old_values = {k: existing.get(k) for k in update_data}

    # Build SET clause
    set_parts: list[str] = []
    params: list[Any] = []
    for key, val in update_data.items():
        params.append(val)
        if key in ("state_id", "project_id"):
            set_parts.append(f"{key} = ${len(params)}::uuid")
        else:
            set_parts.append(f"{key} = ${len(params)}")

    params.append(str(location_id))
    set_clause = ", ".join(set_parts)

    updated = await fetchrow(
        f"UPDATE locations SET {set_clause} WHERE id = ${len(params)}::uuid RETURNING *",
        *params,
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
        description=f"Updated site {existing['name']}",
    )

    cache.invalidate(LOCATIONS_CACHE_KEY)

    return {
        "success": True,
        "data": updated,
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
    # Verify location exists
    existing = await fetchrow(
        "SELECT id, name FROM locations WHERE id = $1::uuid",
        str(location_id),
    )

    if not existing:
        raise NotFoundError("Location", str(location_id))

    location_name = existing["name"]

    # Check for plants currently at this location
    plant_count = await fetchval(
        "SELECT count(*) FROM plants_master WHERE current_location_id = $1::uuid",
        str(location_id),
    ) or 0

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
    weekly_count = await fetchval(
        "SELECT count(*) FROM plant_weekly_records WHERE location_id = $1::uuid",
        str(location_id),
    ) or 0

    submission_count = await fetchval(
        "SELECT count(*) FROM weekly_report_submissions WHERE location_id = $1::uuid",
        str(location_id),
    ) or 0

    history_count = await fetchval(
        "SELECT count(*) FROM plant_location_history WHERE location_id = $1::uuid",
        str(location_id),
    ) or 0

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
        await execute(
            "UPDATE plants_master SET current_location_id = NULL WHERE current_location_id = $1::uuid",
            str(location_id),
        )

    # Delete the location
    await execute(
        "DELETE FROM locations WHERE id = $1::uuid",
        str(location_id),
    )

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

    cache.invalidate(LOCATIONS_CACHE_KEY)

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
    # Verify location exists
    location = await fetchrow(
        "SELECT id, name FROM locations WHERE id = $1::uuid",
        str(location_id),
    )

    if not location:
        raise NotFoundError("Location", str(location_id))

    # Build query
    conditions = ["current_location_id = $1::uuid"]
    params: list[Any] = [str(location_id)]

    if status:
        params.append(status)
        conditions.append(f"status = ${len(params)}")

    where = " AND ".join(conditions)
    offset = (page - 1) * limit

    params.append(limit)
    params.append(offset)
    data = await fetch(
        f"""SELECT *, count(*) OVER() AS _total_count FROM v_plants_summary
            WHERE {where}
            ORDER BY fleet_number
            LIMIT ${len(params) - 1} OFFSET ${len(params)}""",
        *params,
    )

    total = data[0].pop("_total_count", 0) if data else 0
    for row in data[1:]:
        row.pop("_total_count", None)

    return {
        "success": True,
        "data": data,
        "location": location,
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
    conditions = ["location_id = $1::uuid"]
    params: list[Any] = [str(location_id)]

    if year:
        params.append(year)
        conditions.append(f"year = ${len(params)}")

    where = " AND ".join(conditions)
    params.append(limit)

    data = await fetch(
        f"""SELECT * FROM weekly_report_submissions
            WHERE {where}
            ORDER BY submitted_at DESC
            LIMIT ${len(params)}""",
        *params,
    )

    return {
        "success": True,
        "data": data,
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
    # Verify location exists
    location = await fetchrow(
        "SELECT id, name FROM locations WHERE id = $1::uuid",
        str(location_id),
    )

    if not location:
        raise NotFoundError("Location", str(location_id))

    # Build query for weekly records at this location
    conditions = ["location_id = $1::uuid"]
    params: list[Any] = [str(location_id)]

    if year:
        params.append(year)
        conditions.append(f"year = ${len(params)}")
    if week:
        params.append(week)
        conditions.append(f"week_number = ${len(params)}")

    where = " AND ".join(conditions)
    records = await fetch(
        f"""SELECT hours_worked, standby_hours, breakdown_hours, off_hire, year, week_number, plant_id
            FROM plant_weekly_records
            WHERE {where}""",
        *params,
    )

    # Aggregate statistics
    total_hours_worked = sum(float(r.get("hours_worked") or 0) for r in records)
    total_standby_hours = sum(float(r.get("standby_hours") or 0) for r in records)
    total_breakdown_hours = sum(float(r.get("breakdown_hours") or 0) for r in records)
    total_off_hire = sum(1 for r in records if r.get("off_hire"))

    unique_plants = len(set(r.get("plant_id") for r in records if r.get("plant_id")))
    unique_weeks = len(set((r.get("year"), r.get("week_number")) for r in records))

    total_hours = total_hours_worked + total_standby_hours + total_breakdown_hours
    utilization_rate = round((total_hours_worked / total_hours * 100) if total_hours > 0 else 0, 2)

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
            "location_name": location["name"],
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
    conditions = ["pwr.location_id = $1::uuid"]
    params: list[Any] = [str(location_id)]

    if year:
        params.append(year)
        conditions.append(f"pwr.year = ${len(params)}")
    if week:
        params.append(week)
        conditions.append(f"pwr.week_number = ${len(params)}")

    where = " AND ".join(conditions)
    offset = (page - 1) * limit

    params.append(limit)
    params.append(offset)
    records = await fetch(
        f"""SELECT pwr.*, pm.fleet_number, pm.description,
                   count(*) OVER() AS _total_count
            FROM plant_weekly_records pwr
            LEFT JOIN plants_master pm ON pm.id = pwr.plant_id
            WHERE {where}
            ORDER BY pwr.year DESC, pwr.week_number DESC, pm.fleet_number
            LIMIT ${len(params) - 1} OFFSET ${len(params)}""",
        *params,
    )

    total = records[0].pop("_total_count", 0) if records else 0
    for row in records[1:]:
        row.pop("_total_count", None)

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
