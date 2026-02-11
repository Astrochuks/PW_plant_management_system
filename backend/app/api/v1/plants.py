"""Plant management endpoints."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request

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
    fleet_type: str | None = Query(None, description="Filter by fleet type name"),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """Full-text search for plants.

    Args:
        query: Search query.
        current_user: The authenticated user.
        status: Filter by status.
        location_id: Filter by location.
        fleet_type: Filter by fleet type name.
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
            "p_fleet_type": fleet_type,
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
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    year: int | None = None,
    month: int | None = Query(None, ge=1, le=12),
    week_number: int | None = Query(None, ge=1, le=53),
    location_id: UUID | None = None,
) -> dict[str, Any]:
    """Get plant usage summary across the fleet.

    Args:
        current_user: The authenticated user.
        page: Page number.
        limit: Items per page.
        year: Filter by year.
        month: Filter by month (1-12).
        week_number: Filter by week number (1-53).
        location_id: Filter by location.

    Returns:
        Paginated usage summary for plants.
    """
    client = get_supabase_admin_client()
    offset = (page - 1) * limit

    result = client.rpc(
        "get_plant_usage_summary",
        {
            "p_plant_id": None,
            "p_year": year,
            "p_month": month,
            "p_week_number": week_number,
            "p_location_id": str(location_id) if location_id else None,
            "p_limit": limit,
            "p_offset": offset,
        },
    ).execute()

    # total_count is returned in each row via window function
    total = result.data[0]["total_count"] if result.data else 0
    # Strip the total_count field from response data
    data = [{k: v for k, v in row.items() if k != "total_count"} for row in result.data]

    return {
        "success": True,
        "data": data,
        "meta": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
            "year": year,
            "month": month,
            "week_number": week_number,
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
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    location_id: UUID | None = None,
    fleet_type: str | None = Query(None, description="Filter by fleet type name"),
    status: str | None = Query(None, pattern="^(working|standby|breakdown|missing|stolen|unverified|in_transit|off_hire)$"),
    condition: str | None = Query(None, pattern="^(good|faulty|needs_repair|scrap)$", description="Filter by physical condition"),
    search: str | None = None,
) -> dict[str, Any]:
    """Get fleet utilization view with comprehensive stats.

    Args:
        current_user: The authenticated user.
        page: Page number.
        limit: Items per page.
        location_id: Filter by location.
        fleet_type: Filter by fleet type name.
        status: Filter by operational status (working, standby, breakdown, off_hire, etc.).
        condition: Filter by physical condition (good, faulty, needs_repair, scrap).
        search: Search in fleet_number or description.

    Returns:
        Paginated plant utilization data with hours, rates, and costs.
    """
    client = get_supabase_admin_client()

    query = (
        client.table("v_plant_utilization")
        .select("*", count="exact")
    )

    if location_id:
        query = query.eq("current_location_id", str(location_id))
    if fleet_type:
        query = query.ilike("fleet_type", f"%{fleet_type}%")
    if status:
        query = query.eq("status", status)
    if condition:
        query = query.eq("condition", condition)
    if search:
        query = query.or_(f"fleet_number.ilike.%{search}%,description.ilike.%{search}%")

    offset = (page - 1) * limit
    query = query.order("total_hours_worked", desc=True)
    query = query.range(offset, offset + limit - 1)

    result = query.execute()
    total = result.count or 0

    return {
        "success": True,
        "data": result.data,
        "meta": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        },
    }


