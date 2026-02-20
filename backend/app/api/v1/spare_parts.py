"""Spare parts management endpoints."""

from datetime import date, datetime
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, UploadFile, File

from app.api.v1.auth import get_client_ip
from app.core.database import get_supabase_admin_client  # Storage only
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
    supplier_id: UUID | None = Query(None, description="Filter by supplier ID"),
    supplier: str | None = Query(None, description="Filter by supplier name (text search)"),
    po_number: str | None = Query(None, description="Filter by PO number"),
    date_from: date | None = None,
    date_to: date | None = None,
    year: int | None = None,
    month: int | None = None,
    week: int | None = None,
    quarter: int | None = None,
    search: str | None = None,
) -> dict[str, Any]:
    """List spare parts (PO line items) with filtering and pagination."""
    conds: list[str] = []
    params: list[Any] = []

    if plant_id:
        params.append(str(plant_id))
        conds.append(f"sp.plant_id = ${len(params)}::uuid")
    if fleet_number:
        params.append(fleet_number.upper())
        conds.append(f"pm.fleet_number = ${len(params)}")
    if location_id:
        params.append(str(location_id))
        conds.append(f"sp.location_id = ${len(params)}::uuid")
    if supplier_id:
        params.append(str(supplier_id))
        conds.append(f"sp.supplier_id = ${len(params)}::uuid")
    elif supplier:
        params.append(f"%{supplier}%")
        conds.append(f"sp.supplier ILIKE ${len(params)}")
    if po_number:
        params.append(f"%{po_number}%")
        conds.append(f"sp.purchase_order_number ILIKE ${len(params)}")
    if date_from:
        params.append(date_from)
        conds.append(f"sp.replaced_date >= ${len(params)}::date")
    if date_to:
        params.append(date_to)
        conds.append(f"sp.replaced_date <= ${len(params)}::date")
    if year:
        params.append(year)
        conds.append(f"sp.year = ${len(params)}")
    if month:
        params.append(month)
        conds.append(f"sp.month = ${len(params)}")
    if week:
        params.append(week)
        conds.append(f"sp.week_number = ${len(params)}")
    if quarter:
        params.append(quarter)
        conds.append(f"sp.quarter = ${len(params)}")
    if search:
        params.append(f"%{search}%")
        n = len(params)
        conds.append(f"(sp.part_description ILIKE ${n} OR sp.part_number ILIKE ${n})")

    where = " AND ".join(conds) if conds else "TRUE"

    offset = (page - 1) * limit
    params.append(limit)
    params.append(offset)
    rows = await fetch(
        f"""SELECT sp.*,
                   pm.fleet_number, pm.description AS plant_description,
                   COALESCE(s.name, sp.supplier) AS supplier_name,
                   count(*) OVER() AS _total_count
            FROM spare_parts sp
            LEFT JOIN plants_master pm ON pm.id = sp.plant_id
            LEFT JOIN suppliers s ON s.id = sp.supplier_id
            WHERE {where}
            ORDER BY sp.replaced_date DESC NULLS LAST
            LIMIT ${len(params) - 1} OFFSET ${len(params)}""",
        *params,
    )

    total = rows[0].pop("_total_count", 0) if rows else 0
    for row in rows[1:]:
        row.pop("_total_count", None)

    return {
        "success": True,
        "data": rows,
        "meta": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        },
    }


@router.get("/autocomplete/descriptions")
async def autocomplete_descriptions(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    q: str = Query(..., min_length=2, description="Search query"),
    limit: int = Query(10, ge=1, le=50),
) -> dict[str, Any]:
    """Get part description suggestions for autocomplete."""
    try:
        result = await fetch(
            "SELECT * FROM search_distinct_values($1, $2, $3, $4)",
            "spare_parts", "part_description", q, limit,
        )
        suggestions = [row.get("search_distinct_values") for row in result if row.get("search_distinct_values")]
        return {"success": True, "data": suggestions}
    except Exception:
        # Fallback — direct query
        rows = await fetch(
            """SELECT DISTINCT part_description
               FROM spare_parts
               WHERE part_description ILIKE $1
                 AND part_description IS NOT NULL
               LIMIT $2""",
            f"%{q}%",
            limit,
        )
        return {"success": True, "data": [r["part_description"] for r in rows]}


@router.get("/autocomplete/po-numbers")
async def autocomplete_po_numbers(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(10, ge=1, le=50),
) -> dict[str, Any]:
    """Get PO number suggestions for autocomplete."""
    rows = await fetch(
        """SELECT purchase_order_number, count(*)::int AS items_count
           FROM spare_parts
           WHERE purchase_order_number ILIKE $1
             AND purchase_order_number IS NOT NULL
           GROUP BY purchase_order_number
           ORDER BY count(*) DESC
           LIMIT $2""",
        f"%{q.upper()}%",
        limit,
    )

    suggestions = [
        {"po_number": row["purchase_order_number"], "items_count": row["items_count"]}
        for row in rows
    ]

    return {"success": True, "data": suggestions}


@router.get("/stats")
async def get_spare_parts_stats(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = Query(None, description="Filter by year"),
    month: int | None = Query(None, ge=1, le=12, description="Filter by month (1-12)"),
    week: int | None = Query(None, ge=1, le=53, description="Filter by week (1-53)"),
    quarter: int | None = Query(None, ge=1, le=4, description="Filter by quarter (1-4)"),
    location_id: UUID | None = Query(None, description="Filter by location"),
    supplier_id: UUID | None = Query(None, description="Filter by supplier"),
) -> dict[str, Any]:
    """Get spare parts statistics."""
    row = await fetchrow(
        "SELECT * FROM get_spare_parts_stats($1, $2, $3, $4, $5, $6)",
        year, month, week, quarter,
        str(location_id) if location_id else None,
        str(supplier_id) if supplier_id else None,
    )

    return {
        "success": True,
        "data": row or {},
        "meta": {
            "filters": {
                "year": year, "month": month, "week": week, "quarter": quarter,
                "location_id": str(location_id) if location_id else None,
                "supplier_id": str(supplier_id) if supplier_id else None,
            },
        },
    }


@router.get("/top-suppliers")
async def get_top_suppliers(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    limit: int = Query(10, ge=1, le=50),
    year: int | None = Query(None, description="Filter by year"),
    month: int | None = Query(None, ge=1, le=12, description="Filter by month"),
    quarter: int | None = Query(None, ge=1, le=4, description="Filter by quarter"),
    location_id: UUID | None = Query(None, description="Filter by location"),
) -> dict[str, Any]:
    """Get top suppliers by total spend."""
    data = await fetch(
        "SELECT * FROM get_top_suppliers($1, $2, $3, $4, $5)",
        limit, year, month, quarter,
        str(location_id) if location_id else None,
    )

    return {"success": True, "data": data}


