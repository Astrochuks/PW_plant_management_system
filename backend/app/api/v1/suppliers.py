"""Supplier management endpoints."""

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
    client = get_supabase_admin_client()

    query = client.table("suppliers").select("*", count="exact")

    if active_only:
        query = query.eq("is_active", True)

    if search:
        query = query.ilike("name", f"%{search}%")

    offset = (page - 1) * limit
    query = query.order("name")
    query = query.range(offset, offset + limit - 1)

    result = query.execute()
    total = result.count or 0

    # Get PO counts for each supplier
    suppliers_with_stats = []
    for supplier in result.data or []:
        # Count items and POs for this supplier
        stats = (
            client.table("spare_parts")
            .select("purchase_order_number", count="exact")
            .eq("supplier_id", supplier["id"])
            .execute()
        )

        po_numbers = set(
            item["purchase_order_number"]
            for item in (stats.data or [])
            if item.get("purchase_order_number")
        )

        suppliers_with_stats.append({
            **supplier,
            "items_count": stats.count or 0,
            "po_count": len(po_numbers),
        })

    return {
        "success": True,
        "data": suppliers_with_stats,
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
    client = get_supabase_admin_client()

    suggestions = []
    seen_ids = set()

    # Step 1: Exact matches (contains)
    exact_result = (
        client.table("suppliers")
        .select("id, name")
        .ilike("name", f"%{q}%")
        .eq("is_active", True)
        .order("name")
        .limit(limit)
        .execute()
    )

    for sup in exact_result.data or []:
        if sup["id"] not in seen_ids:
            suggestions.append({
                "id": sup["id"],
                "name": sup["name"],
                "match_type": "exact",
            })
            seen_ids.add(sup["id"])

    # Step 2: Fuzzy matches (if enabled and need more results)
    if fuzzy and len(suggestions) < limit:
        fuzzy_result = client.rpc(
            "find_similar_supplier",
            {"p_name": q, "p_threshold": 0.25}
        ).execute()

        for sup in fuzzy_result.data or []:
            if sup["id"] not in seen_ids:
                suggestions.append({
                    "id": sup["id"],
                    "name": sup["name"],
                    "match_type": "fuzzy",
                    "similarity": round(sup["similarity"], 2),
                })
                seen_ids.add(sup["id"])
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
        Supplier details with PO history.
    """
    client = get_supabase_admin_client()

    result = (
        client.table("suppliers")
        .select("*")
        .eq("id", str(supplier_id))
        .single()
        .execute()
    )

    if not result.data:
        raise NotFoundError("Supplier", str(supplier_id))

    # Get PO stats
    po_stats = (
        client.table("spare_parts")
        .select("purchase_order_number, total_cost")
        .eq("supplier_id", str(supplier_id))
        .execute()
    )

    po_numbers = set()
    total_spend = 0
    for item in po_stats.data or []:
        if item.get("purchase_order_number"):
            po_numbers.add(item["purchase_order_number"])
        total_spend += float(item.get("total_cost") or 0)

    return {
        "success": True,
        "data": {
            **result.data,
            "items_count": len(po_stats.data or []),
            "po_count": len(po_numbers),
            "total_spend": round(total_spend, 2),
        },
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
    client = get_supabase_admin_client()

    # Check for duplicate (case-insensitive)
    existing = (
        client.table("suppliers")
        .select("id, name")
        .ilike("name_normalized", name.upper().strip())
        .execute()
    )

    if existing.data:
        raise ValidationError(
            f"Supplier '{existing.data[0]['name']}' already exists",
            details=[{"field": "name", "message": "Already exists", "code": "DUPLICATE"}],
        )

    supplier_data = {
        "name": name.strip(),
        "contact_person": contact_person,
        "phone": phone,
        "email": email,
        "address": address,
    }

    result = client.table("suppliers").insert(supplier_data).execute()
    created = result.data[0]

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
        new_values=supplier_data,
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
    client = get_supabase_admin_client()

    # Build update data
    update_data = {}
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
    existing = (
        client.table("suppliers")
        .select("*")
        .eq("id", str(supplier_id))
        .execute()
    )

    if not existing.data:
        raise NotFoundError("Supplier", str(supplier_id))

    old_values = {k: existing.data[0].get(k) for k in update_data}

    # Check for duplicate name if changing name
    if name:
        dup_check = (
            client.table("suppliers")
            .select("id, name")
            .ilike("name_normalized", name.upper().strip())
            .neq("id", str(supplier_id))
            .execute()
        )
        if dup_check.data:
            raise ValidationError(
                f"Supplier '{dup_check.data[0]['name']}' already exists",
                details=[{"field": "name", "message": "Already exists", "code": "DUPLICATE"}],
            )

    update_data["updated_at"] = "now()"

    result = (
        client.table("suppliers")
        .update(update_data)
        .eq("id", str(supplier_id))
        .execute()
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
        new_values={k: v for k, v in update_data.items() if k != "updated_at"},
        ip_address=get_client_ip(request),
        description=f"Updated supplier: {existing.data[0]['name']}",
    )

    return {
        "success": True,
        "data": result.data[0],
    }


@router.get("/{supplier_id}/pos")
async def get_supplier_pos(
    supplier_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """Get all POs for a supplier.

    Args:
        supplier_id: The supplier UUID.
        page: Page number.
        limit: Items per page.

    Returns:
        Paginated list of POs for this supplier.
    """
    client = get_supabase_admin_client()

    # Verify supplier exists
    supplier = (
        client.table("suppliers")
        .select("id, name")
        .eq("id", str(supplier_id))
        .execute()
    )

    if not supplier.data:
        raise NotFoundError("Supplier", str(supplier_id))

    # Get POs via spare_parts
    result = (
        client.table("spare_parts")
        .select("purchase_order_number, po_date, total_cost, location_id, locations(name)")
        .eq("supplier_id", str(supplier_id))
        .not_.is_("purchase_order_number", "null")
        .order("po_date", desc=True)
        .execute()
    )

    # Aggregate by PO number
    po_map: dict = {}
    for item in result.data or []:
        po_num = item["purchase_order_number"]
        if po_num not in po_map:
            loc = item.get("locations") or {}
            po_map[po_num] = {
                "po_number": po_num,
                "po_date": item.get("po_date"),
                "location": loc.get("name") if isinstance(loc, dict) else None,
                "items_count": 0,
                "total_amount": 0,
            }
        po_map[po_num]["items_count"] += 1
        po_map[po_num]["total_amount"] += float(item.get("total_cost") or 0)

    # Sort by date and paginate
    pos = sorted(po_map.values(), key=lambda x: x.get("po_date") or "", reverse=True)
    total = len(pos)
    offset = (page - 1) * limit
    paginated = pos[offset : offset + limit]

    return {
        "success": True,
        "data": paginated,
        "meta": {
            "supplier": supplier.data[0],
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        },
    }
