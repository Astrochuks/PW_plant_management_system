"""Purchase order management endpoints."""

from datetime import date
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Query, Request, UploadFile

from app.api.v1.auth import get_client_ip
from app.config import get_settings
from app.core.database import get_supabase_admin_client
from app.core.exceptions import NotFoundError, ValidationError
from app.core.security import (
    CurrentUser,
    require_admin,
    require_management_or_admin,
)
from app.monitoring.logging import get_logger
from app.services.audit_service import audit_service
from app.services.fleet_parser import (
    parse_fleet_input,
    resolve_location_from_req_no,
    get_cost_classification,
)

router = APIRouter()
logger = get_logger(__name__)


# Valid file extensions for PO document attachments
ALLOWED_PO_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".xlsx", ".xls"}


@router.get("")
async def list_purchase_orders(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    location_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    vendor: str | None = None,
    search: str | None = None,
    cost_type: str | None = Query(None, pattern="^(direct|shared)$"),
) -> dict[str, Any]:
    """List purchase orders with filtering and pagination.

    Args:
        current_user: The authenticated user.
        page: Page number.
        limit: Items per page.
        location_id: Filter by location.
        date_from: Filter by date range start.
        date_to: Filter by date range end.
        vendor: Filter by vendor name.
        search: Search in PO number or vendor.
        cost_type: Filter by cost classification (direct/shared).

    Returns:
        Paginated list of purchase orders.
    """
    client = get_supabase_admin_client()

    query = (
        client.table("v_purchase_order_costs")
        .select("*", count="exact")
    )

    if location_id:
        query = query.eq("location_id", str(location_id))

    if date_from:
        query = query.gte("po_date", str(date_from))

    if date_to:
        query = query.lte("po_date", str(date_to))

    if vendor:
        query = query.ilike("vendor", f"%{vendor}%")

    if search:
        query = query.or_(f"po_number.ilike.%{search}%,vendor.ilike.%{search}%")

    if cost_type:
        query = query.eq("cost_type", cost_type)

    offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)
    query = query.order("po_date", desc=True)

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


@router.get("/stats")
async def get_purchase_order_stats(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    location_id: UUID | None = None,
) -> dict[str, Any]:
    """Get purchase order statistics.

    Args:
        current_user: The authenticated user.
        year: Filter by year.
        location_id: Filter by location.

    Returns:
        Aggregate statistics for purchase orders.
    """
    client = get_supabase_admin_client()

    # Get overall stats
    query = client.table("v_purchase_order_costs").select("*")

    if year:
        query = query.eq("year", year)

    if location_id:
        query = query.eq("location_id", str(location_id))

    result = query.execute()
    data = result.data or []

    total_amount = sum(float(po.get("total_amount") or 0) for po in data)
    direct_costs = sum(
        float(po.get("total_amount") or 0)
        for po in data
        if po.get("cost_type") == "direct"
    )
    shared_costs = sum(
        float(po.get("total_amount") or 0)
        for po in data
        if po.get("cost_type") == "shared"
    )

    return {
        "success": True,
        "data": {
            "total_pos": len(data),
            "total_amount": total_amount,
            "direct_costs": direct_costs,
            "shared_costs": shared_costs,
            "direct_count": sum(1 for po in data if po.get("cost_type") == "direct"),
            "shared_count": sum(1 for po in data if po.get("cost_type") == "shared"),
        },
    }


