"""API endpoints for plant transfer management.

Provides endpoints for:
- Viewing pending and confirmed transfers
- Manual transfer creation, confirmation/cancellation
- Transfer history for plants
"""

import json
from datetime import date, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.pool import fetch, fetchrow, fetchval, execute
from app.core.security import CurrentUser, require_admin, require_management_or_admin
from app.core.events import broadcast
from app.services.transfer_service import get_transfer_service

router = APIRouter(prefix="/transfers", tags=["Transfers"])


class CreateTransferRequest(BaseModel):
    """Request body for creating a manual transfer."""

    plant_id: UUID
    to_location_id: UUID
    transfer_date: date | None = None
    notes: str | None = Field(None, max_length=500)


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


@router.post("", status_code=201)
async def create_transfer(
    body: CreateTransferRequest,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Manually create a plant transfer (admin only).

    Creates a confirmed transfer, updates the plant's current location,
    and records the movement in location history.
    """
    transfer_date = body.transfer_date or date.today()

    # Fetch the plant
    plant = await fetchrow(
        "SELECT id, fleet_number, description, current_location_id FROM plants_master WHERE id = $1::uuid",
        str(body.plant_id),
    )
    if not plant:
        raise HTTPException(status_code=404, detail="Plant not found")

    from_location_id = str(plant["current_location_id"]) if plant["current_location_id"] else None

    # Validate destination location exists
    to_location = await fetchrow(
        "SELECT id, name FROM locations WHERE id = $1::uuid",
        str(body.to_location_id),
    )
    if not to_location:
        raise HTTPException(status_code=404, detail="Destination location not found")

    # Cannot transfer to the same location
    if from_location_id and from_location_id == str(body.to_location_id):
        raise HTTPException(status_code=400, detail="Plant is already at this location")

    # Get from location name
    from_location_name = None
    if from_location_id:
        from_loc = await fetchrow("SELECT name FROM locations WHERE id = $1::uuid", from_location_id)
        if from_loc:
            from_location_name = from_loc["name"]

    # Create the confirmed transfer record
    transfer = await fetchrow(
        """INSERT INTO plant_transfers
           (plant_id, from_location_id, to_location_id, transfer_date,
            actual_arrival_date, direction, status, confirmed_at, source_remarks)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4, 'inbound', 'confirmed', now(), $5)
           RETURNING *""",
        str(body.plant_id),
        from_location_id,
        str(body.to_location_id),
        transfer_date,
        body.notes,
    )

    # Update plant's current location
    await execute(
        "UPDATE plants_master SET current_location_id = $1::uuid WHERE id = $2::uuid",
        str(body.to_location_id),
        str(body.plant_id),
    )

    # Update location history — same pattern as confirm_transfer
    today = transfer_date
    await execute(
        """UPDATE plant_location_history
           SET end_date = $1::date
           WHERE plant_id = $2::uuid AND end_date IS NULL""",
        today,
        str(body.plant_id),
    )
    await execute(
        """INSERT INTO plant_location_history (plant_id, location_id, start_date, transfer_reason)
           VALUES ($1::uuid, $2::uuid, $3::date, $4)""",
        str(body.plant_id),
        str(body.to_location_id),
        today,
        body.notes or "Manual transfer",
    )

    return {
        "success": True,
        "data": {
            **transfer,
            "plant": {"id": str(plant["id"]), "fleet_number": plant["fleet_number"], "description": plant["description"]},
            "from_location": {"id": from_location_id, "name": from_location_name} if from_location_id else None,
            "to_location": {"id": str(to_location["id"]), "name": to_location["name"]},
        },
        "message": f"Transfer created: {plant['fleet_number']} → {to_location['name']}",
    }
    broadcast("transfers", "create")
    broadcast("plants", "update")


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


@router.get("/site-requests")
async def list_site_transfer_requests(
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    status: str = Query("pending"),
) -> dict[str, Any]:
    """List all site-to-site transfer requests visible to admin.

    Returns both types:
    - pull_request (is_pull_request=TRUE): Site B asked Site A to release a plant.
      The site that currently *holds* the plant must approve.
    - submission_transfer (is_pull_request=FALSE): Site A's weekly report flagged
      a plant as moving to Site B; awaiting confirmation from Site B.
    """
    rows = await fetch(
        """SELECT
               t.id::text, t.status, t.is_pull_request, t.created_at, t.transfer_date,
               t.source_remarks AS notes,
               pm.fleet_number, pm.description, pm.fleet_type,
               fl.id::text AS from_location_id, fl.name AS from_location_name,
               tl.id::text AS to_location_id, tl.name AS to_location_name
           FROM plant_transfers t
           JOIN plants_master pm ON pm.id = t.plant_id
           JOIN locations fl ON fl.id = t.from_location_id
           JOIN locations tl ON tl.id = t.to_location_id
           WHERE t.status = $1
             AND (t.is_pull_request = TRUE OR t.source_submission_id IS NOT NULL)
           ORDER BY t.created_at DESC""",
        status,
    )
    return {
        "success": True,
        "data": [
            {
                "id": r["id"],
                "status": r["status"],
                "type": "pull_request" if r["is_pull_request"] else "submission_transfer",
                "created_at": r["created_at"],
                "transfer_date": r["transfer_date"],
                "notes": r["notes"],
                "plant": {
                    "fleet_number": r["fleet_number"],
                    "description": r["description"],
                    "fleet_type": r["fleet_type"],
                },
                "from_site": {"id": r["from_location_id"], "name": r["from_location_name"]},
                "to_site": {"id": r["to_location_id"], "name": r["to_location_name"]},
            }
            for r in rows
        ],
        "count": len(rows),
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

    # Update plant's current location (preserve condition/status — don't overwrite)
    await execute(
        "UPDATE plants_master SET current_location_id = $1::uuid WHERE id = $2::uuid",
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

    broadcast("transfers", "confirm")
    broadcast("plants", "update")

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

    broadcast("transfers", "cancel")

    return {
        "success": True,
        "data": result,
        "message": "Transfer cancelled successfully",
    }


@router.post("/{transfer_id}/reject")
async def reject_transfer(
    transfer_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Reject a pending site transfer request (admin only).

    Works for both pull requests and submission-initiated transfers.
    The plant stays at its current location.
    """
    transfer = await fetchrow(
        "SELECT id FROM plant_transfers WHERE id = $1::uuid AND status = 'pending'",
        str(transfer_id),
    )
    if not transfer:
        raise HTTPException(status_code=404, detail="Pending transfer not found")

    await execute(
        "UPDATE plant_transfers SET status = 'rejected' WHERE id = $1::uuid",
        str(transfer_id),
    )
    broadcast("transfers", "reject")
    return {"success": True, "message": "Transfer request rejected"}


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
