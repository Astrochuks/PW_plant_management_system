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
from app.core.events import broadcast
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
        n = len(params)
        conds.append(
            f"(sp.plant_id = ${n}::uuid"
            f" OR (sp.shared_fleet_numbers IS NOT NULL"
            f"     AND (SELECT fleet_number FROM plants_master WHERE id = ${n}::uuid) = ANY(sp.shared_fleet_numbers)))"
        )
    if fleet_number:
        params.append(fleet_number.upper())
        n = len(params)
        conds.append(f"(pm.fleet_number = ${n} OR ${n} = ANY(sp.shared_fleet_numbers))")
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
                   COALESCE(pl.is_bua, false) AS is_bua,
                   count(*) OVER() AS _total_count
            FROM spare_parts sp
            LEFT JOIN plants_master pm ON pm.id = sp.plant_id
            LEFT JOIN locations pl ON pl.id = pm.current_location_id
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
        """SELECT sp.purchase_order_number,
                  count(*)::int AS items_count,
                  COALESCE(sum(sp.total_cost), 0)::numeric AS total_cost,
                  array_agg(DISTINCT COALESCE(s.name, sp.supplier)) FILTER (WHERE COALESCE(s.name, sp.supplier) IS NOT NULL) AS suppliers
           FROM spare_parts sp
           LEFT JOIN suppliers s ON s.id = sp.supplier_id
           WHERE sp.purchase_order_number ILIKE $1
             AND sp.purchase_order_number IS NOT NULL
           GROUP BY sp.purchase_order_number
           ORDER BY count(*) DESC
           LIMIT $2""",
        f"%{q.upper()}%",
        limit,
    )

    suggestions = [
        {
            "po_number": row["purchase_order_number"],
            "items_count": row["items_count"],
            "total_cost": float(row.get("total_cost") or 0),
            "suppliers": row.get("suppliers") or [],
        }
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
    fleet_number: str | None = Query(None, description="Filter by fleet number (text search)"),
    supplier: str | None = Query(None, description="Filter by supplier name (text search)"),
    search: str | None = Query(None, description="Search part description or number"),
    date_from: date | None = Query(None, description="Filter from date (YYYY-MM-DD)"),
    date_to: date | None = Query(None, description="Filter to date (YYYY-MM-DD)"),
) -> dict[str, Any]:
    """Get spare parts statistics."""
    row = await fetchrow(
        "SELECT * FROM get_spare_parts_stats($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        year, month, week, quarter,
        str(location_id) if location_id else None,
        str(supplier_id) if supplier_id else None,
        fleet_number.upper() if fleet_number else None,
        supplier or None,
        search or None,
        date_from,
        date_to,
    )

    return {
        "success": True,
        "data": row or {},
        "meta": {
            "filters": {
                "year": year, "month": month, "week": week, "quarter": quarter,
                "location_id": str(location_id) if location_id else None,
                "supplier_id": str(supplier_id) if supplier_id else None,
                "fleet_number": fleet_number,
                "supplier_name": supplier,
                "search": search,
                "date_from": date_from.isoformat() if date_from else None,
                "date_to": date_to.isoformat() if date_to else None,
            },
        },
    }


