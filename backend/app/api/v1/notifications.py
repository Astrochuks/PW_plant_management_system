"""Notification endpoints."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.core.pool import fetch, fetchrow, fetchval, execute
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
    conditions = ["(target_role = $1 OR target_user_id = $2)"]
    params: list[Any] = [current_user.role, current_user.id]

    if unread_only:
        conditions.append("read = false")

    where = " AND ".join(conditions)
    offset = (page - 1) * limit

    params.append(limit)
    params.append(offset)
    data = await fetch(
        f"""SELECT *, count(*) OVER() AS _total_count FROM notifications
            WHERE {where}
            ORDER BY created_at DESC
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
    count = await fetchval(
        """SELECT count(*) FROM notifications
           WHERE read = false
             AND (target_role = $1 OR target_user_id = $2)""",
        current_user.role,
        current_user.id,
    ) or 0

    return {
        "success": True,
        "data": {"unread_count": count},
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
    # Check notification exists and belongs to user
    existing = await fetchrow(
        "SELECT id, target_role, target_user_id FROM notifications WHERE id = $1::uuid",
        str(notification_id),
    )

    if not existing:
        raise NotFoundError("Notification", str(notification_id))

    # Verify user can access this notification
    if existing.get("target_user_id") and existing["target_user_id"] != current_user.id:
        raise NotFoundError("Notification", str(notification_id))
    if existing.get("target_role") and existing["target_role"] != current_user.role:
        raise NotFoundError("Notification", str(notification_id))

    updated = await fetchrow(
        """UPDATE notifications SET read = true, read_at = now()
           WHERE id = $1::uuid
           RETURNING *""",
        str(notification_id),
    )

    return {
        "success": True,
        "data": updated,
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
    status = await execute(
        """UPDATE notifications SET read = true, read_at = now()
           WHERE read = false
             AND (target_role = $1 OR target_user_id = $2)""",
        current_user.role,
        current_user.id,
    )

    # asyncpg execute returns status like "UPDATE 5"
    count = 0
    if status:
        parts = status.split()
        if len(parts) >= 2 and parts[-1].isdigit():
            count = int(parts[-1])

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
    # Check notification exists and user can delete it
    existing = await fetchrow(
        "SELECT id, target_role, target_user_id FROM notifications WHERE id = $1::uuid",
        str(notification_id),
    )

    if not existing:
        raise NotFoundError("Notification", str(notification_id))

    if existing.get("target_user_id") and existing["target_user_id"] != current_user.id:
        raise NotFoundError("Notification", str(notification_id))
    if existing.get("target_role") and existing["target_role"] != current_user.role:
        raise NotFoundError("Notification", str(notification_id))

    await execute(
        "DELETE FROM notifications WHERE id = $1::uuid",
        str(notification_id),
    )

    return {
        "success": True,
        "message": "Notification deleted",
    }
