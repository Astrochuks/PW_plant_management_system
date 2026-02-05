"""Reports and analytics endpoints."""

from datetime import date
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.core.database import get_supabase_admin_client
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
    client = get_supabase_admin_client()

    # Get plant counts by status
    plant_stats = client.rpc("get_dashboard_plant_stats").execute()

    # Get location summary
    location_stats = (
        client.table("v_location_stats")
        .select("*")
        .order("total_plants", desc=True)
        .limit(10)
        .execute()
    )

    # Get recent submissions
    recent_submissions = (
        client.table("weekly_report_submissions")
        .select("*, locations(name)")
        .order("submitted_at", desc=True)
        .limit(5)
        .execute()
    )

    # Get pending notifications count
    notifications = (
        client.table("notifications")
        .select("id", count="exact")
        .eq("read", False)
        .eq("target_role", current_user.role)
        .execute()
    )

    return {
        "success": True,
        "data": {
            "plants": plant_stats.data[0] if plant_stats.data else {},
            "top_locations": location_stats.data,
            "recent_submissions": [
                {
                    **s,
                    "location_name": s.get("locations", {}).get("name") if s.get("locations") else None,
                }
                for s in recent_submissions.data
            ],
            "unread_notifications": notifications.count or 0,
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
    client = get_supabase_admin_client()

    result = client.rpc(
        "get_fleet_summary_by_type",
        {"p_location_id": str(location_id) if location_id else None},
    ).execute()

    return {
        "success": True,
        "data": result.data,
    }


@router.get("/maintenance-costs")
async def get_maintenance_costs(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    year: int | None = None,
    location_id: UUID | None = None,
    group_by: str = Query("month", pattern="^(month|quarter|fleet_type|location)$"),
) -> dict[str, Any]:
    """Get maintenance cost analysis.

    Args:
        current_user: The authenticated user.
        year: Filter by year.
        location_id: Filter by location.
        group_by: Grouping dimension.

    Returns:
        Maintenance costs grouped by specified dimension.
    """
    client = get_supabase_admin_client()

    result = client.rpc(
        "get_maintenance_cost_analysis",
        {
            "p_year": year,
            "p_location_id": str(location_id) if location_id else None,
            "p_group_by": group_by,
        },
    ).execute()

    return {
        "success": True,
        "data": result.data,
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
    client = get_supabase_admin_client()

    result = client.rpc(
        "get_verification_status_by_location",
        {
            "p_year": year,
            "p_week_number": week_number,
        },
    ).execute()

    return {
        "success": True,
        "data": result.data,
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
    client = get_supabase_admin_client()

    result = client.rpc(
        "get_submission_compliance",
        {
            "p_year": year,
            "p_weeks": weeks,
        },
    ).execute()

    return {
        "success": True,
        "data": result.data,
    }


@router.get("/plant-movement")
async def get_plant_movement(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    date_from: date | None = None,
    date_to: date | None = None,
    fleet_type_id: UUID | None = None,
) -> dict[str, Any]:
    """Get plant transfer/movement report.

    Args:
        current_user: The authenticated user.
        date_from: Start date.
        date_to: End date.
        fleet_type_id: Filter by fleet type.

    Returns:
        Plant movement data between locations.
    """
    client = get_supabase_admin_client()

    result = client.rpc(
        "get_plant_movement_report",
        {
            "p_date_from": str(date_from) if date_from else None,
            "p_date_to": str(date_to) if date_to else None,
            "p_fleet_type_id": str(fleet_type_id) if fleet_type_id else None,
        },
    ).execute()

    return {
        "success": True,
        "data": result.data,
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
    client = get_supabase_admin_client()

    result = client.rpc(
        "get_weekly_trend",
        {
            "p_year": year,
            "p_location_id": str(location_id) if location_id else None,
        },
    ).execute()

    return {
        "success": True,
        "data": result.data,
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
    client = get_supabase_admin_client()

    result = client.rpc(
        "get_unverified_plants",
        {
            "p_location_id": str(location_id) if location_id else None,
            "p_weeks_missing": weeks_missing,
            "p_limit": limit,
        },
    ).execute()

    return {
        "success": True,
        "data": result.data,
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
    client = get_supabase_admin_client()

    query = client.table("v_plants_summary").select("*")

    if status:
        query = query.eq("status", status)

    if location_id:
        query = query.eq("current_location_id", str(location_id))

    query = query.order("fleet_number")

    result = query.execute()

    if format == "csv":
        # Convert to CSV format
        import io
        import csv

        if not result.data:
            return {"success": True, "data": "", "format": "csv"}

        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=result.data[0].keys())
        writer.writeheader()
        writer.writerows(result.data)
        csv_data = output.getvalue()

        return {
            "success": True,
            "data": csv_data,
            "format": "csv",
            "count": len(result.data),
        }

    return {
        "success": True,
        "data": result.data,
        "format": "json",
        "count": len(result.data),
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
    client = get_supabase_admin_client()

    query = (
        client.table("spare_parts")
        .select("*, plants_master(fleet_number)")
    )

    if year:
        query = query.gte("replaced_date", f"{year}-01-01").lte("replaced_date", f"{year}-12-31")

    if plant_id:
        query = query.eq("plant_id", str(plant_id))

    query = query.order("replaced_date", desc=True)

    result = query.execute()

    # Transform data
    data = []
    for item in result.data:
        item["fleet_number"] = item.get("plants_master", {}).get("fleet_number") if item.get("plants_master") else None
        if "plants_master" in item:
            del item["plants_master"]
        data.append(item)

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
