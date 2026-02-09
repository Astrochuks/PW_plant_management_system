"""Spare parts management endpoints."""

from datetime import date
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
async def list_spare_parts(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    plant_id: UUID | None = None,
    fleet_number: str | None = None,
    supplier: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
) -> dict[str, Any]:
    """List spare parts with filtering and pagination.

    Args:
        current_user: The authenticated user.
        page: Page number.
        limit: Items per page.
        plant_id: Filter by plant.
        fleet_number: Filter by fleet number.
        supplier: Filter by supplier name.
        date_from: Filter by date range start.
        date_to: Filter by date range end.
        search: Search in part description.

    Returns:
        Paginated list of spare parts.
    """
    client = get_supabase_admin_client()

    # Use a view that includes plant info
    query = (
        client.table("spare_parts")
        .select("*, plants_master(fleet_number, description)", count="exact")
    )

    # Apply filters
    if plant_id:
        query = query.eq("plant_id", str(plant_id))

    if fleet_number:
        # Use the Supabase join filter to avoid a separate query
        query = query.eq("plants_master.fleet_number", fleet_number.upper())

    if supplier:
        query = query.ilike("supplier", f"%{supplier}%")

    if date_from:
        query = query.gte("replaced_date", str(date_from))

    if date_to:
        query = query.lte("replaced_date", str(date_to))

    if search:
        query = query.or_(f"part_description.ilike.%{search}%,part_number.ilike.%{search}%")

    # Pagination
    offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)
    query = query.order("replaced_date", desc=True)

    result = query.execute()
    total = result.count or 0

    # Transform data to include fleet_number
    parts = []
    for item in result.data:
        item["fleet_number"] = item.get("plants_master", {}).get("fleet_number") if item.get("plants_master") else None
        item["plant_description"] = item.get("plants_master", {}).get("description") if item.get("plants_master") else None
        item["supplier_name"] = item.get("supplier")  # supplier is stored as text, not FK
        if "plants_master" in item:
            del item["plants_master"]
        parts.append(item)

    return {
        "success": True,
        "data": parts,
        "meta": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        },
    }


@router.get("/stats")
async def get_spare_parts_stats(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    location_id: UUID | None = None,
) -> dict[str, Any]:
    """Get spare parts statistics.

    Args:
        current_user: The authenticated user.
        year: Filter by year.
        location_id: Filter by plant location.

    Returns:
        Aggregate statistics for spare parts.
    """
    client = get_supabase_admin_client()

    # Get overall stats
    result = client.rpc(
        "get_spare_parts_stats",
        {
            "p_year": year,
            "p_location_id": str(location_id) if location_id else None,
        },
    ).execute()

    return {
        "success": True,
        "data": result.data[0] if result.data else {},
    }


@router.get("/top-suppliers")
async def get_top_suppliers(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    limit: int = Query(10, ge=1, le=50),
    year: int | None = None,
) -> dict[str, Any]:
    """Get top suppliers by total spend.

    Args:
        current_user: The authenticated user.
        limit: Number of suppliers to return.
        year: Filter by year.

    Returns:
        List of top suppliers with spend amounts.
    """
    client = get_supabase_admin_client()

    result = client.rpc(
        "get_top_suppliers",
        {"p_limit": limit, "p_year": year},
    ).execute()

    return {
        "success": True,
        "data": result.data,
    }


@router.get("/high-cost-plants")
async def get_high_cost_plants(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    limit: int = Query(10, ge=1, le=50),
    year: int | None = None,
) -> dict[str, Any]:
    """Get plants with highest maintenance costs.

    Args:
        current_user: The authenticated user.
        limit: Number of plants to return.
        year: Filter by year.

    Returns:
        List of plants ranked by maintenance cost.
    """
    client = get_supabase_admin_client()

    result = client.rpc(
        "get_high_cost_plants",
        {"p_limit": limit, "p_year": year},
    ).execute()

    return {
        "success": True,
        "data": result.data,
    }


