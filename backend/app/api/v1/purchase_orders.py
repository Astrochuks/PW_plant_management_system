"""Purchase order management endpoints."""

from datetime import date, datetime
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
    parse_multiple_req_nos,
    get_cost_classification,
)


def parse_flexible_date(date_str: str | None) -> date | None:
    """Parse date from various formats."""
    if not date_str:
        return None
    if isinstance(date_str, date):
        return date_str

    date_str = date_str.strip()
    formats = [
        "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%m-%y", "%d/%m/%y",
        "%d-%B-%y", "%d-%B-%Y", "%d-%b-%y", "%d-%b-%Y",
        "%d %B %Y", "%d %B %y", "%d %b %Y", "%d %b %y",
        "%B %d, %Y", "%b %d, %Y",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt).date()
        except ValueError:
            continue
    raise ValidationError(f"Could not parse date '{date_str}'")


def parse_items_input(items_str: str) -> list[dict]:
    """Parse items from simple or JSON format."""
    import json

    items_list = []
    items_stripped = items_str.strip()

    if not items_stripped:
        return []

    if items_stripped.startswith("["):
        # JSON format
        try:
            items_list = json.loads(items_stripped)
            if not isinstance(items_list, list):
                raise ValidationError("items must be a JSON array")
        except json.JSONDecodeError as e:
            raise ValidationError(f"Invalid JSON: {str(e)}")
    else:
        # Simple format: description|quantity|unit_cost|part_number;next...
        item_strings = [s.strip() for s in items_stripped.split(";") if s.strip()]

        for item_str in item_strings:
            parts = [p.strip() for p in item_str.split("|")]
            if not parts or not parts[0]:
                continue

            item_dict = {"description": parts[0]}
            if len(parts) > 1 and parts[1]:
                try:
                    item_dict["quantity"] = int(parts[1])
                except ValueError:
                    item_dict["quantity"] = 1
            if len(parts) > 2 and parts[2]:
                try:
                    item_dict["unit_cost"] = float(parts[2])
                except ValueError:
                    pass
            if len(parts) > 3 and parts[3]:
                item_dict["part_number"] = parts[3]

            items_list.append(item_dict)

    return items_list

router = APIRouter()
logger = get_logger(__name__)


# Valid file extensions for PO document attachments
ALLOWED_PO_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".xlsx", ".xls"}