@router.get("/export/excel")
async def export_plants_excel(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    exclude_not_seen: bool = Query(True, description="Exclude plants with 'not seen' in remarks"),
    location_id: UUID | None = Query(None, description="Filter by location"),
    state: str | None = Query(None, description="Filter by state (e.g., 'Kaduna', 'FCT', 'Ogun')"),
    fleet_type: str | None = Query(None, description="Filter by fleet type"),
    condition: str | None = Query(None, pattern="^(good|faulty|needs_repair|scrap)$"),
) -> Any:
    """Export plants to Excel file.

    Columns: Fleet Number, Description, Fleet Type, Make, Model, Location,
    State, Physical Verification, Remarks

    Args:
        current_user: The authenticated user.
        exclude_not_seen: If true, exclude plants with 'not seen' in remarks.
        location_id: Filter by location.
        state: Filter by state.
        fleet_type: Filter by fleet type.
        condition: Filter by condition (for filtering, not shown in export).

    Returns:
        Excel file download.
    """
    import io
    from fastapi.responses import StreamingResponse
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    client = get_supabase_admin_client()

    # If filtering by state, get location IDs for that state first
    state_location_ids = None
    if state:
        state_locs = (
            client.table("locations")
            .select("id")
            .ilike("state", state)
            .execute()
        )
        state_location_ids = [loc["id"] for loc in (state_locs.data or [])]

    # Fetch all records using pagination (Supabase default limit is 1000)
    plants = []
    batch_size = 1000
    offset = 0

    while True:
        query = (
            client.table("plants_master")
            .select("fleet_number, description, fleet_type, make, model, current_location_id, physical_verification, remarks, condition, locations(name, state)")
            .order("fleet_type")
            .order("fleet_number")
            .range(offset, offset + batch_size - 1)
        )

        # Apply filters
        if exclude_not_seen:
            query = query.or_("remarks.not.ilike.%not seen%,remarks.is.null")

        if location_id:
            query = query.eq("current_location_id", str(location_id))
        elif state_location_ids is not None:
            # Filter by locations in the specified state
            if state_location_ids:
                query = query.in_("current_location_id", state_location_ids)
            else:
                # No locations found for this state, return empty
                break

        if fleet_type:
            query = query.ilike("fleet_type", f"%{fleet_type}%")

        if condition:
            query = query.eq("condition", condition)

        result = query.execute()
        batch = result.data or []
        plants.extend(batch)

        # If we got less than batch_size, we've reached the end
        if len(batch) < batch_size:
            break

        offset += batch_size

    # Create Excel workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "Plants"

    # Define headers
    headers = [
        "Fleet Number",
        "Description",
        "Fleet Type",
        "Make",
        "Model",
        "Location",
        "State",
        "Physical Verification",
        "Remarks",
    ]

    # Style definitions
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    header_alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    thin_border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin"),
    )

    # Write headers
    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
        cell.border = thin_border

    # Write data
    for row_idx, plant in enumerate(plants, 2):
        location_name = None
        state_name = None
        if plant.get("locations"):
            loc = plant["locations"] if isinstance(plant["locations"], dict) else {}
            location_name = loc.get("name")
            state_name = loc.get("state")

        row_data = [
            plant.get("fleet_number"),
            plant.get("description"),
            plant.get("fleet_type"),
            plant.get("make"),
            plant.get("model"),
            location_name,
            state_name,
            "Yes" if plant.get("physical_verification") else "No",
            plant.get("remarks"),
        ]

        for col_idx, value in enumerate(row_data, 1):
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            cell.border = thin_border
            cell.alignment = Alignment(vertical="center", wrap_text=True)

    # Set column widths
    column_widths = [15, 30, 25, 15, 15, 20, 12, 18, 40]
    for col_idx, width in enumerate(column_widths, 1):
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    # Freeze header row
    ws.freeze_panes = "A2"

    # Save to buffer
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    # Generate filename
    from datetime import datetime
    filename = f"plants_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"

    logger.info(
        "Plants exported to Excel",
        plants_count=len(plants),
        user_id=current_user.id,
    )

    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/stats")
async def get_plant_stats(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    location_id: UUID | None = None,
) -> dict[str, Any]:
    """Get plant counts grouped by status and condition.

    Useful for dashboard widgets showing fleet overview.

    Args:
        current_user: The authenticated user.
        location_id: Optional filter by location.

    Returns:
        Counts by status, condition, and combined status+condition.
    """
    client = get_supabase_admin_client()

    # Build base query
    query = client.table("plants_master").select("status, condition", count="exact")

    if location_id:
        query = query.eq("current_location_id", str(location_id))

    result = query.execute()
    total = result.count or 0

    # Count by status
    status_counts = {}
    condition_counts = {}
    combined_counts = {}

    for plant in result.data or []:
        status = plant.get("status") or "unverified"
        condition = plant.get("condition") or "good"

        status_counts[status] = status_counts.get(status, 0) + 1
        condition_counts[condition] = condition_counts.get(condition, 0) + 1

        combined_key = f"{status}:{condition}"
        combined_counts[combined_key] = combined_counts.get(combined_key, 0) + 1

    # Count plants with unknown location
    unknown_location_result = (
        client.table("plants_master")
        .select("id", count="exact")
        .is_("current_location_id", "null")
        .execute()
    )
    unknown_location_count = unknown_location_result.count or 0

    return {
        "success": True,
        "data": {
            "total": total,
            "by_status": status_counts,
            "by_condition": condition_counts,
            "by_status_and_condition": combined_counts,
            "unknown_location": unknown_location_count,
        },
    }