@router.get("/plant/{plant_id}/costs")
async def get_plant_costs(
    plant_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    period: str | None = Query(None, pattern="^(week|month|quarter|year|all)$"),
    period_value: int | None = Query(None, description="Week/month/quarter number"),
) -> dict[str, Any]:
    """Get maintenance costs for a specific plant.

    Returns both:
    - Direct costs: POs that are exclusively for this plant
    - Shared costs: POs that include this plant along with others (shown as contribution)

    Args:
        plant_id: The plant UUID.
        current_user: The authenticated user.
        year: Filter by year.
        period: Time period type (week, month, quarter, year, all).
        period_value: Specific period number (e.g., week 5, month 3).

    Returns:
        Cost breakdown for the plant.
    """
    client = get_supabase_admin_client()

    # Verify plant exists
    plant_result = (
        client.table("plants_master")
        .select("id, fleet_number, fleet_type, description")
        .eq("id", str(plant_id))
        .single()
        .execute()
    )

    if not plant_result.data:
        raise NotFoundError("Plant", str(plant_id))

    plant = plant_result.data

    # Get all POs associated with this plant
    fleet_query = (
        client.table("purchase_order_fleets")
        .select("purchase_order_id")
        .eq("plant_id", str(plant_id))
    )
    fleet_result = fleet_query.execute()
    po_ids = [f["purchase_order_id"] for f in fleet_result.data] if fleet_result.data else []

    if not po_ids:
        return {
            "success": True,
            "data": {
                "plant": plant,
                "costs": {
                    "direct_total": 0,
                    "shared_total": 0,
                    "shared_contribution": 0,
                    "grand_total": 0,
                },
                "purchase_orders": [],
            },
            "meta": {
                "year": year,
                "period": period,
                "period_value": period_value,
                "po_count": 0,
            },
        }

    # Get PO details with cost classification
    po_query = (
        client.table("v_purchase_order_costs")
        .select("*")
        .in_("id", po_ids)
    )

    if year:
        po_query = po_query.eq("year", year)

    if period == "week" and period_value:
        po_query = po_query.eq("week_number", period_value)
    elif period == "month" and period_value:
        po_query = po_query.eq("month", period_value)
    elif period == "quarter" and period_value:
        po_query = po_query.eq("quarter", period_value)

    po_query = po_query.order("po_date", desc=True)
    po_result = po_query.execute()
    pos = po_result.data or []

    # Calculate costs
    direct_total = 0.0
    shared_total = 0.0
    shared_contribution = 0.0

    enriched_pos = []
    for po in pos:
        amount = float(po.get("total_amount") or 0)
        plant_count = int(po.get("plant_count") or 1)
        cost_type = po.get("cost_type", "shared")

        if cost_type == "direct":
            direct_total += amount
            contribution = amount
        else:
            shared_total += amount
            # Calculate this plant's share (equal split)
            contribution = amount / plant_count if plant_count > 0 else 0
            shared_contribution += contribution

        enriched_pos.append({
            **po,
            "contribution": round(contribution, 2),
            "plant_share": f"1/{plant_count}" if plant_count > 1 else "100%",
        })

    grand_total = direct_total + shared_contribution

    return {
        "success": True,
        "data": {
            "plant": plant,
            "costs": {
                "direct_total": round(direct_total, 2),
                "shared_total": round(shared_total, 2),
                "shared_contribution": round(shared_contribution, 2),
                "grand_total": round(grand_total, 2),
            },
            "purchase_orders": enriched_pos,
        },
        "meta": {
            "year": year,
            "period": period,
            "period_value": period_value,
            "po_count": len(pos),
            "direct_count": sum(1 for po in pos if po.get("cost_type") == "direct"),
            "shared_count": sum(1 for po in pos if po.get("cost_type") == "shared"),
        },
    }


@router.get("/location/{location_id}/costs")
async def get_location_costs(
    location_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    period: str | None = Query(None, pattern="^(week|month|quarter|year|all)$"),
    period_value: int | None = Query(None, description="Week/month/quarter number"),
    include_workshop: bool = Query(True, description="Include workshop/general costs"),
) -> dict[str, Any]:
    """Get maintenance costs for a specific location/site.

    Returns:
    - Direct costs: POs for single plants at this location
    - Shared costs: Multi-fleet POs
    - Workshop costs: General/workshop costs for the site

    Args:
        location_id: The location UUID.
        current_user: The authenticated user.
        year: Filter by year.
        period: Time period type.
        period_value: Specific period number.
        include_workshop: Include workshop/general costs.

    Returns:
        Cost breakdown for the location.
    """
    client = get_supabase_admin_client()

    # Verify location exists
    location_result = (
        client.table("locations")
        .select("id, name")
        .eq("id", str(location_id))
        .single()
        .execute()
    )

    if not location_result.data:
        raise NotFoundError("Location", str(location_id))

    location = location_result.data

    # Get POs for this location
    po_query = (
        client.table("v_purchase_order_costs")
        .select("*")
        .eq("location_id", str(location_id))
    )

    if year:
        po_query = po_query.eq("year", year)

    if period == "week" and period_value:
        po_query = po_query.eq("week_number", period_value)
    elif period == "month" and period_value:
        po_query = po_query.eq("month", period_value)
    elif period == "quarter" and period_value:
        po_query = po_query.eq("quarter", period_value)

    po_query = po_query.order("po_date", desc=True)
    po_result = po_query.execute()
    pos = po_result.data or []

    # Calculate costs
    direct_total = 0.0
    shared_total = 0.0
    workshop_total = 0.0

    for po in pos:
        amount = float(po.get("total_amount") or 0)
        cost_type = po.get("cost_type", "shared")
        has_workshop = po.get("has_workshop", False)

        if has_workshop and include_workshop:
            workshop_total += amount
        elif cost_type == "direct":
            direct_total += amount
        else:
            shared_total += amount

    grand_total = direct_total + shared_total + (workshop_total if include_workshop else 0)

    # Group by month for trend
    monthly_trend = {}
    for po in pos:
        month = po.get("month")
        yr = po.get("year")
        if month and yr:
            key = f"{yr}-{month:02d}"
            if key not in monthly_trend:
                monthly_trend[key] = {"direct": 0, "shared": 0, "workshop": 0}
            amount = float(po.get("total_amount") or 0)
            cost_type = po.get("cost_type", "shared")
            has_workshop = po.get("has_workshop", False)
            if has_workshop:
                monthly_trend[key]["workshop"] += amount
            elif cost_type == "direct":
                monthly_trend[key]["direct"] += amount
            else:
                monthly_trend[key]["shared"] += amount

    return {
        "success": True,
        "data": {
            "location": location,
            "costs": {
                "direct_total": round(direct_total, 2),
                "shared_total": round(shared_total, 2),
                "workshop_total": round(workshop_total, 2),
                "grand_total": round(grand_total, 2),
            },
            "monthly_trend": [
                {"month": k, **v} for k, v in sorted(monthly_trend.items())
            ],
        },
        "meta": {
            "year": year,
            "period": period,
            "period_value": period_value,
            "po_count": len(pos),
            "include_workshop": include_workshop,
        },
    }


