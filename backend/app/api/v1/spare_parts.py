"""Spare parts management endpoints."""

from datetime import date, datetime
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


def parse_flexible_date(date_str: str | None) -> date | None:
    """Parse date from various formats.

    Accepts:
    - ISO format: 2026-01-13
    - Day-Month-Year: 13-01-26, 13/01/26, 13-01-2026
    - Day-MonthName-Year: 13-January-26, 13-Jan-2026

    Args:
        date_str: Date string in various formats.

    Returns:
        Parsed date or None.
    """
    if not date_str:
        return None

    if isinstance(date_str, date):
        return date_str

    date_str = date_str.strip()

    # Try various formats
    formats = [
        "%Y-%m-%d",      # 2026-01-13
        "%d-%m-%Y",      # 13-01-2026
        "%d/%m/%Y",      # 13/01/2026
        "%d-%m-%y",      # 13-01-26
        "%d/%m/%y",      # 13/01/26
        "%d-%B-%y",      # 13-January-26
        "%d-%B-%Y",      # 13-January-2026
        "%d-%b-%y",      # 13-Jan-26
        "%d-%b-%Y",      # 13-Jan-2026
        "%d %B %Y",      # 13 January 2026
        "%d %B %y",      # 13 January 26
        "%d %b %Y",      # 13 Jan 2026
        "%d %b %y",      # 13 Jan 26
        "%B %d, %Y",     # January 13, 2026
        "%b %d, %Y",     # Jan 13, 2026
    ]

    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt).date()
        except ValueError:
            continue

    # If nothing worked, raise error with helpful message
    raise ValidationError(
        f"Could not parse date '{date_str}'. Use format: YYYY-MM-DD (e.g., 2026-01-13) or DD-MM-YYYY (e.g., 13-01-2026)",
        details=[{"field": "po_date", "message": "Invalid date format", "code": "INVALID_FORMAT"}],
    )


@router.get("")
async def list_spare_parts(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    plant_id: UUID | None = None,
    fleet_number: str | None = None,
    location_id: UUID | None = None,
    supplier: str | None = None,
    po_number: str | None = Query(None, description="Filter by PO number"),
    date_from: date | None = None,
    date_to: date | None = None,
    year: int | None = None,
    month: int | None = None,
    week: int | None = None,
    quarter: int | None = None,
    search: str | None = None,
) -> dict[str, Any]:
    """List spare parts (PO line items) with filtering and pagination.

    Filter by:
    - plant_id or fleet_number (specific plant)
    - location_id (specific site)
    - po_number (specific PO)
    - date_from/date_to (date range)
    - year, month, week, quarter (time periods)
    - supplier, search (text search)
    """
    client = get_supabase_admin_client()

    query = (
        client.table("spare_parts")
        .select("*, plants_master(fleet_number, description)", count="exact")
    )

    # Apply filters
    if plant_id:
        query = query.eq("plant_id", str(plant_id))
    if fleet_number:
        query = query.eq("plants_master.fleet_number", fleet_number.upper())
    if location_id:
        query = query.eq("location_id", str(location_id))
    if supplier:
        query = query.ilike("supplier", f"%{supplier}%")
    if po_number:
        query = query.ilike("purchase_order_number", f"%{po_number}%")
    if date_from:
        query = query.gte("replaced_date", str(date_from))
    if date_to:
        query = query.lte("replaced_date", str(date_to))
    if year:
        query = query.eq("year", year)
    if month:
        query = query.eq("month", month)
    if week:
        query = query.eq("week_number", week)
    if quarter:
        query = query.eq("quarter", quarter)
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


@router.get("/autocomplete/suppliers")
async def autocomplete_suppliers(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(10, ge=1, le=50),
) -> dict[str, Any]:
    """Get supplier suggestions for autocomplete.

    Returns distinct supplier names matching the search query.

    Args:
        q: Search query (minimum 1 character).
        limit: Maximum suggestions to return.

    Returns:
        List of matching supplier names.
    """
    client = get_supabase_admin_client()

    try:
        result = client.rpc(
            "search_distinct_values",
            {
                "p_table": "spare_parts",
                "p_column": "supplier",
                "p_search": q,
                "p_limit": limit,
            },
        ).execute()

        # Extract just the values from the RPC result
        suggestions = [row.get("value") for row in (result.data or []) if row.get("value")]
        return {"success": True, "data": suggestions}

    except Exception:
        # Fallback if RPC fails - use direct query
        result = (
            client.table("spare_parts")
            .select("supplier")
            .ilike("supplier", f"%{q}%")
            .not_.is_("supplier", "null")
            .limit(limit * 3)  # Get more to account for duplicates
            .execute()
        )
        # Get distinct values
        seen = set()
        suggestions = []
        for row in result.data or []:
            val = row.get("supplier")
            if val and val not in seen:
                seen.add(val)
                suggestions.append(val)
                if len(suggestions) >= limit:
                    break
        return {"success": True, "data": suggestions}


