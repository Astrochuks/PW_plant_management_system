"""State management endpoints."""

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


@router.get("")
async def list_states(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    include_inactive: bool = Query(False, description="Include inactive states"),
) -> dict[str, Any]:
    """List all states with their sites count.

    Args:
        current_user: The authenticated user.
        include_inactive: Include inactive states.

    Returns:
        List of states with site counts.
    """
    cache_key = f"states:list:{include_inactive}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # Single query with LEFT JOIN for site counts instead of N+1
    active_filter = "" if include_inactive else "WHERE s.is_active = true"
    states_with_counts = await fetch(
        f"""SELECT s.*, count(l.id)::int AS sites_count
            FROM states s
            LEFT JOIN locations l ON l.state_id = s.id
            {active_filter}
            GROUP BY s.id
            ORDER BY s.name"""
    )

    response = {
        "success": True,
        "data": states_with_counts,
        "meta": {
            "total": len(states_with_counts),
        },
    }
    cache.put(cache_key, response, ttl_seconds=300)  # 5 min
    return response


@router.get("/{state_id}")
async def get_state(
    state_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get a single state by ID with its sites.

    Args:
        state_id: The state UUID.
        current_user: The authenticated user.

    Returns:
        State details with list of sites.
    """
    state = await fetchrow(
        "SELECT * FROM states WHERE id = $1::uuid",
        str(state_id),
    )

    if not state:
        raise NotFoundError("State", str(state_id))

    # Get sites in this state
    sites = await fetch(
        "SELECT * FROM v_location_stats WHERE state_id = $1::uuid ORDER BY location_name",
        str(state_id),
    )

    return {
        "success": True,
        "data": {
            **state,
            "sites": sites,
            "sites_count": len(sites),
        },
    }


@router.get("/{state_id}/sites")
async def get_state_sites(
    state_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get all sites in a state.

    Args:
        state_id: The state UUID.
        current_user: The authenticated user.

    Returns:
        List of sites with stats.
    """
    # Verify state exists
    state = await fetchrow(
        "SELECT id, name FROM states WHERE id = $1::uuid",
        str(state_id),
    )

    if not state:
        raise NotFoundError("State", str(state_id))

    # Get sites with stats
    sites = await fetch(
        "SELECT * FROM v_location_stats WHERE state_id = $1::uuid ORDER BY location_name",
        str(state_id),
    )

    return {
        "success": True,
        "data": sites,
        "meta": {
            "state": state,
            "total": len(sites),
        },
    }


@router.get("/{state_id}/plants")
async def get_state_plants(
    state_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    status: str | None = Query(None, pattern="^(working|standby|under_repair|breakdown|faulty|scrap|missing|off_hire|gpm_assessment|unverified)$"),
    fleet_type: str | None = None,
) -> dict[str, Any]:
    """Get all plants in a state (across all sites).

    Args:
        state_id: The state UUID.
        current_user: The authenticated user.
        page: Page number.
        limit: Items per page.
        status: Filter by plant status.
        fleet_type: Filter by fleet type.

    Returns:
        Paginated list of plants in this state.
    """
    # Verify state exists
    state = await fetchrow(
        "SELECT id, name FROM states WHERE id = $1::uuid",
        str(state_id),
    )

    if not state:
        raise NotFoundError("State", str(state_id))

    # Build WHERE clause
    conditions = ["state_id = $1::uuid"]
    params: list[Any] = [str(state_id)]

    if status:
        params.append(status)
        conditions.append(f"status = ${len(params)}")
    if fleet_type:
        params.append(f"%{fleet_type}%")
        conditions.append(f"fleet_type ILIKE ${len(params)}")

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
        "meta": {
            "state": state,
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        },
    }


@router.post("", status_code=201)
async def create_state(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    name: str = Query(..., min_length=2, description="State name"),
    code: str | None = Query(None, max_length=10, description="State code (e.g., FCT, LAG)"),
    region: str | None = Query(None, description="Region (e.g., North Central, South West)"),
) -> dict[str, Any]:
    """Create a new state.

    Args:
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.
        name: State name.
        code: Optional state code.
        region: Optional region.

    Returns:
        Created state.
    """
    # Check for duplicate name (case-insensitive)
    existing = await fetch(
        "SELECT id, name FROM states WHERE name_normalized ILIKE $1",
        name.upper().strip(),
    )

    if existing:
        raise ValidationError(
            f"State '{existing[0]['name']}' already exists",
            details=[{"field": "name", "message": "Already exists", "code": "DUPLICATE"}],
        )

    created = await fetchrow(
        """INSERT INTO states (name, code, region)
           VALUES ($1, $2, $3)
           RETURNING *""",
        name.strip(),
        code.upper() if code else None,
        region,
    )

    logger.info(
        "State created",
        state_id=created["id"],
        name=name,
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="create",
        table_name="states",
        record_id=created["id"],
        new_values={"name": name.strip(), "code": code, "region": region},
        ip_address=get_client_ip(request),
        description=f"Created state: {name}",
    )

    cache.invalidate_prefix("states:")

    return {
        "success": True,
        "data": created,
    }


