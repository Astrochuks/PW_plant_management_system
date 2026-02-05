"""Plant management endpoints."""

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
from app.models.plant import (
    PlantCreate,
    PlantUpdate,
    PlantSummary,
    PlantListResponse,
    PlantTransferRequest,
)
from app.monitoring.logging import get_logger
from app.services.audit_service import audit_service

router = APIRouter()
logger = get_logger(__name__)


# ============================================================================
# Non-parametric routes MUST come before /{plant_id} routes
# ============================================================================


@router.get("/events")
async def list_plant_events(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    event_type: str | None = Query(None, pattern="^(movement|missing|new|returned|verification_failed)$"),
    plant_id: UUID | None = None,
    location_id: UUID | None = None,
    acknowledged: bool | None = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """List plant events (movements, new plants, missing plants, etc.)

    Args:
        current_user: The authenticated user.
        event_type: Filter by event type.
        plant_id: Filter by specific plant.
        location_id: Filter by location involved.
        acknowledged: Filter by acknowledgement status.
        page: Page number.
        limit: Items per page.

    Returns:
        Paginated list of plant events.
    """
    client = get_supabase_admin_client()

    query = (
        client.table("plant_events")
        .select("*, plants_master(fleet_number, description)", count="exact")
    )

    if event_type:
        query = query.eq("event_type", event_type)
    if plant_id:
        query = query.eq("plant_id", str(plant_id))
    if location_id:
        query = query.or_(f"from_location_id.eq.{location_id},to_location_id.eq.{location_id}")
    if acknowledged is not None:
        query = query.eq("acknowledged", acknowledged)

    offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)
    query = query.order("created_at", desc=True)

    result = query.execute()
    total = result.count or 0

    # Transform to include plant info
    events = []
    for item in result.data:
        item["fleet_number"] = item.get("plants_master", {}).get("fleet_number") if item.get("plants_master") else None
        item["plant_description"] = item.get("plants_master", {}).get("description") if item.get("plants_master") else None
        if "plants_master" in item:
            del item["plants_master"]
        events.append(item)

    return {
        "success": True,
        "data": events,
        "meta": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        },
    }


@router.patch("/events/{event_id}/acknowledge")
async def acknowledge_event(
    event_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    remarks: str | None = None,
) -> dict[str, Any]:
    """Acknowledge a plant event.

    Args:
        event_id: The event UUID.
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.
        remarks: Optional remarks about acknowledgement.

    Returns:
        Updated event.
    """
    client = get_supabase_admin_client()

    # Check event exists and capture old state
    existing = (
        client.table("plant_events")
        .select("*")
        .eq("id", str(event_id))
        .execute()
    )

    if not existing.data:
        raise NotFoundError("Plant event", str(event_id))

    old_values = {"acknowledged": existing.data[0].get("acknowledged", False)}

    update_data = {
        "acknowledged": True,
        "acknowledged_by": current_user.id,
        "acknowledged_at": "now()",
    }
    if remarks:
        update_data["remarks"] = remarks

    result = (
        client.table("plant_events")
        .update(update_data)
        .eq("id", str(event_id))
        .execute()
    )

    logger.info(
        "Plant event acknowledged",
        event_id=str(event_id),
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="update",
        table_name="plant_events",
        record_id=str(event_id),
        old_values=old_values,
        new_values={"acknowledged": True, "remarks": remarks},
        ip_address=get_client_ip(request),
        description=f"Acknowledged plant event {event_id}",
    )

    return {
        "success": True,
        "data": result.data[0],
    }