@router.get("/autocomplete/descriptions")
async def autocomplete_descriptions(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    q: str = Query(..., min_length=2, description="Search query"),
    limit: int = Query(10, ge=1, le=50),
) -> dict[str, Any]:
    """Get part description suggestions for autocomplete.

    Returns distinct part descriptions matching the search query.

    Args:
        q: Search query (minimum 2 characters).
        limit: Maximum suggestions to return.

    Returns:
        List of matching part descriptions.
    """
    client = get_supabase_admin_client()

    try:
        result = client.rpc(
            "search_distinct_values",
            {
                "p_table": "spare_parts",
                "p_column": "part_description",
                "p_search": q,
                "p_limit": limit,
            },
        ).execute()

        # Extract just the values from the RPC result
        suggestions = [row.get("value") for row in (result.data or []) if row.get("value")]
        return {"success": True, "data": suggestions}

    except Exception:
        # Fallback if RPC fails - use direct query
        result = (
            client.table("spare_parts")
            .select("part_description")
            .ilike("part_description", f"%{q}%")
            .not_.is_("part_description", "null")
            .limit(limit * 3)
            .execute()
        )
        seen = set()
        suggestions = []
        for row in result.data or []:
            val = row.get("part_description")
            if val and val not in seen:
                seen.add(val)
                suggestions.append(val)
                if len(suggestions) >= limit:
                    break
        return {"success": True, "data": suggestions}


