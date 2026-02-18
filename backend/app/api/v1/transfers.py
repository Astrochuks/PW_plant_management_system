"""API endpoints for plant transfer management.

Provides endpoints for:
- Viewing pending and confirmed transfers
- Manual transfer confirmation/cancellation
- Transfer history for plants
"""

import json
from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.pool import fetch, fetchrow, fetchval, execute
from app.core.security import CurrentUser, require_admin, require_management_or_admin
from app.services.transfer_service import get_transfer_service

router = APIRouter(prefix="/transfers", tags=["Transfers"])


@router.get("")
async def list_transfers(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    status: str | None = Query(None, description="Filter by status: pending, confirmed, cancelled"),
    plant_id: UUID | None = Query(None, description="Filter by plant ID"),
    location_id: UUID | None = Query(None, description="Filter by location (source or destination)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """List plant transfers with optional filters.

    Returns transfers ordered by creation date (newest first).
    Single JOIN query replaces previous batch-fetch pattern.
    """
    conds: list[str] = []
    params: list[Any] = []

    if status:
        params.append(status)
        conds.append(f"t.status = ${len(params)}")
    if plant_id:
        params.append(str(plant_id))
        conds.append(f"t.plant_id = ${len(params)}::uuid")
    if location_id:
        params.append(str(location_id))
        n = len(params)
        conds.append(f"(t.from_location_id = ${n}::uuid OR t.to_location_id = ${n}::uuid)")

    where = " AND ".join(conds) if conds else "TRUE"

    # Single query: data + count in one round-trip
    params.append(limit)
    params.append(offset)
    data = await fetch(
        f"""SELECT t.*,
                   json_build_object('id', pm.id, 'fleet_number', pm.fleet_number, 'description', pm.description) AS plant,
                   CASE WHEN fl.id IS NOT NULL
                        THEN json_build_object('id', fl.id, 'name', fl.name)
                        ELSE NULL END AS from_location,
                   CASE WHEN tl.id IS NOT NULL
                        THEN json_build_object('id', tl.id, 'name', tl.name)
                        ELSE NULL END AS to_location,
                   ws.week_number AS source_week,
                   ws.year AS source_year,
                   ws.week_ending_date,
                   count(*) OVER() AS _total_count
            FROM plant_transfers t
            LEFT JOIN plants_master pm ON pm.id = t.plant_id
            LEFT JOIN locations fl ON fl.id = t.from_location_id
            LEFT JOIN locations tl ON tl.id = t.to_location_id
            LEFT JOIN weekly_report_submissions ws ON ws.id = t.source_submission_id
            WHERE {where}
            ORDER BY t.created_at DESC
            LIMIT ${len(params) - 1} OFFSET ${len(params)}""",
        *params,
    )

    total = data[0].pop("_total_count", 0) if data else 0
    for row in data[1:]:
        row.pop("_total_count", None)

    return {
        "success": True,
        "data": data,
        "pagination": {
            "total": total,
            "limit": limit,
            "offset": offset,
        },
    }


@router.get("/pending")
async def list_pending_transfers(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    location_id: UUID | None = Query(None, description="Filter by location"),
) -> dict[str, Any]:
    """List pending transfers awaiting confirmation.

    These are outbound transfers that haven't been confirmed by
    the destination location's report yet.
    """
    service = get_transfer_service()
    transfers = await service.get_pending_transfers(location_id=location_id)

    return {
        "success": True,
        "data": transfers,
        "count": len(transfers),
    }


@router.get("/plant/{plant_id}")
async def get_plant_transfers(
    plant_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """Get transfer history for a specific plant."""
    service = get_transfer_service()
    transfers = await service.get_plant_transfers(plant_id=plant_id, limit=limit)

    return {
        "success": True,
        "data": transfers,
        "count": len(transfers),
    }


@router.get("/{transfer_id}")
async def get_transfer(
    transfer_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get details of a specific transfer."""
    row = await fetchrow(
        """SELECT t.*,
                  json_build_object('id', pm.id, 'fleet_number', pm.fleet_number,
                                    'description', pm.description, 'status', pm.status) AS plants_master,
                  CASE WHEN fl.id IS NOT NULL
                       THEN json_build_object('id', fl.id, 'name', fl.name)
                       ELSE NULL END AS from_location,
                  CASE WHEN tl.id IS NOT NULL
                       THEN json_build_object('id', tl.id, 'name', tl.name)
                       ELSE NULL END AS to_location,
                  CASE WHEN ss.id IS NOT NULL
                       THEN json_build_object('id', ss.id, 'week_ending_date', ss.week_ending_date, 'location_id', ss.location_id)
                       ELSE NULL END AS source_submission,
                  CASE WHEN cs.id IS NOT NULL
                       THEN json_build_object('id', cs.id, 'week_ending_date', cs.week_ending_date, 'location_id', cs.location_id)
                       ELSE NULL END AS confirmed_submission
           FROM plant_transfers t
           LEFT JOIN plants_master pm ON pm.id = t.plant_id
           LEFT JOIN locations fl ON fl.id = t.from_location_id
           LEFT JOIN locations tl ON tl.id = t.to_location_id
           LEFT JOIN weekly_report_submissions ss ON ss.id = t.source_submission_id
           LEFT JOIN weekly_report_submissions cs ON cs.id = t.confirmed_by_submission_id
           WHERE t.id = $1::uuid""",
        str(transfer_id),
    )

    if not row:
        raise HTTPException(status_code=404, detail="Transfer not found")

    return {
        "success": True,
        "data": row,
    }


@router.post("/{transfer_id}/confirm")
async def confirm_transfer(
    transfer_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Manually confirm a pending transfer.

    This updates the transfer status to confirmed and updates
    the plant's current location to the destination.
    """
    # Get the transfer
    transfer = await fetchrow(
        "SELECT * FROM plant_transfers WHERE id = $1::uuid",
        str(transfer_id),
    )

    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")

    if transfer["status"] != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Transfer is already {transfer['status']}"
        )

    # Confirm the transfer
    updated = await fetchrow(
        """UPDATE plant_transfers
           SET status = 'confirmed', confirmed_at = now()
           WHERE id = $1::uuid
           RETURNING *""",
        str(transfer_id),
    )

    # Update plant location and clear pending transfer
    await execute(
        """UPDATE plants_master
           SET current_location_id = $1::uuid,
               pending_transfer_id = NULL,
               status = 'working'
           WHERE id = $2::uuid""",
        str(transfer["to_location_id"]),
        str(transfer["plant_id"]),
    )

    # Close current location history and create new one
    today = datetime.utcnow().date()
    await execute(
        """UPDATE plant_location_history
           SET end_date = $1::date
           WHERE plant_id = $2::uuid AND end_date IS NULL""",
        today,
        str(transfer["plant_id"]),
    )
    await execute(
        """INSERT INTO plant_location_history (plant_id, location_id, start_date, transfer_reason)
           VALUES ($1::uuid, $2::uuid, $3::date, 'Manual transfer confirmation')""",
        str(transfer["plant_id"]),
        str(transfer["to_location_id"]),
        today,
    )

    return {
        "success": True,
        "data": updated,
        "message": "Transfer confirmed successfully",
    }


@router.post("/{transfer_id}/cancel")
async def cancel_transfer(
    transfer_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    reason: str | None = Query(None, description="Reason for cancellation"),
) -> dict[str, Any]:
    """Cancel a pending transfer.

    This marks the transfer as cancelled and resets the plant's
    status from in_transit.
    """
    service = get_transfer_service()
    result = await service.cancel_transfer(transfer_id=transfer_id, reason=reason)

    if not result:
        raise HTTPException(
            status_code=400,
            detail="Failed to cancel transfer. It may not exist or is not pending."
        )

    return {
        "success": True,
        "data": result,
        "message": "Transfer cancelled successfully",
    }


@router.get("/stats/summary")
async def get_transfer_stats(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    since: str | None = Query(None, description="ISO timestamp — count transfers created after this time"),
) -> dict[str, Any]:
    """Get summary statistics for transfers.

    Uses a single RPC that scans plant_transfers once with COUNT FILTER
    instead of 4-5 separate COUNT queries.
    """
    since_dt = None
    if since:
        from datetime import datetime as _dt
        try:
            since_dt = _dt.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            since_dt = None

    raw = await fetchval(
        "SELECT get_transfer_stats_summary($1::timestamptz)",
        since_dt,
    )

    stats = (json.loads(raw) if isinstance(raw, str) else raw) if raw else {}

    return {
        "success": True,
        "data": {
            "pending": stats.get("pending", 0),
            "confirmed": stats.get("confirmed", 0),
            "cancelled": stats.get("cancelled", 0),
            "recent_7_days": stats.get("recent_7_days", 0),
            "new_since": stats.get("new_since", 0),
        },
    }
