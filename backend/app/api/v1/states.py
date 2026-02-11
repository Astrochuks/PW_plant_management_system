"""State management endpoints."""

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
    client = get_supabase_admin_client()

    query = client.table("states").select("*")

    if not include_inactive:
        query = query.eq("is_active", True)

    query = query.order("name")
    result = query.execute()

    # Get site counts for each state
    states_with_counts = []
    for state in result.data or []:
        sites = (
            client.table("locations")
            .select("id", count="exact")
            .eq("state_id", state["id"])
            .execute()
        )
        states_with_counts.append({
            **state,
            "sites_count": sites.count or 0,
        })

    return {
        "success": True,
        "data": states_with_counts,
        "meta": {
            "total": len(states_with_counts),
        },
    }


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
    client = get_supabase_admin_client()

    result = (
        client.table("states")
        .select("*")
        .eq("id", str(state_id))
        .single()
        .execute()
    )

    if not result.data:
        raise NotFoundError("State", str(state_id))

    # Get sites in this state
    sites = (
        client.table("v_location_stats")
        .select("*")
        .eq("state_id", str(state_id))
        .order("location_name")
        .execute()
    )

    return {
        "success": True,
        "data": {
            **result.data,
            "sites": sites.data or [],
            "sites_count": len(sites.data) if sites.data else 0,
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
    client = get_supabase_admin_client()

    # Verify state exists
    state = (
        client.table("states")
        .select("id, name")
        .eq("id", str(state_id))
        .single()
        .execute()
    )

    if not state.data:
        raise NotFoundError("State", str(state_id))

    # Get sites with stats
    sites = (
        client.table("v_location_stats")
        .select("*")
        .eq("state_id", str(state_id))
        .order("location_name")
        .execute()
    )

    return {
        "success": True,
        "data": sites.data or [],
        "meta": {
            "state": state.data,
            "total": len(sites.data) if sites.data else 0,
        },
    }


@router.get("/{state_id}/plants")
async def get_state_plants(
    state_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    status: str | None = Query(None, pattern="^(working|standby|breakdown|faulty|scrap|missing|stolen|unverified|in_transit|off_hire)$"),
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
    client = get_supabase_admin_client()

    # Verify state exists
    state = (
        client.table("states")
        .select("id, name")
        .eq("id", str(state_id))
        .single()
        .execute()
    )

    if not state.data:
        raise NotFoundError("State", str(state_id))

    # Get plants using the view which has state_id
    query = (
        client.table("v_plants_summary")
        .select("*", count="exact")
        .eq("state_id", str(state_id))
    )

    if status:
        query = query.eq("status", status)
    if fleet_type:
        query = query.ilike("fleet_type", f"%{fleet_type}%")

    offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)
    query = query.order("fleet_number")

    result = query.execute()
    total = result.count or 0

    return {
        "success": True,
        "data": result.data or [],
        "meta": {
            "state": state.data,
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
    client = get_supabase_admin_client()

    # Check for duplicate name (case-insensitive)
    existing = (
        client.table("states")
        .select("id, name")
        .ilike("name_normalized", name.upper().strip())
        .execute()
    )

    if existing.data:
        raise ValidationError(
            f"State '{existing.data[0]['name']}' already exists",
            details=[{"field": "name", "message": "Already exists", "code": "DUPLICATE"}],
        )

    state_data = {
        "name": name.strip(),
        "code": code.upper() if code else None,
        "region": region,
    }

    result = client.table("states").insert(state_data).execute()
    created = result.data[0]

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
        new_values=state_data,
        ip_address=get_client_ip(request),
        description=f"Created state: {name}",
    )

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
    client = get_supabase_admin_client()

    # Build update data
    update_data = {}
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
    existing = (
        client.table("states")
        .select("*")
        .eq("id", str(state_id))
        .execute()
    )

    if not existing.data:
        raise NotFoundError("State", str(state_id))

    old_values = {k: existing.data[0].get(k) for k in update_data}

    # Check for duplicate name if changing name
    if name:
        dup_check = (
            client.table("states")
            .select("id, name")
            .ilike("name_normalized", name.upper().strip())
            .neq("id", str(state_id))
            .execute()
        )
        if dup_check.data:
            raise ValidationError(
                f"State '{dup_check.data[0]['name']}' already exists",
                details=[{"field": "name", "message": "Already exists", "code": "DUPLICATE"}],
            )

    update_data["updated_at"] = "now()"

    result = (
        client.table("states")
        .update(update_data)
        .eq("id", str(state_id))
        .execute()
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
        new_values={k: v for k, v in update_data.items() if k != "updated_at"},
        ip_address=get_client_ip(request),
        description=f"Updated state: {existing.data[0]['name']}",
    )

    return {
        "success": True,
        "data": result.data[0],
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
    client = get_supabase_admin_client()

    # Verify state exists
    existing = (
        client.table("states")
        .select("id, name")
        .eq("id", str(state_id))
        .single()
        .execute()
    )

    if not existing.data:
        raise NotFoundError("State", str(state_id))

    state_name = existing.data["name"]

    # Check for linked sites
    sites = (
        client.table("locations")
        .select("id, name", count="exact")
        .eq("state_id", str(state_id))
        .execute()
    )
    site_count = sites.count or 0

    if site_count > 0:
        site_names = [s["name"] for s in (sites.data or [])[:5]]
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
    client.table("states").delete().eq("id", str(state_id)).execute()

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

    return {
        "success": True,
        "message": f"State '{state_name}' deleted successfully",
    }