@router.get("/autocomplete/po-numbers")
async def autocomplete_po_numbers(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(10, ge=1, le=50),
) -> dict[str, Any]:
    """Get PO number suggestions for autocomplete.

    Returns distinct PO numbers matching the search query.
    Useful to check if a PO has already been entered.

    Args:
        q: Search query (minimum 1 character).
        limit: Maximum suggestions to return.

    Returns:
        List of matching PO numbers with item count.
    """
    client = get_supabase_admin_client()

    result = (
        client.table("spare_parts")
        .select("purchase_order_number")
        .ilike("purchase_order_number", f"%{q.upper()}%")
        .not_.is_("purchase_order_number", "null")
        .limit(limit * 3)
        .execute()
    )

    # Get distinct with counts
    po_counts: dict[str, int] = {}
    for row in result.data or []:
        po = row.get("purchase_order_number")
        if po:
            po_counts[po] = po_counts.get(po, 0) + 1

    # Sort by frequency and limit
    suggestions = [
        {"po_number": po, "items_count": count}
        for po, count in sorted(po_counts.items(), key=lambda x: -x[1])[:limit]
    ]

    return {"success": True, "data": suggestions}


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
    part_number: str | None = None,
    supplier: str | None = Query(None, description="Vendor/supplier name"),
    reason_for_change: str | None = None,
    unit_cost: float | None = None,
    quantity: int = 1,
    vat_percentage: float | None = Query(default=None, ge=0, le=100, description="VAT percentage (0-100). Use this OR vat_amount."),
    vat_amount: float | None = Query(default=None, ge=0, description="Absolute VAT amount. Use this OR vat_percentage."),
    discount_percentage: float | None = Query(default=None, ge=0, le=100, description="Discount percentage (0-100). Use this OR discount_amount."),
    discount_amount: float | None = Query(default=None, ge=0, description="Absolute discount amount. Use this OR discount_percentage."),
    other_costs: float = Query(default=0, ge=0, description="Additional costs (shipping, handling, etc.)"),
    purchase_order_number: str | None = Query(None, description="PO number from document"),
    po_date: str | None = Query(None, description="PO date (formats: 2026-01-13, 13-01-26, 13-January-26)"),
    requisition_number: str | None = Query(None, description="REQ NO from PO (e.g., ABJ 340888)"),
    location_id: UUID | None = Query(None, description="Location/site UUID"),
    remarks: str | None = None,
) -> dict[str, Any]:
    """Create a new spare part / PO line item record.

    This is the main endpoint for entering PO data. Each call creates one line item.
    For a PO with multiple items, call this endpoint multiple times with the same PO number.

    Total cost is auto-calculated as: subtotal + VAT - discount + other_costs
    Where:
    - subtotal = unit_cost × quantity
    - VAT = vat_amount (if provided) OR subtotal × vat_percentage / 100
    - discount = discount_amount (if provided) OR subtotal × discount_percentage / 100

    You can provide either:
    - plant_id OR fleet_number (for identifying the plant)
    - vat_percentage OR vat_amount (for VAT calculation)
    - discount_percentage OR discount_amount (for discount calculation)

    Date formats accepted: 2026-01-13, 13-01-2026, 13/01/26, 13-January-26, 13-Jan-26

    Args:
        plant_id: The plant UUID (use this OR fleet_number).
        fleet_number: Fleet number string (alternative to plant_id).
        part_description: Description of the part/item.
        part_number: Part number if known.
        supplier: Vendor/supplier name.
        reason_for_change: Why the part was replaced.
        unit_cost: Cost per unit.
        quantity: Number of parts.
        vat_percentage: VAT percentage (0-100). Use this OR vat_amount.
        vat_amount: Absolute VAT amount already calculated. Use this OR vat_percentage.
        discount_percentage: Discount percentage (0-100). Use this OR discount_amount.
        discount_amount: Absolute discount amount already calculated. Use this OR discount_percentage.
        other_costs: Additional costs (shipping, handling, etc.).
        purchase_order_number: PO number from the document.
        po_date: Date on the PO (used for both po_date and replaced_date).
        requisition_number: REQ NO (e.g., ABJ 340888, KWO 12345).
        location_id: Location/site UUID.
        remarks: Additional notes.

    Returns:
        Created spare part with ID and calculated total_cost.
    """
    client = get_supabase_admin_client()

    # Parse the date (flexible format)
    parsed_date = parse_flexible_date(po_date)

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

    # Calculate time dimensions from date if provided
    year = None
    month = None
    week_number = None
    quarter = None
    if parsed_date:
        year = parsed_date.year
        month = parsed_date.month
        week_number = parsed_date.isocalendar()[1]
        quarter = (month - 1) // 3 + 1

    # Create spare part (po_date = replaced_date, same thing)
    # Use either percentage or absolute amount for VAT and discount
    part_data = {
        "plant_id": resolved_plant_id,
        "part_description": part_description,
        "replaced_date": str(parsed_date) if parsed_date else None,
        "part_number": part_number,
        "supplier": supplier,
        "reason_for_change": reason_for_change,
        "unit_cost": unit_cost,
        "quantity": quantity,
        "vat_percentage": vat_percentage if vat_amount is None else 0,
        "vat_amount": vat_amount,
        "discount_percentage": discount_percentage if discount_amount is None else 0,
        "discount_amount": discount_amount,
        "other_costs": other_costs,
        "purchase_order_number": purchase_order_number.upper() if purchase_order_number else None,
        "po_date": str(parsed_date) if parsed_date else None,
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
    fleet_numbers: str = Query(..., description="Fleet(s): T468, 463, WORKSHOP, LOW LOADER"),
    purchase_order_number: str = Query(..., description="PO number"),
    items: str = Query(..., description="Items: desc|qty|cost|part_no;next..."),
    po_date: str | None = Query(None, description="Date (13-January-26, 2026-01-13, etc.)"),
    requisition_number: str | None = Query(None, description="REQ NO"),
    location_id: UUID | None = Query(None, description="Location UUID"),
    supplier_id: UUID | None = Query(None, description="Supplier UUID (preferred)"),
    supplier: str | None = Query(None, description="Vendor name (will resolve to supplier_id)"),
    vat_percentage: float | None = Query(None, ge=0, le=100, description="VAT %"),
    vat_amount: float | None = Query(None, ge=0, description="Total VAT amount"),
    discount_percentage: float | None = Query(None, ge=0, le=100, description="Discount %"),
    discount_amount: float | None = Query(None, ge=0, description="Total discount amount"),
    other_costs: float = Query(default=0, ge=0, description="Other costs"),
) -> dict[str, Any]:
    """
    **UNIFIED PO ENTRY - Handles ALL scenarios**

    - Single fleet: `T468`
    - Multiple fleets: `T468, 463, 466`
    - Workshop: `WORKSHOP` or `W/SHOP`
    - Categories: `LOW LOADER`, `VOLVO`, `CONSUMABLES`
    - Mixed: `T468, WORKSHOP, LOW LOADER`

    **Items Format:**
    ```
    NOZZLE SET|6|415000|170-5181;TIPS|8|35000|1U3352
    ```
    Format: description|quantity|unit_cost|part_number (semicolon-separated)

    **Date Formats:** 2026-01-13, 13-01-26, 13-January-26, 13/01/26

    **Cost Classification:**
    - `direct`: Single resolved plant, no workshop/category
    - `shared`: Multiple plants, or has workshop, or has category
    """
    import json
    from app.services.fleet_parser import parse_fleet_input, get_cost_classification

    client = get_supabase_admin_client()

    # Check for duplicate PO - block if exists
    po_upper = purchase_order_number.upper().strip()
    existing_po = (
        client.table("spare_parts")
        .select("id, purchase_order_number")
        .eq("purchase_order_number", po_upper)
        .limit(1)
        .execute()
    )

    if existing_po.data:
        raise ValidationError(
            f"PO '{po_upper}' already exists. Use PATCH /spare-parts/{{id}} to edit existing line items.",
            details=[{"field": "purchase_order_number", "message": "Already exists", "code": "DUPLICATE_PO"}],
        )

    # Resolve supplier_id from supplier name if not provided directly
    resolved_supplier_id = None
    resolved_supplier_name = None
    supplier_matched_by = None  # "exact", "fuzzy", or "new"

    if supplier_id:
        # Verify supplier exists
        sup = client.table("suppliers").select("id, name").eq("id", str(supplier_id)).execute()
        if sup.data:
            resolved_supplier_id = str(supplier_id)
            resolved_supplier_name = sup.data[0]["name"]
            supplier_matched_by = "exact"
        else:
            raise ValidationError(f"Supplier with ID '{supplier_id}' not found")
    elif supplier:
        supplier_input = supplier.strip()

        # Step 1: Try exact match (case-insensitive)
        sup = client.table("suppliers").select("id, name").ilike("name", supplier_input).execute()
        if sup.data:
            resolved_supplier_id = sup.data[0]["id"]
            resolved_supplier_name = sup.data[0]["name"]
            supplier_matched_by = "exact"
        else:
            # Step 2: Try fuzzy matching using pg_trgm similarity
            fuzzy_result = client.rpc(
                "find_similar_supplier",
                {"p_name": supplier_input, "p_threshold": 0.3}
            ).execute()

            if fuzzy_result.data and len(fuzzy_result.data) > 0:
                # Use the best fuzzy match
                best_match = fuzzy_result.data[0]
                resolved_supplier_id = best_match["id"]
                resolved_supplier_name = best_match["name"]
                supplier_matched_by = "fuzzy"
                logger.info(
                    "Fuzzy matched supplier",
                    input=supplier_input,
                    matched_to=best_match["name"],
                    similarity=best_match["similarity"],
                )
            else:
                # Step 3: No match found - create new supplier
                new_sup = client.table("suppliers").insert({"name": supplier_input}).execute()
                if new_sup.data:
                    resolved_supplier_id = new_sup.data[0]["id"]
                    resolved_supplier_name = new_sup.data[0]["name"]
                    supplier_matched_by = "new"
                    logger.info("Created new supplier", supplier_name=supplier_input)

    # Parse the date
    parsed_date = parse_flexible_date(po_date)

    # Parse items
    items_list = []
    items_stripped = items.strip()

    if items_stripped.startswith("["):
        try:
            items_list = json.loads(items_stripped)
            if not isinstance(items_list, list) or not items_list:
                raise ValidationError("items must be a non-empty JSON array")
        except json.JSONDecodeError as e:
            raise ValidationError(f"Invalid JSON: {str(e)}")
    else:
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

        if not items_list:
            raise ValidationError("No valid items. Format: description|qty|cost|part_no;next...")

    # Parse fleet numbers (handles T468, 463, WORKSHOP, LOW LOADER, etc.)
    parsed_fleets = parse_fleet_input(fleet_numbers)
    if not parsed_fleets:
        raise ValidationError("At least one fleet entry is required")

    # Determine cost type
    cost_type = get_cost_classification(parsed_fleets)

    # Calculate time dimensions
    year = parsed_date.year if parsed_date else None
    month = parsed_date.month if parsed_date else None
    week_number = parsed_date.isocalendar()[1] if parsed_date else None
    quarter = (month - 1) // 3 + 1 if month else None

    # Calculate subtotal for VAT/discount distribution
    subtotal = sum((item.get("unit_cost") or 0) * (item.get("quantity") or 1) for item in items_list)

    # Calculate VAT and discount totals
    if vat_amount is not None:
        total_vat = vat_amount
    else:
        total_vat = subtotal * (vat_percentage or 0) / 100

    if discount_amount is not None:
        total_discount = discount_amount
    else:
        total_discount = subtotal * (discount_percentage or 0) / 100

    # Create spare parts for each fleet entry × each item
    created_parts = []
    total_cost_sum = 0

    for fleet in parsed_fleets:
        for item in items_list:
            item_subtotal = (item.get("unit_cost") or 0) * (item.get("quantity") or 1)

            # Distribute VAT/discount proportionally
            if subtotal > 0:
                item_vat = total_vat * (item_subtotal / subtotal) / len(parsed_fleets)
                item_discount = total_discount * (item_subtotal / subtotal) / len(parsed_fleets)
                item_other = other_costs * (item_subtotal / subtotal) / len(parsed_fleets)
            else:
                item_vat = 0
                item_discount = 0
                item_other = 0

            part_data = {
                "plant_id": fleet["plant_id"],  # None for workshop/category
                "fleet_number_raw": fleet["fleet_number_raw"],
                "is_workshop": fleet["is_workshop"],
                "is_category": fleet.get("is_category", False),
                "category_name": fleet.get("category_name"),
                "cost_type": cost_type,
                "part_description": item["description"],
                "part_number": item.get("part_number"),
                "quantity": item.get("quantity", 1),
                "unit_cost": item.get("unit_cost"),
                "purchase_order_number": purchase_order_number.upper(),
                "po_date": str(parsed_date) if parsed_date else None,
                "replaced_date": str(parsed_date) if parsed_date else None,
                "requisition_number": requisition_number.upper() if requisition_number else None,
                "location_id": str(location_id) if location_id else None,
                "supplier_id": resolved_supplier_id,
                "supplier": resolved_supplier_name,
                "vat_amount": round(item_vat, 2) if item_vat > 0 else None,
                "discount_amount": round(item_discount, 2) if item_discount > 0 else None,
                "other_costs": round(item_other, 2) if item_other > 0 else None,
                "vat_percentage": 0,
                "discount_percentage": 0,
                "year": year,
                "month": month,
                "week_number": week_number,
                "quarter": quarter,
                "created_by": current_user.id,
            }

            result = client.table("spare_parts").insert(part_data).execute()
            created = result.data[0]
            created_parts.append(created)
            total_cost_sum += float(created.get("total_cost") or 0)

    # Get resolved fleet numbers for response
    resolved_fleets = [f["fleet_number_raw"] for f in parsed_fleets]
    plants_resolved = [f for f in parsed_fleets if f["plant_id"]]

    logger.info(
        "PO bulk entry created",
        po_number=purchase_order_number.upper(),
        fleets=resolved_fleets,
        items_count=len(items_list),
        records_created=len(created_parts),
        cost_type=cost_type,
        total_cost=total_cost_sum,
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="create",
        table_name="spare_parts",
        record_id=purchase_order_number.upper(),
        new_values={"po_number": purchase_order_number, "fleets": resolved_fleets, "items": len(items_list)},
        ip_address=get_client_ip(request),
        description=f"PO {purchase_order_number.upper()}: {len(items_list)} items for {', '.join(resolved_fleets)}",
    )

    return {
        "success": True,
        "data": created_parts,
        "meta": {
            "po_number": purchase_order_number.upper(),
            "cost_type": cost_type,
            "fleets": resolved_fleets,
            "fleets_resolved": len(plants_resolved),
            "has_workshop": any(f["is_workshop"] for f in parsed_fleets),
            "has_category": any(f.get("is_category") for f in parsed_fleets),
            "items_count": len(items_list),
            "records_created": len(created_parts),
            "subtotal": round(subtotal, 2),
            "vat": round(total_vat, 2),
            "discount": round(total_discount, 2),
            "other_costs": other_costs,
            "total_cost": round(total_cost_sum, 2),
            "supplier": {
                "id": resolved_supplier_id,
                "name": resolved_supplier_name,
                "matched_by": supplier_matched_by,  # "exact", "fuzzy", or "new"
            } if resolved_supplier_id else None,
        },
    }