# ============================================================================
# Parametric routes with /{plant_id}
# ============================================================================


@router.get("")
async def list_plants(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=500),
    status: str | None = Query(None, description="Filter by status(es). Comma-separated for multiple: working,standby,breakdown"),
    condition: str | None = Query(None, description="Filter by condition(s). Comma-separated: good,faulty,needs_repair,scrap"),
    location_id: UUID | None = None,
    state: str | None = Query(None, description="Filter by state (e.g., 'Kaduna', 'FCT', 'Ogun')"),
    fleet_type: str | None = Query(None, description="Filter by fleet type(s). Comma-separated: TRUCKS,EXCAVATOR"),
    search: str | None = None,
    verified_only: bool = False,
    unknown_location: bool = Query(False, description="Filter for plants with unknown/NULL location"),
    in_transit: bool = Query(False, description="Filter for plants currently in transit"),
    columns: str | None = Query(
        None,
        description="Comma-separated list of columns to return. Default: all. Example: fleet_number,status,current_location,fleet_type",
    ),
    sort_by: str = Query("fleet_number", description="Column to sort by"),
    sort_order: str = Query("asc", pattern="^(asc|desc)$", description="Sort order: asc or desc"),
) -> dict[str, Any]:
    """List plants with filtering, pagination, and column selection.

    **Multi-value filters:** Use comma-separated values to filter by multiple options.
    - `status=working,standby` - Plants that are working OR standby
    - `condition=good,faulty` - Plants in good OR faulty condition
    - `fleet_type=TRUCKS,EXCAVATOR` - Trucks OR Excavators

    **Column selection:** Use `columns` to select which fields to return.
    - `columns=fleet_number,status,current_location` - Only these 3 fields
    - Useful for exports and customized views

    **Available columns:**
    id, fleet_number, description, fleet_type, make, model, chassis_number,
    year_of_manufacture, purchase_year, purchase_cost, serial_m, serial_e,
    status, condition, physical_verification, current_location_id, current_location,
    state_id, state, state_code, last_verified_date, remarks, created_at, updated_at,
    total_maintenance_cost, parts_replaced_count, last_maintenance_date, shared_po_count

    Args:
        page: Page number.
        limit: Items per page (max 500 for exports).
        status: Filter by status(es) - comma-separated.
        condition: Filter by condition(s) - comma-separated.
        location_id: Filter by location UUID.
        state: Filter by state name.
        fleet_type: Filter by fleet type(s) - comma-separated.
        search: Search in fleet_number, description.
        verified_only: Only show verified plants.
        unknown_location: Only plants with NULL location.
        in_transit: Only plants in transit.
        columns: Comma-separated columns to return.
        sort_by: Column to sort by.
        sort_order: asc or desc.

    Returns:
        Paginated list of plants (with selected columns if specified).
    """
    client = get_supabase_admin_client()

    # Parse multi-value filters
    status_list = [s.strip() for s in status.split(",")] if status else None
    condition_list = [c.strip() for c in condition.split(",")] if condition else None
    fleet_type_list = [f.strip() for f in fleet_type.split(",")] if fleet_type else None

    # If filtering by state, get location IDs for that state first
    state_location_ids = None
    if state:
        state_locs = (
            client.table("locations")
            .select("id, state_id, states(name)")
            .ilike("states.name", f"%{state}%")
            .execute()
        )
        state_location_ids = [loc["id"] for loc in (state_locs.data or []) if loc.get("states")]

    # Build select clause based on columns parameter
    if columns:
        column_list = [c.strip() for c in columns.split(",")]
        # Always include id for consistency
        if "id" not in column_list:
            column_list.insert(0, "id")
        select_clause = ",".join(column_list)
    else:
        select_clause = "*"

    # Use the view for summary data
    query = client.table("v_plants_summary").select(select_clause, count="exact")

    # Apply status filter (multi-value)
    if in_transit:
        query = query.eq("status", "in_transit")
    elif status_list:
        if len(status_list) == 1:
            query = query.eq("status", status_list[0])
        else:
            query = query.in_("status", status_list)

    # Apply condition filter (multi-value)
    if condition_list:
        if len(condition_list) == 1:
            query = query.eq("condition", condition_list[0])
        else:
            query = query.in_("condition", condition_list)

    # Apply fleet_type filter (multi-value with ILIKE for partial matching)
    if fleet_type_list:
        if len(fleet_type_list) == 1:
            query = query.ilike("fleet_type", f"%{fleet_type_list[0]}%")
        else:
            # Build OR condition for multiple fleet types
            or_conditions = ",".join([f"fleet_type.ilike.%{ft}%" for ft in fleet_type_list])
            query = query.or_(or_conditions)

    # Location filters
    if unknown_location:
        query = query.is_("current_location_id", "null")
    elif location_id:
        query = query.eq("current_location_id", str(location_id))
    elif state_location_ids is not None:
        if state_location_ids:
            query = query.in_("current_location_id", state_location_ids)
        else:
            return {
                "success": True,
                "data": [],
                "meta": {"page": page, "limit": limit, "total": 0, "total_pages": 0, "has_more": False},
            }

    if search:
        query = query.or_(f"fleet_number.ilike.%{search}%,description.ilike.%{search}%")

    if verified_only:
        query = query.eq("physical_verification", True)

    # Pagination
    offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)

    # Sorting
    query = query.order(sort_by, desc=(sort_order == "desc"))

    result = query.execute()
    total = result.count or 0

    return {
        "success": True,
        "data": result.data or [],
        "meta": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
            "has_more": page * limit < total,
            "columns": columns.split(",") if columns else "all",
            "filters": {
                "status": status_list,
                "condition": condition_list,
                "fleet_type": fleet_type_list,
                "location_id": str(location_id) if location_id else None,
                "state": state,
                "verified_only": verified_only,
                "unknown_location": unknown_location,
                "in_transit": in_transit,
            },
        },
    }


