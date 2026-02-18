"""Supplier management endpoints."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request

from app.api.v1.auth import get_client_ip
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


@router.get("")
async def list_suppliers(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = None,
    active_only: bool = Query(True, description="Only show active suppliers"),
) -> dict[str, Any]:
    """List all suppliers with pagination.

    Args:
        current_user: The authenticated user.
        page: Page number.
        limit: Items per page.
        search: Search in supplier name.
        active_only: Only show active suppliers.

    Returns:
        Paginated list of suppliers with PO stats.
    """
    conditions: list[str] = []
    params: list[Any] = []

    if active_only:
        conditions.append("is_active = true")

    if search:
        params.append(f"%{search}%")
        conditions.append(f"name ILIKE ${len(params)}")

    where = " AND ".join(conditions) if conditions else "TRUE"
    offset = (page - 1) * limit

    params.append(limit)
    params.append(offset)
    data = await fetch(
        f"""SELECT *, count(*) OVER() AS _total_count FROM v_supplier_stats
            WHERE {where}
            ORDER BY name
            LIMIT ${len(params) - 1} OFFSET ${len(params)}""",
        *params,
    )

    total = data[0].pop("_total_count", 0) if data else 0
    for row in data[1:]:
        row.pop("_total_count", None)

    return {
        "success": True,
        "data": data,
        "meta": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        },
    }


@router.get("/autocomplete")
async def autocomplete_suppliers(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(10, ge=1, le=50),
    fuzzy: bool = Query(True, description="Include fuzzy matches"),
) -> dict[str, Any]:
    """Get supplier suggestions for autocomplete.

    Uses exact matching first, then fuzzy matching if enabled.

    Args:
        q: Search query.
        limit: Maximum suggestions.
        fuzzy: Include fuzzy matches (default: True).

    Returns:
        List of matching suppliers with id, name, and match_type.
    """
    suggestions: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    # Step 1: Exact matches (contains)
    exact_rows = await fetch(
        """SELECT id, name FROM suppliers
           WHERE name ILIKE $1 AND is_active = true
           ORDER BY name
           LIMIT $2""",
        f"%{q}%",
        limit,
    )

    for sup in exact_rows:
        sid = str(sup["id"])
        if sid not in seen_ids:
            suggestions.append({
                "id": sid,
                "name": sup["name"],
                "match_type": "exact",
            })
            seen_ids.add(sid)

    # Step 2: Fuzzy matches (if enabled and need more results)
    if fuzzy and len(suggestions) < limit:
        fuzzy_rows = await fetch(
            "SELECT * FROM find_similar_supplier($1, $2)",
            q,
            0.25,
        )

        for sup in fuzzy_rows:
            sid = str(sup["id"])
            if sid not in seen_ids:
                suggestions.append({
                    "id": sid,
                    "name": sup["name"],
                    "match_type": "fuzzy",
                    "similarity": round(float(sup.get("similarity", 0)), 2),
                })
                seen_ids.add(sid)
                if len(suggestions) >= limit:
                    break

    return {
        "success": True,
        "data": suggestions,
    }


@router.get("/{supplier_id}")
async def get_supplier(
    supplier_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get a single supplier by ID.

    Args:
        supplier_id: The supplier UUID.
        current_user: The authenticated user.

    Returns:
        Supplier details with stats.
    """
    row = await fetchrow(
        "SELECT * FROM v_supplier_stats WHERE id = $1::uuid",
        str(supplier_id),
    )

    if not row:
        raise NotFoundError("Supplier", str(supplier_id))

    return {
        "success": True,
        "data": row,
    }


@router.post("", status_code=201)
async def create_supplier(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    name: str = Query(..., min_length=2, description="Supplier name"),
    contact_person: str | None = Query(None),
    phone: str | None = Query(None),
    email: str | None = Query(None),
    address: str | None = Query(None),
) -> dict[str, Any]:
    """Create a new supplier.

    Args:
        name: Supplier name (must be unique).
        contact_person: Contact person name.
        phone: Phone number.
        email: Email address.
        address: Physical address.

    Returns:
        Created supplier.
    """
    # Check for duplicate (case-insensitive)
    existing = await fetch(
        "SELECT id, name FROM suppliers WHERE name_normalized ILIKE $1",
        name.upper().strip(),
    )

    if existing:
        raise ValidationError(
            f"Supplier '{existing[0]['name']}' already exists",
            details=[{"field": "name", "message": "Already exists", "code": "DUPLICATE"}],
        )

    created = await fetchrow(
        """INSERT INTO suppliers (name, contact_person, phone, email, address)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *""",
        name.strip(),
        contact_person,
        phone,
        email,
        address,
    )

    logger.info(
        "Supplier created",
        supplier_id=created["id"],
        name=name,
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="create",
        table_name="suppliers",
        record_id=created["id"],
        new_values={"name": name.strip(), "contact_person": contact_person, "phone": phone, "email": email, "address": address},
        ip_address=get_client_ip(request),
        description=f"Created supplier: {name}",
    )

    return {
        "success": True,
        "data": created,
    }