@router.get("/{part_id}")
async def get_spare_part(
    part_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get a single spare part by ID.

    Args:
        part_id: The spare part UUID.
        current_user: The authenticated user.

    Returns:
        Spare part details.
    """
    client = get_supabase_admin_client()

    result = (
        client.table("spare_parts")
        .select("*, plants_master(fleet_number, description)")
        .eq("id", str(part_id))
        .single()
        .execute()
    )

    if not result.data:
        raise NotFoundError("Spare part", str(part_id))

    # Transform data
    data = result.data
    data["fleet_number"] = data.get("plants_master", {}).get("fleet_number") if data.get("plants_master") else None
    data["plant_description"] = data.get("plants_master", {}).get("description") if data.get("plants_master") else None
    data["supplier_name"] = data.get("supplier")  # supplier is stored as text, not FK
    if "plants_master" in data:
        del data["plants_master"]

    return {
        "success": True,
        "data": data,
    }


@router.post("", status_code=201)
async def create_spare_part(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    plant_id: UUID | None = Query(None, description="Plant UUID (required unless fleet_number provided)"),
    fleet_number: str | None = Query(None, description="Fleet number (alternative to plant_id)"),
    part_description: str = Query(..., description="Description of the part/item"),
    replaced_date: date | None = Query(None, description="Date part was used/replaced"),
    part_number: str | None = None,
    supplier: str | None = Query(None, description="Vendor/supplier name"),
    reason_for_change: str | None = None,
    unit_cost: float | None = None,
    quantity: int = 1,
    vat_percentage: float = Query(default=0, ge=0, le=100, description="VAT percentage (0-100)"),
    discount_percentage: float = Query(default=0, ge=0, le=100, description="Discount percentage (0-100)"),
    other_costs: float = Query(default=0, ge=0, description="Additional costs (shipping, handling, etc.)"),
    purchase_order_number: str | None = Query(None, description="PO number from document"),
    po_date: date | None = Query(None, description="Date on the PO document"),
    requisition_number: str | None = Query(None, description="REQ NO from PO (e.g., ABJ 340888)"),
    location_id: UUID | None = Query(None, description="Location/site UUID"),
    remarks: str | None = None,
) -> dict[str, Any]:
    """Create a new spare part / PO line item record.

    This is the main endpoint for entering PO data. Each call creates one line item.
    For a PO with multiple items, call this endpoint multiple times with the same PO number.

    Total cost is auto-calculated as: (unit_cost × quantity × (1 + VAT%) × (1 - discount%)) + other_costs

    You can provide either plant_id OR fleet_number. If fleet_number is provided,
    the system will look up the plant_id automatically.

    Args:
        plant_id: The plant UUID (use this OR fleet_number).
        fleet_number: Fleet number string (alternative to plant_id).
        part_description: Description of the part/item.
        replaced_date: Date the part was replaced/used.
        part_number: Part number if known.
        supplier: Vendor/supplier name.
        reason_for_change: Why the part was replaced.
        unit_cost: Cost per unit.
        quantity: Number of parts.
        vat_percentage: VAT percentage (0-100).
        discount_percentage: Discount percentage (0-100).
        other_costs: Additional costs (shipping, handling, etc.).
        purchase_order_number: PO number from the document.
        po_date: Date on the PO document.
        requisition_number: REQ NO (e.g., ABJ 340888, KWO 12345).
        location_id: Location/site UUID.
        remarks: Additional notes.

    Returns:
        Created spare part with ID and calculated total_cost.
    """
    client = get_supabase_admin_client()

    # Resolve plant_id from fleet_number if needed
    resolved_plant_id = None
    resolved_fleet_number = None

    if plant_id:
        # Verify plant exists
        plant = (
            client.table("plants_master")
            .select("id, fleet_number")
            .eq("id", str(plant_id))
            .single()
            .execute()
        )
        if not plant.data:
            raise NotFoundError("Plant", str(plant_id))
        resolved_plant_id = str(plant_id)
        resolved_fleet_number = plant.data["fleet_number"]

    elif fleet_number:
        # Look up plant by fleet number
        plant = (
            client.table("plants_master")
            .select("id, fleet_number")
            .eq("fleet_number", fleet_number.upper())
            .execute()
        )
        if plant.data:
            resolved_plant_id = plant.data[0]["id"]
            resolved_fleet_number = plant.data[0]["fleet_number"]
        else:
            raise NotFoundError("Plant with fleet number", fleet_number.upper())

    else:
        raise ValidationError(
            "Either plant_id or fleet_number is required",
            details=[{"field": "plant_id", "message": "Required", "code": "REQUIRED"}],
        )

    # Calculate time dimensions from po_date if provided
    year = None
    month = None
    week_number = None
    quarter = None
    if po_date:
        year = po_date.year
        month = po_date.month
        week_number = po_date.isocalendar()[1]
        quarter = (month - 1) // 3 + 1

    # Create spare part
    part_data = {
        "plant_id": resolved_plant_id,
        "part_description": part_description,
        "replaced_date": str(replaced_date) if replaced_date else str(po_date) if po_date else None,
        "part_number": part_number,
        "supplier": supplier,
        "reason_for_change": reason_for_change,
        "unit_cost": unit_cost,
        "quantity": quantity,
        "vat_percentage": vat_percentage,
        "discount_percentage": discount_percentage,
        "other_costs": other_costs,
        "purchase_order_number": purchase_order_number.upper() if purchase_order_number else None,
        "po_date": str(po_date) if po_date else None,
        "requisition_number": requisition_number.upper() if requisition_number else None,
        "location_id": str(location_id) if location_id else None,
        "year": year,
        "month": month,
        "week_number": week_number,
        "quarter": quarter,
        "remarks": remarks,
        "created_by": current_user.id,
    }

    result = (
        client.table("spare_parts")
        .insert(part_data)
        .execute()
    )

    created = result.data[0]

    logger.info(
        "Spare part created",
        part_id=created["id"],
        plant_id=resolved_plant_id,
        fleet_number=resolved_fleet_number,
        po_number=purchase_order_number,
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="create",
        table_name="spare_parts",
        record_id=created["id"],
        new_values=part_data,
        ip_address=get_client_ip(request),
        description=f"Created spare part for {resolved_fleet_number}: {part_description}",
    )

    return {
        "success": True,
        "data": {
            **created,
            "fleet_number": resolved_fleet_number,
        },
    }


@router.post("/bulk", status_code=201)
async def create_spare_parts_bulk(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    fleet_number: str = Query(..., description="Fleet number for all items"),
    purchase_order_number: str = Query(..., description="PO number for all items"),
    po_date: date | None = Query(None, description="PO date"),
    requisition_number: str | None = Query(None, description="REQ NO"),
    location_id: UUID | None = Query(None, description="Location UUID"),
    supplier: str | None = Query(None, description="Vendor name"),
    vat_percentage: float = Query(default=0, ge=0, le=100),
    discount_percentage: float = Query(default=0, ge=0, le=100),
    items: str = Query(..., description="JSON array of items: [{description, quantity, unit_cost, part_number?}]"),
) -> dict[str, Any]:
    """Create multiple spare parts / PO line items at once.

    Use this when entering a PO with multiple line items for a single plant.
    All items share the same PO number, plant, location, and financial terms.

    Args:
        fleet_number: Fleet number (the plant this PO is for).
        purchase_order_number: PO number from document.
        po_date: Date on the PO.
        requisition_number: REQ NO.
        location_id: Location UUID.
        supplier: Vendor name.
        vat_percentage: VAT % (applied to all items).
        discount_percentage: Discount % (applied to all items).
        items: JSON array of line items, each with:
            - description (required): Part description
            - quantity (optional, default 1): Quantity
            - unit_cost (optional): Unit cost
            - part_number (optional): Part number

    Example items parameter:
        [{"description": "Filter", "quantity": 2, "unit_cost": 5000},
         {"description": "Seal Kit", "quantity": 1, "unit_cost": 15000}]

    Returns:
        Created spare parts with total cost.
    """
    import json

    client = get_supabase_admin_client()

    # Parse items JSON
    try:
        items_list = json.loads(items)
        if not isinstance(items_list, list) or not items_list:
            raise ValidationError("items must be a non-empty JSON array")
    except json.JSONDecodeError as e:
        raise ValidationError(f"Invalid JSON in items parameter: {str(e)}")

    # Look up plant by fleet number
    plant = (
        client.table("plants_master")
        .select("id, fleet_number")
        .eq("fleet_number", fleet_number.upper())
        .execute()
    )

    if not plant.data:
        raise NotFoundError("Plant with fleet number", fleet_number.upper())

    plant_id = plant.data[0]["id"]
    resolved_fleet_number = plant.data[0]["fleet_number"]

    # Calculate time dimensions
    year = po_date.year if po_date else None
    month = po_date.month if po_date else None
    week_number = po_date.isocalendar()[1] if po_date else None
    quarter = (month - 1) // 3 + 1 if month else None

    # Create all spare parts
    created_parts = []
    total_cost = 0

    for item in items_list:
        if not item.get("description"):
            continue  # Skip items without description

        part_data = {
            "plant_id": plant_id,
            "part_description": item["description"],
            "part_number": item.get("part_number"),
            "quantity": item.get("quantity", 1),
            "unit_cost": item.get("unit_cost"),
            "purchase_order_number": purchase_order_number.upper(),
            "po_date": str(po_date) if po_date else None,
            "replaced_date": str(po_date) if po_date else None,
            "requisition_number": requisition_number.upper() if requisition_number else None,
            "location_id": str(location_id) if location_id else None,
            "supplier": supplier,
            "vat_percentage": vat_percentage,
            "discount_percentage": discount_percentage,
            "year": year,
            "month": month,
            "week_number": week_number,
            "quarter": quarter,
            "created_by": current_user.id,
        }

        result = client.table("spare_parts").insert(part_data).execute()
        created = result.data[0]
        created_parts.append(created)
        total_cost += float(created.get("total_cost") or 0)

    logger.info(
        "Bulk spare parts created",
        count=len(created_parts),
        fleet_number=resolved_fleet_number,
        po_number=purchase_order_number,
        total_cost=total_cost,
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="create",
        table_name="spare_parts",
        record_id=purchase_order_number.upper(),
        new_values={
            "po_number": purchase_order_number,
            "fleet_number": resolved_fleet_number,
            "items_count": len(created_parts),
            "total_cost": total_cost,
        },
        ip_address=get_client_ip(request),
        description=f"Bulk created {len(created_parts)} items for {resolved_fleet_number} from PO {purchase_order_number}",
    )

    return {
        "success": True,
        "data": created_parts,
        "meta": {
            "items_created": len(created_parts),
            "total_cost": round(total_cost, 2),
            "fleet_number": resolved_fleet_number,
            "po_number": purchase_order_number.upper(),
        },
    }


@router.get("/by-po/{po_number}")
async def get_spare_parts_by_po(
    po_number: str,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get all spare parts for a specific PO number.

    Use this to view all line items entered for a PO.

    Args:
        po_number: The purchase order number.

    Returns:
        List of spare parts with plant info and totals.
    """
    client = get_supabase_admin_client()

    result = (
        client.table("spare_parts")
        .select("*, plants_master(fleet_number, description)")
        .ilike("purchase_order_number", po_number)
        .order("created_at")
        .execute()
    )

    parts = []
    total_cost = 0
    for item in result.data or []:
        plant_info = item.pop("plants_master", {}) or {}
        item["fleet_number"] = plant_info.get("fleet_number")
        item["plant_description"] = plant_info.get("description")
        parts.append(item)
        total_cost += float(item.get("total_cost") or 0)

    return {
        "success": True,
        "data": parts,
        "meta": {
            "po_number": po_number.upper(),
            "items_count": len(parts),
            "total_cost": round(total_cost, 2),
            "distinct_plants": len(set(p.get("plant_id") for p in parts if p.get("plant_id"))),
        },
    }


@router.patch("/{part_id}")
async def update_spare_part(
    part_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    part_description: str | None = None,
    replaced_date: date | None = None,
    part_number: str | None = None,
    supplier: str | None = None,
    reason_for_change: str | None = None,
    unit_cost: float | None = None,
    quantity: int | None = None,
    vat_percentage: float | None = Query(default=None, ge=0, le=100, description="VAT percentage (0-100)"),
    discount_percentage: float | None = Query(default=None, ge=0, le=100, description="Discount percentage (0-100)"),
    other_costs: float | None = Query(default=None, ge=0, description="Additional costs"),
    purchase_order_number: str | None = None,
    remarks: str | None = None,
) -> dict[str, Any]:
    """Update an existing spare part.

    Total cost is auto-calculated as: (unit_cost × quantity × (1 + VAT%) × (1 - discount%)) + other_costs

    Args:
        part_id: The spare part UUID.
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.
        All other args are optional fields to update.

    Returns:
        Updated spare part with recalculated total_cost.
    """
    client = get_supabase_admin_client()

    # Build update data first to know which fields to fetch
    update_data = {}
    if part_description is not None:
        update_data["part_description"] = part_description
    if replaced_date is not None:
        update_data["replaced_date"] = str(replaced_date)
    if part_number is not None:
        update_data["part_number"] = part_number
    if supplier is not None:
        update_data["supplier"] = supplier
    if reason_for_change is not None:
        update_data["reason_for_change"] = reason_for_change
    if unit_cost is not None:
        update_data["unit_cost"] = unit_cost
    if quantity is not None:
        update_data["quantity"] = quantity
    if vat_percentage is not None:
        update_data["vat_percentage"] = vat_percentage
    if discount_percentage is not None:
        update_data["discount_percentage"] = discount_percentage
    if other_costs is not None:
        update_data["other_costs"] = other_costs
    if purchase_order_number is not None:
        update_data["purchase_order_number"] = purchase_order_number
    if remarks is not None:
        update_data["remarks"] = remarks

    if not update_data:
        raise ValidationError("No fields to update")

    # Fetch current values for fields being changed (for audit diff)
    fields_to_fetch = ",".join(["id", "part_description"] + list(update_data.keys()))
    existing = (
        client.table("spare_parts")
        .select(fields_to_fetch)
        .eq("id", str(part_id))
        .execute()
    )

    if not existing.data:
        raise NotFoundError("Spare part", str(part_id))

    old_record = existing.data[0]
    old_values = {k: old_record.get(k) for k in update_data if k in old_record}

    # updated_at is auto-set by trigger

    result = (
        client.table("spare_parts")
        .update(update_data)
        .eq("id", str(part_id))
        .execute()
    )

    logger.info(
        "Spare part updated",
        part_id=str(part_id),
        updated_fields=list(update_data.keys()),
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="update",
        table_name="spare_parts",
        record_id=str(part_id),
        old_values=old_values,
        new_values=update_data,
        ip_address=get_client_ip(request),
        description=f"Updated spare part {old_record.get('part_description', str(part_id))}: {', '.join(update_data.keys())}",
    )

    return {
        "success": True,
        "data": result.data[0],
    }


@router.delete("/{part_id}")
async def delete_spare_part(
    part_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Delete a spare part record.

    Args:
        part_id: The spare part UUID.
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.

    Returns:
        Success message.
    """
    client = get_supabase_admin_client()

    # Capture full record before deletion for audit trail
    existing = (
        client.table("spare_parts")
        .select("*")
        .eq("id", str(part_id))
        .single()
        .execute()
    )

    if not existing.data:
        raise NotFoundError("Spare part", str(part_id))

    deleted_record = existing.data

    # Delete part
    client.table("spare_parts").delete().eq("id", str(part_id)).execute()

    logger.info(
        "Spare part deleted",
        part_id=str(part_id),
        plant_id=deleted_record["plant_id"],
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="delete",
        table_name="spare_parts",
        record_id=str(part_id),
        old_values=deleted_record,
        ip_address=get_client_ip(request),
        description=f"Deleted spare part {deleted_record.get('part_description', str(part_id))}",
    )

    return {
        "success": True,
        "message": "Spare part deleted successfully",
    }