@router.get("/search/{query}")
async def search_plants(
    query: str,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    status: str | None = None,
    location_id: UUID | None = None,
    fleet_type_id: UUID | None = None,
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """Full-text search for plants.

    Args:
        query: Search query.
        current_user: The authenticated user.
        status: Filter by status.
        location_id: Filter by location.
        fleet_type_id: Filter by fleet type.
        limit: Maximum results.

    Returns:
        Search results ranked by relevance.
    """
    client = get_supabase_admin_client()

    result = client.rpc(
        "search_plants",
        {
            "p_search_term": query,
            "p_status": status,
            "p_location_id": str(location_id) if location_id else None,
            "p_fleet_type_id": str(fleet_type_id) if fleet_type_id else None,
            "p_limit": limit,
            "p_offset": 0,
        },
    ).execute()

    return {
        "success": True,
        "data": result.data,
        "meta": {"query": query, "count": len(result.data)},
    }


@router.get("/usage/summary")
async def get_usage_summary(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    month: int | None = Query(None, ge=1, le=12),
    location_id: UUID | None = None,
    limit: int = Query(50, ge=1, le=500),
) -> dict[str, Any]:
    """Get plant usage summary across the fleet.

    Args:
        current_user: The authenticated user.
        year: Filter by year.
        month: Filter by month (1-12).
        location_id: Filter by location.
        limit: Maximum plants to return.

    Returns:
        Usage summary for plants.
    """
    client = get_supabase_admin_client()

    result = client.rpc(
        "get_plant_usage_summary",
        {
            "p_plant_id": None,
            "p_year": year,
            "p_month": month,
            "p_location_id": str(location_id) if location_id else None,
        },
    ).execute()

    return {
        "success": True,
        "data": result.data[:limit] if result.data else [],
        "meta": {
            "year": year,
            "month": month,
            "total": len(result.data) if result.data else 0,
        },
    }


@router.get("/usage/breakdowns")
async def get_breakdown_report(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    week_number: int | None = Query(None, ge=1, le=53),
    location_id: UUID | None = None,
) -> dict[str, Any]:
    """Get breakdown report - plants with breakdown hours.

    Args:
        current_user: The authenticated user.
        year: Filter by year.
        week_number: Filter by week number.
        location_id: Filter by location.

    Returns:
        List of plants with breakdowns.
    """
    client = get_supabase_admin_client()

    result = client.rpc(
        "get_breakdown_report",
        {
            "p_year": year,
            "p_week_number": week_number,
            "p_location_id": str(location_id) if location_id else None,
        },
    ).execute()

    return {
        "success": True,
        "data": result.data,
    }


@router.get("/utilization")
async def get_fleet_utilization(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, Any]:
    """Get fleet utilization view with comprehensive stats.

    Args:
        current_user: The authenticated user.
        limit: Maximum plants to return.

    Returns:
        Plant utilization data with hours, rates, and costs.
    """
    client = get_supabase_admin_client()

    result = (
        client.table("v_plant_utilization")
        .select("*")
        .order("total_hours_worked", desc=True)
        .limit(limit)
        .execute()
    )

    return {
        "success": True,
        "data": result.data,
    }


# ============================================================================
# Parametric routes with /{plant_id}
# ============================================================================


@router.get("", response_model=PlantListResponse)
async def list_plants(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: str | None = Query(None, pattern="^(working|standby|breakdown|faulty|scrap|missing|stolen|unverified|in_transit|off_hire)$"),
    location_id: UUID | None = None,
    fleet_type: str | None = Query(None, description="Filter by fleet type name"),
    search: str | None = None,
    verified_only: bool = False,
) -> PlantListResponse:
    """List plants with filtering and pagination.

    Args:
        current_user: The authenticated user.
        page: Page number.
        limit: Items per page.
        status: Filter by status.
        location_id: Filter by location.
        fleet_type_id: Filter by fleet type.
        search: Search in fleet_number, description.
        verified_only: Only show verified plants.

    Returns:
        Paginated list of plants with summary stats.
    """
    client = get_supabase_admin_client()

    # Use the view for summary data
    query = client.table("v_plants_summary").select("*", count="exact")

    # Apply filters
    if status:
        query = query.eq("status", status)

    if location_id:
        query = query.eq("current_location_id", str(location_id))

    if fleet_type:
        query = query.ilike("fleet_type", f"%{fleet_type}%")

    if search:
        # Full-text search
        query = query.or_(
            f"fleet_number.ilike.%{search}%,description.ilike.%{search}%"
        )

    if verified_only:
        query = query.eq("physical_verification", True)

    # Pagination
    offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)

    # Order by fleet_number
    query = query.order("fleet_number")

    result = query.execute()

    # Create response
    plants = [PlantSummary(**p) for p in result.data]
    total = result.count or 0

    return PlantListResponse(
        data=plants,
        meta={
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
            "has_more": page * limit < total,
        },
    )