@router.get("/high-cost-plants")
async def get_high_cost_plants(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    limit: int = Query(10, ge=1, le=50),
    year: int | None = None,
) -> dict[str, Any]:
    """Get plants with highest maintenance costs."""
    data = await fetch(
        "SELECT * FROM get_high_cost_plants($1, $2)",
        limit, year,
    )

    return {"success": True, "data": data}


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
    vat_percentage: float | None = Query(default=None, ge=0, le=100),
    vat_amount: float | None = Query(default=None, ge=0),
    discount_percentage: float | None = Query(default=None, ge=0, le=100),
    discount_amount: float | None = Query(default=None, ge=0),
    other_costs: float = Query(default=0, ge=0),
    purchase_order_number: str | None = Query(None),
    po_date: str | None = Query(None, description="PO date (formats: 2026-01-13, 13-01-26, 13-January-26)"),
    requisition_number: str | None = Query(None),
    location_id: UUID | None = Query(None),
    remarks: str | None = None,
) -> dict[str, Any]:
    """Create a new spare part / PO line item record."""
    parsed_date = parse_flexible_date(po_date)

    resolved_plant_id = None
    resolved_fleet_number = None

    if plant_id:
        plant = await fetchrow(
            "SELECT id, fleet_number FROM plants_master WHERE id = $1::uuid",
            str(plant_id),
        )
        if not plant:
            raise NotFoundError("Plant", str(plant_id))
        resolved_plant_id = str(plant_id)
        resolved_fleet_number = plant["fleet_number"]
    elif fleet_number:
        plant = await fetchrow(
            "SELECT id, fleet_number FROM plants_master WHERE fleet_number = $1",
            fleet_number.upper(),
        )
        if not plant:
            raise NotFoundError("Plant with fleet number", fleet_number.upper())
        resolved_plant_id = plant["id"]
        resolved_fleet_number = plant["fleet_number"]
    else:
        raise ValidationError(
            "Either plant_id or fleet_number is required",
            details=[{"field": "plant_id", "message": "Required", "code": "REQUIRED"}],
        )

    # Calculate time dimensions
    calc_year = parsed_date.year if parsed_date else None
    calc_month = parsed_date.month if parsed_date else None
    calc_week = parsed_date.isocalendar()[1] if parsed_date else None
    calc_quarter = (calc_month - 1) // 3 + 1 if calc_month else None

    created = await fetchrow(
        """INSERT INTO spare_parts
               (plant_id, part_description, replaced_date, part_number,
                supplier, reason_for_change, unit_cost, quantity,
                vat_percentage, vat_amount, discount_percentage, discount_amount,
                other_costs, purchase_order_number, po_date, requisition_number,
                location_id, year, month, week_number, quarter, remarks, created_by)
           VALUES ($1::uuid, $2, $3::date, $4,
                   $5, $6, $7, $8,
                   $9, $10, $11, $12,
                   $13, $14, $15::date, $16,
                   $17::uuid, $18, $19, $20, $21, $22, $23)
           RETURNING *""",
        resolved_plant_id,
        part_description,
        parsed_date,
        part_number,
        supplier,
        reason_for_change,
        unit_cost,
        quantity,
        vat_percentage if vat_amount is None else 0,
        vat_amount,
        discount_percentage if discount_amount is None else 0,
        discount_amount,
        other_costs,
        purchase_order_number.upper() if purchase_order_number else None,
        parsed_date,
        requisition_number.upper() if requisition_number else None,
        str(location_id) if location_id else None,
        calc_year, calc_month, calc_week, calc_quarter,
        remarks,
        current_user.id,
    )

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
        new_values={"part_description": part_description, "plant_id": resolved_plant_id},
        ip_address=get_client_ip(request),
        description=f"Created spare part for {resolved_fleet_number}: {part_description}",
    )

    return {
        "success": True,
        "data": {**created, "fleet_number": resolved_fleet_number},
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
    """UNIFIED PO ENTRY - Handles ALL scenarios."""
    import json
    from app.services.fleet_parser import parse_fleet_input, get_cost_classification

    # Check for duplicate PO
    po_upper = purchase_order_number.upper().strip()
    existing_po = await fetchrow(
        "SELECT id FROM spare_parts WHERE purchase_order_number = $1 LIMIT 1",
        po_upper,
    )
    if existing_po:
        raise ValidationError(
            f"PO '{po_upper}' already exists. Use PATCH /spare-parts/{{id}} to edit existing line items.",
            details=[{"field": "purchase_order_number", "message": "Already exists", "code": "DUPLICATE_PO"}],
        )

    # Resolve supplier
    resolved_supplier_id = None
    resolved_supplier_name = None
    supplier_matched_by = None

    if supplier_id:
        sup = await fetchrow(
            "SELECT id, name FROM suppliers WHERE id = $1::uuid", str(supplier_id),
        )
        if not sup:
            raise ValidationError(f"Supplier with ID '{supplier_id}' not found")
        resolved_supplier_id = str(supplier_id)
        resolved_supplier_name = sup["name"]
        supplier_matched_by = "exact"
    elif supplier:
        supplier_input = supplier.strip()
        # Exact match (case-insensitive)
        sup = await fetchrow(
            "SELECT id, name FROM suppliers WHERE name ILIKE $1", supplier_input,
        )
        if sup:
            resolved_supplier_id = sup["id"]
            resolved_supplier_name = sup["name"]
            supplier_matched_by = "exact"
        else:
            # Fuzzy match
            fuzzy = await fetch(
                "SELECT * FROM find_similar_supplier($1, $2)",
                supplier_input, 0.3,
            )
            if fuzzy:
                best = fuzzy[0]
                resolved_supplier_id = best["id"]
                resolved_supplier_name = best["name"]
                supplier_matched_by = "fuzzy"
                logger.info("Fuzzy matched supplier", input=supplier_input, matched_to=best["name"])
            else:
                # Create new supplier
                new_sup = await fetchrow(
                    "INSERT INTO suppliers (name) VALUES ($1) RETURNING *",
                    supplier_input,
                )
                if new_sup:
                    resolved_supplier_id = new_sup["id"]
                    resolved_supplier_name = new_sup["name"]
                    supplier_matched_by = "new"
                    logger.info("Created new supplier", supplier_name=supplier_input)

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
            item_dict: dict[str, Any] = {"description": parts[0]}
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
            if len(parts) > 4 and parts[4]:
                item_dict["item_fleet"] = parts[4].upper()
            items_list.append(item_dict)
        if not items_list:
            raise ValidationError("No valid items. Format: description|qty|cost|part_no|fleet;next...")

    # Parse fleet numbers (now async)
    parsed_fleets = await parse_fleet_input(fleet_numbers)
    if not parsed_fleets:
        raise ValidationError("At least one fleet entry is required")

    cost_type = get_cost_classification(parsed_fleets)

    # Time dimensions
    calc_year = parsed_date.year if parsed_date else None
    calc_month = parsed_date.month if parsed_date else None
    calc_week = parsed_date.isocalendar()[1] if parsed_date else None
    calc_quarter = (calc_month - 1) // 3 + 1 if calc_month else None

    # Calculate subtotal for VAT/discount distribution
    subtotal = sum((item.get("unit_cost") or 0) * (item.get("quantity") or 1) for item in items_list)
    total_vat = vat_amount if vat_amount is not None else subtotal * (vat_percentage or 0) / 100
    total_discount = discount_amount if discount_amount is not None else subtotal * (discount_percentage or 0) / 100

    # Separate direct vs shared items
    direct_items = [item for item in items_list if item.get("item_fleet")]
    shared_items = [item for item in items_list if not item.get("item_fleet")]

    # Build fleet lookup
    fleet_lookup: dict[str, dict] = {}
    for fleet in parsed_fleets:
        fleet_lookup[fleet["fleet_number_raw"]] = fleet
        if fleet.get("plant_id"):
            plant_row = await fetchrow(
                "SELECT fleet_number FROM plants_master WHERE id = $1::uuid",
                str(fleet["plant_id"]),
            )
            if plant_row:
                fleet_lookup[plant_row["fleet_number"]] = fleet

    created_parts = []
    total_cost_sum = 0
    direct_count = 0
    shared_count = 0

    date_val = parsed_date

    # Process DIRECT items
    for item in direct_items:
        item_fleet = item["item_fleet"]
        item_subtotal = (item.get("unit_cost") or 0) * (item.get("quantity") or 1)

        fleet = fleet_lookup.get(item_fleet)
        if not fleet:
            resolved = await parse_fleet_input(item_fleet)
            if resolved and resolved[0].get("plant_id"):
                fleet = resolved[0]
        if not fleet:
            logger.warning(f"Could not resolve fleet '{item_fleet}' for item '{item['description']}'")
            continue

        frac = item_subtotal / subtotal if subtotal > 0 else 0
        item_vat = total_vat * frac
        item_disc = total_discount * frac
        item_other = other_costs * frac

        created = await fetchrow(
            """INSERT INTO spare_parts
                   (plant_id, assigned_plant_id, fleet_number_raw, is_workshop, is_category,
                    category_name, cost_type, part_description, part_number, quantity, unit_cost,
                    purchase_order_number, po_date, replaced_date, requisition_number,
                    location_id, supplier_id, supplier,
                    vat_amount, discount_amount, other_costs, vat_percentage, discount_percentage,
                    year, month, week_number, quarter, created_by)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5,
                       $6, 'direct', $7, $8, $9, $10,
                       $11, $12::date, $12::date, $13,
                       $14::uuid, $15::uuid, $16,
                       $17, $18, $19, 0, 0,
                       $20, $21, $22, $23, $24)
               RETURNING *""",
            fleet.get("plant_id"),
            fleet.get("plant_id"),
            item_fleet,
            fleet.get("is_workshop", False),
            fleet.get("is_category", False),
            fleet.get("category_name"),
            item["description"],
            item.get("part_number"),
            item.get("quantity", 1),
            item.get("unit_cost"),
            po_upper,
            date_val,
            requisition_number.upper() if requisition_number else None,
            str(location_id) if location_id else None,
            str(resolved_supplier_id) if resolved_supplier_id else None,
            resolved_supplier_name,
            round(item_vat, 2) if item_vat > 0 else None,
            round(item_disc, 2) if item_disc > 0 else None,
            round(item_other, 2) if item_other > 0 else None,
            calc_year, calc_month, calc_week, calc_quarter,
            current_user.id,
        )
        if created:
            created_parts.append(created)
            total_cost_sum += float(created.get("total_cost") or 0)
            direct_count += 1

    # Process SHARED items
    for fleet in parsed_fleets:
        for item in shared_items:
            item_subtotal = (item.get("unit_cost") or 0) * (item.get("quantity") or 1)
            frac = (item_subtotal / subtotal / len(parsed_fleets)) if subtotal > 0 else 0
            item_vat = total_vat * frac
            item_disc = total_discount * frac
            item_other = other_costs * frac

            created = await fetchrow(
                """INSERT INTO spare_parts
                       (plant_id, assigned_plant_id, fleet_number_raw, is_workshop, is_category,
                        category_name, cost_type, part_description, part_number, quantity, unit_cost,
                        purchase_order_number, po_date, replaced_date, requisition_number,
                        location_id, supplier_id, supplier,
                        vat_amount, discount_amount, other_costs, vat_percentage, discount_percentage,
                        year, month, week_number, quarter, created_by)
                   VALUES ($1::uuid, NULL, $2, $3, $4,
                           $5, $6, $7, $8, $9, $10,
                           $11, $12::date, $12::date, $13,
                           $14::uuid, $15::uuid, $16,
                           $17, $18, $19, 0, 0,
                           $20, $21, $22, $23, $24)
                   RETURNING *""",
                fleet["plant_id"],
                fleet["fleet_number_raw"],
                fleet["is_workshop"],
                fleet.get("is_category", False),
                fleet.get("category_name"),
                cost_type,
                item["description"],
                item.get("part_number"),
                item.get("quantity", 1),
                item.get("unit_cost"),
                po_upper,
                date_val,
                requisition_number.upper() if requisition_number else None,
                str(location_id) if location_id else None,
                str(resolved_supplier_id) if resolved_supplier_id else None,
                resolved_supplier_name,
                round(item_vat, 2) if item_vat > 0 else None,
                round(item_disc, 2) if item_disc > 0 else None,
                round(item_other, 2) if item_other > 0 else None,
                calc_year, calc_month, calc_week, calc_quarter,
                current_user.id,
            )
            if created:
                created_parts.append(created)
                total_cost_sum += float(created.get("total_cost") or 0)
                shared_count += 1

    resolved_fleets = [f["fleet_number_raw"] for f in parsed_fleets]
    plants_resolved = [f for f in parsed_fleets if f["plant_id"]]

    logger.info(
        "PO bulk entry created",
        po_number=po_upper,
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
        record_id=po_upper,
        new_values={"po_number": purchase_order_number, "fleets": resolved_fleets, "items": len(items_list)},
        ip_address=get_client_ip(request),
        description=f"PO {po_upper}: {len(items_list)} items for {', '.join(resolved_fleets)}",
    )

    return {
        "success": True,
        "data": created_parts,
        "meta": {
            "po_number": po_upper,
            "cost_type": cost_type,
            "fleets": resolved_fleets,
            "fleets_resolved": len(plants_resolved),
            "has_workshop": any(f["is_workshop"] for f in parsed_fleets),
            "has_category": any(f.get("is_category") for f in parsed_fleets),
            "items_count": len(items_list),
            "direct_items": len(direct_items),
            "shared_items": len(shared_items),
            "records_created": len(created_parts),
            "direct_records": direct_count,
            "shared_records": shared_count,
            "subtotal": round(subtotal, 2),
            "vat": round(total_vat, 2),
            "discount": round(total_discount, 2),
            "other_costs": other_costs,
            "total_cost": round(total_cost_sum, 2),
            "supplier": {
                "id": resolved_supplier_id,
                "name": resolved_supplier_name,
                "matched_by": supplier_matched_by,
            } if resolved_supplier_id else None,
        },
    }


# Keep old endpoint name for backwards compatibility
@router.post("/entry", status_code=201)
async def create_spare_parts_entry(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    fleet_numbers: str = Query(...),
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
    """Get all spare parts for a specific PO number."""
    rows = await fetch(
        """SELECT sp.*,
                  pm.fleet_number, pm.description AS plant_description,
                  COALESCE(s.name, sp.supplier) AS supplier_name,
                  s.id AS supplier_table_id, s.name AS supplier_table_name
           FROM spare_parts sp
           LEFT JOIN plants_master pm ON pm.id = sp.plant_id
           LEFT JOIN suppliers s ON s.id = sp.supplier_id
           WHERE sp.purchase_order_number ILIKE $1
           ORDER BY sp.created_at""",
        po_number,
    )

    total_cost = 0
    supplier_info = None
    for row in rows:
        total_cost += float(row.get("total_cost") or 0)
        if not supplier_info and row.get("supplier_table_id"):
            supplier_info = {"id": row["supplier_table_id"], "name": row["supplier_table_name"]}

    return {
        "success": True,
        "data": rows,
        "meta": {
            "po_number": po_number.upper(),
            "items_count": len(rows),
            "total_cost": round(total_cost, 2),
            "distinct_plants": len(set(r.get("plant_id") for r in rows if r.get("plant_id"))),
            "supplier": supplier_info,
        },
    }


@router.patch("/by-po/{po_number}")
async def update_po(
    po_number: str,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    po_date: str | None = Query(None),
    supplier_id: UUID | None = Query(None),
    vat_amount: float | None = Query(None, ge=0),
    discount_amount: float | None = Query(None, ge=0),
    location_id: UUID | None = Query(None),
    requisition_number: str | None = Query(None),
) -> dict[str, Any]:
    """Update PO-level details for all line items in a PO."""
    existing = await fetch(
        "SELECT id, total_cost, unit_cost, quantity FROM spare_parts WHERE purchase_order_number ILIKE $1",
        po_number,
    )
    if not existing:
        raise NotFoundError("PO", po_number)

    update_data: dict[str, Any] = {}
    set_parts: list[str] = []
    params: list[Any] = []

    if po_date:
        parsed_date = parse_flexible_date(po_date)
        if parsed_date:
            params.append(parsed_date)
            n = len(params)
            set_parts.extend([f"po_date = ${n}::date", f"replaced_date = ${n}::date"])
            update_data["po_date"] = parsed_date
            params.append(parsed_date.year)
            set_parts.append(f"year = ${len(params)}")
            params.append(parsed_date.month)
            set_parts.append(f"month = ${len(params)}")
            params.append(parsed_date.isocalendar()[1])
            set_parts.append(f"week_number = ${len(params)}")
            params.append((parsed_date.month - 1) // 3 + 1)
            set_parts.append(f"quarter = ${len(params)}")

    if supplier_id:
        sup = await fetchrow("SELECT id, name FROM suppliers WHERE id = $1::uuid", str(supplier_id))
        if not sup:
            raise NotFoundError("Supplier", str(supplier_id))
        params.append(str(supplier_id))
        set_parts.append(f"supplier_id = ${len(params)}::uuid")
        params.append(sup["name"])
        set_parts.append(f"supplier = ${len(params)}")
        update_data["supplier_id"] = str(supplier_id)
        update_data["supplier"] = sup["name"]

    if location_id:
        loc = await fetchrow("SELECT id FROM locations WHERE id = $1::uuid", str(location_id))
        if not loc:
            raise NotFoundError("Location", str(location_id))
        params.append(str(location_id))
        set_parts.append(f"location_id = ${len(params)}::uuid")
        update_data["location_id"] = str(location_id)

    if requisition_number is not None:
        params.append(requisition_number.upper() if requisition_number else None)
        set_parts.append(f"requisition_number = ${len(params)}")
        update_data["requisition_number"] = requisition_number

    # Handle VAT/discount redistribution per item
    if vat_amount is not None or discount_amount is not None:
        subtotal = sum((item.get("unit_cost") or 0) * (item.get("quantity") or 1) for item in existing)
        for item in existing:
            item_subtotal = (item.get("unit_cost") or 0) * (item.get("quantity") or 1)
            item_sets: list[str] = []
            item_params: list[Any] = []
            if vat_amount is not None and subtotal > 0:
                item_params.append(round(vat_amount * (item_subtotal / subtotal), 2))
                item_sets.append(f"vat_amount = ${len(item_params)}")
            if discount_amount is not None and subtotal > 0:
                item_params.append(round(discount_amount * (item_subtotal / subtotal), 2))
                item_sets.append(f"discount_amount = ${len(item_params)}")
            if item_sets:
                item_params.append(str(item["id"]))
                await execute(
                    f"UPDATE spare_parts SET {', '.join(item_sets)} WHERE id = ${len(item_params)}::uuid",
                    *item_params,
                )

    # Apply common updates to all items
    if set_parts:
        params.append(po_number)
        await execute(
            f"UPDATE spare_parts SET {', '.join(set_parts)} WHERE purchase_order_number ILIKE ${len(params)}",
            *params,
        )

    logger.info(
        "PO updated", po_number=po_number.upper(),
        updated_fields=list(update_data.keys()), items_count=len(existing),
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id, user_email=current_user.email,
        action="update", table_name="spare_parts", record_id=po_number.upper(),
        new_values=update_data, ip_address=get_client_ip(request),
        description=f"Updated PO {po_number.upper()}: {', '.join(update_data.keys())}",
    )

    return {
        "success": True,
        "message": f"Updated {len(existing)} items in PO {po_number.upper()}",
        "updated_fields": list(update_data.keys()),
    }


@router.delete("/by-po/{po_number}")
async def delete_po(
    po_number: str,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Delete an entire PO and all its line items."""
    existing = await fetch(
        "SELECT id, part_description, total_cost FROM spare_parts WHERE purchase_order_number ILIKE $1",
        po_number,
    )
    if not existing:
        raise NotFoundError("PO", po_number)

    items_count = len(existing)
    total_cost = sum(float(item.get("total_cost") or 0) for item in existing)

    await execute(
        "DELETE FROM spare_parts WHERE purchase_order_number ILIKE $1",
        po_number,
    )

    logger.info("PO deleted", po_number=po_number.upper(), items_deleted=items_count, user_id=current_user.id)

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id, user_email=current_user.email,
        action="delete", table_name="spare_parts", record_id=po_number.upper(),
        old_values={"items_count": items_count, "total_cost": total_cost},
        ip_address=get_client_ip(request),
        description=f"Deleted PO {po_number.upper()} ({items_count} items, ₦{total_cost:,.2f})",
    )

    return {
        "success": True,
        "message": f"Deleted PO {po_number.upper()}",
        "details": {"items_deleted": items_count, "total_cost_deleted": round(total_cost, 2)},
    }


@router.post("/by-po/{po_number}/document")
async def upload_po_document(
    po_number: str,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    file: UploadFile = File(..., description="PO document (PDF or image)"),
) -> dict[str, Any]:
    """Upload a document for a PO. Storage stays on Supabase SDK."""
    # Verify PO exists
    existing = await fetchrow(
        "SELECT id FROM spare_parts WHERE purchase_order_number ILIKE $1 LIMIT 1",
        po_number,
    )
    if not existing:
        raise NotFoundError("PO", po_number)

    allowed_types = ["application/pdf", "image/jpeg", "image/png", "image/jpg"]
    if file.content_type not in allowed_types:
        raise ValidationError(
            f"Invalid file type: {file.content_type}. Allowed: PDF, JPEG, PNG",
            details=[{"field": "file", "message": "Invalid file type", "code": "INVALID_TYPE"}],
        )

    ext = file.filename.split(".")[-1] if file.filename and "." in file.filename else "pdf"
    unique_filename = f"po-documents/{po_number.upper()}/{uuid4()}.{ext}"
    file_content = await file.read()

    # Upload to Supabase Storage (SDK stays)
    try:
        client = get_supabase_admin_client()
        storage = client.storage.from_("documents")
        storage.upload(unique_filename, file_content, {"content-type": file.content_type})
        document_url = storage.get_public_url(unique_filename)
    except Exception as e:
        logger.error("Failed to upload document", error=str(e), po_number=po_number)
        raise ValidationError(f"Failed to upload document: {str(e)}")

    # Update DB via asyncpg
    await execute(
        """UPDATE spare_parts
           SET document_url = $1, document_name = $2, document_uploaded_at = now()
           WHERE purchase_order_number ILIKE $3""",
        document_url,
        file.filename,
        po_number,
    )

    logger.info("PO document uploaded", po_number=po_number.upper(), filename=file.filename, user_id=current_user.id)

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id, user_email=current_user.email,
        action="upload", table_name="spare_parts", record_id=po_number.upper(),
        new_values={"document_name": file.filename, "document_url": document_url},
        ip_address=get_client_ip(request),
        description=f"Uploaded document for PO {po_number.upper()}: {file.filename}",
    )

    return {
        "success": True,
        "data": {"po_number": po_number.upper(), "document_url": document_url, "document_name": file.filename},
    }


@router.get("/by-po/{po_number}/document")
async def get_po_document(
    po_number: str,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get the document URL for a PO."""
    doc = await fetchrow(
        """SELECT document_url, document_name, document_uploaded_at
           FROM spare_parts
           WHERE purchase_order_number ILIKE $1 AND document_url IS NOT NULL
           LIMIT 1""",
        po_number,
    )
    if not doc or not doc.get("document_url"):
        raise NotFoundError("Document for PO", po_number)

    return {
        "success": True,
        "data": {
            "po_number": po_number.upper(),
            "document_url": doc["document_url"],
            "document_name": doc["document_name"],
            "uploaded_at": doc["document_uploaded_at"],
        },
    }


@router.delete("/by-po/{po_number}/document")
async def delete_po_document(
    po_number: str,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Delete the document for a PO."""
    old_doc = await fetchrow(
        """SELECT document_url, document_name
           FROM spare_parts
           WHERE purchase_order_number ILIKE $1 AND document_url IS NOT NULL
           LIMIT 1""",
        po_number,
    )
    if not old_doc or not old_doc.get("document_url"):
        raise NotFoundError("Document for PO", po_number)

    await execute(
        """UPDATE spare_parts
           SET document_url = NULL, document_name = NULL, document_uploaded_at = NULL
           WHERE purchase_order_number ILIKE $1""",
        po_number,
    )

    logger.info("PO document deleted", po_number=po_number.upper(), user_id=current_user.id)

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id, user_email=current_user.email,
        action="delete", table_name="spare_parts", record_id=po_number.upper(),
        old_values={"document_name": old_doc["document_name"]},
        ip_address=get_client_ip(request),
        description=f"Deleted document for PO {po_number.upper()}",
    )

    return {"success": True, "message": f"Document deleted for PO {po_number.upper()}"}


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
    vat_percentage: float | None = Query(default=None, ge=0, le=100),
    discount_percentage: float | None = Query(default=None, ge=0, le=100),
    other_costs: float | None = Query(default=None, ge=0),
    purchase_order_number: str | None = None,
    remarks: str | None = None,
) -> dict[str, Any]:
    """Update an existing spare part."""
    update_fields: dict[str, Any] = {}
    if part_description is not None:
        update_fields["part_description"] = part_description
    if replaced_date is not None:
        update_fields["replaced_date"] = replaced_date
    if part_number is not None:
        update_fields["part_number"] = part_number
    if supplier is not None:
        update_fields["supplier"] = supplier
    if reason_for_change is not None:
        update_fields["reason_for_change"] = reason_for_change
    if unit_cost is not None:
        update_fields["unit_cost"] = unit_cost
    if quantity is not None:
        update_fields["quantity"] = quantity
    if vat_percentage is not None:
        update_fields["vat_percentage"] = vat_percentage
    if discount_percentage is not None:
        update_fields["discount_percentage"] = discount_percentage
    if other_costs is not None:
        update_fields["other_costs"] = other_costs
    if purchase_order_number is not None:
        update_fields["purchase_order_number"] = purchase_order_number
    if remarks is not None:
        update_fields["remarks"] = remarks

    if not update_fields:
        raise ValidationError("No fields to update")

    existing = await fetchrow(
        "SELECT * FROM spare_parts WHERE id = $1::uuid",
        str(part_id),
    )
    if not existing:
        raise NotFoundError("Spare part", str(part_id))

    old_values = {k: existing.get(k) for k in update_fields if k in existing}

    # Build dynamic SET clause
    set_parts: list[str] = []
    params: list[Any] = []
    for key, val in update_fields.items():
        params.append(val)
        if key == "replaced_date":
            set_parts.append(f"{key} = ${len(params)}::date")
        else:
            set_parts.append(f"{key} = ${len(params)}")

    params.append(str(part_id))
    updated = await fetchrow(
        f"UPDATE spare_parts SET {', '.join(set_parts)} WHERE id = ${len(params)}::uuid RETURNING *",
        *params,
    )

    logger.info("Spare part updated", part_id=str(part_id), updated_fields=list(update_fields.keys()), user_id=current_user.id)

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id, user_email=current_user.email,
        action="update", table_name="spare_parts", record_id=str(part_id),
        old_values=old_values, new_values=update_fields,
        ip_address=get_client_ip(request),
        description=f"Updated spare part {existing.get('part_description', str(part_id))}: {', '.join(update_fields.keys())}",
    )

    return {"success": True, "data": updated}


@router.delete("/{part_id}")
async def delete_spare_part(
    part_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Delete a spare part record."""
    existing = await fetchrow(
        "SELECT * FROM spare_parts WHERE id = $1::uuid",
        str(part_id),
    )
    if not existing:
        raise NotFoundError("Spare part", str(part_id))

    await execute("DELETE FROM spare_parts WHERE id = $1::uuid", str(part_id))

    logger.info("Spare part deleted", part_id=str(part_id), user_id=current_user.id)

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id, user_email=current_user.email,
        action="delete", table_name="spare_parts", record_id=str(part_id),
        old_values=existing, ip_address=get_client_ip(request),
        description=f"Deleted spare part {existing.get('part_description', str(part_id))}",
    )

    return {"success": True, "message": "Spare part deleted successfully"}


# ============== PO-LEVEL ENDPOINTS ==============

@router.get("/pos")
async def list_purchase_orders(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    location_id: UUID | None = None,
    supplier_id: UUID | None = Query(None),
    plant_id: UUID | None = Query(None),
    fleet_number: str | None = Query(None),
    date_from: date | None = None,
    date_to: date | None = None,
    vendor: str | None = None,
    search: str | None = Query(None),
    cost_type: str | None = Query(None, pattern="^(direct|shared)$"),
    year: int | None = None,
    month: int | None = None,
    week: int | None = None,
    quarter: int | None = None,
    sort_by: str = Query("po_date", pattern="^(po_date|created_at)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
) -> dict[str, Any]:
    """List purchase orders (aggregated from spare_parts)."""
    # If filtering by plant, first get PO numbers for this plant
    plant_po_numbers: list[str] | None = None
    if plant_id or fleet_number:
        target_plant_id = None
        if plant_id:
            target_plant_id = str(plant_id)
        elif fleet_number:
            p = await fetchrow(
                "SELECT id FROM plants_master WHERE fleet_number = $1", fleet_number.upper(),
            )
            if not p:
                return {"success": True, "data": [], "meta": {"page": page, "limit": limit, "total": 0, "total_amount": 0, "total_pages": 0}}
            target_plant_id = p["id"]

        po_rows = await fetch(
            """SELECT DISTINCT purchase_order_number
               FROM spare_parts WHERE plant_id = $1::uuid AND purchase_order_number IS NOT NULL""",
            target_plant_id,
        )
        plant_po_numbers = [r["purchase_order_number"] for r in po_rows]
        if not plant_po_numbers:
            return {"success": True, "data": [], "meta": {"page": page, "limit": limit, "total": 0, "total_amount": 0, "total_pages": 0}}

    # If searching in descriptions, get matching PO numbers
    desc_po_numbers: list[str] | None = None
    if search:
        desc_rows = await fetch(
            """SELECT DISTINCT purchase_order_number
               FROM spare_parts WHERE part_description ILIKE $1 AND purchase_order_number IS NOT NULL""",
            f"%{search}%",
        )
        desc_po_numbers = [r["purchase_order_number"] for r in desc_rows]

    conds: list[str] = []
    params: list[Any] = []

    if plant_po_numbers is not None:
        placeholders = ", ".join(f"${len(params) + i + 1}" for i in range(len(plant_po_numbers)))
        params.extend(plant_po_numbers)
        conds.append(f"po_number IN ({placeholders})")

    if location_id:
        params.append(str(location_id))
        conds.append(f"location_id = ${len(params)}::uuid")
    if supplier_id:
        params.append(str(supplier_id))
        conds.append(f"supplier_id = ${len(params)}::uuid")
    if date_from:
        params.append(date_from)
        conds.append(f"po_date >= ${len(params)}::date")
    if date_to:
        params.append(date_to)
        conds.append(f"po_date <= ${len(params)}::date")
    if vendor:
        params.append(f"%{vendor}%")
        conds.append(f"vendor ILIKE ${len(params)}")
    if search:
        search_cond_parts = [f"po_number ILIKE ${len(params) + 1}", f"vendor ILIKE ${len(params) + 1}"]
        params.append(f"%{search}%")
        if desc_po_numbers:
            desc_placeholders = ", ".join(f"${len(params) + i + 1}" for i in range(len(desc_po_numbers)))
            params.extend(desc_po_numbers)
            search_cond_parts.append(f"po_number IN ({desc_placeholders})")
        conds.append(f"({' OR '.join(search_cond_parts)})")
    if cost_type:
        params.append(cost_type)
        conds.append(f"cost_type = ${len(params)}")
    if year:
        params.append(year)
        conds.append(f"year = ${len(params)}")
    if month:
        params.append(month)
        conds.append(f"month = ${len(params)}")
    if week:
        params.append(week)
        conds.append(f"week_number = ${len(params)}")
    if quarter:
        params.append(quarter)
        conds.append(f"quarter = ${len(params)}")

    where = " AND ".join(conds) if conds else "TRUE"
    safe_sort = sort_by if sort_by in ("po_date", "created_at") else "po_date"
    direction = "DESC" if sort_order == "desc" else "ASC"

    offset = (page - 1) * limit
    params.append(limit)
    params.append(offset)
    data = await fetch(
        f"""SELECT v.*, l.name AS location_name,
                   count(*) OVER() AS _total_count,
                   SUM(v.total_amount) OVER() AS _grand_total
            FROM v_purchase_orders_summary v
            LEFT JOIN locations l ON l.id = v.location_id
            WHERE {where}
            ORDER BY v.{safe_sort} {direction} NULLS LAST
            LIMIT ${len(params) - 1} OFFSET ${len(params)}""",
        *params,
    )

    total = data[0].pop("_total_count", 0) if data else 0
    grand_total = float(data[0].pop("_grand_total", 0) or 0) if data else 0
    for row in data[1:]:
        row.pop("_total_count", None)
        row.pop("_grand_total", None)

    return {
        "success": True,
        "data": data,
        "meta": {
            "page": page, "limit": limit, "total": total,
            "total_amount": round(grand_total, 2),
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
    """Get maintenance costs for a specific plant."""
    plant = await fetchrow(
        """SELECT pm.id, pm.fleet_number, pm.description, pm.fleet_type,
                  pm.current_location_id, l.name AS current_location
           FROM plants_master pm
           LEFT JOIN locations l ON l.id = pm.current_location_id
           WHERE pm.id = $1::uuid""",
        str(plant_id),
    )
    if not plant:
        raise NotFoundError("Plant", str(plant_id))

    costs = await fetchrow(
        "SELECT * FROM get_plant_costs_by_period($1, $2, $3, $4, $5)",
        str(plant_id), year, month, quarter, week,
    )
    costs = costs or {"total_cost": 0, "parts_count": 0, "po_count": 0}

    # Recent parts
    conds = ["sp.plant_id = $1::uuid"]
    params: list[Any] = [str(plant_id)]
    if year:
        params.append(year)
        conds.append(f"sp.year = ${len(params)}")
    if month:
        params.append(month)
        conds.append(f"sp.month = ${len(params)}")
    if quarter:
        params.append(quarter)
        conds.append(f"sp.quarter = ${len(params)}")
    if week:
        params.append(week)
        conds.append(f"sp.week_number = ${len(params)}")

    where = " AND ".join(conds)
    recent_parts = await fetch(
        f"""SELECT sp.id, sp.part_description, sp.quantity, sp.total_cost,
                   sp.purchase_order_number, sp.replaced_date, sp.supplier
            FROM spare_parts sp
            WHERE {where}
            ORDER BY sp.replaced_date DESC NULLS LAST
            LIMIT 20""",
        *params,
    )

    return {
        "success": True,
        "data": {
            "plant": plant,
            "costs": {
                "total_cost": float(costs.get("total_cost") or 0),
                "parts_count": int(costs.get("parts_count") or 0),
                "po_count": int(costs.get("po_count") or 0),
            },
            "recent_parts": recent_parts,
        },
        "meta": {"year": year, "month": month, "quarter": quarter, "week": week},
    }


@router.get("/plant/{plant_id}/shared-costs")
async def get_plant_shared_costs(
    plant_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get shared costs for a specific plant."""
    plant = await fetchrow(
        "SELECT id, fleet_number, description FROM plants_master WHERE id = $1::uuid",
        str(plant_id),
    )
    if not plant:
        raise NotFoundError("Plant", str(plant_id))

    result = await fetch(
        "SELECT * FROM get_plant_shared_costs($1)",
        str(plant_id),
    )

    shared_costs = []
    for idx, po in enumerate(result, 1):
        shared_costs.append({
            "label": f"Shared Cost {idx}",
            "po_number": po.get("po_number"),
            "po_date": po.get("po_date"),
            "total_amount": float(po.get("total_amount") or 0),
            "supplier": po.get("supplier_name"),
            "shared_with": po.get("shared_with") or [],
            "items": po.get("items") or [],
        })

    return {
        "success": True,
        "data": {"plant": plant, "shared_costs": shared_costs, "shared_costs_count": len(shared_costs)},
    }


@router.get("/location/{location_id}/costs")
async def get_location_costs(
    location_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    month: int | None = None,
) -> dict[str, Any]:
    """Get maintenance costs for a specific location/site."""
    location = await fetchrow(
        "SELECT id, name FROM locations WHERE id = $1::uuid", str(location_id),
    )
    if not location:
        raise NotFoundError("Location", str(location_id))

    conds = ["location_id = $1::uuid"]
    params: list[Any] = [str(location_id)]
    if year:
        params.append(year)
        conds.append(f"year = ${len(params)}")
    if month:
        params.append(month)
        conds.append(f"month = ${len(params)}")

    where = " AND ".join(conds)

    # Use SQL aggregation instead of fetching all rows
    agg = await fetchrow(
        f"""SELECT
                COALESCE(SUM(total_cost), 0)::float AS total_cost,
                COALESCE(SUM(CASE WHEN plant_id IS NOT NULL AND NOT is_workshop AND NOT COALESCE(is_category, false) THEN total_cost ELSE 0 END), 0)::float AS direct_cost,
                COALESCE(SUM(CASE WHEN is_workshop THEN total_cost ELSE 0 END), 0)::float AS workshop_cost,
                COALESCE(SUM(CASE WHEN COALESCE(is_category, false) THEN total_cost ELSE 0 END), 0)::float AS category_cost,
                count(*)::int AS items_count,
                count(DISTINCT plant_id)::int AS plants_count
            FROM spare_parts WHERE {where}""",
        *params,
    )

    return {
        "success": True,
        "data": {
            "location": location,
            "costs": {
                "total_cost": round(agg["total_cost"], 2),
                "direct_cost": round(agg["direct_cost"], 2),
                "workshop_cost": round(agg["workshop_cost"], 2),
                "category_cost": round(agg["category_cost"], 2),
            },
            "items_count": agg["items_count"],
            "plants_count": agg["plants_count"],
        },
        "meta": {"year": year, "month": month},
    }


@router.get("/summary")
async def get_overall_summary(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    month: int | None = None,
    location_id: UUID | None = None,
) -> dict[str, Any]:
    """Get overall maintenance cost summary."""
    conds: list[str] = []
    params: list[Any] = []
    if year:
        params.append(year)
        conds.append(f"year = ${len(params)}")
    if month:
        params.append(month)
        conds.append(f"month = ${len(params)}")
    if location_id:
        params.append(str(location_id))
        conds.append(f"location_id = ${len(params)}::uuid")

    where = " AND ".join(conds) if conds else "TRUE"

    agg = await fetchrow(
        f"""SELECT
                COALESCE(SUM(total_cost), 0)::float AS total_cost,
                COALESCE(SUM(CASE WHEN plant_id IS NOT NULL AND NOT is_workshop AND NOT COALESCE(is_category, false) THEN total_cost ELSE 0 END), 0)::float AS direct_cost,
                COALESCE(SUM(CASE WHEN is_workshop THEN total_cost ELSE 0 END), 0)::float AS workshop_cost,
                COALESCE(SUM(CASE WHEN COALESCE(is_category, false) THEN total_cost ELSE 0 END), 0)::float AS category_cost,
                count(*)::int AS items_count,
                count(DISTINCT purchase_order_number)::int AS po_count,
                count(DISTINCT plant_id)::int AS plants_count,
                count(DISTINCT location_id)::int AS locations_count
            FROM spare_parts WHERE {where}""",
        *params,
    )

    return {
        "success": True,
        "data": {
            "total_cost": round(agg["total_cost"], 2),
            "direct_cost": round(agg["direct_cost"], 2),
            "workshop_cost": round(agg["workshop_cost"], 2),
            "category_cost": round(agg["category_cost"], 2),
            "items_count": agg["items_count"],
            "po_count": agg["po_count"],
            "plants_count": agg["plants_count"],
            "locations_count": agg["locations_count"],
        },
        "meta": {"year": year, "month": month, "location_id": str(location_id) if location_id else None},
    }


@router.get("/analytics/by-period")
async def get_costs_by_period(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    period: str = Query(..., pattern="^(week|month|quarter|year)$"),
    year: int = Query(...),
    plant_id: UUID | None = None,
    location_id: UUID | None = None,
) -> dict[str, Any]:
    """Get costs grouped by period (week, month, quarter, year)."""
    period_column = {"week": "week_number", "month": "month", "quarter": "quarter", "year": "year"}[period]

    conds = ["year = $1"]
    params: list[Any] = [year]
    if plant_id:
        params.append(str(plant_id))
        conds.append(f"plant_id = ${len(params)}::uuid")
    if location_id:
        params.append(str(location_id))
        conds.append(f"location_id = ${len(params)}::uuid")

    where = " AND ".join(conds)

    rows = await fetch(
        f"""SELECT {period_column} AS period_val,
                   COALESCE(SUM(total_cost), 0)::float AS total_cost,
                   count(*)::int AS items_count,
                   count(DISTINCT purchase_order_number)::int AS po_count
            FROM spare_parts
            WHERE {where} AND {period_column} IS NOT NULL
            GROUP BY {period_column}
            ORDER BY {period_column}""",
        *params,
    )

    periods = [
        {period: row["period_val"], "total_cost": round(row["total_cost"], 2),
         "items_count": row["items_count"], "po_count": row["po_count"]}
        for row in rows
    ]
    grand_total = sum(p["total_cost"] for p in periods)

    return {
        "success": True,
        "data": periods,
        "meta": {
            "period_type": period, "year": year,
            "plant_id": str(plant_id) if plant_id else None,
            "location_id": str(location_id) if location_id else None,
            "grand_total": round(grand_total, 2), "periods_count": len(periods),
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
    """Compare costs year-over-year."""
    year_list = [int(y.strip()) for y in years.split(",") if y.strip().isdigit()]
    if not year_list:
        raise ValidationError("At least one valid year is required")

    period_column = "month" if group_by == "month" else "quarter"

    conds: list[str] = []
    params: list[Any] = []

    # Build IN clause for years
    year_placeholders = ", ".join(f"${i + 1}" for i in range(len(year_list)))
    params.extend(year_list)
    conds.append(f"year IN ({year_placeholders})")

    if plant_id:
        params.append(str(plant_id))
        conds.append(f"plant_id = ${len(params)}::uuid")
    if location_id:
        params.append(str(location_id))
        conds.append(f"location_id = ${len(params)}::uuid")

    where = " AND ".join(conds)

    rows = await fetch(
        f"""SELECT year, {period_column} AS period_val,
                   COALESCE(SUM(total_cost), 0)::float AS total_cost
            FROM spare_parts
            WHERE {where} AND {period_column} IS NOT NULL
            GROUP BY year, {period_column}
            ORDER BY year, {period_column}""",
        *params,
    )

    # Build year → period → total_cost map
    year_data: dict[int, dict[int, float]] = {y: {} for y in year_list}
    for row in rows:
        y = row["year"]
        p = row["period_val"]
        if y in year_data:
            year_data[y][p] = row["total_cost"]

    # Format response
    max_period = 12 if group_by == "month" else 4
    comparison = []
    for p in range(1, max_period + 1):
        entry: dict[str, Any] = {group_by: p}
        for y in year_list:
            entry[str(y)] = round(year_data[y].get(p, 0), 2)
        comparison.append(entry)

    yearly_totals = {str(y): round(sum(year_data[y].values()), 2) for y in year_list}

    return {
        "success": True,
        "data": comparison,
        "meta": {
            "years": year_list, "group_by": group_by,
            "plant_id": str(plant_id) if plant_id else None,
            "location_id": str(location_id) if location_id else None,
            "yearly_totals": yearly_totals,
        },
    }


# ============== SINGLE PART BY ID (must be last to avoid route conflicts) ==============

@router.get("/{part_id}")
async def get_spare_part(
    part_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get a single spare part by ID."""
    row = await fetchrow(
        """SELECT sp.*,
                  pm.fleet_number, pm.description AS plant_description,
                  COALESCE(s.name, sp.supplier) AS supplier_name
           FROM spare_parts sp
           LEFT JOIN plants_master pm ON pm.id = sp.plant_id
           LEFT JOIN suppliers s ON s.id = sp.supplier_id
           WHERE sp.id = $1::uuid""",
        str(part_id),
    )
    if not row:
        raise NotFoundError("Spare part", str(part_id))

    return {"success": True, "data": row}