# Keep old endpoint name for backwards compatibility
@router.post("/entry", status_code=201)
async def create_spare_parts_entry(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    fleet_numbers: str = Query(..., description="Fleet(s): T468, 463, WORKSHOP, LOW LOADER"),
    purchase_order_number: str = Query(..., description="PO number"),
    items: str = Query(..., description="Items: desc|qty|cost|part_no;next..."),
    po_date: str | None = Query(None),
    requisition_number: str | None = Query(None),
    location_id: UUID | None = Query(None),
    supplier: str | None = Query(None),
    vat_percentage: float | None = Query(None, ge=0, le=100),
    vat_amount: float | None = Query(None, ge=0),
    discount_percentage: float | None = Query(None, ge=0, le=100),
    discount_amount: float | None = Query(None, ge=0),
    other_costs: float = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Alias for /bulk - use /bulk instead."""
    return await create_spare_parts_bulk(
        request, background_tasks, current_user,
        fleet_numbers, purchase_order_number, items, po_date,
        requisition_number, location_id, supplier,
        vat_percentage, vat_amount, discount_percentage, discount_amount, other_costs,
    )


# Legacy endpoint for single fleet - redirects to bulk
@router.post("/legacy-bulk", status_code=201, include_in_schema=False)
async def create_spare_parts_legacy(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    fleet_number: str = Query(...),
    purchase_order_number: str = Query(...),
    items: str = Query(...),
    po_date: str | None = Query(None),
    requisition_number: str | None = Query(None),
    location_id: UUID | None = Query(None),
    supplier: str | None = Query(None),
    vat_percentage: float | None = Query(None, ge=0, le=100),
    vat_amount: float | None = Query(None, ge=0),
    discount_percentage: float | None = Query(None, ge=0, le=100),
    discount_amount: float | None = Query(None, ge=0),
    other_costs: float = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Legacy endpoint - use /bulk with fleet_numbers instead."""
    return await create_spare_parts_bulk(
        request, background_tasks, current_user,
        fleet_number, purchase_order_number, items, po_date,
        requisition_number, location_id, supplier,
        vat_percentage, vat_amount, discount_percentage, discount_amount, other_costs,
    )


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


# ============== PO-LEVEL ENDPOINTS ==============

@router.get("/pos")
async def list_purchase_orders(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    location_id: UUID | None = None,
    supplier_id: UUID | None = Query(None, description="Filter by supplier"),
    date_from: date | None = None,
    date_to: date | None = None,
    vendor: str | None = None,
    search: str | None = None,
    cost_type: str | None = Query(None, pattern="^(direct|shared)$"),
    year: int | None = None,
    month: int | None = None,
    week: int | None = None,
    quarter: int | None = None,
    sort_by: str = Query("po_date", pattern="^(po_date|created_at)$", description="Sort by: po_date (default) or created_at (recently added)"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$", description="Sort order: asc or desc"),
) -> dict[str, Any]:
    """List purchase orders (aggregated from spare_parts).

    Filter by date range, year, month, week, quarter, location, vendor, supplier, cost_type.
    Sort by po_date (PO date) or created_at (recently added).
    """
    client = get_supabase_admin_client()

    query = client.table("v_purchase_orders_summary").select("*", count="exact")

    if location_id:
        query = query.eq("location_id", str(location_id))
    if supplier_id:
        query = query.eq("supplier_id", str(supplier_id))
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
    if year:
        query = query.eq("year", year)
    if month:
        query = query.eq("month", month)
    if week:
        query = query.eq("week_number", week)
    if quarter:
        query = query.eq("quarter", quarter)

    offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)
    query = query.order(sort_by, desc=(sort_order == "desc"))

    result = query.execute()
    total = result.count or 0

    # Calculate totals for filtered data
    total_amount = sum(float(po.get("total_amount") or 0) for po in result.data or [])

    return {
        "success": True,
        "data": result.data,
        "meta": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_amount": round(total_amount, 2),
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        },
    }


