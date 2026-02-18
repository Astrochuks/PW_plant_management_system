"""API endpoints for plant transfer management.

Provides endpoints for:
- Viewing pending and confirmed transfers
- Manual transfer confirmation/cancellation
- Transfer history for plants
"""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

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
    """
    service = get_transfer_service()

    try:
        # Use simpler query to avoid join issues
        query = (
            service.client.table("plant_transfers")
            .select("*")
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
        )

        if status:
            query = query.eq("status", status)

        if plant_id:
            query = query.eq("plant_id", str(plant_id))

        if location_id:
            query = query.or_(
                f"from_location_id.eq.{str(location_id)},to_location_id.eq.{str(location_id)}"
            )

        result = query.execute()

        # Batch collect IDs for enrichment (avoid N+1 queries)
        transfers_list = result.data or []
        plant_ids = list({t["plant_id"] for t in transfers_list if t.get("plant_id")})
        location_ids = list({
            lid for t in transfers_list
            for lid in [t.get("from_location_id"), t.get("to_location_id")]
            if lid
        })
        submission_ids = list({t["source_submission_id"] for t in transfers_list if t.get("source_submission_id")})

        # Batch fetch plants
        plants_map: dict[str, dict] = {}
        if plant_ids:
            plants_result = service.client.table("plants_master").select("id, fleet_number, description").in_("id", plant_ids).execute()
            plants_map = {p["id"]: p for p in (plants_result.data or [])}

        # Batch fetch locations
        locations_map: dict[str, dict] = {}
        if location_ids:
            locs_result = service.client.table("locations").select("id, name").in_("id", location_ids).execute()
            locations_map = {loc["id"]: loc for loc in (locs_result.data or [])}

        # Batch fetch source submissions for week info
        submissions_map: dict[str, dict] = {}
        if submission_ids:
            subs_result = service.client.table("weekly_report_submissions").select("id, year, week_number, week_ending_date").in_("id", submission_ids).execute()
            submissions_map = {s["id"]: s for s in (subs_result.data or [])}

        # Enrich transfers
        enriched_data = []
        for transfer in transfers_list:
            sub = submissions_map.get(transfer.get("source_submission_id", ""), {})
            enriched_data.append({
                **transfer,
                "plant": plants_map.get(transfer.get("plant_id")),
                "from_location": locations_map.get(transfer.get("from_location_id")),
                "to_location": locations_map.get(transfer.get("to_location_id")),
                "source_week": sub.get("week_number"),
                "source_year": sub.get("year"),
                "week_ending_date": sub.get("week_ending_date"),
            })

        # Get total count
        count_query = service.client.table("plant_transfers").select("id", count="exact")
        if status:
            count_query = count_query.eq("status", status)
        if plant_id:
            count_query = count_query.eq("plant_id", str(plant_id))
        if location_id:
            count_query = count_query.or_(
                f"from_location_id.eq.{str(location_id)},to_location_id.eq.{str(location_id)}"
            )
        count_result = count_query.execute()

        return {
            "success": True,
            "data": enriched_data,
            "pagination": {
                "total": count_result.count,
                "limit": limit,
                "offset": offset,
            },
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch transfers: {str(e)}")


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

    transfers = service.get_pending_transfers(location_id=location_id)

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

    transfers = service.get_plant_transfers(plant_id=plant_id, limit=limit)

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
    service = get_transfer_service()

    result = (
        service.client.table("plant_transfers")
        .select(
            "*, "
            "plants_master(id, fleet_number, description, status), "
            "from_location:locations!from_location_id(id, name), "
            "to_location:locations!to_location_id(id, name), "
            "source_submission:weekly_report_submissions!source_submission_id(id, week_ending_date, location_id), "
            "confirmed_submission:weekly_report_submissions!confirmed_by_submission_id(id, week_ending_date, location_id)"
        )
        .eq("id", str(transfer_id))
        .single()
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Transfer not found")

    return {
        "success": True,
        "data": result.data,
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
    service = get_transfer_service()

    # Get the transfer
    transfer = (
        service.client.table("plant_transfers")
        .select("*")
        .eq("id", str(transfer_id))
        .single()
        .execute()
    )

    if not transfer.data:
        raise HTTPException(status_code=404, detail="Transfer not found")

    if transfer.data["status"] != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Transfer is already {transfer.data['status']}"
        )

    # Confirm the transfer
    from datetime import datetime

    result = (
        service.client.table("plant_transfers")
        .update({
            "status": "confirmed",
            "confirmed_at": datetime.utcnow().isoformat(),
        })
        .eq("id", str(transfer_id))
        .execute()
    )

    # Update plant location and clear pending transfer
    service.client.table("plants_master").update({
        "current_location_id": transfer.data["to_location_id"],
        "pending_transfer_id": None,
        "status": "working",  # Reset from in_transit
    }).eq("id", transfer.data["plant_id"]).execute()

    # Create location history record
    service.client.table("plant_location_history").update({
        "end_date": datetime.utcnow().date().isoformat(),
    }).eq("plant_id", transfer.data["plant_id"]).is_("end_date", "null").execute()

    service.client.table("plant_location_history").insert({
        "plant_id": transfer.data["plant_id"],
        "location_id": transfer.data["to_location_id"],
        "start_date": datetime.utcnow().date().isoformat(),
        "transfer_reason": "Manual transfer confirmation",
    }).execute()

    return {
        "success": True,
        "data": result.data[0] if result.data else None,
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

    result = service.cancel_transfer(transfer_id=transfer_id, reason=reason)

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
    """Get summary statistics for transfers."""
    service = get_transfer_service()

    # Get counts by status
    pending = service.client.table("plant_transfers").select("id", count="exact").eq("status", "pending").execute()
    confirmed = service.client.table("plant_transfers").select("id", count="exact").eq("status", "confirmed").execute()
    cancelled = service.client.table("plant_transfers").select("id", count="exact").eq("status", "cancelled").execute()

    # Get recent transfers (last 7 days)
    from datetime import datetime, timedelta
    week_ago = (datetime.utcnow() - timedelta(days=7)).isoformat()

    recent = (
        service.client.table("plant_transfers")
        .select("id", count="exact")
        .gte("created_at", week_ago)
        .execute()
    )

    # Count new transfers since a given timestamp (for badge counts)
    new_since = 0
    if since:
        new_since_result = (
            service.client.table("plant_transfers")
            .select("id", count="exact")
            .gt("created_at", since)
            .execute()
        )
        new_since = new_since_result.count or 0

    return {
        "success": True,
        "data": {
            "pending": pending.count,
            "confirmed": confirmed.count,
            "cancelled": cancelled.count,
            "recent_7_days": recent.count,
            "new_since": new_since,
        },
    }