@router.patch("/{state_id}")
async def update_state(
    state_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    name: str | None = Query(None, min_length=2),
    code: str | None = Query(None, max_length=10),
    region: str | None = Query(None),
    is_active: bool | None = Query(None),
) -> dict[str, Any]:
    """Update a state.

    Args:
        state_id: The state UUID.
        All other args are optional fields to update.

    Returns:
        Updated state.
    """
    # Build update data
    update_data: dict[str, Any] = {}
    if name is not None:
        update_data["name"] = name.strip()
    if code is not None:
        update_data["code"] = code.upper()
    if region is not None:
        update_data["region"] = region
    if is_active is not None:
        update_data["is_active"] = is_active

    if not update_data:
        raise ValidationError("No fields to update")

    # Get existing for audit
    existing = await fetchrow(
        "SELECT * FROM states WHERE id = $1::uuid",
        str(state_id),
    )

    if not existing:
        raise NotFoundError("State", str(state_id))

    old_values = {k: existing.get(k) for k in update_data}

    # Check for duplicate name if changing name
    if name:
        dup_check = await fetch(
            "SELECT id, name FROM states WHERE name_normalized ILIKE $1 AND id != $2::uuid",
            name.upper().strip(),
            str(state_id),
        )
        if dup_check:
            raise ValidationError(
                f"State '{dup_check[0]['name']}' already exists",
                details=[{"field": "name", "message": "Already exists", "code": "DUPLICATE"}],
            )

    # Build SET clause
    set_parts: list[str] = []
    params: list[Any] = []
    for key, val in update_data.items():
        params.append(val)
        set_parts.append(f"{key} = ${len(params)}")
    set_parts.append("updated_at = now()")

    params.append(str(state_id))
    set_clause = ", ".join(set_parts)

    updated = await fetchrow(
        f"UPDATE states SET {set_clause} WHERE id = ${len(params)}::uuid RETURNING *",
        *params,
    )

    logger.info(
        "State updated",
        state_id=str(state_id),
        updated_fields=list(update_data.keys()),
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="update",
        table_name="states",
        record_id=str(state_id),
        old_values=old_values,
        new_values=update_data,
        ip_address=get_client_ip(request),
        description=f"Updated state: {existing['name']}",
    )

    cache.invalidate_prefix("states:")

    return {
        "success": True,
        "data": updated,
    }


@router.delete("/{state_id}")
async def delete_state(
    state_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Delete a state.

    Fails if any sites are linked to this state.

    Args:
        state_id: The state UUID.

    Returns:
        Success message.
    """
    # Verify state exists
    existing = await fetchrow(
        "SELECT id, name FROM states WHERE id = $1::uuid",
        str(state_id),
    )

    if not existing:
        raise NotFoundError("State", str(state_id))

    state_name = existing["name"]

    # Check for linked sites
    site_count = await fetchval(
        "SELECT count(*) FROM locations WHERE state_id = $1::uuid",
        str(state_id),
    ) or 0

    if site_count > 0:
        site_names_rows = await fetch(
            "SELECT name FROM locations WHERE state_id = $1::uuid LIMIT 5",
            str(state_id),
        )
        site_names = [s["name"] for s in site_names_rows]
        raise ValidationError(
            f"Cannot delete state '{state_name}': {site_count} site(s) linked. "
            f"Reassign sites first: {', '.join(site_names)}{'...' if site_count > 5 else ''}",
            details=[{
                "field": "state_id",
                "message": f"{site_count} sites linked",
                "code": "HAS_DEPENDENCIES",
            }],
        )

    # Delete the state
    await execute(
        "DELETE FROM states WHERE id = $1::uuid",
        str(state_id),
    )

    logger.info(
        "State deleted",
        state_id=str(state_id),
        name=state_name,
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="delete",
        table_name="states",
        record_id=str(state_id),
        old_values={"name": state_name},
        ip_address=get_client_ip(request),
        description=f"Deleted state: {state_name}",
    )

    cache.invalidate_prefix("states:")

    return {
        "success": True,
        "message": f"State '{state_name}' deleted successfully",
    }