@router.get("/plant/{plant_id}/costs")
async def get_plant_costs(
    plant_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    month: int | None = None,
    quarter: int | None = None,
    week: int | None = None,
) -> dict[str, Any]:
    """Get maintenance costs for a specific plant.

    Filter by year, month, quarter, or week for time-based analysis.
    """
    client = get_supabase_admin_client()

    # Get plant info
    plant_result = (
        client.table("plants_master")
        .select("id, fleet_number, description, fleet_type, current_location_id, locations(name)")
        .eq("id", str(plant_id))
        .single()
        .execute()
    )

    if not plant_result.data:
        raise NotFoundError("Plant", str(plant_id))

    plant = plant_result.data
    location_info = plant.pop("locations", {}) or {}
    plant["current_location"] = location_info.get("name")

    # Get costs using RPC
    costs_result = client.rpc(
        "get_plant_costs_by_period",
        {
            "p_plant_id": str(plant_id),
            "p_year": year,
            "p_month": month,
            "p_quarter": quarter,
            "p_week": week,
        },
    ).execute()

    costs = costs_result.data[0] if costs_result.data else {
        "total_cost": 0,
        "parts_count": 0,
        "po_count": 0,
    }

    # Get recent spare parts for this plant
    parts_query = (
        client.table("spare_parts")
        .select("id, part_description, quantity, total_cost, purchase_order_number, replaced_date, supplier")
        .eq("plant_id", str(plant_id))
    )

    if year:
        parts_query = parts_query.eq("year", year)
    if month:
        parts_query = parts_query.eq("month", month)
    if quarter:
        parts_query = parts_query.eq("quarter", quarter)
    if week:
        parts_query = parts_query.eq("week_number", week)

    parts_query = parts_query.order("replaced_date", desc=True).limit(20)
    parts_result = parts_query.execute()

    return {
        "success": True,
        "data": {
            "plant": plant,
            "costs": {
                "total_cost": float(costs.get("total_cost") or 0),
                "parts_count": int(costs.get("parts_count") or 0),
                "po_count": int(costs.get("po_count") or 0),
            },
            "recent_parts": parts_result.data or [],
        },
        "meta": {
            "year": year,
            "month": month,
            "quarter": quarter,
            "week": week,
        },
    }