@router.get("/by-fleet/{fleet_number}")
async def get_plant_by_fleet(
    fleet_number: str,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get a single plant by fleet number.

    Args:
        fleet_number: The fleet number (e.g., P453, T468, E25).
        current_user: The authenticated user.

    Returns:
        Plant details with related data.
    """
    client = get_supabase_admin_client()

    # Normalize fleet number (uppercase, no extra spaces)
    normalized = " ".join(fleet_number.upper().split())

    result = (
        client.table("v_plants_summary")
        .select("*")
        .eq("fleet_number", normalized)
        .execute()
    )

    if not result.data:
        raise NotFoundError("Plant with fleet number", fleet_number)

    return {
        "success": True,
        "data": result.data[0],
    }


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

    # Prepare plant data — mode="json" converts UUIDs to strings for Supabase
    # fleet_type is auto-resolved by database trigger if not provided
    plant_data = plant.model_dump(exclude_none=True, mode="json")

    # Insert with duplicate check in one operation
    # Use upsert with ignoreDuplicates=False to get error on conflict
    try:
        result = (
            client.table("plants_master")
            .insert(plant_data)
            .execute()
        )
    except Exception as e:
        error_msg = str(e).lower()
        if "duplicate" in error_msg or "unique" in error_msg or "already exists" in error_msg:
            raise ValidationError(
                "Plant with this fleet number already exists",
                details=[{"field": "fleet_number", "message": "Already exists", "code": "DUPLICATE"}],
            )
        raise

    created = result.data[0]

    # Record initial location history if a location was provided
    if plant_data.get("current_location_id"):
        client.table("plant_location_history").insert({
            "plant_id": created["id"],
            "location_id": plant_data["current_location_id"],
            "start_date": created.get("created_at", "now()"),
            "transfer_reason": "Initial assignment",
            "created_by": current_user.id,
        }).execute()

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
        new_values=plant.model_dump(exclude_none=True, mode="json"),
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
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    description: str | None = Query(None, description="Equipment description"),
    fleet_type: str | None = Query(None, description="Fleet type (e.g., TRUCKS, EXCAVATOR)"),
    make: str | None = Query(None, description="Manufacturer (e.g., TOYOTA, CAT)"),
    model: str | None = Query(None, description="Model name/number"),
    chassis_number: str | None = Query(None, description="Chassis/VIN number"),
    year_of_manufacture: int | None = Query(None, ge=1900, le=2100, description="Year manufactured"),
    purchase_year: int | None = Query(None, ge=1900, le=2100, description="Year purchased"),
    purchase_cost: float | None = Query(None, ge=0, description="Purchase cost"),
    serial_m: str | None = Query(None, description="Mechanical serial number"),
    serial_e: str | None = Query(None, description="Electrical serial number"),
    remarks: str | None = Query(None, description="Additional remarks"),
    current_location_id: UUID | None = Query(None, description="Current location UUID"),
    status: str | None = Query(None, pattern="^(working|standby|breakdown|faulty|scrap|missing|stolen|unverified|in_transit|off_hire)$", description="Operational status"),
    condition: str | None = Query(None, pattern="^(good|faulty|needs_repair|scrap)$", description="Physical condition"),
    physical_verification: bool | None = Query(None, description="Has been physically verified"),
) -> dict[str, Any]:
    """Update an existing plant - only provide the fields you want to change.

    **Example:** To update just purchase_cost and purchase_year:
    ```
    PATCH /plants/{id}?purchase_cost=5000000&purchase_year=2023
    ```

    Args:
        plant_id: The plant UUID.
        All other parameters are optional - only provide what you want to change.

    Returns:
        Updated plant with all fields.
    """
    client = get_supabase_admin_client()

    # Build update data from provided parameters only
    update_data = {}
    if description is not None:
        update_data["description"] = description
    if fleet_type is not None:
        update_data["fleet_type"] = fleet_type
    if make is not None:
        update_data["make"] = make
    if model is not None:
        update_data["model"] = model
    if chassis_number is not None:
        update_data["chassis_number"] = chassis_number
    if year_of_manufacture is not None:
        update_data["year_of_manufacture"] = year_of_manufacture
    if purchase_year is not None:
        update_data["purchase_year"] = purchase_year
    if purchase_cost is not None:
        update_data["purchase_cost"] = purchase_cost
    if serial_m is not None:
        update_data["serial_m"] = serial_m
    if serial_e is not None:
        update_data["serial_e"] = serial_e
    if remarks is not None:
        update_data["remarks"] = remarks
    if current_location_id is not None:
        update_data["current_location_id"] = str(current_location_id)
    if status is not None:
        update_data["status"] = status
    if condition is not None:
        update_data["condition"] = condition
    if physical_verification is not None:
        update_data["physical_verification"] = physical_verification

    if not update_data:
        raise ValidationError("No fields to update. Provide at least one field.")

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

    # Return full plant data from view
    updated = (
        client.table("v_plants_summary")
        .select("*")
        .eq("id", str(plant_id))
        .single()
        .execute()
    )

    return {
        "success": True,
        "data": updated.data,
        "meta": {
            "updated_fields": [k for k in update_data.keys() if k != "updated_at"],
        },
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
    year: int | None = Query(None, description="Filter by year"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(52, ge=1, le=200, description="Items per page (default 52 = 1 year)"),
) -> dict[str, Any]:
    """Get weekly tracking records for a plant.

    Shows where the plant was reported each week.

    Args:
        plant_id: The plant UUID.
        current_user: The authenticated user.
        year: Filter by year.
        page: Page number.
        limit: Items per page (default 52 = 1 year).

    Returns:
        Paginated list of weekly records with location info.
    """
    client = get_supabase_admin_client()

    query = (
        client.table("plant_weekly_records")
        .select("*, locations!plant_weekly_records_location_id_fkey(name)", count="exact")
        .eq("plant_id", str(plant_id))
    )

    if year:
        query = query.eq("year", year)

    # Apply ordering and pagination
    offset = (page - 1) * limit
    query = query.order("year", desc=True).order("week_number", desc=True)
    query = query.range(offset, offset + limit - 1)

    try:
        result = query.execute()
        total = result.count or 0

        # Transform to include location name
        records = []
        for item in result.data or []:
            # Handle locations which may be a dict or None
            locations = item.get("locations")
            if isinstance(locations, dict):
                item["location_name"] = locations.get("name")
            else:
                item["location_name"] = None

            # Remove embedded relation from response
            if "locations" in item:
                del item["locations"]

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
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch weekly records: {str(e)}")


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
