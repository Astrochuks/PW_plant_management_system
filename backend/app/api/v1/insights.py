"""Fleet insights and intelligence endpoints."""

import asyncio
from datetime import date, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.pool import fetch, fetchrow, fetchval, execute
from app.core.security import (
    CurrentUser,
    require_admin,
    require_management_or_admin,
)
from app.monitoring.logging import get_logger
from app.services.insights_service import (
    generate_insights_for_week,
    generate_fleet_wide_insights,
)

router = APIRouter()
logger = get_logger(__name__)


@router.get("")
async def list_insights(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    week_ending_date: date | None = Query(None, description="Filter by week ending date"),
    severity: str | None = Query(None, description="Filter: info, warning, critical"),
    insight_type: str | None = Query(None, description="Filter by insight type"),
    location_id: UUID | None = Query(None, description="Filter by location"),
    acknowledged: bool | None = Query(None, description="Filter by acknowledged status"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """List insights with optional filters."""
    conditions = []
    params: list[Any] = []
    idx = 1

    if week_ending_date:
        conditions.append(f"wi.week_ending_date = ${idx}")
        params.append(week_ending_date)
        idx += 1
    if severity:
        conditions.append(f"wi.severity = ${idx}")
        params.append(severity)
        idx += 1
    if insight_type:
        conditions.append(f"wi.insight_type = ${idx}")
        params.append(insight_type)
        idx += 1
    if location_id:
        conditions.append(f"wi.location_id = ${idx}::uuid")
        params.append(str(location_id))
        idx += 1
    if acknowledged is not None:
        conditions.append(f"wi.acknowledged = ${idx}")
        params.append(acknowledged)
        idx += 1

    where_clause = " AND ".join(conditions) if conditions else "TRUE"
    offset = (page - 1) * limit

    count_query = f"SELECT count(*) FROM weekly_insights wi WHERE {where_clause}"
    total = await fetchval(count_query, *params) or 0

    data_query = f"""
        SELECT wi.*,
               l.name AS location_name
        FROM weekly_insights wi
        LEFT JOIN locations l ON l.id = wi.location_id
        WHERE {where_clause}
        ORDER BY
            CASE wi.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
            wi.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
    """
    params.extend([limit, offset])

    rows = await fetch(data_query, *params)

    return {
        "success": True,
        "data": rows,
        "meta": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total else 0,
        },
    }


@router.get("/summary")
async def get_insights_summary(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    week_ending_date: date | None = Query(None, description="Week to summarize (default: latest)"),
) -> dict[str, Any]:
    """Get insights summary stats for dashboard."""
    # Direct query instead of SQL function to avoid asyncpg NULL type issues
    if week_ending_date:
        summary = await fetchrow(
            """SELECT count(*) AS total,
                      count(*) FILTER (WHERE severity = 'critical') AS critical,
                      count(*) FILTER (WHERE severity = 'warning') AS warning,
                      count(*) FILTER (WHERE severity = 'info') AS info,
                      count(*) FILTER (WHERE NOT acknowledged) AS unacknowledged,
                      $1::date AS week_ending_date
               FROM weekly_insights WHERE week_ending_date = $1""",
            week_ending_date,
        )
    else:
        summary = await fetchrow(
            """SELECT count(*) AS total,
                      count(*) FILTER (WHERE severity = 'critical') AS critical,
                      count(*) FILTER (WHERE severity = 'warning') AS warning,
                      count(*) FILTER (WHERE severity = 'info') AS info,
                      count(*) FILTER (WHERE NOT acknowledged) AS unacknowledged,
                      max(week_ending_date) AS week_ending_date
               FROM weekly_insights"""
        )

    raw_week = summary["week_ending_date"] if summary else None
    # Ensure effective_week is a proper date object (Supavisor may return str)
    if raw_week and isinstance(raw_week, str):
        effective_week = date.fromisoformat(raw_week)
    elif raw_week and isinstance(raw_week, date):
        effective_week = raw_week
    else:
        effective_week = None

    # Fall back to latest submission week when no insights exist yet
    if not effective_week:
        raw_fallback = await fetchval(
            "SELECT MAX(week_ending_date) FROM weekly_report_submissions WHERE status IN ('completed', 'partial')"
        )
        if raw_fallback and isinstance(raw_fallback, str):
            effective_week = date.fromisoformat(raw_fallback)
        elif raw_fallback:
            effective_week = raw_fallback

    # Get top insights (critical + warning, most recent)
    week_filter = ""
    params: list[Any] = []
    if week_ending_date:
        week_filter = "AND wi.week_ending_date = $1::date"
        params.append(week_ending_date)
    elif effective_week:
        week_filter = "AND wi.week_ending_date = $1::date"
        params.append(effective_week)

    top_query = f"""
        SELECT wi.*, l.name AS location_name
        FROM weekly_insights wi
        LEFT JOIN locations l ON l.id = wi.location_id
        WHERE wi.severity IN ('critical', 'warning') {week_filter}
        ORDER BY
            CASE wi.severity WHEN 'critical' THEN 0 ELSE 1 END,
            wi.created_at DESC
        LIMIT 5
    """
    top_insights = await fetch(top_query, *params)

    return {
        "success": True,
        "data": {
            "total": int(summary["total"]) if summary else 0,
            "critical": int(summary["critical"]) if summary else 0,
            "warning": int(summary["warning"]) if summary else 0,
            "info": int(summary["info"]) if summary else 0,
            "unacknowledged": int(summary["unacknowledged"]) if summary else 0,
            "week_ending_date": str(effective_week) if effective_week else None,
            "top_insights": top_insights,
        },
    }


@router.get("/weekly-brief")
async def get_weekly_brief(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    week_ending_date: date | None = Query(None, description="Week to report on"),
) -> dict[str, Any]:
    """Get structured weekly intelligence brief.

    Returns a pre-structured report with fleet overview, site rankings,
    condition changes, alerts, and recommendations.
    """
    # If no week specified, use latest
    if not week_ending_date:
        latest = await fetchval(
            "SELECT MAX(week_ending_date) FROM weekly_report_submissions WHERE status IN ('completed', 'partial')"
        )
        if not latest:
            return {"success": True, "data": None, "message": "No weekly reports processed yet."}
        week_ending_date = latest

    # Run all queries in parallel
    async def _fleet_overview():
        row = await fetchrow("SELECT * FROM get_dashboard_plant_stats()")
        return dict(row) if row else {}

    async def _site_rankings():
        return await fetch("SELECT * FROM get_site_utilization_scores($1)", week_ending_date)

    async def _condition_changes():
        return await fetch("SELECT * FROM get_condition_changes($1)", week_ending_date)

    async def _insights():
        return await fetch(
            """SELECT wi.*, l.name AS location_name
               FROM weekly_insights wi
               LEFT JOIN locations l ON l.id = wi.location_id
               WHERE wi.week_ending_date = $1
               ORDER BY CASE wi.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                        wi.created_at DESC""",
            week_ending_date,
        )

    async def _chronic():
        return await fetch("SELECT * FROM get_chronic_breakdown_plants(2)")

    results = await asyncio.gather(
        _fleet_overview(), _site_rankings(), _condition_changes(), _insights(), _chronic(),
        return_exceptions=True,
    )

    fleet_overview = results[0] if not isinstance(results[0], Exception) else {}
    site_rankings = results[1] if not isinstance(results[1], Exception) else []
    condition_changes = results[2] if not isinstance(results[2], Exception) else []
    insights = results[3] if not isinstance(results[3], Exception) else []
    chronic = results[4] if not isinstance(results[4], Exception) else []

    # Build recommendations from insights
    recommendations = [
        i["recommendation"] for i in insights
        if i.get("recommendation") and i["severity"] in ("critical", "warning")
    ]

    return {
        "success": True,
        "data": {
            "week_ending_date": str(week_ending_date),
            "fleet_overview": fleet_overview,
            "site_rankings": site_rankings,
            "condition_changes": condition_changes,
            "chronic_breakdowns": chronic,
            "insights": insights,
            "recommendations": list(dict.fromkeys(recommendations)),  # deduplicate
        },
    }


@router.post("/generate")
async def trigger_insight_generation(
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    week_ending_date: date = Query(..., description="Week to generate insights for"),
) -> dict[str, Any]:
    """Trigger insight generation for a specific week (admin only)."""
    result = await generate_insights_for_week(week_ending_date)

    return {
        "success": True,
        "data": result,
        "message": (
            f"Generated {result['site_insights']} site insights and "
            f"{result['fleet_insights']} fleet-wide insights for week ending {week_ending_date}."
        ),
    }


@router.patch("/{insight_id}/acknowledge")
async def acknowledge_insight(
    insight_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
) -> dict[str, Any]:
    """Mark an insight as acknowledged."""
    result = await execute(
        """UPDATE weekly_insights
           SET acknowledged = true, acknowledged_by = $2::uuid, acknowledged_at = $3
           WHERE id = $1::uuid AND NOT acknowledged""",
        str(insight_id), current_user.id, datetime.utcnow(),
    )

    return {"success": True, "message": "Insight acknowledged."}