@router.get("/location/{location_id}/costs")
async def get_location_costs(
    location_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    month: int | None = None,
) -> dict[str, Any]:
    """Get maintenance costs for a specific location/site."""
    client = get_supabase_admin_client()

    # Get location info
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

    # Get costs for this location
    query = (
        client.table("spare_parts")
        .select("total_cost, plant_id, is_workshop, is_category")
        .eq("location_id", str(location_id))
    )

    if year:
        query = query.eq("year", year)
    if month:
        query = query.eq("month", month)

    result = query.execute()
    data = result.data or []

    total_cost = sum(float(r.get("total_cost") or 0) for r in data)
    direct_cost = sum(float(r.get("total_cost") or 0) for r in data if r.get("plant_id") and not r.get("is_workshop") and not r.get("is_category"))
    workshop_cost = sum(float(r.get("total_cost") or 0) for r in data if r.get("is_workshop"))
    category_cost = sum(float(r.get("total_cost") or 0) for r in data if r.get("is_category"))

    return {
        "success": True,
        "data": {
            "location": location,
            "costs": {
                "total_cost": round(total_cost, 2),
                "direct_cost": round(direct_cost, 2),
                "workshop_cost": round(workshop_cost, 2),
                "category_cost": round(category_cost, 2),
            },
            "items_count": len(data),
            "plants_count": len(set(r.get("plant_id") for r in data if r.get("plant_id"))),
        },
        "meta": {
            "year": year,
            "month": month,
        },
    }


