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
        .select("*, plants(fleet_number, description)", count="exact")
    )

    # Apply filters
    if plant_id:
        query = query.eq("plant_id", str(plant_id))

    if fleet_number:
        # Need to filter by related plant's fleet_number
        plant = client.table("plants").select("id").eq("fleet_number", fleet_number.upper()).execute()
        if plant.data:
            query = query.eq("plant_id", plant.data[0]["id"])
        else:
            # Return empty if plant not found
            return {
                "success": True,
                "data": [],
                "meta": {"page": page, "limit": limit, "total": 0, "total_pages": 0},
            }

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
        item["fleet_number"] = item.get("plants", {}).get("fleet_number") if item.get("plants") else None
        item["plant_description"] = item.get("plants", {}).get("description") if item.get("plants") else None
        item["supplier_name"] = item.get("supplier")  # supplier is stored as text, not FK
        if "plants" in item:
            del item["plants"]
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
        .select("*, plants(fleet_number, description)")
        .eq("id", str(part_id))
        .single()
        .execute()
    )

    if not result.data:
        raise NotFoundError("Spare part", str(part_id))

    # Transform data
    data = result.data
    data["fleet_number"] = data.get("plants", {}).get("fleet_number") if data.get("plants") else None
    data["plant_description"] = data.get("plants", {}).get("description") if data.get("plants") else None
    data["supplier_name"] = data.get("supplier")  # supplier is stored as text, not FK
    if "plants" in data:
        del data["plants"]

    return {
        "success": True,
        "data": data,
    }


@router.post("", status_code=201)
async def create_spare_part(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    plant_id: UUID,
    part_description: str,
    replaced_date: date | None = None,
    part_number: str | None = None,
    supplier: str | None = None,
    reason_for_change: str | None = None,
    unit_cost: float | None = None,
    quantity: int = 1,
    vat_percentage: float = Query(default=0, ge=0, le=100, description="VAT percentage (0-100)"),
    discount_percentage: float = Query(default=0, ge=0, le=100, description="Discount percentage (0-100)"),
    other_costs: float = Query(default=0, ge=0, description="Additional costs (shipping, handling, etc.)"),
    purchase_order_number: str | None = None,
    remarks: str | None = None,
) -> dict[str, Any]:
    """Create a new spare part record.

    Total cost is auto-calculated as: (unit_cost × quantity × (1 + VAT%) × (1 - discount%)) + other_costs

    Args:
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.
        plant_id: The plant this part belongs to.
        part_description: Description of the part.
        replaced_date: Date the part was replaced.
        part_number: Part number.
        supplier: Supplier name.
        reason_for_change: Why the part was replaced.
        unit_cost: Cost per unit.
        quantity: Number of parts.
        vat_percentage: VAT percentage (0-100).
        discount_percentage: Discount percentage (0-100).
        other_costs: Additional costs (shipping, handling, etc.).
        purchase_order_number: PO number.
        remarks: Additional notes.

    Returns:
        Created spare part with ID and calculated total_cost.
    """
    client = get_supabase_admin_client()

    # Verify plant exists
    plant = (
        client.table("plants")
        .select("id, fleet_number")
        .eq("id", str(plant_id))
        .single()
        .execute()
    )

    if not plant.data:
        raise NotFoundError("Plant", str(plant_id))

    # Create spare part
    part_data = {
        "plant_id": str(plant_id),
        "part_description": part_description,
        "replaced_date": str(replaced_date) if replaced_date else None,
        "part_number": part_number,
        "supplier": supplier,
        "reason_for_change": reason_for_change,
        "unit_cost": unit_cost,
        "quantity": quantity,
        "vat_percentage": vat_percentage,
        "discount_percentage": discount_percentage,
        "other_costs": other_costs,
        "purchase_order_number": purchase_order_number,
        "remarks": remarks,
        "created_by": current_user.id,
    }

    result = (
        client.table("spare_parts")
        .insert(part_data)
        .execute()
    )

    created = result.data[0]
    fleet_number = plant.data["fleet_number"]

    logger.info(
        "Spare part created",
        part_id=created["id"],
        plant_id=str(plant_id),
        fleet_number=fleet_number,
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
        description=f"Created spare part for plant {fleet_number}: {part_description}",
    )

    return {
        "success": True,
        "data": created,
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
