"""Notification endpoints."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.core.database import get_supabase_admin_client
from app.core.exceptions import NotFoundError
from app.core.security import (
    CurrentUser,
    get_current_user,
)
from app.monitoring.logging import get_logger

router = APIRouter()
logger = get_logger(__name__)


@router.get("")
async def list_notifications(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    unread_only: bool = False,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """List notifications for the current user.

    Args:
        current_user: The authenticated user.
        unread_only: Only show unread notifications.
        page: Page number.
        limit: Items per page.

    Returns:
        Paginated list of notifications.
    """
    client = get_supabase_admin_client()

    query = (
        client.table("notifications")
        .select("*", count="exact")
        .or_(f"target_role.eq.{current_user.role},target_user_id.eq.{current_user.id}")
    )

    if unread_only:
        query = query.eq("read", False)

    offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)
    query = query.order("created_at", desc=True)

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
            "unread_count": total if unread_only else None,
        },
    }


@router.get("/unread-count")
async def get_unread_count(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    """Get count of unread notifications.

    Args:
        current_user: The authenticated user.

    Returns:
        Count of unread notifications.
    """
    client = get_supabase_admin_client()

    result = (
        client.table("notifications")
        .select("id", count="exact")
        .eq("read", False)
        .or_(f"target_role.eq.{current_user.role},target_user_id.eq.{current_user.id}")
        .execute()
    )

    return {
        "success": True,
        "data": {"unread_count": result.count or 0},
    }


@router.patch("/{notification_id}/read")
async def mark_as_read(
    notification_id: UUID,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    """Mark a notification as read.

    Args:
        notification_id: The notification UUID.
        current_user: The authenticated user.

    Returns:
        Updated notification.
    """
    client = get_supabase_admin_client()

    # Check notification exists and belongs to user
    existing = (
        client.table("notifications")
        .select("id, target_role, target_user_id")
        .eq("id", str(notification_id))
        .single()
        .execute()
    )

    if not existing.data:
        raise NotFoundError("Notification", str(notification_id))

    # Verify user can access this notification
    notif = existing.data
    if notif.get("target_user_id") and notif["target_user_id"] != current_user.id:
        raise NotFoundError("Notification", str(notification_id))
    if notif.get("target_role") and notif["target_role"] != current_user.role:
        raise NotFoundError("Notification", str(notification_id))

    result = (
        client.table("notifications")
        .update({"read": True, "read_at": "now()"})
        .eq("id", str(notification_id))
        .execute()
    )

    return {
        "success": True,
        "data": result.data[0],
    }


@router.post("/mark-all-read")
async def mark_all_as_read(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    """Mark all notifications as read.

    Args:
        current_user: The authenticated user.

    Returns:
        Count of notifications marked as read.
    """
    client = get_supabase_admin_client()

    # Update all unread notifications for this user
    result = (
        client.table("notifications")
        .update({"read": True, "read_at": "now()"})
        .eq("read", False)
        .or_(f"target_role.eq.{current_user.role},target_user_id.eq.{current_user.id}")
        .execute()
    )

    count = len(result.data) if result.data else 0

    logger.info(
        "Marked all notifications as read",
        count=count,
        user_id=current_user.id,
    )

    return {
        "success": True,
        "data": {"marked_read": count},
    }


@router.delete("/{notification_id}")
async def delete_notification(
    notification_id: UUID,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    """Delete a notification.

    Args:
        notification_id: The notification UUID.
        current_user: The authenticated user.

    Returns:
        Success message.
    """
    client = get_supabase_admin_client()

    # Check notification exists and user can delete it
    existing = (
        client.table("notifications")
        .select("id, target_role, target_user_id")
        .eq("id", str(notification_id))
        .single()
        .execute()
    )

    if not existing.data:
        raise NotFoundError("Notification", str(notification_id))

    notif = existing.data
    if notif.get("target_user_id") and notif["target_user_id"] != current_user.id:
        raise NotFoundError("Notification", str(notification_id))
    if notif.get("target_role") and notif["target_role"] != current_user.role:
        raise NotFoundError("Notification", str(notification_id))

    client.table("notifications").delete().eq("id", str(notification_id)).execute()

    return {
        "success": True,
        "message": "Notification deleted",
    }