@router.get("/summary")
async def get_overall_summary(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    month: int | None = None,
    location_id: UUID | None = None,
) -> dict[str, Any]:
    """Get overall maintenance cost summary."""
    client = get_supabase_admin_client()

    query = client.table("spare_parts").select("total_cost, plant_id, is_workshop, is_category, location_id")

    if year:
        query = query.eq("year", year)
    if month:
        query = query.eq("month", month)
    if location_id:
        query = query.eq("location_id", str(location_id))

    result = query.execute()
    data = result.data or []

    total_cost = sum(float(r.get("total_cost") or 0) for r in data)
    direct_cost = sum(float(r.get("total_cost") or 0) for r in data if r.get("plant_id") and not r.get("is_workshop") and not r.get("is_category"))
    workshop_cost = sum(float(r.get("total_cost") or 0) for r in data if r.get("is_workshop"))
    category_cost = sum(float(r.get("total_cost") or 0) for r in data if r.get("is_category"))

    # Get distinct counts
    po_numbers = set(r.get("purchase_order_number") for r in data if r.get("purchase_order_number"))
    plant_ids = set(r.get("plant_id") for r in data if r.get("plant_id"))
    location_ids = set(r.get("location_id") for r in data if r.get("location_id"))

    return {
        "success": True,
        "data": {
            "total_cost": round(total_cost, 2),
            "direct_cost": round(direct_cost, 2),
            "workshop_cost": round(workshop_cost, 2),
            "category_cost": round(category_cost, 2),
            "items_count": len(data),
            "po_count": len(po_numbers),
            "plants_count": len(plant_ids),
            "locations_count": len(location_ids),
        },
        "meta": {
            "year": year,
            "month": month,
            "location_id": str(location_id) if location_id else None,
        },
    }


