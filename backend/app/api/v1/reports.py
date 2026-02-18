"""Reports and analytics endpoints."""

import asyncio
from datetime import date
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.core.pool import fetch, fetchrow, fetchval, fetch_json_rpc
from app.core.security import (
    CurrentUser,
    require_management_or_admin,
)
from app.monitoring.logging import get_logger

router = APIRouter()
logger = get_logger(__name__)


@router.get("/dashboard")
async def get_dashboard_summary(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Get dashboard summary statistics.

    Args:
        current_user: The authenticated user.

    Returns:
        Summary stats for the dashboard.
    """
    role = current_user.role

    # Run all 4 independent queries concurrently — truly async, no thread wrapping
    plant_stats, location_stats, recent_submissions, unread_count = await asyncio.gather(
        fetchrow("SELECT * FROM get_dashboard_plant_stats()"),
        fetch(
            "SELECT * FROM v_location_stats ORDER BY total_plants DESC LIMIT 10"
        ),
        fetch(
            """SELECT s.*, l.name AS location_name
               FROM weekly_report_submissions s
               LEFT JOIN locations l ON l.id = s.location_id
               ORDER BY s.submitted_at DESC
               LIMIT 5"""
        ),
        fetchval(
            "SELECT count(*) FROM notifications WHERE read = false AND target_role = $1",
            role,
        ),
    )

    return {
        "success": True,
        "data": {
            "plants": plant_stats or {},
            "top_locations": location_stats,
            "recent_submissions": recent_submissions,
            "unread_notifications": unread_count or 0,
        },
    }


@router.get("/fleet-summary")
async def get_fleet_summary(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    location_id: UUID | None = None,
) -> dict[str, Any]:
    """Get fleet summary by type.

    Args:
        current_user: The authenticated user.
        location_id: Optional location filter.

    Returns:
        Fleet counts grouped by type.
    """
    data = await fetch(
        "SELECT * FROM get_fleet_summary_by_type($1)",
        str(location_id) if location_id else None,
    )

    return {
        "success": True,
        "data": data,
    }


@router.get("/maintenance-costs")
async def get_maintenance_costs(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    location_id: UUID | None = None,
    plant_id: UUID | None = None,
    fleet_type: str | None = Query(None, description="Filter by fleet type name"),
    group_by: str = Query("month", pattern="^(week|month|quarter|year|fleet_type|location|plant)$"),
) -> dict[str, Any]:
    """Get maintenance cost analysis.

    Group by week/month/quarter/year for time trends, or by fleet_type/location/plant
    for categorical breakdowns. Combine with filters to drill down.

    Examples:
        - Monthly costs for 2025: ?year=2025&group_by=month
        - Weekly costs for a plant: ?plant_id=...&group_by=week
        - Costs by equipment type: ?group_by=fleet_type&year=2025
        - Costs by location: ?group_by=location
        - Top-spending plants: ?group_by=plant&year=2025

    Args:
        current_user: The authenticated user.
        year: Filter by year.
        location_id: Filter by location.
        plant_id: Filter by specific plant.
        fleet_type: Filter by fleet type name.
        group_by: Grouping dimension (week, month, quarter, year, fleet_type, location, plant).

    Returns:
        Maintenance costs grouped by specified dimension.
    """
    data = await fetch(
        "SELECT * FROM get_maintenance_cost_analysis($1, $2, $3, $4, $5)",
        year,
        str(location_id) if location_id else None,
        str(plant_id) if plant_id else None,
        fleet_type,
        group_by,
    )

    return {
        "success": True,
        "data": data,
        "meta": {
            "group_by": group_by,
            "year": year,
            "total_groups": len(data),
            "grand_total": sum(row.get("total_cost", 0) for row in data),
        },
    }


@router.get("/verification-status")
async def get_verification_status(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    week_number: int | None = None,
) -> dict[str, Any]:
    """Get physical verification status by location.

    Args:
        current_user: The authenticated user.
        year: Filter by year.
        week_number: Filter by week number.

    Returns:
        Verification rates by location.
    """
    data = await fetch(
        "SELECT * FROM get_verification_status_by_location($1, $2)",
        year,
        week_number,
    )

    return {
        "success": True,
        "data": data,
    }


@router.get("/submission-compliance")
async def get_submission_compliance(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    weeks: int = Query(12, ge=1, le=52),
) -> dict[str, Any]:
    """Get weekly report submission compliance by location.

    Args:
        current_user: The authenticated user.
        year: Filter by year.
        weeks: Number of weeks to analyze.

    Returns:
        Submission compliance rates by location.
    """
    data = await fetch(
        "SELECT * FROM get_submission_compliance($1, $2)",
        year,
        weeks,
    )

    return {
        "success": True,
        "data": data,
    }


@router.get("/plant-movement")
async def get_plant_movement(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    date_from: date | None = None,
    date_to: date | None = None,
    fleet_type: str | None = Query(None, description="Filter by fleet type name"),
) -> dict[str, Any]:
    """Get plant transfer/movement report.

    Args:
        current_user: The authenticated user.
        date_from: Start date.
        date_to: End date.
        fleet_type: Filter by fleet type name.

    Returns:
        Plant movement data between locations.
    """
    data = await fetch(
        "SELECT * FROM get_plant_movement_report($1, $2, $3)",
        date_from,
        date_to,
        fleet_type,
    )

    return {
        "success": True,
        "data": data,
    }


@router.get("/weekly-trend")
async def get_weekly_trend(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int,
    location_id: UUID | None = None,
) -> dict[str, Any]:
    """Get weekly trend data for the year.

    Args:
        current_user: The authenticated user.
        year: Year to analyze.
        location_id: Optional location filter.

    Returns:
        Weekly plant counts and verification rates.
    """
    data = await fetch(
        "SELECT * FROM get_weekly_trend($1, $2)",
        year,
        str(location_id) if location_id else None,
    )

    return {
        "success": True,
        "data": data,
    }


@router.get("/unverified-plants")
async def get_unverified_plants(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    location_id: UUID | None = None,
    weeks_missing: int = Query(2, ge=1, le=12),
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, Any]:
    """Get plants not verified in recent weeks.

    Args:
        current_user: The authenticated user.
        location_id: Filter by location.
        weeks_missing: Number of weeks without verification.
        limit: Maximum results.

    Returns:
        List of plants missing verification.
    """
    data = await fetch(
        "SELECT * FROM get_unverified_plants($1, $2, $3)",
        str(location_id) if location_id else None,
        weeks_missing,
        limit,
    )

    return {
        "success": True,
        "data": data,
    }


@router.get("/export/plants")
async def export_plants(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    format: str = Query("json", pattern="^(json|csv)$"),
    status: str | None = None,
    location_id: UUID | None = None,
) -> dict[str, Any]:
    """Export plant data.

    Args:
        current_user: The authenticated user.
        format: Export format (json or csv).
        status: Filter by status.
        location_id: Filter by location.

    Returns:
        Exported data or download URL.
    """
    conditions: list[str] = []
    params: list[Any] = []

    if status:
        params.append(status)
        conditions.append(f"status = ${len(params)}")

    if location_id:
        params.append(str(location_id))
        conditions.append(f"current_location_id = ${len(params)}::uuid")

    where = " AND ".join(conditions) if conditions else "TRUE"
    data = await fetch(
        f"SELECT * FROM v_plants_summary WHERE {where} ORDER BY fleet_number",
        *params,
    )

    if format == "csv":
        import io
        import csv

        if not data:
            return {"success": True, "data": "", "format": "csv"}

        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=data[0].keys())
        writer.writeheader()
        writer.writerows(data)
        csv_data = output.getvalue()

        return {
            "success": True,
            "data": csv_data,
            "format": "csv",
            "count": len(data),
        }

    return {
        "success": True,
        "data": data,
        "format": "json",
        "count": len(data),
    }


@router.get("/export/maintenance")
async def export_maintenance(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    format: str = Query("json", pattern="^(json|csv)$"),
    year: int | None = None,
    plant_id: UUID | None = None,
) -> dict[str, Any]:
    """Export maintenance/spare parts data.

    Args:
        current_user: The authenticated user.
        format: Export format (json or csv).
        year: Filter by year.
        plant_id: Filter by plant.

    Returns:
        Exported data or download URL.
    """
    conditions: list[str] = []
    params: list[Any] = []

    if year:
        params.append(f"{year}-01-01")
        conditions.append(f"sp.replaced_date >= ${len(params)}::date")
        params.append(f"{year}-12-31")
        conditions.append(f"sp.replaced_date <= ${len(params)}::date")

    if plant_id:
        params.append(str(plant_id))
        conditions.append(f"sp.plant_id = ${len(params)}::uuid")

    where = " AND ".join(conditions) if conditions else "TRUE"
    data = await fetch(
        f"""SELECT sp.*, pm.fleet_number
            FROM spare_parts sp
            LEFT JOIN plants_master pm ON pm.id = sp.plant_id
            WHERE {where}
            ORDER BY sp.replaced_date DESC""",
        *params,
    )

    if format == "csv":
        import io
        import csv

        if not data:
            return {"success": True, "data": "", "format": "csv"}

        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=data[0].keys())
        writer.writeheader()
        writer.writerows(data)
        csv_data = output.getvalue()

        return {
            "success": True,
            "data": csv_data,
            "format": "csv",
            "count": len(data),
        }

    return {
        "success": True,
        "data": data,
        "format": "json",
        "count": len(data),
    }