@router.get("/{plant_id}")
async def get_plant(
    plant_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get a single plant by ID.

    Args:
        plant_id: The plant UUID.
        current_user: The authenticated user.

    Returns:
        Plant details with related data.
    """
    client = get_supabase_admin_client()

    result = (
        client.table("v_plants_summary")
        .select("*")
        .eq("id", str(plant_id))
        .single()
        .execute()
    )

    if not result.data:
        raise NotFoundError("Plant", str(plant_id))

    return {
        "success": True,
        "data": result.data,
    }


@router.post("", status_code=201)
async def create_plant(
    plant: PlantCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Create a new plant.

    Args:
        plant: Plant data.
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.

    Returns:
        Created plant with ID.
    """
    client = get_supabase_admin_client()

    # Check for duplicate fleet number
    existing = (
        client.table("plants_master")
        .select("id")
        .eq("fleet_number", plant.fleet_number)
        .execute()
    )

    if existing.data:
        raise ValidationError(
            "Plant with this fleet number already exists",
            details=[{"field": "fleet_number", "message": "Already exists", "code": "DUPLICATE"}],
        )

    # Create plant
    result = (
        client.table("plants_master")
        .insert(plant.model_dump(exclude_none=True))
        .execute()
    )

    created = result.data[0]

    logger.info(
        "Plant created",
        plant_id=created["id"],
        fleet_number=plant.fleet_number,
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="create",
        table_name="plants_master",
        record_id=created["id"],
        new_values=plant.model_dump(exclude_none=True),
        ip_address=get_client_ip(request),
        description=f"Created plant {plant.fleet_number}",
    )

    return {
        "success": True,
        "data": created,
    }


@router.patch("/{plant_id}")
async def update_plant(
    plant_id: UUID,
    plant: PlantUpdate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Update an existing plant.

    Args:
        plant_id: The plant UUID.
        plant: Updated plant data.
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.

    Returns:
        Updated plant.
    """
    client = get_supabase_admin_client()

    # Update only provided fields
    update_data = plant.model_dump(exclude_none=True)
    if not update_data:
        raise ValidationError("No fields to update")

    # Fetch current values for the fields being changed (for audit diff)
    fields_to_fetch = ",".join(["id", "fleet_number"] + list(update_data.keys()))
    existing = (
        client.table("plants_master")
        .select(fields_to_fetch)
        .eq("id", str(plant_id))
        .execute()
    )

    if not existing.data:
        raise NotFoundError("Plant", str(plant_id))

    # Capture old values only for fields that are actually changing
    old_record = existing.data[0]
    old_values = {k: old_record.get(k) for k in update_data if k in old_record}

    update_data["updated_at"] = "now()"

    result = (
        client.table("plants_master")
        .update(update_data)
        .eq("id", str(plant_id))
        .execute()
    )

    logger.info(
        "Plant updated",
        plant_id=str(plant_id),
        updated_fields=list(update_data.keys()),
        user_id=current_user.id,
    )

    fleet_number = old_record.get("fleet_number", str(plant_id))
    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="update",
        table_name="plants_master",
        record_id=str(plant_id),
        old_values=old_values,
        new_values={k: v for k, v in update_data.items() if k != "updated_at"},
        ip_address=get_client_ip(request),
        description=f"Updated plant {fleet_number}: {', '.join(update_data.keys())}",
    )

    return {
        "success": True,
        "data": result.data[0],
    }


@router.post("/{plant_id}/transfer")
async def transfer_plant(
    plant_id: UUID,
    transfer: PlantTransferRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Transfer a plant to a new location.

    Args:
        plant_id: The plant UUID.
        transfer: Transfer details.
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.

    Returns:
        Transfer result.
    """
    client = get_supabase_admin_client()

    # Call the RPC function
    result = client.rpc(
        "transfer_plant",
        {
            "p_plant_id": str(plant_id),
            "p_new_location_id": str(transfer.new_location_id),
            "p_transfer_reason": transfer.transfer_reason,
            "p_user_id": current_user.id,
        },
    ).execute()

    if not result.data.get("success"):
        raise ValidationError(result.data.get("error", "Transfer failed"))

    from_loc = result.data.get("from_location", "Unknown")
    to_loc = result.data.get("to_location", "Unknown")

    logger.info(
        "Plant transferred",
        plant_id=str(plant_id),
        from_location=from_loc,
        to_location=to_loc,
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="transfer",
        table_name="plants_master",
        record_id=str(plant_id),
        old_values={"location": from_loc},
        new_values={"location": to_loc, "transfer_reason": transfer.transfer_reason},
        ip_address=get_client_ip(request),
        description=f"Transferred plant from {from_loc} to {to_loc}",
    )

    return {
        "success": True,
        "data": result.data,
    }


@router.delete("/{plant_id}")
async def delete_plant(
    plant_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Delete a plant record.

    Captures the full record before deletion for audit trail.

    Args:
        plant_id: The plant UUID.
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.

    Returns:
        Success message.
    """
    client = get_supabase_admin_client()

    # Capture full record before deletion for audit trail
    existing = (
        client.table("plants_master")
        .select("*")
        .eq("id", str(plant_id))
        .single()
        .execute()
    )

    if not existing.data:
        raise NotFoundError("Plant", str(plant_id))

    deleted_record = existing.data
    fleet_number = deleted_record.get("fleet_number", str(plant_id))

    # Delete plant
    client.table("plants_master").delete().eq("id", str(plant_id)).execute()

    logger.info(
        "Plant deleted",
        plant_id=str(plant_id),
        fleet_number=fleet_number,
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="delete",
        table_name="plants_master",
        record_id=str(plant_id),
        old_values=deleted_record,
        ip_address=get_client_ip(request),
        description=f"Deleted plant {fleet_number}",
    )

    return {
        "success": True,
        "message": f"Plant {fleet_number} deleted successfully",
    }


@router.get("/{plant_id}/maintenance-history")
async def get_plant_maintenance_history(
    plant_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    """Get maintenance history for a plant.

    Args:
        plant_id: The plant UUID.
        current_user: The authenticated user.
        limit: Maximum records to return.

    Returns:
        List of maintenance/spare parts records.
    """
    client = get_supabase_admin_client()

    result = client.rpc(
        "get_plant_maintenance_history",
        {"p_plant_id": str(plant_id), "p_limit": limit},
    ).execute()

    return {
        "success": True,
        "data": result.data,
    }


@router.get("/{plant_id}/location-history")
async def get_plant_location_history(
    plant_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get location history for a plant.

    Args:
        plant_id: The plant UUID.
        current_user: The authenticated user.

    Returns:
        List of location records showing where the plant has been.
    """
    client = get_supabase_admin_client()

    result = client.rpc(
        "get_plant_location_history",
        {"p_plant_id": str(plant_id)},
    ).execute()

    return {
        "success": True,
        "data": result.data,
    }


@router.get("/{plant_id}/weekly-records")
async def get_plant_weekly_records(
    plant_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    limit: int = Query(52, ge=1, le=200),
) -> dict[str, Any]:
    """Get weekly tracking records for a plant.

    Shows where the plant was reported each week.

    Args:
        plant_id: The plant UUID.
        current_user: The authenticated user.
        year: Filter by year.
        limit: Maximum records (default 52 = 1 year).

    Returns:
        List of weekly records with location info.
    """
    client = get_supabase_admin_client()

    query = (
        client.table("plant_weekly_records")
        .select("*, locations(name)")
        .eq("plant_id", str(plant_id))
    )

    if year:
        query = query.eq("year", year)

    query = query.order("year", desc=True).order("week_number", desc=True)
    query = query.limit(limit)

    result = query.execute()

    # Transform to include location name
    records = []
    for item in result.data:
        item["location_name"] = item.get("locations", {}).get("name") if item.get("locations") else None
        if "locations" in item:
            del item["locations"]
        records.append(item)

    return {
        "success": True,
        "data": records,
    }


@router.get("/{plant_id}/events")
async def get_plant_events(
    plant_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    """Get events for a specific plant.

    Args:
        plant_id: The plant UUID.
        current_user: The authenticated user.
        limit: Maximum records.

    Returns:
        List of events for this plant.
    """
    client = get_supabase_admin_client()

    result = (
        client.table("plant_events")
        .select("*, from_loc:locations!from_location_id(name), to_loc:locations!to_location_id(name)")
        .eq("plant_id", str(plant_id))
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )

    # Transform
    events = []
    for item in result.data:
        item["from_location_name"] = item.get("from_loc", {}).get("name") if item.get("from_loc") else None
        item["to_location_name"] = item.get("to_loc", {}).get("name") if item.get("to_loc") else None
        if "from_loc" in item:
            del item["from_loc"]
        if "to_loc" in item:
            del item["to_loc"]
        events.append(item)

    return {
        "success": True,
        "data": events,
    }


@router.get("/{plant_id}/usage")
async def get_plant_usage(
    plant_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    month: int | None = Query(None, ge=1, le=12),
) -> dict[str, Any]:
    """Get usage summary for a specific plant.

    Args:
        plant_id: The plant UUID.
        current_user: The authenticated user.
        year: Filter by year.
        month: Filter by month.

    Returns:
        Usage summary for the plant.
    """
    client = get_supabase_admin_client()

    result = client.rpc(
        "get_plant_usage_summary",
        {
            "p_plant_id": str(plant_id),
            "p_year": year,
            "p_month": month,
            "p_location_id": None,
        },
    ).execute()

    if not result.data:
        raise NotFoundError("Plant usage data", str(plant_id))

    return {
        "success": True,
        "data": result.data[0] if result.data else None,
    }
