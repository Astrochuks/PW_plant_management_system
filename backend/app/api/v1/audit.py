"""Audit log endpoints for viewing CRUD operation history."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.core.security import CurrentUser, require_admin
from app.services.audit_service import audit_service

router = APIRouter()


@router.get("/logs")
async def get_audit_logs(
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    table_name: str | None = Query(None, description="Filter by table (plants_master, spare_parts, locations, etc.)"),
    record_id: str | None = Query(None, description="Filter by specific record ID"),
    action: str | None = Query(None, pattern="^(create|update|delete|transfer|upload)$"),
    user_id: str | None = Query(None, description="Filter by user ID"),
    start_date: str | None = Query(None, description="ISO date string"),
    end_date: str | None = Query(None, description="ISO date string"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
) -> dict[str, Any]:
    """View audit logs with filtering and pagination.

    Admin only. Shows all data modification events across the system.
    """
    result = audit_service.get_logs(
        table_name=table_name,
        record_id=record_id,
        action=action,
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        page=page,
        limit=limit,
    )

    return {
        "success": True,
        "data": result["logs"],
        "meta": {
            "page": result["page"],
            "limit": result["limit"],
            "total": result["total"],
            "total_pages": result["total_pages"],
        },
    }


@router.get("/logs/{table_name}/{record_id}")
async def get_record_history(
    table_name: str,
    record_id: str,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Get full audit history for a specific record.

    Admin only. Shows all changes made to a particular record over time.
    """
    history = audit_service.get_record_history(table_name, record_id)

    return {
        "success": True,
        "data": history,
    }