@router.get("/analytics/by-period")
async def get_costs_by_period(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    period: str = Query(..., pattern="^(week|month|quarter|year)$", description="Period type"),
    year: int = Query(..., description="Year to analyze"),
    plant_id: UUID | None = None,
    location_id: UUID | None = None,
) -> dict[str, Any]:
    """Get costs grouped by period (week, month, quarter, year).

    Returns totals for each week/month/quarter in the specified year,
    useful for trend analysis and charts.
    """
    client = get_supabase_admin_client()

    # Determine the grouping column
    period_column = {
        "week": "week_number",
        "month": "month",
        "quarter": "quarter",
        "year": "year",
    }[period]

    query = (
        client.table("spare_parts")
        .select(f"{period_column}, total_cost, plant_id, purchase_order_number")
        .eq("year", year)
    )

    if plant_id:
        query = query.eq("plant_id", str(plant_id))
    if location_id:
        query = query.eq("location_id", str(location_id))

    result = query.execute()
    data = result.data or []

    # Group by period
    period_totals: dict[int, dict] = {}
    for item in data:
        p = item.get(period_column)
        if p is None:
            continue
        if p not in period_totals:
            period_totals[p] = {"total_cost": 0, "items_count": 0, "po_numbers": set()}
        period_totals[p]["total_cost"] += float(item.get("total_cost") or 0)
        period_totals[p]["items_count"] += 1
        if item.get("purchase_order_number"):
            period_totals[p]["po_numbers"].add(item["purchase_order_number"])

    # Convert to list
    periods = []
    for p in sorted(period_totals.keys()):
        periods.append({
            period: p,
            "total_cost": round(period_totals[p]["total_cost"], 2),
            "items_count": period_totals[p]["items_count"],
            "po_count": len(period_totals[p]["po_numbers"]),
        })

    grand_total = sum(p["total_cost"] for p in periods)

    return {
        "success": True,
        "data": periods,
        "meta": {
            "period_type": period,
            "year": year,
            "plant_id": str(plant_id) if plant_id else None,
            "location_id": str(location_id) if location_id else None,
            "grand_total": round(grand_total, 2),
            "periods_count": len(periods),
        },
    }


@router.get("/analytics/year-over-year")
async def get_year_over_year(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    years: str = Query(..., description="Comma-separated years to compare, e.g., '2025,2026'"),
    plant_id: UUID | None = None,
    location_id: UUID | None = None,
    group_by: str = Query("month", pattern="^(month|quarter)$"),
) -> dict[str, Any]:
    """Compare costs year-over-year.

    Returns monthly or quarterly totals for each year for comparison.
    """
    client = get_supabase_admin_client()

    year_list = [int(y.strip()) for y in years.split(",") if y.strip().isdigit()]
    if not year_list:
        raise ValidationError("At least one valid year is required")

    period_column = "month" if group_by == "month" else "quarter"

    query = (
        client.table("spare_parts")
        .select(f"year, {period_column}, total_cost, purchase_order_number")
        .in_("year", year_list)
    )

    if plant_id:
        query = query.eq("plant_id", str(plant_id))
    if location_id:
        query = query.eq("location_id", str(location_id))

    result = query.execute()
    data = result.data or []

    # Group by year and period
    year_data: dict[int, dict[int, dict]] = {y: {} for y in year_list}
    for item in data:
        y = item.get("year")
        p = item.get(period_column)
        if y is None or p is None or y not in year_data:
            continue
        if p not in year_data[y]:
            year_data[y][p] = {"total_cost": 0, "items_count": 0, "po_numbers": set()}
        year_data[y][p]["total_cost"] += float(item.get("total_cost") or 0)
        year_data[y][p]["items_count"] += 1
        if item.get("purchase_order_number"):
            year_data[y][p]["po_numbers"].add(item["purchase_order_number"])

    # Format response
    comparison = []
    max_period = 12 if group_by == "month" else 4
    for p in range(1, max_period + 1):
        row = {group_by: p}
        for y in year_list:
            if p in year_data[y]:
                row[str(y)] = round(year_data[y][p]["total_cost"], 2)
            else:
                row[str(y)] = 0
        comparison.append(row)

    # Yearly totals
    yearly_totals = {}
    for y in year_list:
        yearly_totals[str(y)] = round(sum(d["total_cost"] for d in year_data[y].values()), 2)

    return {
        "success": True,
        "data": comparison,
        "meta": {
            "years": year_list,
            "group_by": group_by,
            "plant_id": str(plant_id) if plant_id else None,
            "location_id": str(location_id) if location_id else None,
            "yearly_totals": yearly_totals,
        },
    }