@router.post("/entry", status_code=201)
async def create_purchase_order_entry(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    po_number: str = Query(..., description="PO number from document"),
    po_date: str | None = Query(None, description="Date (formats: 2026-01-13, 13-01-26, 13-January-26)"),
    vendor: str | None = Query(None, description="Vendor/supplier name"),
    fleet_numbers: str = Query(..., description="Fleet(s): T468, 463, WORKSHOP, LOW LOADER"),
    items: str = Query(..., description="Items: desc|qty|cost|part_no;next... OR JSON array"),
    location_id: UUID | None = Query(None, description="Location UUID (select from dropdown)"),
    req_no: str | None = Query(None, description="REQ NO(s): KWOI 2345, ABJ 2340"),
    vat_percentage: float | None = Query(None, ge=0, le=100, description="VAT % (use this OR vat_amount)"),
    vat_amount: float | None = Query(None, ge=0, description="Total VAT amount"),
    discount_percentage: float | None = Query(None, ge=0, le=100, description="Discount %"),
    discount_amount: float | None = Query(None, ge=0, description="Total discount amount"),
    other_costs: float = Query(default=0, ge=0, description="Shipping, handling, etc."),
    notes: str | None = Query(None, description="Additional notes"),
) -> dict[str, Any]:
    """
    **UNIFIED PO ENTRY ENDPOINT**

    This is the main endpoint for entering ALL purchase orders - single or multi-fleet,
    workshop costs, category entries, everything.

    **Fleet Numbers Examples:**
    - Single fleet: `T468`
    - Multiple fleets: `T468, 463, 466` (463, 466 inherit T prefix)
    - Workshop: `WORKSHOP` or `W/SHOP`
    - Categories: `LOW LOADER`, `VOLVO`, `CONSUMABLES`, `PRECAST`
    - Mixed: `T468, 463, WORKSHOP, LOW LOADER`

    **Items Format (Simple - recommended):**
    ```
    NOZZLE SET|6|415000|170-5181;TIPS|8|35000|1U3352;PIN|8|12000
    ```
    Format: description|quantity|unit_cost|part_number (separated by semicolons)

    **Items Format (JSON):**
    ```json
    [{"description": "NOZZLE SET", "quantity": 6, "unit_cost": 415000, "part_number": "170-5181"}]
    ```

    **Date Formats Accepted:**
    2026-01-13, 13-01-2026, 13/01/26, 13-January-26, 13-Jan-26

    **What Gets Created:**
    1. `purchase_orders` record (PO header)
    2. `spare_parts` records (line items, linked to PO)
    3. `purchase_order_fleets` records (fleet associations)
    4. Cost classification: 'direct' (single plant) or 'shared' (multi-fleet/workshop/category)
    """
    client = get_supabase_admin_client()

    # Parse date
    parsed_date = parse_flexible_date(po_date)

    # Parse items
    items_list = parse_items_input(items)
    if not items_list:
        raise ValidationError("At least one item is required")

    # Parse fleet numbers
    parsed_fleets = parse_fleet_input(fleet_numbers)
    if not parsed_fleets:
        raise ValidationError("At least one fleet number is required")

    # Check for duplicate PO
    existing = (
        client.table("purchase_orders")
        .select("id")
        .eq("po_number", po_number.upper())
        .execute()
    )
    if existing.data:
        raise ValidationError(
            f"PO {po_number.upper()} already exists",
            details=[{"field": "po_number", "code": "DUPLICATE"}],
        )

    # Determine cost type
    cost_type = get_cost_classification(parsed_fleets)

    # Calculate time dimensions
    year = parsed_date.year if parsed_date else None
    month = parsed_date.month if parsed_date else None
    week_number = parsed_date.isocalendar()[1] if parsed_date else None
    quarter = (month - 1) // 3 + 1 if month else None

    # Calculate totals
    subtotal = sum(
        (item.get("unit_cost") or 0) * (item.get("quantity") or 1)
        for item in items_list
    )

    # Calculate VAT and discount
    if vat_amount is not None:
        calculated_vat = vat_amount
        effective_vat_pct = (vat_amount / subtotal * 100) if subtotal > 0 else 0
    else:
        effective_vat_pct = vat_percentage or 0
        calculated_vat = subtotal * effective_vat_pct / 100

    if discount_amount is not None:
        calculated_discount = discount_amount
        effective_discount_pct = (discount_amount / subtotal * 100) if subtotal > 0 else 0
    else:
        effective_discount_pct = discount_percentage or 0
        calculated_discount = subtotal * effective_discount_pct / 100

    total_amount = subtotal + calculated_vat - calculated_discount + other_costs

    # Create PO header
    po_data = {
        "po_number": po_number.upper(),
        "po_date": str(parsed_date) if parsed_date else None,
        "vendor": vendor,
        "req_no": req_no.upper() if req_no else None,
        "location_id": str(location_id) if location_id else None,
        "subtotal": round(subtotal, 2),
        "vat_percentage": round(effective_vat_pct, 2),
        "discount_percentage": round(effective_discount_pct, 2),
        "other_costs": other_costs,
        "total_amount": round(total_amount, 2),
        "notes": notes,
        "cost_type": cost_type,
        "year": year,
        "month": month,
        "week_number": week_number,
        "quarter": quarter,
        "created_by": current_user.id,
    }

    po_result = client.table("purchase_orders").insert(po_data).execute()
    created_po = po_result.data[0]
    po_id = created_po["id"]

    # Create fleet associations
    fleets_created = []
    resolved_plant_ids = []
    for pf in parsed_fleets:
        fleet_data = {
            "purchase_order_id": po_id,
            "fleet_number_raw": pf["fleet_number_raw"],
            "plant_id": pf["plant_id"],
            "fleet_type": pf["fleet_type"],
            "is_workshop": pf["is_workshop"],
            "is_category": pf.get("is_category", False),
            "category_name": pf.get("category_name"),
            "is_resolved": pf["is_resolved"],
        }
        fleet_result = client.table("purchase_order_fleets").insert(fleet_data).execute()
        fleets_created.append(fleet_result.data[0])
        if pf["plant_id"]:
            resolved_plant_ids.append(pf["plant_id"])

    # Create spare_parts records (line items) for each resolved plant
    # If multiple plants, items are associated with each plant
    # If no resolved plants (workshop/category only), create items without plant_id
    items_created = []

    # Determine which plant_ids to create items for
    plant_ids_for_items = resolved_plant_ids if resolved_plant_ids else [None]

    # Distribute VAT/discount per item proportionally
    for plant_id in plant_ids_for_items:
        for item in items_list:
            item_subtotal = (item.get("unit_cost") or 0) * (item.get("quantity") or 1)

            # Proportional VAT/discount for this item
            if subtotal > 0:
                item_vat = calculated_vat * (item_subtotal / subtotal) / len(plant_ids_for_items)
                item_discount = calculated_discount * (item_subtotal / subtotal) / len(plant_ids_for_items)
            else:
                item_vat = 0
                item_discount = 0

            spare_part_data = {
                "plant_id": plant_id,
                "purchase_order_id": po_id,
                "purchase_order_number": po_number.upper(),
                "part_description": item.get("description"),
                "part_number": item.get("part_number"),
                "quantity": item.get("quantity", 1),
                "unit_cost": item.get("unit_cost"),
                "vat_amount": round(item_vat, 2) if item_vat > 0 else None,
                "discount_amount": round(item_discount, 2) if item_discount > 0 else None,
                "vat_percentage": 0,  # Using amounts instead
                "discount_percentage": 0,
                "supplier": vendor,
                "replaced_date": str(parsed_date) if parsed_date else None,
                "po_date": str(parsed_date) if parsed_date else None,
                "requisition_number": req_no.upper() if req_no else None,
                "location_id": str(location_id) if location_id else None,
                "year": year,
                "month": month,
                "week_number": week_number,
                "quarter": quarter,
                "created_by": current_user.id,
            }

            item_result = client.table("spare_parts").insert(spare_part_data).execute()
            items_created.append(item_result.data[0])

    # Calculate total from created items
    total_from_items = sum(float(i.get("total_cost") or 0) for i in items_created)

    logger.info(
        "PO entry created",
        po_id=po_id,
        po_number=po_number.upper(),
        cost_type=cost_type,
        fleets_count=len(fleets_created),
        items_count=len(items_created),
        plants_count=len(resolved_plant_ids),
        total_amount=total_amount,
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="create",
        table_name="purchase_orders",
        record_id=po_id,
        new_values={"po_number": po_number, "fleet_numbers": fleet_numbers, "items_count": len(items_list)},
        ip_address=get_client_ip(request),
        description=f"Created PO {po_number.upper()} - {cost_type} - {len(items_list)} items",
    )

    return {
        "success": True,
        "data": {
            "purchase_order": created_po,
            "fleets": fleets_created,
            "items": items_created,
        },
        "meta": {
            "po_id": po_id,
            "po_number": po_number.upper(),
            "cost_type": cost_type,
            "fleets_count": len(fleets_created),
            "items_count": len(items_created),
            "plants_resolved": len(resolved_plant_ids),
            "plants_unresolved": sum(1 for f in fleets_created if not f.get("plant_id") and not f.get("is_workshop") and not f.get("is_category")),
            "has_workshop": any(f.get("is_workshop") for f in fleets_created),
            "has_category": any(f.get("is_category") for f in fleets_created),
            "subtotal": round(subtotal, 2),
            "vat": round(calculated_vat, 2),
            "discount": round(calculated_discount, 2),
            "other_costs": other_costs,
            "total": round(total_amount, 2),
            "total_from_items": round(total_from_items, 2),
        },
    }


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

    Returns PO summaries aggregated from spare_parts table.

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

    # Use the new view that aggregates from spare_parts
    query = (
        client.table("v_purchase_orders_summary")
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
    req_no: str | None = Form(None, description="REQ NO(s), can be multiple: 'KWOI 2345, ABJ 2340'"),
    location_ids: str | None = Form(None, description="Comma-separated location UUIDs"),
    subtotal: float | None = Form(None),
    discount_percentage: float = Form(default=0, ge=0, le=100),
    vat_percentage: float = Form(default=0, ge=0, le=100),
    other_costs: float = Form(default=0, ge=0),
    total_amount: float | None = Form(None),
    notes: str | None = Form(None),
    fleet_numbers: str | None = Form(None, description="Comma-separated: 'T468, 463, LOW LOADER, WORKSHOP'"),
    document: UploadFile | None = File(None, description="Optional PO document (PDF, image)"),
) -> dict[str, Any]:
    """Create a purchase order from manual entry with optional document attachment.

    This is the main endpoint for manually entering PO data from physical documents
    (PDF scans, photos of hardcopy, etc.). The document can be attached in the same request.

    Supports:
    - Multi-fleet POs (T468, 463, 466)
    - Workshop/general entries (WORKSHOP, W/SHOP)
    - Category entries (LOW LOADER, VOLVO, CONSUMABLES, PRECAST)
    - Multiple locations per PO (KWOI 2345, ABJ 2340)

    Args:
        po_number: Purchase order number.
        po_date: PO date.
        vendor: Vendor name.
        vendor_address: Vendor address.
        req_no: Requisition number(s) - can be multiple comma-separated.
        location_ids: Comma-separated location UUIDs (user selects from dropdown).
        subtotal: Subtotal before tax/discount.
        discount_percentage: Discount percentage (0-100).
        vat_percentage: VAT percentage (0-100).
        other_costs: Additional costs.
        total_amount: Final total amount.
        notes: Additional notes.
        fleet_numbers: Comma-separated fleet entries.
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

    # Parse location_ids (user-selected, no auto-resolution)
    parsed_locations = []
    primary_location_id = None
    if location_ids:
        loc_ids = [lid.strip() for lid in location_ids.split(",") if lid.strip()]
        if loc_ids:
            primary_location_id = loc_ids[0]
            for lid in loc_ids:
                parsed_locations.append({"location_id": lid, "req_no": None})

    # Parse REQ NOs to associate with locations
    parsed_req_nos = []
    if req_no:
        parsed_req_nos = parse_multiple_req_nos(req_no)
        # Match REQ NOs to locations if we have them
        for prn in parsed_req_nos:
            # Find matching location in parsed_locations by location_id
            matched = False
            for pl in parsed_locations:
                if prn["location_id"] and pl["location_id"] == prn["location_id"]:
                    pl["req_no"] = prn["req_no"]
                    matched = True
                    break
            if not matched and prn["location_id"]:
                # Add location from REQ NO if not already in list
                parsed_locations.append({
                    "location_id": prn["location_id"],
                    "req_no": prn["req_no"],
                })
                if not primary_location_id:
                    primary_location_id = prn["location_id"]

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
        location_folder = primary_location_id or "general"
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
        "location_id": primary_location_id,  # Primary location
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

    # Create location associations for multi-location POs
    locations_created = []
    if len(parsed_locations) > 0:
        for pl in parsed_locations:
            try:
                loc_data = {
                    "purchase_order_id": po_id,
                    "location_id": pl["location_id"],
                    "req_no": pl.get("req_no"),
                }
                loc_result = (
                    client.table("purchase_order_locations")
                    .insert(loc_data)
                    .execute()
                )
                locations_created.append(loc_result.data[0])
            except Exception as e:
                logger.warning("Failed to create PO location", error=str(e), location_id=pl["location_id"])

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
                "is_category": pf.get("is_category", False),
                "category_name": pf.get("category_name"),
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
        locations_count=len(locations_created),
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
        new_values={**po_data, "fleet_numbers": fleet_numbers, "location_ids": location_ids},
        ip_address=get_client_ip(request),
        description=f"Manually created PO {po_number.upper()} ({cost_type})",
    )

    return {
        "success": True,
        "data": {
            **created,
            "fleets": fleets_created,
            "locations": locations_created,
            "cost_type": cost_type,
        },
        "meta": {
            "fleets_resolved": sum(1 for f in fleets_created if f.get("plant_id")),
            "fleets_unresolved": sum(1 for f in fleets_created if not f.get("plant_id") and not f.get("is_workshop") and not f.get("is_category")),
            "has_workshop": any(f.get("is_workshop") for f in fleets_created),
            "has_category": any(f.get("is_category") for f in fleets_created),
            "categories": [f.get("category_name") for f in fleets_created if f.get("is_category")],
            "location_count": len(locations_created),
            "is_multi_location": len(locations_created) > 1,
            "document_attached": bool(storage_path),
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


# ---------- Spare Parts Linkage ----------


@router.get("/{po_id}/spare-parts")
async def get_po_spare_parts(
    po_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get spare parts linked to a purchase order.

    Args:
        po_id: The purchase order UUID.
        current_user: The authenticated user.

    Returns:
        List of spare parts linked to this PO.
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

    # Get linked spare parts
    parts_result = (
        client.table("spare_parts")
        .select("*, plants_master(fleet_number, fleet_type, description)")
        .eq("purchase_order_id", str(po_id))
        .order("created_at", desc=True)
        .execute()
    )

    # Transform data
    parts = []
    for part in parts_result.data or []:
        plant_info = part.pop("plants_master", {}) or {}
        parts.append({
            **part,
            "fleet_number": plant_info.get("fleet_number"),
            "fleet_type": plant_info.get("fleet_type"),
            "plant_description": plant_info.get("description"),
        })

    return {
        "success": True,
        "data": parts,
        "meta": {
            "po_number": po.data["po_number"],
            "total_parts": len(parts),
            "total_cost": sum(float(p.get("total_cost") or 0) for p in parts),
        },
    }


@router.post("/{po_id}/spare-parts", status_code=201)
async def link_spare_part_to_po(
    po_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    plant_id: UUID | None = Query(None, description="Plant this part was used on"),
    part_description: str = Query(..., description="Description of the part"),
    quantity: int = Query(1, ge=1),
    unit_cost: float = Query(..., ge=0),
    part_number: str | None = Query(None),
    replaced_date: date | None = Query(None),
    reason_for_change: str | None = Query(None),
) -> dict[str, Any]:
    """Create a spare part record linked to a purchase order.

    Use this when entering parts from a PO. The part will be linked to the PO
    and optionally to a specific plant.

    Args:
        po_id: The purchase order UUID.
        plant_id: Optional plant that used this part.
        part_description: Description of the part.
        quantity: Quantity used.
        unit_cost: Cost per unit.
        part_number: Part number if known.
        replaced_date: Date the part was replaced.
        reason_for_change: Reason for the replacement.

    Returns:
        Created spare part record.
    """
    client = get_supabase_admin_client()

    # Verify PO exists and get its details
    po = (
        client.table("purchase_orders")
        .select("id, po_number, po_date, location_id, vat_percentage, discount_percentage")
        .eq("id", str(po_id))
        .single()
        .execute()
    )

    if not po.data:
        raise NotFoundError("Purchase order", str(po_id))

    # Create spare part record
    part_data = {
        "purchase_order_id": str(po_id),
        "plant_id": str(plant_id) if plant_id else None,
        "part_description": part_description,
        "part_number": part_number,
        "quantity": quantity,
        "unit_cost": unit_cost,
        "replaced_date": str(replaced_date) if replaced_date else str(po.data.get("po_date")) if po.data.get("po_date") else None,
        "reason_for_change": reason_for_change,
        "purchase_order_number": po.data["po_number"],
        "po_date": po.data.get("po_date"),
        "location_id": po.data.get("location_id"),
        "vat_percentage": po.data.get("vat_percentage", 0),
        "discount_percentage": po.data.get("discount_percentage", 0),
        "created_by": current_user.id,
    }

    result = client.table("spare_parts").insert(part_data).execute()
    created = result.data[0]

    logger.info(
        "Spare part created from PO",
        spare_part_id=created["id"],
        po_id=str(po_id),
        plant_id=str(plant_id) if plant_id else None,
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
        description=f"Created spare part from PO {po.data['po_number']}: {part_description}",
    )

    return {
        "success": True,
        "data": created,
    }


@router.get("/plant/{plant_id}/all-costs")
async def get_plant_all_costs(
    plant_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    include_shared: bool = Query(True, description="Include this plant's share of shared POs"),
) -> dict[str, Any]:
    """Get all maintenance costs for a plant from both spare_parts and purchase_orders.

    This combines:
    1. Direct spare_parts records for this plant
    2. Direct POs (single plant only)
    3. Shared POs (this plant's contribution, if include_shared=True)

    Args:
        plant_id: The plant UUID.
        year: Filter by year.
        include_shared: Include share of multi-fleet POs.

    Returns:
        Combined cost data from all sources.
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

    # 1. Get direct spare_parts (not linked to a PO)
    spare_query = (
        client.table("spare_parts")
        .select("*")
        .eq("plant_id", str(plant_id))
        .is_("purchase_order_id", "null")  # Only parts NOT from PO system
    )
    if year:
        spare_query = spare_query.eq("year", year)
    spare_result = spare_query.execute()
    direct_parts = spare_result.data or []
    direct_parts_total = sum(float(p.get("total_cost") or 0) for p in direct_parts)

    # 2. Get spare_parts linked to POs (for this plant)
    po_spare_query = (
        client.table("spare_parts")
        .select("*, purchase_orders(po_number, po_date, vendor)")
        .eq("plant_id", str(plant_id))
        .not_.is_("purchase_order_id", "null")
    )
    if year:
        po_spare_query = po_spare_query.eq("year", year)
    po_spare_result = po_spare_query.execute()
    po_linked_parts = po_spare_result.data or []
    po_linked_parts_total = sum(float(p.get("total_cost") or 0) for p in po_linked_parts)

    # 3. Get POs associated with this plant
    fleet_query = (
        client.table("purchase_order_fleets")
        .select("purchase_order_id")
        .eq("plant_id", str(plant_id))
    )
    fleet_result = fleet_query.execute()
    po_ids = [f["purchase_order_id"] for f in fleet_result.data] if fleet_result.data else []

    direct_po_total = 0.0
    shared_po_total = 0.0
    shared_contribution = 0.0
    pos_data = []

    if po_ids:
        po_query = (
            client.table("v_purchase_order_costs")
            .select("*")
            .in_("id", po_ids)
        )
        if year:
            po_query = po_query.eq("year", year)
        po_result = po_query.execute()

        for po in po_result.data or []:
            amount = float(po.get("total_amount") or 0)
            plant_count = int(po.get("plant_count") or 1)
            cost_type = po.get("cost_type", "shared")

            if cost_type == "direct":
                direct_po_total += amount
                contribution = amount
            else:
                shared_po_total += amount
                contribution = amount / plant_count if plant_count > 0 and include_shared else 0
                shared_contribution += contribution

            pos_data.append({
                "id": po["id"],
                "po_number": po["po_number"],
                "po_date": po["po_date"],
                "vendor": po.get("vendor"),
                "total_amount": amount,
                "cost_type": cost_type,
                "plant_count": plant_count,
                "contribution": round(contribution, 2),
            })

    # Calculate totals
    grand_total = direct_parts_total + po_linked_parts_total + direct_po_total + (shared_contribution if include_shared else 0)

    return {
        "success": True,
        "data": {
            "plant": plant,
            "costs": {
                "direct_spare_parts": round(direct_parts_total, 2),
                "po_linked_spare_parts": round(po_linked_parts_total, 2),
                "direct_po_total": round(direct_po_total, 2),
                "shared_po_total": round(shared_po_total, 2),
                "shared_contribution": round(shared_contribution, 2) if include_shared else 0,
                "grand_total": round(grand_total, 2),
            },
            "breakdown": {
                "spare_parts_count": len(direct_parts) + len(po_linked_parts),
                "po_count": len(pos_data),
                "direct_po_count": sum(1 for p in pos_data if p["cost_type"] == "direct"),
                "shared_po_count": sum(1 for p in pos_data if p["cost_type"] == "shared"),
            },
            "purchase_orders": pos_data,
        },
        "meta": {
            "year": year,
            "include_shared": include_shared,
        },
    }


# ---------- Link Existing Spare Parts ----------


@router.get("/{po_id}/find-matching-spare-parts")
async def find_matching_spare_parts(
    po_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Find spare_parts records that match this PO by PO number.

    Use this to discover existing spare_parts that were entered from the same
    physical PO document (via Excel upload) but aren't linked to the PO record yet.

    Args:
        po_id: The purchase order UUID.

    Returns:
        List of matching spare_parts that could be linked.
    """
    client = get_supabase_admin_client()

    # Get PO number
    po = (
        client.table("purchase_orders")
        .select("id, po_number")
        .eq("id", str(po_id))
        .single()
        .execute()
    )

    if not po.data:
        raise NotFoundError("Purchase order", str(po_id))

    po_number = po.data["po_number"]

    # Find spare_parts with matching PO number that aren't already linked
    matching = (
        client.table("spare_parts")
        .select("*, plants_master(fleet_number, description)")
        .eq("purchase_order_number", po_number)
        .is_("purchase_order_id", "null")  # Not yet linked
        .execute()
    )

    # Also try case-insensitive match
    if not matching.data:
        matching = (
            client.table("spare_parts")
            .select("*, plants_master(fleet_number, description)")
            .ilike("purchase_order_number", po_number)
            .is_("purchase_order_id", "null")
            .execute()
        )

    parts = []
    for part in matching.data or []:
        plant_info = part.pop("plants_master", {}) or {}
        parts.append({
            **part,
            "fleet_number": plant_info.get("fleet_number"),
            "plant_description": plant_info.get("description"),
        })

    return {
        "success": True,
        "data": parts,
        "meta": {
            "po_number": po_number,
            "matching_count": len(parts),
            "total_cost": sum(float(p.get("total_cost") or 0) for p in parts),
        },
    }


@router.post("/{po_id}/link-spare-parts")
async def link_spare_parts_to_po(
    po_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    spare_part_ids: str = Query(..., description="Comma-separated spare_part UUIDs to link"),
) -> dict[str, Any]:
    """Link existing spare_parts records to this purchase order.

    Use this after find-matching-spare-parts to connect legacy spare_parts
    (entered via Excel) to the PO record.

    Args:
        po_id: The purchase order UUID.
        spare_part_ids: Comma-separated UUIDs of spare_parts to link.

    Returns:
        Number of records linked.
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

    # Parse IDs
    ids = [sid.strip() for sid in spare_part_ids.split(",") if sid.strip()]

    if not ids:
        raise ValidationError("No spare_part_ids provided")

    # Update spare_parts to link to PO
    linked_count = 0
    for spare_id in ids:
        try:
            result = (
                client.table("spare_parts")
                .update({"purchase_order_id": str(po_id)})
                .eq("id", spare_id)
                .is_("purchase_order_id", "null")  # Only if not already linked
                .execute()
            )
            if result.data:
                linked_count += 1
        except Exception as e:
            logger.warning("Failed to link spare_part", spare_part_id=spare_id, error=str(e))

    logger.info(
        "Linked spare_parts to PO",
        po_id=str(po_id),
        po_number=po.data["po_number"],
        linked_count=linked_count,
        attempted=len(ids),
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="update",
        table_name="spare_parts",
        record_id=str(po_id),
        new_values={"linked_spare_parts": ids},
        ip_address=get_client_ip(request),
        description=f"Linked {linked_count} spare_parts to PO {po.data['po_number']}",
    )

    return {
        "success": True,
        "message": f"Linked {linked_count} of {len(ids)} spare_parts to PO",
        "data": {
            "linked_count": linked_count,
            "attempted": len(ids),
        },
    }


@router.post("/{po_id}/link-all-matching-spare-parts")
async def link_all_matching_spare_parts(
    po_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Automatically link all spare_parts that match this PO's number.

    Convenience endpoint that finds and links all matching spare_parts in one call.

    Args:
        po_id: The purchase order UUID.

    Returns:
        Number of records linked.
    """
    client = get_supabase_admin_client()

    # Get PO
    po = (
        client.table("purchase_orders")
        .select("id, po_number")
        .eq("id", str(po_id))
        .single()
        .execute()
    )

    if not po.data:
        raise NotFoundError("Purchase order", str(po_id))

    po_number = po.data["po_number"]

    # Update all matching spare_parts
    result = (
        client.table("spare_parts")
        .update({"purchase_order_id": str(po_id)})
        .eq("purchase_order_number", po_number)
        .is_("purchase_order_id", "null")
        .execute()
    )

    linked_count = len(result.data) if result.data else 0

    # Also try case-insensitive
    if linked_count == 0:
        result = (
            client.table("spare_parts")
            .update({"purchase_order_id": str(po_id)})
            .ilike("purchase_order_number", po_number)
            .is_("purchase_order_id", "null")
            .execute()
        )
        linked_count = len(result.data) if result.data else 0

    logger.info(
        "Auto-linked spare_parts to PO",
        po_id=str(po_id),
        po_number=po_number,
        linked_count=linked_count,
        user_id=current_user.id,
    )

    if linked_count > 0:
        background_tasks.add_task(
            audit_service.log,
            user_id=current_user.id,
            user_email=current_user.email,
            action="update",
            table_name="spare_parts",
            record_id=str(po_id),
            new_values={"auto_linked_count": linked_count},
            ip_address=get_client_ip(request),
            description=f"Auto-linked {linked_count} spare_parts to PO {po_number}",
        )

    return {
        "success": True,
        "message": f"Linked {linked_count} spare_parts to PO {po_number}",
        "data": {
            "linked_count": linked_count,
            "po_number": po_number,
        },
    }


# ---------- Unresolved Fleet Numbers ----------


@router.get("/unresolved-fleets")
async def list_unresolved_fleets(
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    """List all unresolved fleet entries across POs.

    These are fleet numbers that couldn't be matched to plants_master.
    Admin can review and either:
    - Create a new plant
    - Link to an existing plant
    - Mark as category/workshop

    Returns:
        List of unresolved fleet entries with their PO info.
    """
    client = get_supabase_admin_client()

    query = (
        client.table("purchase_order_fleets")
        .select("*, purchase_orders(po_number, po_date, vendor)", count="exact")
        .is_("plant_id", "null")
        .eq("is_resolved", False)
        .eq("is_workshop", False)
        .eq("is_category", False)
        .order("created_at", desc=True)
    )

    offset = (page - 1) * limit
    result = query.range(offset, offset + limit - 1).execute()
    total = result.count or 0

    fleets = []
    for f in result.data or []:
        po_info = f.pop("purchase_orders", {}) or {}
        fleets.append({
            **f,
            "po_number": po_info.get("po_number"),
            "po_date": po_info.get("po_date"),
            "vendor": po_info.get("vendor"),
        })

    return {
        "success": True,
        "data": fleets,
        "meta": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        },
    }


@router.post("/fleets/{fleet_id}/resolve")
async def resolve_fleet_entry(
    fleet_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    action: str = Query(..., pattern="^(link_plant|create_plant|mark_category|mark_workshop)$"),
    plant_id: UUID | None = Query(None, description="Plant UUID for link_plant action"),
    fleet_number: str | None = Query(None, description="Fleet number for create_plant action"),
    description: str | None = Query(None, description="Description for create_plant"),
    category_name: str | None = Query(None, description="Category name for mark_category"),
) -> dict[str, Any]:
    """Resolve an unresolved fleet entry.

    Actions:
    - link_plant: Link to existing plant (requires plant_id)
    - create_plant: Create new plant and link (requires fleet_number)
    - mark_category: Mark as category entry (requires category_name)
    - mark_workshop: Mark as workshop/general entry

    Args:
        fleet_id: The fleet association UUID.
        action: Resolution action to take.
        plant_id: Plant UUID for link_plant action.
        fleet_number: Fleet number for create_plant action.
        description: Description for create_plant action.
        category_name: Category name for mark_category action.

    Returns:
        Updated fleet entry.
    """
    client = get_supabase_admin_client()

    # Get fleet entry
    fleet = (
        client.table("purchase_order_fleets")
        .select("*")
        .eq("id", str(fleet_id))
        .single()
        .execute()
    )

    if not fleet.data:
        raise NotFoundError("Fleet entry", str(fleet_id))

    update_data = {}

    if action == "link_plant":
        if not plant_id:
            raise ValidationError("plant_id is required for link_plant action")

        # Verify plant exists
        plant = (
            client.table("plants_master")
            .select("id, fleet_number, fleet_type")
            .eq("id", str(plant_id))
            .single()
            .execute()
        )

        if not plant.data:
            raise NotFoundError("Plant", str(plant_id))

        update_data = {
            "plant_id": str(plant_id),
            "fleet_type": plant.data.get("fleet_type"),
            "is_resolved": True,
        }

    elif action == "create_plant":
        if not fleet_number:
            raise ValidationError("fleet_number is required for create_plant action")

        # Check if plant already exists
        existing = (
            client.table("plants_master")
            .select("id")
            .eq("fleet_number", fleet_number.upper())
            .execute()
        )

        if existing.data:
            raise ValidationError(
                f"Plant with fleet number '{fleet_number}' already exists",
                details=[{"field": "fleet_number", "message": "Already exists", "code": "DUPLICATE"}],
            )

        # Extract prefix for fleet_type lookup
        import re
        prefix_match = re.match(r"^([A-Z]+)", fleet_number.upper())
        fleet_type = None
        if prefix_match:
            prefix = prefix_match.group(1)
            type_lookup = (
                client.table("fleet_number_prefixes")
                .select("fleet_type")
                .eq("prefix", prefix)
                .execute()
            )
            if type_lookup.data:
                fleet_type = type_lookup.data[0]["fleet_type"]

        # Create new plant
        plant_data = {
            "fleet_number": fleet_number.upper(),
            "description": description,
            "fleet_type": fleet_type,
            "status": "unverified",
        }
        plant_result = client.table("plants_master").insert(plant_data).execute()
        new_plant = plant_result.data[0]

        update_data = {
            "plant_id": new_plant["id"],
            "fleet_type": fleet_type,
            "is_resolved": True,
        }

        logger.info(
            "Created plant from PO fleet entry",
            plant_id=new_plant["id"],
            fleet_number=fleet_number.upper(),
            fleet_id=str(fleet_id),
            user_id=current_user.id,
        )

    elif action == "mark_category":
        if not category_name:
            raise ValidationError("category_name is required for mark_category action")

        update_data = {
            "is_category": True,
            "category_name": category_name.upper(),
            "is_resolved": True,
        }

    elif action == "mark_workshop":
        update_data = {
            "is_workshop": True,
            "is_resolved": True,
        }

    # Update fleet entry
    result = (
        client.table("purchase_order_fleets")
        .update(update_data)
        .eq("id", str(fleet_id))
        .execute()
    )

    logger.info(
        "Resolved fleet entry",
        fleet_id=str(fleet_id),
        action=action,
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="update",
        table_name="purchase_order_fleets",
        record_id=str(fleet_id),
        old_values={"is_resolved": False},
        new_values=update_data,
        ip_address=get_client_ip(request),
        description=f"Resolved fleet entry via {action}",
    )

    return {
        "success": True,
        "message": f"Fleet entry resolved via {action}",
        "data": result.data[0] if result.data else None,
    }


# ---------- Line Items with Spare Parts ----------


@router.post("/{po_id}/items-with-parts", status_code=201)
async def add_item_and_create_spare_parts(
    po_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    description: str = Query(..., description="Item description"),
    quantity: int = Query(1, ge=1),
    unit_cost: float = Query(..., ge=0),
    part_number: str | None = Query(None),
    plant_ids: str | None = Query(None, description="Comma-separated plant UUIDs to create spare_parts for"),
    distribute_cost: bool = Query(False, description="Split cost among plants (true) or duplicate full cost (false)"),
) -> dict[str, Any]:
    """Add a line item to PO and optionally create spare_parts records for plants.

    This combines adding a line item with creating the corresponding spare_parts
    records for one or more plants.

    Args:
        po_id: The purchase order UUID.
        description: Item description.
        quantity: Quantity.
        unit_cost: Unit cost.
        part_number: Part number.
        plant_ids: Plants to create spare_parts for.
        distribute_cost: If true, split cost among plants. If false, each plant gets full cost.

    Returns:
        Created line item and spare_parts.
    """
    client = get_supabase_admin_client()

    # Verify PO exists and get details
    po = (
        client.table("purchase_orders")
        .select("id, po_number, po_date, location_id, vat_percentage, discount_percentage")
        .eq("id", str(po_id))
        .single()
        .execute()
    )

    if not po.data:
        raise NotFoundError("Purchase order", str(po_id))

    # Create line item
    item_data = {
        "purchase_order_id": str(po_id),
        "description": description,
        "quantity": quantity,
        "unit_cost": unit_cost,
        "part_number": part_number,
    }

    item_result = client.table("purchase_order_items").insert(item_data).execute()
    created_item = item_result.data[0]

    # Create spare_parts if plant_ids provided
    created_parts = []
    if plant_ids:
        pids = [pid.strip() for pid in plant_ids.split(",") if pid.strip()]
        plant_count = len(pids)

        for pid in pids:
            # Calculate cost per plant
            if distribute_cost and plant_count > 1:
                part_quantity = quantity // plant_count or 1
                part_unit_cost = unit_cost
            else:
                part_quantity = quantity
                part_unit_cost = unit_cost

            part_data = {
                "purchase_order_id": str(po_id),
                "plant_id": pid,
                "part_description": description,
                "part_number": part_number,
                "quantity": part_quantity,
                "unit_cost": part_unit_cost,
                "purchase_order_number": po.data["po_number"],
                "po_date": po.data.get("po_date"),
                "location_id": po.data.get("location_id"),
                "vat_percentage": po.data.get("vat_percentage", 0),
                "discount_percentage": po.data.get("discount_percentage", 0),
                "created_by": current_user.id,
            }

            try:
                part_result = client.table("spare_parts").insert(part_data).execute()
                created_parts.append(part_result.data[0])
            except Exception as e:
                logger.warning("Failed to create spare_part", plant_id=pid, error=str(e))

    logger.info(
        "Created PO item with spare_parts",
        po_id=str(po_id),
        item_id=created_item["id"],
        spare_parts_count=len(created_parts),
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="create",
        table_name="purchase_order_items",
        record_id=created_item["id"],
        new_values={**item_data, "spare_parts_created": len(created_parts)},
        ip_address=get_client_ip(request),
        description=f"Added item to PO {po.data['po_number']}: {description}",
    )

    return {
        "success": True,
        "data": {
            "item": created_item,
            "spare_parts": created_parts,
        },
        "meta": {
            "item_total": float(created_item.get("total_cost") or 0),
            "spare_parts_count": len(created_parts),
            "distribute_cost": distribute_cost,
        },
    }