@router.get("/combined-costs")
async def get_combined_maintenance_costs(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    location_id: UUID | None = None,
    group_by: str = Query("month", pattern="^(month|year|location)$"),
) -> dict[str, Any]:
    """Get combined maintenance costs from spare_parts and purchase_orders.

    This endpoint provides a unified view of all maintenance costs,
    distinguishing between direct (single-plant) and shared (multi-fleet) costs.

    Args:
        current_user: The authenticated user.
        year: Filter by year.
        location_id: Filter by location.
        group_by: Grouping dimension (month, year, location).

    Returns:
        Combined maintenance costs grouped by specified dimension.
    """
    client = get_supabase_admin_client()

    result = client.rpc(
        "get_maintenance_costs_combined",
        {
            "p_year": year,
            "p_location_id": str(location_id) if location_id else None,
            "p_group_by": group_by,
        },
    ).execute()

    # Calculate totals
    totals = {
        "direct_costs": sum(float(row.get("direct_costs") or 0) for row in result.data),
        "shared_costs": sum(float(row.get("shared_costs") or 0) for row in result.data),
        "total_costs": sum(float(row.get("total_costs") or 0) for row in result.data),
    }

    return {
        "success": True,
        "data": result.data,
        "meta": {
            "group_by": group_by,
            "year": year,
            "totals": totals,
        },
    }