@router.get("/years")
async def get_spare_parts_years(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get list of years that have spare parts data."""
    rows = await fetch(
        "SELECT DISTINCT year FROM spare_parts WHERE year IS NOT NULL ORDER BY year DESC"
    )
    return {"success": True, "data": [r["year"] for r in rows]}


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


@router.get("/top-sites")
async def get_top_sites(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = Query(None, description="Filter by year"),
    month: int | None = Query(None, ge=1, le=12, description="Filter by month"),
    quarter: int | None = Query(None, ge=1, le=4, description="Filter by quarter"),
) -> dict[str, Any]:
    """Get all sites/locations ranked by total maintenance spend."""
    conds = ["sp.location_id IS NOT NULL"]
    params: list[Any] = []
    if year:
        params.append(year)
        conds.append(f"sp.year = ${len(params)}")
    if month:
        params.append(month)
        conds.append(f"sp.month = ${len(params)}")
    if quarter:
        params.append(quarter)
        conds.append(f"sp.quarter = ${len(params)}")

    where = " AND ".join(conds)

    rows = await fetch(
        f"""SELECT
                l.id AS location_id,
                l.name AS location_name,
                COALESCE(SUM(sp.total_cost), 0)::float AS total_spend,
                COUNT(*)::int AS items_count,
                COUNT(DISTINCT sp.purchase_order_number)::int AS po_count,
                COUNT(DISTINCT sp.plant_id)::int AS plants_count
            FROM spare_parts sp
            JOIN locations l ON l.id = sp.location_id
            WHERE {where}
            GROUP BY l.id, l.name
            ORDER BY total_spend DESC""",
        *params,
    )

    return {"success": True, "data": rows}


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

    broadcast("spare_parts", "create")

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
    other_costs_description: str | None = Query(None, description="Description of other costs"),
) -> dict[str, Any]:
    """UNIFIED PO ENTRY - Handles ALL scenarios."""
    import asyncio
    import json
    import time
    from app.services.fleet_parser import parse_fleet_input, get_cost_classification
    from app.core.pool import get_pool

    t_start = time.perf_counter()
    timings: dict[str, float] = {}

    def _mark(label: str, t_from: float) -> None:
        timings[label] = round((time.perf_counter() - t_from) * 1000, 1)

    po_upper = purchase_order_number.upper().strip()

    # ── Phase 1: run independent queries in PARALLEL ────────────────
    # next_sub, supplier resolution, and fleet parsing don't depend on each
    # other. Running them concurrently turns ~3 sequential round-trips into 1.
    async def _resolve_supplier() -> tuple[Any, str | None, str | None]:
        """Returns (supplier_id, supplier_name, matched_by)."""
        if supplier_id:
            sup = await fetchrow(
                "SELECT id, name FROM suppliers WHERE id = $1::uuid", str(supplier_id),
            )
            if sup:
                return sup["id"], sup["name"], "exact"
            return str(supplier_id), None, "exact"
        if not supplier:
            return None, None, None
        supplier_input = supplier.strip()
        # Exact match first
        sup = await fetchrow(
            "SELECT id, name FROM suppliers WHERE name ILIKE $1", supplier_input,
        )
        if sup:
            return sup["id"], sup["name"], "exact"
        # Fuzzy match fallback
        fuzzy = await fetch(
            "SELECT * FROM find_similar_supplier($1, $2)",
            supplier_input, 0.3,
        )
        if fuzzy:
            best = fuzzy[0]
            logger.info("Fuzzy matched supplier", input=supplier_input, matched_to=best["name"])
            return best["id"], best["name"], "fuzzy"
        # Create new supplier (still needs its own round-trip but only on true novelty)
        new_sup = await fetchrow(
            "INSERT INTO suppliers (name) VALUES ($1) RETURNING *", supplier_input,
        )
        if new_sup:
            logger.info("Created new supplier", supplier_name=supplier_input)
            return new_sup["id"], new_sup["name"], "new"
        return None, None, None

    t_parallel = time.perf_counter()
    (next_sub, parsed_fleets, supplier_result) = await asyncio.gather(
        fetchval(
            "SELECT COALESCE(MAX(submission_number), 0) + 1 FROM spare_parts "
            "WHERE purchase_order_number = $1",
            po_upper,
        ),
        parse_fleet_input(fleet_numbers),
        _resolve_supplier(),
    )
    _mark("parallel_queries_ms", t_parallel)

    resolved_supplier_id, resolved_supplier_name, supplier_matched_by = supplier_result

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

    # parsed_fleets was already awaited in the parallel phase above
    if not parsed_fleets:
        raise ValidationError("At least one fleet entry is required")

    cost_type = get_cost_classification(parsed_fleets)

    # Detect multi-fleet PO (scenarios 2 & 3)
    is_multi_fleet = len(parsed_fleets) > 1 or any(
        f.get("is_workshop") or f.get("is_category") for f in parsed_fleets
    )

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

    # Build fleet lookup — parse_fleet_input already resolved plant_id, fleet_type,
    # and the normalized fleet_number via batched queries. No extra DB round-trips
    # needed. We key by both raw input ("463") AND normalized fleet number ("T463")
    # so per-item fleet assignments match either form.
    fleet_lookup: dict[str, dict] = {}
    for fleet in parsed_fleets:
        fleet_lookup[fleet["fleet_number_raw"]] = fleet
        normalized = fleet.get("fleet_number_normalized")
        if normalized and normalized != fleet["fleet_number_raw"]:
            fleet_lookup[normalized] = fleet

    date_val = parsed_date
    req_upper = requisition_number.upper() if requisition_number else None
    loc_str = str(location_id) if location_id else None
    sup_id_str = str(resolved_supplier_id) if resolved_supplier_id else None

    # Collect all rows to insert in one batch
    # Each row is a tuple of column values
    rows: list[tuple] = []
    direct_count = 0
    shared_count = 0

    # Process DIRECT items — resolve fleets for unresolved ones in batch
    unresolved_direct_fleets = set()
    for item in direct_items:
        item_fleet = item["item_fleet"]
        if item_fleet not in fleet_lookup:
            unresolved_direct_fleets.add(item_fleet)

    if unresolved_direct_fleets:
        # Batch resolve: look up all unresolved fleet numbers at once
        resolved_plants = await fetch(
            "SELECT id, fleet_number, fleet_type FROM plants_master WHERE fleet_number = ANY($1::text[])",
            list(unresolved_direct_fleets),
        )
        for p in resolved_plants:
            fleet_lookup[p["fleet_number"]] = {
                "fleet_number_raw": p["fleet_number"],
                "plant_id": p["id"],
                "fleet_type": p.get("fleet_type"),
                "is_workshop": False,
                "is_category": False,
                "category_name": None,
                "is_resolved": True,
            }

    for item in direct_items:
        item_fleet = item["item_fleet"]
        item_subtotal = (item.get("unit_cost") or 0) * (item.get("quantity") or 1)

        fleet = fleet_lookup.get(item_fleet)
        if not fleet:
            logger.warning(f"Could not resolve fleet '{item_fleet}' for item '{item['description']}'")
            continue

        frac = item_subtotal / subtotal if subtotal > 0 else 0

        # Distribute VAT/discount/other proportionally to all line items
        item_vat = round(total_vat * frac, 2) if total_vat * frac > 0 else None
        item_discount = round(total_discount * frac, 2) if total_discount * frac > 0 else None
        item_other = round(other_costs * frac, 2) if other_costs * frac > 0 else None

        rows.append((
            fleet.get("plant_id"),       # plant_id
            fleet.get("plant_id"),       # assigned_plant_id
            item_fleet,                  # fleet_number_raw
            fleet.get("is_workshop", False),
            fleet.get("is_category", False),
            fleet.get("category_name"),
            "direct",                    # cost_type
            item["description"],
            item.get("part_number"),
            item.get("quantity", 1),
            item.get("unit_cost"),
            po_upper,
            date_val,
            req_upper,
            loc_str,
            sup_id_str,
            resolved_supplier_name,
            item_vat,
            item_discount,
            item_other,
            calc_year, calc_month, calc_week, calc_quarter,
            current_user.id,
            False,                       # is_po_overhead
            other_costs_description,     # other_costs_description
        ))
        direct_count += 1

    # Process SHARED items — one row per item at ORIGINAL price
    # For multi-fleet POs: plant_id=NULL, shared_fleet_numbers stores fleet list
    # For single-fleet POs: plant_id set to that fleet, distribute VAT/discount
    shared_fleet_list = [f["fleet_number_raw"] for f in parsed_fleets]
    for item in shared_items:
        item_unit_cost = item.get("unit_cost") or 0

        if is_multi_fleet:
            # Multi-fleet: distribute VAT/discount proportionally; shared item has no plant_id
            item_subtotal = item_unit_cost * (item.get("quantity") or 1)
            frac = item_subtotal / subtotal if subtotal > 0 else 0
            item_vat = round(total_vat * frac, 2) if total_vat * frac > 0 else None
            item_discount = round(total_discount * frac, 2) if total_discount * frac > 0 else None
            item_other = round(other_costs * frac, 2) if other_costs * frac > 0 else None
            row_plant_id = None
            row_fleet_raw = None
            row_is_workshop = False
            row_is_category = False
            row_category_name = None
        else:
            # Single fleet: distribute VAT/discount proportionally
            fleet = parsed_fleets[0]
            item_subtotal = item_unit_cost * (item.get("quantity") or 1)
            frac = item_subtotal / subtotal if subtotal > 0 else 0
            item_vat = round(total_vat * frac, 2) if total_vat * frac > 0 else None
            item_discount = round(total_discount * frac, 2) if total_discount * frac > 0 else None
            item_other = round(other_costs * frac, 2) if other_costs * frac > 0 else None
            row_plant_id = fleet.get("plant_id")
            row_fleet_raw = fleet["fleet_number_raw"]
            row_is_workshop = fleet.get("is_workshop", False)
            row_is_category = fleet.get("is_category", False)
            row_category_name = fleet.get("category_name")

        rows.append((
            row_plant_id,
            None,                        # assigned_plant_id
            row_fleet_raw,
            row_is_workshop,
            row_is_category,
            row_category_name,
            cost_type,
            item["description"],
            item.get("part_number"),
            item.get("quantity", 1),
            item_unit_cost,              # ORIGINAL price (not divided)
            po_upper,
            date_val,
            req_upper,
            loc_str,
            sup_id_str,
            resolved_supplier_name,
            item_vat,
            item_discount,
            item_other,
            calc_year, calc_month, calc_week, calc_quarter,
            current_user.id,
            False,                       # is_po_overhead
            other_costs_description,     # other_costs_description
        ))
        shared_count += 1

    # Single batch INSERT in a transaction with triggers disabled for speed.
    # Triggers skipped: audit_spare_parts (we log via background task already),
    # trg_spare_parts_time_columns (we populate year/month/week/quarter ourselves).
    records_created = 0
    if rows:
        # Unzip rows into column arrays for UNNEST
        (plant_ids, assigned_ids, fleet_raws, is_workshops, is_categories,
         category_names, cost_types, descriptions, part_numbers, quantities,
         unit_costs, po_numbers, po_dates, req_numbers, loc_ids, sup_ids,
         sup_names, vat_amounts, disc_amounts, other_amounts,
         years, months, weeks, quarters, created_bys, po_overheads,
         other_descs) = zip(*rows)

        insert_args = [
            [str(v) if v else None for v in plant_ids],
            [str(v) if v else None for v in assigned_ids],
            list(fleet_raws),
            list(is_workshops),
            list(is_categories),
            list(category_names),
            list(cost_types),
            list(descriptions),
            list(part_numbers),
            [int(q) if q is not None else 1 for q in quantities],
            [float(c) if c is not None else None for c in unit_costs],
            list(po_numbers),
            [date_val] * len(rows),
            list(req_numbers),
            list(loc_ids),
            list(sup_ids),
            list(sup_names),
            [float(v) if v is not None else None for v in vat_amounts],
            [float(v) if v is not None else None for v in disc_amounts],
            [float(v) if v is not None else None for v in other_amounts],
            [int(v) if v is not None else None for v in years],
            [int(v) if v is not None else None for v in months],
            [int(v) if v is not None else None for v in weeks],
            [int(v) if v is not None else None for v in quarters],
            [str(v) for v in created_bys],
            list(po_overheads),
            [next_sub] * len(rows),
            list(other_descs),
        ]

        pool = get_pool()
        t_insert = time.perf_counter()
        async with pool.acquire() as conn:
            async with conn.transaction():
                # Disable triggers for this transaction only (auto-reverts on commit)
                await conn.execute(
                    "SET LOCAL session_replication_role = 'replica'"
                )
                result = await conn.execute(
                    """INSERT INTO spare_parts
                           (plant_id, assigned_plant_id, fleet_number_raw, is_workshop, is_category,
                            category_name, cost_type, part_description, part_number, quantity, unit_cost,
                            purchase_order_number, po_date, replaced_date, requisition_number,
                            location_id, supplier_id, supplier,
                            vat_amount, discount_amount, other_costs, vat_percentage, discount_percentage,
                            year, month, week_number, quarter, created_by, is_po_overhead,
                            submission_number, other_costs_description)
                       SELECT
                            u.plant_id::uuid, u.assigned_id::uuid, u.fleet_raw, u.is_ws, u.is_cat,
                            u.cat_name, u.ctype, u.descr, u.part_no, u.qty, u.ucost,
                            u.po_num, u.po_dt::date, u.po_dt::date, u.req_num,
                            u.loc::uuid, u.sup_id::uuid, u.sup_name,
                            u.vat_amt, u.disc_amt, u.other_amt, 0, 0,
                            u.yr, u.mo, u.wk, u.qtr, u.cb::uuid, u.is_overhead,
                            u.sub_num, u.other_desc
                       FROM UNNEST(
                            $1::text[], $2::text[], $3::text[], $4::bool[], $5::bool[],
                            $6::text[], $7::text[], $8::text[], $9::text[], $10::int[],
                            $11::float[], $12::text[], $13::date[], $14::text[], $15::text[],
                            $16::text[], $17::text[], $18::float[], $19::float[], $20::float[],
                            $21::int[], $22::int[], $23::int[], $24::int[], $25::text[],
                            $26::bool[], $27::int[], $28::text[]
                       ) AS u(plant_id, assigned_id, fleet_raw, is_ws, is_cat,
                              cat_name, ctype, descr, part_no, qty, ucost,
                              po_num, po_dt, req_num, loc, sup_id,
                              sup_name, vat_amt, disc_amt, other_amt,
                              yr, mo, wk, qtr, cb, is_overhead,
                              sub_num, other_desc)""",
                    *insert_args,
                )
                # result is like "INSERT 0 10" — parse the count
                records_created = int(result.split()[-1]) if result else 0

                # Set shared_fleet_numbers for multi-fleet shared items
                if shared_items and is_multi_fleet:
                    await conn.execute(
                        """UPDATE spare_parts
                           SET shared_fleet_numbers = $1::text[]
                           WHERE purchase_order_number = $2
                             AND submission_number = $3
                             AND cost_type = 'shared'""",
                        shared_fleet_list, po_upper, next_sub,
                    )
        _mark("insert_ms", t_insert)

    resolved_fleets = [f["fleet_number_raw"] for f in parsed_fleets]
    timings["total_ms"] = round((time.perf_counter() - t_start) * 1000, 1)

    logger.info(
        "PO bulk entry created",
        po_number=po_upper,
        fleets=resolved_fleets,
        items_count=len(items_list),
        records_created=records_created,
        cost_type=cost_type,
        user_id=current_user.id,
        **timings,
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

    broadcast("spare_parts", "create")

    return {
        "success": True,
        "data": [],
        "meta": {
            "po_number": po_upper,
            "cost_type": cost_type,
            "fleets": resolved_fleets,
            "items_count": len(items_list),
            "records_created": records_created,
            "subtotal": round(subtotal, 2),
            "submission_number": next_sub,
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
    other_costs_description: str | None = Query(None),
) -> dict[str, Any]:
    """Alias for /bulk - use /bulk instead."""
    return await create_spare_parts_bulk(
        request, background_tasks, current_user,
        fleet_numbers, purchase_order_number, items, po_date,
        requisition_number, location_id, supplier,
        vat_percentage, vat_amount, discount_percentage, discount_amount, other_costs,
        other_costs_description,
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
    other_costs_description: str | None = Query(None),
) -> dict[str, Any]:
    """Legacy endpoint - use /bulk with fleet_numbers instead."""
    return await create_spare_parts_bulk(
        request, background_tasks, current_user,
        fleet_number, purchase_order_number, items, po_date,
        requisition_number, location_id, supplier,
        vat_percentage, vat_amount, discount_percentage, discount_amount, other_costs,
        other_costs_description,
    )


@router.get("/by-po/{po_number}")
async def get_spare_parts_by_po(
    po_number: str,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get all spare parts for a specific PO number, grouped by submission."""
    rows = await fetch(
        """SELECT sp.*,
                  pm.fleet_number, pm.description AS plant_description,
                  COALESCE(s.name, sp.supplier) AS supplier_name,
                  s.id AS supplier_table_id, s.name AS supplier_table_name
           FROM spare_parts sp
           LEFT JOIN plants_master pm ON pm.id = sp.plant_id
           LEFT JOIN suppliers s ON s.id = sp.supplier_id
           WHERE sp.purchase_order_number ILIKE $1
           ORDER BY sp.submission_number, sp.created_at""",
        po_number,
    )

    # Group rows by submission_number
    sub_map: dict[int, dict[str, Any]] = {}
    item_rows: list[dict] = []
    grand_total = 0.0
    combined_vat = 0.0
    combined_discount = 0.0
    combined_other = 0.0

    for row in rows:
        sn = row.get("submission_number") or 1
        if sn not in sub_map:
            sub_map[sn] = []
        grand_total += float(row.get("total_cost") or 0)
        sub_map[sn].append(row)
        item_rows.append(row)
        combined_vat += float(row.get("vat_amount") or 0)
        combined_discount += float(row.get("discount_amount") or 0)
        combined_other += float(row.get("other_costs") or 0)

    # Build per-submission breakdown
    submissions = []
    for sn in sorted(sub_map.keys()):
        items = sub_map[sn]
        sub_subtotal = sum(
            (float(r.get("unit_cost") or 0) * (r.get("quantity") or 1))
            for r in items
        )
        sub_vat = sum(float(r.get("vat_amount") or 0) for r in items)
        sub_discount = sum(float(r.get("discount_amount") or 0) for r in items)
        sub_other = sum(float(r.get("other_costs") or 0) for r in items)
        sub_total = sum(float(r.get("total_cost") or 0) for r in items)
        sub_other_desc = next((r.get("other_costs_description") for r in items if r.get("other_costs_description")), None)

        # Document from first item with doc in this submission
        doc_row = next((r for r in items if r.get("document_url")), None)

        submissions.append({
            "submission_number": sn,
            "items_count": len(items),
            "subtotal": round(sub_subtotal, 2),
            "vat_amount": round(sub_vat, 2),
            "discount_amount": round(sub_discount, 2),
            "other_costs": round(sub_other, 2),
            "other_costs_description": sub_other_desc,
            "total": round(sub_total, 2),
            "document": {
                "url": doc_row.get("document_url"),
                "name": doc_row.get("document_name"),
                "uploaded_at": str(doc_row.get("document_uploaded_at")) if doc_row.get("document_uploaded_at") else None,
            } if doc_row and doc_row.get("document_url") else None,
        })

    # Build supplier breakdown (exclude overhead)
    suppliers_map: dict[str, dict[str, Any]] = {}
    for row in item_rows:
        sid = row.get("supplier_table_id")
        sname = row.get("supplier_table_name") or row.get("supplier") or "Unknown"
        key = str(sid) if sid else sname
        if key not in suppliers_map:
            suppliers_map[key] = {"id": sid, "name": sname, "items_count": 0, "total_cost": 0}
        suppliers_map[key]["items_count"] += 1
        suppliers_map[key]["total_cost"] += float(row.get("total_cost") or 0)

    suppliers_list = sorted(suppliers_map.values(), key=lambda s: s["total_cost"], reverse=True)
    primary_supplier = suppliers_list[0] if suppliers_list else None

    # PO-level cost_type — count distinct fleets from both direct and shared items
    distinct_fleets: set[str] = set()
    for r in item_rows:
        if r.get("fleet_number_raw"):
            distinct_fleets.add(r["fleet_number_raw"])
        if r.get("shared_fleet_numbers"):
            distinct_fleets.update(r["shared_fleet_numbers"])
    distinct_plants = set(r.get("plant_id") for r in item_rows if r.get("plant_id"))
    has_workshop = any(r.get("is_workshop") for r in item_rows)
    has_category = any(r.get("is_category") for r in item_rows)
    has_shared_fleets = any(r.get("shared_fleet_numbers") for r in item_rows)
    po_cost_type = "direct" if len(distinct_plants) == 1 and not has_workshop and not has_category and not has_shared_fleets else "shared"

    # Combined VAT/discount/other summary across all submissions
    cost_breakdown = {
        "vat_amount": round(sum(s["vat_amount"] for s in submissions), 2),
        "discount_amount": round(sum(s["discount_amount"] for s in submissions), 2),
        "other_costs": round(sum(s["other_costs"] for s in submissions), 2),
    }

    return {
        "success": True,
        "data": item_rows,
        "meta": {
            "po_number": po_number.upper(),
            "items_count": len(item_rows),
            "total_cost": round(grand_total, 2),
            "distinct_plants": max(len(distinct_plants), len(distinct_fleets)),
            "cost_type": po_cost_type,
            "supplier": primary_supplier,
            "suppliers": [
                {"id": s["id"], "name": s["name"], "items_count": s["items_count"], "total_cost": round(s["total_cost"], 2)}
                for s in suppliers_list
            ],
            "overhead": cost_breakdown,
            "submissions": submissions,
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

    broadcast("spare_parts", "update")

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

    broadcast("spare_parts", "delete")

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
    submission_number: int = Query(1, ge=1, description="Submission number to attach document to"),
) -> dict[str, Any]:
    """Upload a document for a specific submission of a PO."""
    # Verify PO + submission exists
    existing = await fetchrow(
        "SELECT id FROM spare_parts WHERE purchase_order_number ILIKE $1 AND submission_number = $2 LIMIT 1",
        po_number, submission_number,
    )
    if not existing:
        raise NotFoundError("PO submission", f"{po_number} sub#{submission_number}")

    allowed_types = ["application/pdf", "image/jpeg", "image/png", "image/jpg"]
    if file.content_type not in allowed_types:
        raise ValidationError(
            f"Invalid file type: {file.content_type}. Allowed: PDF, JPEG, PNG",
            details=[{"field": "file", "message": "Invalid file type", "code": "INVALID_TYPE"}],
        )

    ext = file.filename.split(".")[-1] if file.filename and "." in file.filename else "pdf"
    unique_filename = f"po-documents/{po_number.upper()}/sub-{submission_number}/{uuid4()}.{ext}"
    file_content = await file.read()

    # Upload to Supabase Storage
    try:
        client = get_supabase_admin_client()
        storage = client.storage.from_("documents")
        storage.upload(unique_filename, file_content, {"content-type": file.content_type})
        document_url = storage.get_public_url(unique_filename)
    except Exception as e:
        logger.error("Failed to upload document", error=str(e), po_number=po_number)
        raise ValidationError(f"Failed to upload document: {str(e)}")

    # Update the first row in this submission to hold the document reference
    first_item = await fetchrow(
        """SELECT id FROM spare_parts
           WHERE purchase_order_number ILIKE $1 AND submission_number = $2
           ORDER BY created_at LIMIT 1""",
        po_number, submission_number,
    )
    if first_item:
        await execute(
            """UPDATE spare_parts
               SET document_url = $1, document_name = $2, document_uploaded_at = now()
               WHERE id = $3::uuid""",
            document_url, file.filename, str(first_item["id"]),
        )

    logger.info("PO document uploaded", po_number=po_number.upper(), submission=submission_number, filename=file.filename, user_id=current_user.id)

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id, user_email=current_user.email,
        action="upload", table_name="spare_parts", record_id=po_number.upper(),
        new_values={"document_name": file.filename, "document_url": document_url, "submission_number": submission_number},
        ip_address=get_client_ip(request),
        description=f"Uploaded document for PO {po_number.upper()} submission #{submission_number}: {file.filename}",
    )

    return {
        "success": True,
        "data": {"po_number": po_number.upper(), "document_url": document_url, "document_name": file.filename, "submission_number": submission_number},
    }


@router.get("/by-po/{po_number}/document")
async def get_po_document(
    po_number: str,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    submission_number: int = Query(1, ge=1),
) -> dict[str, Any]:
    """Get the document URL for a specific submission of a PO."""
    doc = await fetchrow(
        """SELECT document_url, document_name, document_uploaded_at
           FROM spare_parts
           WHERE purchase_order_number ILIKE $1 AND submission_number = $2 AND document_url IS NOT NULL
           LIMIT 1""",
        po_number, submission_number,
    )
    if not doc or not doc.get("document_url"):
        raise NotFoundError("Document for PO", f"{po_number} sub#{submission_number}")

    return {
        "success": True,
        "data": {
            "po_number": po_number.upper(),
            "submission_number": submission_number,
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
    submission_number: int = Query(1, ge=1),
) -> dict[str, Any]:
    """Delete the document for a specific submission of a PO."""
    old_doc = await fetchrow(
        """SELECT document_url, document_name
           FROM spare_parts
           WHERE purchase_order_number ILIKE $1 AND submission_number = $2 AND document_url IS NOT NULL
           LIMIT 1""",
        po_number, submission_number,
    )
    if not old_doc or not old_doc.get("document_url"):
        raise NotFoundError("Document for PO", f"{po_number} sub#{submission_number}")

    await execute(
        """UPDATE spare_parts
           SET document_url = NULL, document_name = NULL, document_uploaded_at = NULL
           WHERE purchase_order_number ILIKE $1 AND submission_number = $2""",
        po_number, submission_number,
    )

    logger.info("PO document deleted", po_number=po_number.upper(), submission=submission_number, user_id=current_user.id)

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id, user_email=current_user.email,
        action="delete", table_name="spare_parts", record_id=po_number.upper(),
        old_values={"document_name": old_doc["document_name"], "submission_number": submission_number},
        ip_address=get_client_ip(request),
        description=f"Deleted document for PO {po_number.upper()} submission #{submission_number}",
    )

    return {"success": True, "message": f"Document deleted for PO {po_number.upper()} submission #{submission_number}"}


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

    broadcast("spare_parts", "update")

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

    broadcast("spare_parts", "delete")

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
               FROM spare_parts
               WHERE (plant_id = $1::uuid
                      OR (shared_fleet_numbers IS NOT NULL
                          AND (SELECT fleet_number FROM plants_master WHERE id = $1::uuid) = ANY(shared_fleet_numbers)))
                 AND purchase_order_number IS NOT NULL""",
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

    # Recent parts (direct costs only, exclude overhead rows)
    conds = ["sp.plant_id = $1::uuid", "sp.cost_type = 'direct'"]
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
            "items_subtotal": float(po.get("items_subtotal") or 0),
            "total_amount": float(po.get("total_amount") or 0),
            "po_vat": float(po.get("po_vat") or 0),
            "po_discount": float(po.get("po_discount") or 0),
            "po_other": float(po.get("po_other") or 0),
            "supplier": po.get("supplier_name"),
            "shared_with": po.get("shared_with") or [],
            "items": po.get("items") or [],
        })

    return {
        "success": True,
        "data": {
            "plant": plant,
            "shared_costs": shared_costs,
            "shared_costs_count": len(shared_costs),
            "total_shared_cost": round(sum(sc["total_amount"] for sc in shared_costs), 2),
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
        n = len(params)
        conds.append(
            f"(plant_id = ${n}::uuid"
            f" OR (shared_fleet_numbers IS NOT NULL"
            f"     AND (SELECT fleet_number FROM plants_master WHERE id = ${n}::uuid) = ANY(shared_fleet_numbers)))"
        )
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
        n = len(params)
        conds.append(
            f"(plant_id = ${n}::uuid"
            f" OR (shared_fleet_numbers IS NOT NULL"
            f"     AND (SELECT fleet_number FROM plants_master WHERE id = ${n}::uuid) = ANY(shared_fleet_numbers)))"
        )
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


# ============== REPEAT/DUPLICATE PURCHASE DETECTION ==============

@router.get("/analytics/repeat-purchases")
async def get_repeat_purchases(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    min_occurrences: int = Query(2, ge=2, description="Minimum number of POs for the same part"),
    min_price_ratio: float = Query(1.0, ge=1.0, description="Minimum max/min price ratio to flag"),
    plant_id: UUID | None = Query(None, description="Filter by specific plant"),
    location_id: UUID | None = Query(None, description="Filter by location"),
    include_consumables: bool = Query(True, description="Include consumables like oil, filters"),
    sort_by: str = Query("last_purchase_date", pattern="^(price_ratio|total_spent|purchase_count|part_name|fleet_number|last_purchase_date|first_purchase_date)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    """Detect repeat/duplicate purchases of the same part for the same plant.

    Groups spare parts by (plant + part_description) across different POs.
    Flags entries where the same part was purchased multiple times, with
    price ratio highlighting for potential overcharging.

    This is a LIVE query — always reflects the current spare_parts data.
    New POs automatically appear on next page load.

    Returns:
        List of repeat purchases with price analysis.
    """
    # Build WHERE clause
    conds: list[str] = []
    params: list[Any] = []

    if plant_id:
        params.append(str(plant_id))
        conds.append(f"sp.plant_id = ${len(params)}::uuid")

    if location_id:
        params.append(str(location_id))
        conds.append(f"sp.location_id = ${len(params)}::uuid")

    where = " AND ".join(conds) if conds else "TRUE"

    # Validate sort column (whitelist to prevent SQL injection)
    allowed_sorts = {"price_ratio", "total_spent", "purchase_count", "part_name", "fleet_number", "last_purchase_date", "first_purchase_date"}
    safe_sort = sort_by if sort_by in allowed_sorts else "last_purchase_date"
    safe_order = "ASC" if sort_order == "asc" else "DESC"

    # Add fixed params: min_occurrences, min_price_ratio, limit, offset
    params.append(min_occurrences)
    n_min_occ = len(params)
    params.append(min_price_ratio)
    n_min_ratio = len(params)
    params.append(limit)
    n_limit = len(params)
    params.append((page - 1) * limit)
    n_offset = len(params)

    # Main query: group by plant + normalized part description.
    # Uses count(*) >= min_occurrences (not count(DISTINCT po)) to catch
    # duplicates within the same PO (e.g., T207 bought the same part twice
    # on the same PO at different dates/prices).
    rows = await fetch(
        f"""WITH grouped AS (
              SELECT
                sp.plant_id,
                pm.fleet_number,
                pm.description AS plant_description,
                l.name AS location_name,
                UPPER(TRIM(sp.part_description)) AS part_name,
                count(DISTINCT sp.purchase_order_number) AS po_count,
                count(*) AS purchase_count,
                sum(sp.quantity) AS total_quantity,
                sum(sp.total_cost)::float AS total_spent,
                min(sp.unit_cost)::float AS min_unit_cost,
                max(sp.unit_cost)::float AS max_unit_cost,
                CASE
                  WHEN min(sp.unit_cost) > 0
                  THEN round((max(sp.unit_cost) / min(sp.unit_cost))::numeric, 1)::float
                  ELSE 1.0
                END AS price_ratio,
                min(sp.po_date) AS first_purchase_date,
                max(sp.po_date) AS last_purchase_date,
                max(sp.created_at) AS last_entered_at,
                array_agg(DISTINCT sp.purchase_order_number ORDER BY sp.purchase_order_number) AS po_numbers,
                array_agg(DISTINCT COALESCE(s.name, sp.supplier) ORDER BY COALESCE(s.name, sp.supplier)) AS suppliers
              FROM spare_parts sp
              LEFT JOIN plants_master pm ON pm.id = sp.plant_id
              LEFT JOIN locations l ON l.id = sp.location_id
              LEFT JOIN suppliers s ON s.id = sp.supplier_id
              WHERE {where}
              GROUP BY sp.plant_id, pm.fleet_number, pm.description, l.name,
                       UPPER(TRIM(sp.part_description))
              HAVING count(*) >= ${n_min_occ}
            )
            SELECT *, count(*) OVER() AS _total_count
            FROM grouped
            WHERE price_ratio >= ${n_min_ratio}
            ORDER BY {safe_sort} {safe_order} NULLS LAST,
                     price_ratio DESC, total_spent DESC
            LIMIT ${n_limit} OFFSET ${n_offset}""",
        *params,
    )

    total = rows[0].pop("_total_count", 0) if rows else 0
    for row in rows[1:]:
        row.pop("_total_count", None)

    # Classify each entry
    for row in rows:
        ratio = row.get("price_ratio", 1.0)
        if ratio >= 5.0:
            row["severity"] = "critical"  # Likely error or overcharging
        elif ratio >= 2.0:
            row["severity"] = "warning"   # Significant price difference
        elif ratio >= 1.3:
            row["severity"] = "info"      # Moderate difference
        else:
            row["severity"] = "normal"    # Same price, legitimate repeat

        # Convert date objects for JSON
        if row.get("first_purchase_date"):
            row["first_purchase_date"] = str(row["first_purchase_date"])
        if row.get("last_purchase_date"):
            row["last_purchase_date"] = str(row["last_purchase_date"])
        if row.get("last_entered_at"):
            row["last_entered_at"] = str(row["last_entered_at"])

    # Summary stats
    total_items = total
    critical = sum(1 for r in rows if r.get("severity") == "critical")
    warning = sum(1 for r in rows if r.get("severity") == "warning")
    total_wasted = sum(r.get("total_spent", 0) for r in rows if r.get("severity") in ("critical", "warning"))

    return {
        "success": True,
        "data": rows,
        "meta": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        },
        "summary": {
            "total_repeat_items": total_items,
            "critical_count": critical,
            "warning_count": warning,
            "flagged_total_spent": round(total_wasted, 2),
        },
    }


@router.get("/analytics/repeat-purchases/detail")
async def get_repeat_purchase_detail(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    part_name: str = Query(..., description="Part description (uppercase normalized)"),
    plant_id: UUID | None = Query(None, description="Plant UUID (null for workshop/shared)"),
) -> dict[str, Any]:
    """Get individual purchase records for a specific plant+part combo.

    Used to expand a row in the repeat purchases report and see each
    individual purchase side by side.
    """
    conds = ["UPPER(TRIM(sp.part_description)) = $1"]
    params: list[Any] = [part_name.upper().strip()]

    if plant_id:
        params.append(str(plant_id))
        conds.append(f"sp.plant_id = ${len(params)}::uuid")
    else:
        conds.append("sp.plant_id IS NULL")

    where = " AND ".join(conds)

    rows = await fetch(
        f"""SELECT sp.id, sp.part_description, sp.part_number,
                   sp.quantity, sp.unit_cost::float, sp.total_cost::float,
                   sp.purchase_order_number, sp.po_date, sp.created_at,
                   COALESCE(s.name, sp.supplier) AS supplier_name,
                   sp.reason_for_change
            FROM spare_parts sp
            LEFT JOIN suppliers s ON s.id = sp.supplier_id
            WHERE {where}
            ORDER BY sp.po_date DESC NULLS LAST, sp.created_at DESC""",
        *params,
    )

    # Convert dates
    for row in rows:
        if row.get("po_date"):
            row["po_date"] = str(row["po_date"])
        if row.get("created_at"):
            row["created_at"] = str(row["created_at"])

    return {
        "success": True,
        "data": rows,
    }


# ============== PARTS PRICE CATALOG ==============

@router.get("/analytics/price-catalog")
async def get_price_catalog(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    search: str | None = Query(None, description="Search part name or part number"),
    sort_by: str = Query("part_name", pattern="^(part_name|part_number|purchase_count|avg_unit_cost|total_spent|last_purchased)$"),
    sort_order: str = Query("asc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=10000),
) -> dict[str, Any]:
    """Parts price catalog — every unique part+part_number with price aggregation.

    Groups by (part_description + part_number). Same description with different
    part numbers = different products = separate rows. Parts without a part
    number are grouped together by description alone.
    """
    conds: list[str] = []
    params: list[Any] = []

    if search:
        params.append(f"%{search}%")
        n = len(params)
        conds.append(f"(UPPER(sp.part_description) ILIKE ${n} OR COALESCE(sp.part_number, '') ILIKE ${n})")

    where = " AND ".join(conds) if conds else "TRUE"

    allowed_sorts = {"part_name", "part_number", "purchase_count", "avg_unit_cost", "total_spent", "last_purchased"}
    safe_sort = sort_by if sort_by in allowed_sorts else "part_name"
    safe_order = "DESC" if sort_order == "desc" else "ASC"

    params.append(limit)
    params.append((page - 1) * limit)

    rows = await fetch(
        f"""SELECT
              UPPER(TRIM(sp.part_description)) AS part_name,
              COALESCE(NULLIF(TRIM(sp.part_number), ''), '-') AS part_number,
              count(*) AS purchase_count,
              sum(sp.quantity) AS total_qty,
              min(sp.unit_cost)::float AS min_unit_cost,
              max(sp.unit_cost)::float AS max_unit_cost,
              round(avg(sp.unit_cost)::numeric, 2)::float AS avg_unit_cost,
              sum(sp.total_cost)::float AS total_spent,
              max(sp.po_date) AS last_purchased,
              count(DISTINCT COALESCE(s.name, sp.supplier)) AS supplier_count,
              array_agg(DISTINCT COALESCE(s.name, sp.supplier) ORDER BY COALESCE(s.name, sp.supplier)) AS suppliers,
              count(*) OVER() AS _total_count
            FROM spare_parts sp
            LEFT JOIN suppliers s ON s.id = sp.supplier_id
            WHERE {where}
            GROUP BY UPPER(TRIM(sp.part_description)), COALESCE(NULLIF(TRIM(sp.part_number), ''), '-')
            ORDER BY {safe_sort} {safe_order} NULLS LAST
            LIMIT ${len(params) - 1} OFFSET ${len(params)}""",
        *params,
    )

    total = rows[0].pop("_total_count", 0) if rows else 0
    for row in rows[1:]:
        row.pop("_total_count", None)

    for row in rows:
        if row.get("last_purchased"):
            row["last_purchased"] = str(row["last_purchased"])

    return {
        "success": True,
        "data": rows,
        "meta": {
            "page": page, "limit": limit, "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
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