@router.patch("/{supplier_id}")
async def update_supplier(
    supplier_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    name: str | None = Query(None, min_length=2),
    contact_person: str | None = Query(None),
    phone: str | None = Query(None),
    email: str | None = Query(None),
    address: str | None = Query(None),
    is_active: bool | None = Query(None),
) -> dict[str, Any]:
    """Update a supplier.

    Args:
        supplier_id: The supplier UUID.
        All other args are optional fields to update.

    Returns:
        Updated supplier.
    """
    # Build update data
    update_data: dict[str, Any] = {}
    if name is not None:
        update_data["name"] = name.strip()
    if contact_person is not None:
        update_data["contact_person"] = contact_person
    if phone is not None:
        update_data["phone"] = phone
    if email is not None:
        update_data["email"] = email
    if address is not None:
        update_data["address"] = address
    if is_active is not None:
        update_data["is_active"] = is_active

    if not update_data:
        raise ValidationError("No fields to update")

    # Get existing for audit
    existing = await fetchrow(
        "SELECT * FROM suppliers WHERE id = $1::uuid",
        str(supplier_id),
    )

    if not existing:
        raise NotFoundError("Supplier", str(supplier_id))

    old_values = {k: existing.get(k) for k in update_data}

    # Check for duplicate name if changing name
    if name:
        dup_check = await fetch(
            "SELECT id, name FROM suppliers WHERE name_normalized ILIKE $1 AND id != $2::uuid",
            name.upper().strip(),
            str(supplier_id),
        )
        if dup_check:
            raise ValidationError(
                f"Supplier '{dup_check[0]['name']}' already exists",
                details=[{"field": "name", "message": "Already exists", "code": "DUPLICATE"}],
            )

    # Build SET clause
    set_parts: list[str] = []
    params: list[Any] = []
    for key, val in update_data.items():
        params.append(val)
        set_parts.append(f"{key} = ${len(params)}")
    set_parts.append("updated_at = now()")

    params.append(str(supplier_id))
    set_clause = ", ".join(set_parts)

    updated = await fetchrow(
        f"UPDATE suppliers SET {set_clause} WHERE id = ${len(params)}::uuid RETURNING *",
        *params,
    )

    logger.info(
        "Supplier updated",
        supplier_id=str(supplier_id),
        updated_fields=list(update_data.keys()),
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="update",
        table_name="suppliers",
        record_id=str(supplier_id),
        old_values=old_values,
        new_values=update_data,
        ip_address=get_client_ip(request),
        description=f"Updated supplier: {existing['name']}",
    )

    return {
        "success": True,
        "data": updated,
    }


@router.get("/{supplier_id}/pos")
async def get_supplier_pos(
    supplier_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """Get all POs for a supplier.

    Optimized: SQL GROUP BY instead of fetching all rows and aggregating in Python.

    Args:
        supplier_id: The supplier UUID.
        page: Page number.
        limit: Items per page.

    Returns:
        Paginated list of POs for this supplier.
    """
    # Verify supplier exists
    supplier = await fetchrow(
        "SELECT id, name FROM suppliers WHERE id = $1::uuid",
        str(supplier_id),
    )

    if not supplier:
        raise NotFoundError("Supplier", str(supplier_id))

    # Aggregate POs in SQL instead of Python
    total = await fetchval(
        """SELECT count(DISTINCT purchase_order_number)
           FROM spare_parts
           WHERE supplier_id = $1::uuid AND purchase_order_number IS NOT NULL""",
        str(supplier_id),
    ) or 0

    offset = (page - 1) * limit
    pos = await fetch(
        """SELECT sp.purchase_order_number AS po_number,
                  MAX(sp.po_date) AS po_date,
                  MAX(l.name) AS location,
                  count(*)::int AS items_count,
                  COALESCE(SUM(sp.total_cost), 0)::float AS total_amount
           FROM spare_parts sp
           LEFT JOIN locations l ON l.id = sp.location_id
           WHERE sp.supplier_id = $1::uuid AND sp.purchase_order_number IS NOT NULL
           GROUP BY sp.purchase_order_number
           ORDER BY MAX(sp.po_date) DESC NULLS LAST
           LIMIT $2 OFFSET $3""",
        str(supplier_id),
        limit,
        offset,
    )

    return {
        "success": True,
        "data": pos,
        "meta": {
            "supplier": supplier,
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        },
    }