@router.get("/{po_id}")
async def get_purchase_order(
    po_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get a single purchase order with items and fleet associations.

    Args:
        po_id: The purchase order UUID.
        current_user: The authenticated user.

    Returns:
        Purchase order details with items and fleets.
    """
    client = get_supabase_admin_client()

    # Get PO header
    po_result = (
        client.table("purchase_orders")
        .select("*, locations(name)")
        .eq("id", str(po_id))
        .single()
        .execute()
    )

    if not po_result.data:
        raise NotFoundError("Purchase order", str(po_id))

    po = po_result.data
    po["location_name"] = po.get("locations", {}).get("name") if po.get("locations") else None
    po.pop("locations", None)

    # Get line items
    items_result = (
        client.table("purchase_order_items")
        .select("*")
        .eq("purchase_order_id", str(po_id))
        .order("created_at")
        .execute()
    )

    # Get fleet associations
    fleets_result = (
        client.table("purchase_order_fleets")
        .select("*, plants_master(fleet_number, description, fleet_type)")
        .eq("purchase_order_id", str(po_id))
        .order("created_at")
        .execute()
    )

    # Transform fleet data
    fleets = []
    for f in fleets_result.data:
        fleet = {
            "id": f["id"],
            "fleet_number_raw": f["fleet_number_raw"],
            "plant_id": f["plant_id"],
            "fleet_type": f["fleet_type"],
            "is_workshop": f["is_workshop"],
            "is_resolved": f["is_resolved"],
        }
        if f.get("plants_master"):
            fleet["plant_fleet_number"] = f["plants_master"].get("fleet_number")
            fleet["plant_description"] = f["plants_master"].get("description")
            fleet["plant_fleet_type"] = f["plants_master"].get("fleet_type")
        fleets.append(fleet)

    # Determine cost type
    cost_type = get_cost_classification(fleets)

    return {
        "success": True,
        "data": {
            **po,
            "items": items_result.data,
            "fleets": fleets,
            "cost_type": cost_type,
        },
    }


@router.post("/manual", status_code=201)
async def create_manual_purchase_order(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    po_number: str = Form(...),
    po_date: date | None = Form(None),
    vendor: str | None = Form(None),
    vendor_address: str | None = Form(None),
    req_no: str | None = Form(None),
    location_id: UUID | None = Form(None),
    subtotal: float | None = Form(None),
    discount_percentage: float = Form(default=0, ge=0, le=100),
    vat_percentage: float = Form(default=0, ge=0, le=100),
    other_costs: float = Form(default=0, ge=0),
    total_amount: float | None = Form(None),
    notes: str | None = Form(None),
    fleet_numbers: str | None = Form(None, description="Comma-separated fleet numbers"),
    document: UploadFile | None = File(None, description="Optional PO document (PDF, image)"),
) -> dict[str, Any]:
    """Create a purchase order from manual entry with optional document attachment.

    This is the main endpoint for manually entering PO data from physical documents
    (PDF scans, photos of hardcopy, etc.). The document can be attached in the same request.

    Supports multi-fleet POs and workshop entries.

    Args:
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.
        po_number: Purchase order number.
        po_date: PO date.
        vendor: Vendor name.
        vendor_address: Vendor address.
        req_no: Requisition number (auto-resolves location if prefix matches).
        location_id: Location ID (optional if req_no has known prefix).
        subtotal: Subtotal before tax/discount.
        discount_percentage: Discount percentage (0-100).
        vat_percentage: VAT percentage (0-100).
        other_costs: Additional costs (shipping, handling, etc.).
        total_amount: Final total amount.
        notes: Additional notes.
        fleet_numbers: Comma-separated fleet numbers (e.g., "T468, 463, WORKSHOP").
        document: Optional document file (PDF, PNG, JPG).

    Returns:
        Created purchase order with ID and document info.
    """
    client = get_supabase_admin_client()

    # Check for duplicate PO number
    existing = (
        client.table("purchase_orders")
        .select("id")
        .eq("po_number", po_number.upper())
        .execute()
    )

    if existing.data:
        raise ValidationError(
            "Purchase order with this number already exists",
            details=[{"field": "po_number", "message": "Already exists", "code": "DUPLICATE"}],
        )

    # Try to resolve location from req_no if not provided
    resolved_location_id = str(location_id) if location_id else None
    if not resolved_location_id and req_no:
        resolved_location_id = resolve_location_from_req_no(req_no)

    # Handle document upload if provided
    storage_path = None
    file_name = None
    if document and document.filename:
        ext = "." + document.filename.split(".")[-1].lower() if "." in document.filename else ""
        if ext not in ALLOWED_PO_EXTENSIONS:
            raise ValidationError(
                f"Invalid file type. Allowed: {', '.join(ALLOWED_PO_EXTENSIONS)}",
                details=[{"field": "document", "message": "Invalid file type", "code": "INVALID_TYPE"}],
            )

        file_content = await document.read()
        location_folder = resolved_location_id or "general"
        date_folder = str(po_date) if po_date else "undated"
        storage_path = f"purchase-orders/{location_folder}/{date_folder}/{po_number.upper()}_{document.filename}"

        try:
            client.storage.from_("reports").upload(
                storage_path,
                file_content,
                {"content-type": document.content_type or "application/octet-stream"},
            )
            file_name = document.filename
        except Exception as e:
            if "already exists" in str(e).lower():
                client.storage.from_("reports").update(storage_path, file_content)
                file_name = document.filename
            else:
                logger.warning("Failed to upload document, continuing without it", error=str(e))
                storage_path = None

    # Create PO
    po_data = {
        "po_number": po_number.upper(),
        "po_date": str(po_date) if po_date else None,
        "vendor": vendor,
        "vendor_address": vendor_address,
        "req_no": req_no.upper() if req_no else None,
        "location_id": resolved_location_id,
        "subtotal": subtotal,
        "discount_percentage": discount_percentage,
        "vat_percentage": vat_percentage,
        "other_costs": other_costs,
        "total_amount": total_amount,
        "notes": notes,
        "source_file_path": storage_path,
        "source_file_name": file_name,
        "created_by": current_user.id,
    }

    result = client.table("purchase_orders").insert(po_data).execute()
    created = result.data[0]
    po_id = created["id"]

    # Parse and create fleet associations
    fleets_created = []
    if fleet_numbers:
        parsed_fleets = parse_fleet_input(fleet_numbers)
        for pf in parsed_fleets:
            fleet_data = {
                "purchase_order_id": po_id,
                "fleet_number_raw": pf["fleet_number_raw"],
                "plant_id": pf["plant_id"],
                "fleet_type": pf["fleet_type"],
                "is_workshop": pf["is_workshop"],
                "is_resolved": pf["is_resolved"],
            }
            fleet_result = (
                client.table("purchase_order_fleets")
                .insert(fleet_data)
                .execute()
            )
            fleets_created.append(fleet_result.data[0])

    # Determine cost type
    cost_type = get_cost_classification(fleets_created) if fleets_created else "shared"

    logger.info(
        "Manual PO created",
        po_id=po_id,
        po_number=po_number,
        fleets_count=len(fleets_created),
        has_document=bool(storage_path),
        cost_type=cost_type,
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="create",
        table_name="purchase_orders",
        record_id=po_id,
        new_values={**po_data, "fleet_numbers": fleet_numbers},
        ip_address=get_client_ip(request),
        description=f"Manually created PO {po_number.upper()} ({cost_type})",
    )

    return {
        "success": True,
        "data": {
            **created,
            "fleets": fleets_created,
            "cost_type": cost_type,
        },
        "meta": {
            "fleets_resolved": sum(1 for f in fleets_created if f.get("is_resolved")),
            "fleets_unresolved": sum(1 for f in fleets_created if not f.get("is_resolved")),
            "has_workshop": any(f.get("is_workshop") for f in fleets_created),
            "document_attached": bool(storage_path),
            "location_auto_resolved": bool(not location_id and resolved_location_id),
        },
    }


@router.post("", status_code=201)
async def create_purchase_order(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    po_number: str,
    po_date: date | None = None,
    vendor: str | None = None,
    vendor_address: str | None = None,
    req_no: str | None = None,
    location_id: UUID | None = None,
    subtotal: float | None = None,
    discount_percentage: float = Query(default=0, ge=0, le=100),
    vat_percentage: float = Query(default=0, ge=0, le=100),
    other_costs: float = Query(default=0, ge=0),
    total_amount: float | None = None,
    notes: str | None = None,
    fleet_numbers: str | None = Query(None, description="Comma-separated fleet numbers (e.g., 'T468, 463, 466')"),
) -> dict[str, Any]:
    """Create a new purchase order.

    Args:
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.
        po_number: Purchase order number.
        po_date: PO date.
        vendor: Vendor name.
        vendor_address: Vendor address.
        req_no: Requisition number (can auto-resolve location).
        location_id: Location ID (optional if req_no provided).
        subtotal: Subtotal before tax/discount.
        discount_percentage: Discount percentage (0-100).
        vat_percentage: VAT percentage (0-100).
        other_costs: Additional costs (shipping, handling, etc.).
        total_amount: Final total amount.
        notes: Additional notes.
        fleet_numbers: Comma-separated fleet numbers.

    Returns:
        Created purchase order with ID.
    """
    client = get_supabase_admin_client()

    # Check for duplicate PO number
    existing = (
        client.table("purchase_orders")
        .select("id")
        .eq("po_number", po_number.upper())
        .execute()
    )

    if existing.data:
        raise ValidationError(
            "Purchase order with this number already exists",
            details=[{"field": "po_number", "message": "Already exists", "code": "DUPLICATE"}],
        )

    # Try to resolve location from req_no if not provided
    resolved_location_id = str(location_id) if location_id else None
    if not resolved_location_id and req_no:
        resolved_location_id = resolve_location_from_req_no(req_no)

    # Create PO
    po_data = {
        "po_number": po_number.upper(),
        "po_date": str(po_date) if po_date else None,
        "vendor": vendor,
        "vendor_address": vendor_address,
        "req_no": req_no.upper() if req_no else None,
        "location_id": resolved_location_id,
        "subtotal": subtotal,
        "discount_percentage": discount_percentage,
        "vat_percentage": vat_percentage,
        "other_costs": other_costs,
        "total_amount": total_amount,
        "notes": notes,
        "created_by": current_user.id,
    }

    result = client.table("purchase_orders").insert(po_data).execute()
    created = result.data[0]
    po_id = created["id"]

    # Parse and create fleet associations
    fleets_created = []
    if fleet_numbers:
        parsed_fleets = parse_fleet_input(fleet_numbers)
        for pf in parsed_fleets:
            fleet_data = {
                "purchase_order_id": po_id,
                "fleet_number_raw": pf["fleet_number_raw"],
                "plant_id": pf["plant_id"],
                "fleet_type": pf["fleet_type"],
                "is_workshop": pf["is_workshop"],
                "is_resolved": pf["is_resolved"],
            }
            fleet_result = (
                client.table("purchase_order_fleets")
                .insert(fleet_data)
                .execute()
            )
            fleets_created.append(fleet_result.data[0])

    logger.info(
        "Purchase order created",
        po_id=po_id,
        po_number=po_number,
        fleets_count=len(fleets_created),
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="create",
        table_name="purchase_orders",
        record_id=po_id,
        new_values=po_data,
        ip_address=get_client_ip(request),
        description=f"Created PO {po_number.upper()}",
    )

    return {
        "success": True,
        "data": {
            **created,
            "fleets": fleets_created,
        },
    }


@router.post("/{po_id}/attach-document", status_code=200)
async def attach_document_to_po(
    po_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """Attach a document (PDF, image) to an existing purchase order.

    Use this for manually entered POs to attach the original PO document
    (scanned PDF, photo of hardcopy, etc.).

    Args:
        po_id: The purchase order UUID.
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.
        file: The document file (PDF, PNG, JPG, JPEG).

    Returns:
        Updated purchase order with file path.
    """
    settings = get_settings()
    client = get_supabase_admin_client()

    # Validate file extension
    if not file.filename:
        raise ValidationError("File name is required")

    ext = "." + file.filename.split(".")[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_PO_EXTENSIONS:
        raise ValidationError(
            f"Invalid file type. Allowed: {', '.join(ALLOWED_PO_EXTENSIONS)}",
            details=[{"field": "file", "message": "Invalid file type", "code": "INVALID_TYPE"}],
        )

    # Verify PO exists
    existing = (
        client.table("purchase_orders")
        .select("id, po_number, po_date, location_id")
        .eq("id", str(po_id))
        .single()
        .execute()
    )

    if not existing.data:
        raise NotFoundError("Purchase order", str(po_id))

    po = existing.data

    # Read file content
    file_content = await file.read()
    file_size = len(file_content)

    # Store file in Supabase Storage
    location_folder = po.get("location_id") or "general"
    date_folder = str(po.get("po_date")) if po.get("po_date") else "undated"
    storage_path = f"purchase-orders/{location_folder}/{date_folder}/{po['po_number']}_{file.filename}"

    try:
        client.storage.from_("reports").upload(
            storage_path,
            file_content,
            {"content-type": file.content_type or "application/octet-stream"},
        )
    except Exception as e:
        if "already exists" in str(e).lower():
            client.storage.from_("reports").update(storage_path, file_content)
        else:
            logger.error("Failed to upload PO document", error=str(e))
            raise ValidationError(f"Failed to upload file: {str(e)}")

    # Update PO with file info
    result = (
        client.table("purchase_orders")
        .update({
            "source_file_path": storage_path,
            "source_file_name": file.filename,
        })
        .eq("id", str(po_id))
        .execute()
    )

    logger.info(
        "Document attached to PO",
        po_id=str(po_id),
        po_number=po["po_number"],
        file_name=file.filename,
        file_size=file_size,
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="update",
        table_name="purchase_orders",
        record_id=str(po_id),
        new_values={"source_file_path": storage_path, "source_file_name": file.filename},
        ip_address=get_client_ip(request),
        description=f"Attached document to PO {po['po_number']}: {file.filename}",
    )

    return {
        "success": True,
        "message": f"Document '{file.filename}' attached successfully",
        "data": {
            "po_id": str(po_id),
            "file_name": file.filename,
            "file_size": file_size,
            "storage_path": storage_path,
        },
    }


@router.get("/{po_id}/document")
async def get_po_document(
    po_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get a signed URL to download/view the PO document.

    Args:
        po_id: The purchase order UUID.
        current_user: The authenticated user.

    Returns:
        Signed URL for document access.
    """
    client = get_supabase_admin_client()

    # Get PO with file path
    po = (
        client.table("purchase_orders")
        .select("id, po_number, source_file_path, source_file_name")
        .eq("id", str(po_id))
        .single()
        .execute()
    )

    if not po.data:
        raise NotFoundError("Purchase order", str(po_id))

    if not po.data.get("source_file_path"):
        raise NotFoundError("Document for purchase order", str(po_id))

    # Create signed URL
    try:
        signed_url = client.storage.from_("reports").create_signed_url(
            po.data["source_file_path"],
            expires_in=3600,  # 1 hour
        )

        file_name = po.data.get("source_file_name", "")
        ext = file_name.split(".")[-1].lower() if "." in file_name else ""
        file_type_map = {
            "pdf": "pdf",
            "png": "image",
            "jpg": "image",
            "jpeg": "image",
            "xlsx": "excel",
            "xls": "excel",
        }

        return {
            "success": True,
            "data": {
                "url": signed_url.get("signedURL"),
                "file_name": file_name,
                "file_type": file_type_map.get(ext, "unknown"),
                "can_preview": ext in ("pdf", "png", "jpg", "jpeg"),
                "expires_in_seconds": 3600,
            },
        }
    except Exception as e:
        logger.error("Failed to generate signed URL", error=str(e))
        raise ValidationError(f"Could not generate document URL: {str(e)}")


@router.patch("/{po_id}")
async def update_purchase_order(
    po_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    po_date: date | None = None,
    vendor: str | None = None,
    vendor_address: str | None = None,
    req_no: str | None = None,
    location_id: UUID | None = None,
    subtotal: float | None = None,
    discount_percentage: float | None = Query(default=None, ge=0, le=100),
    vat_percentage: float | None = Query(default=None, ge=0, le=100),
    other_costs: float | None = Query(default=None, ge=0),
    total_amount: float | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """Update an existing purchase order.

    Args:
        po_id: The purchase order UUID.
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.
        All other args are optional fields to update.

    Returns:
        Updated purchase order.
    """
    client = get_supabase_admin_client()

    # Build update data
    update_data = {}
    if po_date is not None:
        update_data["po_date"] = str(po_date)
    if vendor is not None:
        update_data["vendor"] = vendor
    if vendor_address is not None:
        update_data["vendor_address"] = vendor_address
    if req_no is not None:
        update_data["req_no"] = req_no.upper()
    if location_id is not None:
        update_data["location_id"] = str(location_id)
    if subtotal is not None:
        update_data["subtotal"] = subtotal
    if discount_percentage is not None:
        update_data["discount_percentage"] = discount_percentage
    if vat_percentage is not None:
        update_data["vat_percentage"] = vat_percentage
    if other_costs is not None:
        update_data["other_costs"] = other_costs
    if total_amount is not None:
        update_data["total_amount"] = total_amount
    if notes is not None:
        update_data["notes"] = notes

    if not update_data:
        raise ValidationError("No fields to update")

    # Fetch current values for audit diff
    existing = (
        client.table("purchase_orders")
        .select("*")
        .eq("id", str(po_id))
        .execute()
    )

    if not existing.data:
        raise NotFoundError("Purchase order", str(po_id))

    old_record = existing.data[0]
    old_values = {k: old_record.get(k) for k in update_data if k in old_record}

    result = (
        client.table("purchase_orders")
        .update(update_data)
        .eq("id", str(po_id))
        .execute()
    )

    logger.info(
        "Purchase order updated",
        po_id=str(po_id),
        updated_fields=list(update_data.keys()),
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="update",
        table_name="purchase_orders",
        record_id=str(po_id),
        old_values=old_values,
        new_values=update_data,
        ip_address=get_client_ip(request),
        description=f"Updated PO {old_record.get('po_number', str(po_id))}",
    )

    return {
        "success": True,
        "data": result.data[0],
    }


@router.delete("/{po_id}")
async def delete_purchase_order(
    po_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Delete a purchase order.

    This will also delete all associated items and fleet associations.

    Args:
        po_id: The purchase order UUID.
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.

    Returns:
        Success message.
    """
    client = get_supabase_admin_client()

    # Capture record before deletion
    existing = (
        client.table("purchase_orders")
        .select("*")
        .eq("id", str(po_id))
        .single()
        .execute()
    )

    if not existing.data:
        raise NotFoundError("Purchase order", str(po_id))

    deleted_record = existing.data

    # Delete (cascade will handle items and fleets)
    client.table("purchase_orders").delete().eq("id", str(po_id)).execute()

    logger.info(
        "Purchase order deleted",
        po_id=str(po_id),
        po_number=deleted_record["po_number"],
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="delete",
        table_name="purchase_orders",
        record_id=str(po_id),
        old_values=deleted_record,
        ip_address=get_client_ip(request),
        description=f"Deleted PO {deleted_record['po_number']}",
    )

    return {
        "success": True,
        "message": f"Purchase order '{deleted_record['po_number']}' deleted successfully",
    }


# ---------- Line Items ----------


@router.post("/{po_id}/items", status_code=201)
async def add_purchase_order_item(
    po_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    description: str,
    quantity: int = 1,
    unit_cost: float | None = None,
    part_number: str | None = None,
) -> dict[str, Any]:
    """Add a line item to a purchase order.

    Args:
        po_id: The purchase order UUID.
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.
        description: Item description.
        quantity: Quantity.
        unit_cost: Unit cost.
        part_number: Part number.

    Returns:
        Created line item.
    """
    client = get_supabase_admin_client()

    # Verify PO exists
    po = (
        client.table("purchase_orders")
        .select("id, po_number")
        .eq("id", str(po_id))
        .single()
        .execute()
    )

    if not po.data:
        raise NotFoundError("Purchase order", str(po_id))

    item_data = {
        "purchase_order_id": str(po_id),
        "description": description,
        "quantity": quantity,
        "unit_cost": unit_cost,
        "part_number": part_number,
    }

    result = client.table("purchase_order_items").insert(item_data).execute()
    created = result.data[0]

    logger.info(
        "PO item added",
        po_id=str(po_id),
        item_id=created["id"],
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="create",
        table_name="purchase_order_items",
        record_id=created["id"],
        new_values=item_data,
        ip_address=get_client_ip(request),
        description=f"Added item to PO {po.data['po_number']}: {description}",
    )

    return {
        "success": True,
        "data": created,
    }


@router.delete("/{po_id}/items/{item_id}")
async def remove_purchase_order_item(
    po_id: UUID,
    item_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Remove a line item from a purchase order.

    Args:
        po_id: The purchase order UUID.
        item_id: The item UUID.
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.

    Returns:
        Success message.
    """
    client = get_supabase_admin_client()

    # Verify item exists and belongs to PO
    existing = (
        client.table("purchase_order_items")
        .select("*")
        .eq("id", str(item_id))
        .eq("purchase_order_id", str(po_id))
        .single()
        .execute()
    )

    if not existing.data:
        raise NotFoundError("Purchase order item", str(item_id))

    client.table("purchase_order_items").delete().eq("id", str(item_id)).execute()

    logger.info(
        "PO item removed",
        po_id=str(po_id),
        item_id=str(item_id),
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="delete",
        table_name="purchase_order_items",
        record_id=str(item_id),
        old_values=existing.data,
        ip_address=get_client_ip(request),
        description=f"Removed item from PO: {existing.data['description']}",
    )

    return {
        "success": True,
        "message": "Item removed successfully",
    }


# ---------- Fleet Associations ----------


@router.post("/{po_id}/fleets", status_code=201)
async def add_purchase_order_fleet(
    po_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    fleet_numbers: str = Query(..., description="Comma-separated fleet numbers"),
) -> dict[str, Any]:
    """Add fleet associations to a purchase order.

    Parses input like "T468, 463, 466" and creates associations.
    Abbreviated numbers inherit the last prefix (463 → T463).

    Args:
        po_id: The purchase order UUID.
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.
        fleet_numbers: Comma-separated fleet numbers.

    Returns:
        Created fleet associations.
    """
    client = get_supabase_admin_client()

    # Verify PO exists
    po = (
        client.table("purchase_orders")
        .select("id, po_number")
        .eq("id", str(po_id))
        .single()
        .execute()
    )

    if not po.data:
        raise NotFoundError("Purchase order", str(po_id))

    # Parse and create fleet associations
    parsed_fleets = parse_fleet_input(fleet_numbers)
    created_fleets = []
    skipped = []

    for pf in parsed_fleets:
        # Check if already exists
        existing = (
            client.table("purchase_order_fleets")
            .select("id")
            .eq("purchase_order_id", str(po_id))
            .eq("fleet_number_raw", pf["fleet_number_raw"])
            .execute()
        )

        if existing.data:
            skipped.append(pf["fleet_number_raw"])
            continue

        fleet_data = {
            "purchase_order_id": str(po_id),
            "fleet_number_raw": pf["fleet_number_raw"],
            "plant_id": pf["plant_id"],
            "fleet_type": pf["fleet_type"],
            "is_workshop": pf["is_workshop"],
            "is_resolved": pf["is_resolved"],
        }

        result = client.table("purchase_order_fleets").insert(fleet_data).execute()
        created_fleets.append(result.data[0])

    logger.info(
        "PO fleets added",
        po_id=str(po_id),
        created_count=len(created_fleets),
        skipped=skipped,
        user_id=current_user.id,
    )

    if created_fleets:
        background_tasks.add_task(
            audit_service.log,
            user_id=current_user.id,
            user_email=current_user.email,
            action="create",
            table_name="purchase_order_fleets",
            record_id=str(po_id),
            new_values={"fleet_numbers": fleet_numbers, "parsed": [f["fleet_number_raw"] for f in created_fleets]},
            ip_address=get_client_ip(request),
            description=f"Added fleets to PO {po.data['po_number']}: {fleet_numbers}",
        )

    return {
        "success": True,
        "data": created_fleets,
        "skipped": skipped,
        "message": f"Added {len(created_fleets)} fleet(s)" + (f", skipped {len(skipped)} duplicate(s)" if skipped else ""),
    }


@router.delete("/{po_id}/fleets/{fleet_id}")
async def remove_purchase_order_fleet(
    po_id: UUID,
    fleet_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Remove a fleet association from a purchase order.

    Args:
        po_id: The purchase order UUID.
        fleet_id: The fleet association UUID.
        request: The HTTP request.
        background_tasks: Background task runner.
        current_user: The authenticated admin user.

    Returns:
        Success message.
    """
    client = get_supabase_admin_client()

    # Verify fleet exists and belongs to PO
    existing = (
        client.table("purchase_order_fleets")
        .select("*")
        .eq("id", str(fleet_id))
        .eq("purchase_order_id", str(po_id))
        .single()
        .execute()
    )

    if not existing.data:
        raise NotFoundError("Fleet association", str(fleet_id))

    client.table("purchase_order_fleets").delete().eq("id", str(fleet_id)).execute()

    logger.info(
        "PO fleet removed",
        po_id=str(po_id),
        fleet_id=str(fleet_id),
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="delete",
        table_name="purchase_order_fleets",
        record_id=str(fleet_id),
        old_values=existing.data,
        ip_address=get_client_ip(request),
        description=f"Removed fleet {existing.data['fleet_number_raw']} from PO",
    )

    return {
        "success": True,
        "message": f"Fleet '{existing.data['fleet_number_raw']}' removed successfully",
    }
