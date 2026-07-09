"""Reports and analytics endpoints."""

import asyncio
import calendar
from datetime import date, timedelta
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
    state_id: UUID | None = None,
    location_id: UUID | None = None,
    fleet_type: str | None = Query(None, description="Filter by fleet type name"),
    year: int | None = None,
) -> dict[str, Any]:
    """Get dashboard summary statistics with optional global filters.

    Args:
        current_user: The authenticated user.
        state_id: Filter by state.
        location_id: Filter by location/site.
        fleet_type: Filter by fleet type (applies to plant stats only).
        year: Filter submissions by year.

    Returns:
        Summary stats for the dashboard.
    """
    role = current_user.role

    # Run each query independently so one failure doesn't kill the dashboard
    plant_stats: dict[str, Any] = {}
    location_stats: list[dict[str, Any]] = []
    recent_submissions: list[dict[str, Any]] = []
    unread_count: int = 0
    site_state_counts: dict[str, int] = {"total_sites": 0, "total_states": 0}

    # --- Plant stats: inline SQL replacing get_dashboard_plant_stats() ---
    # Uses pm.condition (NOT status) per project convention.
    async def _plant_stats() -> dict[str, Any]:
        conds: list[str] = []
        params: list[Any] = []
        if state_id:
            params.append(str(state_id))
            conds.append(f"l.state_id = ${len(params)}::uuid")
        if location_id:
            params.append(str(location_id))
            conds.append(f"pm.current_location_id = ${len(params)}::uuid")
        if fleet_type:
            params.append(fleet_type)
            conds.append(f"pm.fleet_type = ${len(params)}")
        where = " AND ".join(conds) if conds else "TRUE"
        row = await fetchrow(
            f"""SELECT
                    count(*)::int AS total_plants,
                    count(*) FILTER (WHERE pm.condition = 'working')::int AS working_plants,
                    count(*) FILTER (WHERE pm.condition = 'standby')::int AS standby_plants,
                    count(*) FILTER (WHERE pm.condition = 'breakdown')::int AS breakdown_plants,
                    count(*) FILTER (WHERE pm.condition = 'missing')::int AS missing_plants,
                    count(*) FILTER (WHERE pm.condition = 'scrap')::int AS scrap_plants,
                    count(*) FILTER (WHERE pm.condition = 'off_hire')::int AS off_hire_plants,
                    count(*) FILTER (WHERE pm.condition IS NULL)::int AS unknown_condition_plants,
                    count(*) FILTER (WHERE pm.last_verified_date IS NOT NULL)::int AS verified_plants,
                    count(*) FILTER (WHERE pm.last_verified_date IS NULL)::int AS unverified_plants
                FROM plants_master pm
                LEFT JOIN locations l ON l.id = pm.current_location_id
                WHERE {where}""",
            *params,
        )
        return row or {}

    # --- Location stats (v_location_stats view has state_id column) ---
    async def _location_stats() -> list[dict[str, Any]]:
        conds: list[str] = []
        params: list[Any] = []
        if state_id:
            params.append(str(state_id))
            conds.append(f"state_id = ${len(params)}::uuid")
        if location_id:
            params.append(str(location_id))
            conds.append(f"id = ${len(params)}::uuid")
        where = " AND ".join(conds) if conds else "TRUE"
        return await fetch(
            f"SELECT * FROM v_location_stats WHERE {where} ORDER BY total_plants DESC LIMIT 10",
            *params,
        )

    # --- Recent submissions ---
    async def _recent_submissions() -> list[dict[str, Any]]:
        conds: list[str] = []
        params: list[Any] = []
        if state_id:
            params.append(str(state_id))
            conds.append(f"l.state_id = ${len(params)}::uuid")
        if location_id:
            params.append(str(location_id))
            conds.append(f"s.location_id = ${len(params)}::uuid")
        if year:
            params.append(year)
            conds.append(f"s.year = ${len(params)}")
        where = " AND ".join(conds) if conds else "TRUE"
        return await fetch(
            f"""SELECT s.*, l.name AS location_name
               FROM weekly_report_submissions s
               LEFT JOIN locations l ON l.id = s.location_id
               WHERE {where}
               ORDER BY s.submitted_at DESC
               LIMIT 5""",
            *params,
        )

    async def _unread_count() -> int:
        # "read" is a reserved word — must be quoted
        val = await fetchval(
            'SELECT count(*) FROM notifications WHERE "read" = false AND target_role = $1',
            role,
        )
        return val or 0

    # --- Site & state counts ---
    async def _site_state_counts() -> dict[str, int]:
        conds: list[str] = []
        params: list[Any] = []
        if state_id:
            params.append(str(state_id))
            conds.append(f"l.state_id = ${len(params)}::uuid")
        if location_id:
            params.append(str(location_id))
            conds.append(f"l.id = ${len(params)}::uuid")
        where = " AND ".join(conds) if conds else "TRUE"
        row = await fetchrow(
            f"""SELECT
                   count(DISTINCT l.id)::int AS total_sites,
                   count(DISTINCT l.state_id)::int AS total_states
               FROM locations l
               WHERE {where}""",
            *params,
        )
        return dict(row) if row else {"total_sites": 0, "total_states": 0}

    results = await asyncio.gather(
        _plant_stats(),
        _location_stats(),
        _recent_submissions(),
        _unread_count(),
        _site_state_counts(),
        return_exceptions=True,
    )

    # Unpack results, logging any failures
    for i, (name, result) in enumerate(zip(
        ["plant_stats", "location_stats", "recent_submissions", "unread_count",
         "site_state_counts"],
        results,
    )):
        if isinstance(result, Exception):
            logger.error("Dashboard query failed", query=name, error=str(result))
        else:
            if i == 0:
                plant_stats = result
            elif i == 1:
                location_stats = result
            elif i == 2:
                recent_submissions = result
            elif i == 3:
                unread_count = result
            elif i == 4:
                site_state_counts = result

    return {
        "success": True,
        "data": {
            "plants": plant_stats,
            "top_locations": location_stats,
            "recent_submissions": recent_submissions,
            "unread_notifications": unread_count,
            "total_sites": site_state_counts.get("total_sites", 0),
            "total_states": site_state_counts.get("total_states", 0),
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


@router.get("/recently-purchased")
async def get_recently_purchased(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    limit: int = Query(10, ge=1, le=50),
) -> dict[str, Any]:
    """Get recently purchased plants ordered by purchase date (year, month) descending."""
    data = await fetch(
        """SELECT pm.id, fleet_number, description, fleet_type, make, model,
                  purchase_year, purchase_month, purchase_cost,
                  condition, current_location_id,
                  l.name AS current_location
           FROM plants_master pm
           LEFT JOIN locations l ON l.id = pm.current_location_id
           WHERE pm.purchase_year IS NOT NULL
           ORDER BY pm.purchase_year DESC, COALESCE(pm.purchase_month, 0) DESC, pm.created_at DESC
           LIMIT $1""",
        limit,
    )
    return {"success": True, "data": data}


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
        group_by,
        str(plant_id) if plant_id else None,
        fleet_type,
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
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    """Get plants not verified in recent weeks.

    Args:
        current_user: The authenticated user.
        location_id: Filter by location.
        weeks_missing: Number of weeks without verification.
        page: Page number (1-based).
        limit: Results per page.

    Returns:
        Paginated list of plants missing verification.
    """
    offset = (page - 1) * limit
    rows = await fetch(
        "SELECT * FROM get_unverified_plants($1, $2, $3, $4)",
        str(location_id) if location_id else None,
        weeks_missing,
        limit,
        offset,
    )

    total = rows[0].pop("_total_count", 0) if rows else 0
    for row in rows:
        row.pop("_total_count", None)

    return {
        "success": True,
        "data": rows,
        "meta": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": max(1, -(-total // limit)),
        },
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
        params.append(date(year, 1, 1))
        conditions.append(f"sp.replaced_date >= ${len(params)}::date")
        params.append(date(year, 12, 31))
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


@router.get("/states-summary")
async def get_states_summary(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    fleet_type: str | None = Query(None, description="Filter by fleet type name"),
) -> dict[str, Any]:
    """Get plant statistics aggregated per state for the dashboard map.

    When fleet_type is provided, counts are filtered to only that equipment type
    (uses plants_master directly instead of v_location_stats).
    """
    if fleet_type:
        # Filtered path: count plants_master rows with matching fleet_type
        data = await fetch(
            """SELECT s.id, s.name, s.code, s.region,
                      count(DISTINCT l.id)::int AS sites_count,
                      count(pm.id)::int AS total_plants,
                      count(pm.id) FILTER (WHERE pm.condition = 'working')::int AS working_plants,
                      count(pm.id) FILTER (WHERE pm.condition = 'standby')::int AS standby_plants,
                      count(pm.id) FILTER (WHERE pm.condition = 'breakdown')::int AS breakdown_plants,
                      count(pm.id) FILTER (WHERE pm.condition = 'missing')::int AS missing_plants,
                      count(pm.id) FILTER (WHERE pm.condition = 'scrap')::int AS scrap_plants
               FROM states s
               LEFT JOIN locations l ON l.state_id = s.id
               LEFT JOIN plants_master pm ON pm.current_location_id = l.id AND pm.fleet_type = $1
               WHERE s.is_active = true
               GROUP BY s.id, s.name, s.code, s.region
               ORDER BY total_plants DESC""",
            fleet_type,
        )
    else:
        # Unfiltered path: use pre-aggregated view for speed
        data = await fetch(
            """SELECT s.id, s.name, s.code, s.region,
                      count(DISTINCT l.id)::int AS sites_count,
                      coalesce(sum(ls.total_plants), 0)::int AS total_plants,
                      coalesce(sum(ls.working_plants), 0)::int AS working_plants,
                      coalesce(sum(ls.standby_plants), 0)::int AS standby_plants,
                      coalesce(sum(ls.breakdown_plants), 0)::int AS breakdown_plants,
                      coalesce(sum(ls.missing_plants), 0)::int AS missing_plants,
                      coalesce(sum(ls.scrap_plants), 0)::int AS scrap_plants
               FROM states s
               LEFT JOIN locations l ON l.state_id = s.id
               LEFT JOIN v_location_stats ls ON ls.id = l.id
               WHERE s.is_active = true
               GROUP BY s.id, s.name, s.code, s.region
               ORDER BY total_plants DESC"""
        )
    return {"success": True, "data": data}


@router.get("/fleet-distribution")
async def get_fleet_distribution(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    fleet_type: str | None = Query(None, description="Filter by fleet type"),
) -> dict[str, Any]:
    """Return every site grouped under its state, with fleet-type breakdown per site.

    Response shape:
      [ { state_name, state_code, region, total_plants, sites: [
            { site_name, total_plants, fleet_types: { "TRUCKS": 5, ... } }
          ]
        }, ... ]
    """
    params: list[Any] = []
    fleet_filter = ""
    if fleet_type:
        params.append(fleet_type)
        fleet_filter = f"AND pm.fleet_type = ${len(params)}"

    rows = await fetch(
        f"""SELECT s.name  AS state_name,
                   s.code  AS state_code,
                   s.region,
                   l.id    AS location_id,
                   l.name  AS site_name,
                   pm.fleet_type,
                   count(pm.id)::int AS cnt
            FROM states s
            JOIN locations l ON l.state_id = s.id
            LEFT JOIN plants_master pm ON pm.current_location_id = l.id {fleet_filter}
            WHERE s.is_active = true
            GROUP BY s.name, s.code, s.region, l.id, l.name, pm.fleet_type
            ORDER BY s.name, cnt DESC""",
        *params,
    )

    from collections import OrderedDict

    states_map: dict[str, dict[str, Any]] = OrderedDict()
    for r in rows:
        skey = r["state_name"]
        if skey not in states_map:
            states_map[skey] = {
                "state_name": r["state_name"],
                "state_code": r["state_code"],
                "region": r["region"],
                "total_plants": 0,
                "_sites": OrderedDict(),
            }
        state = states_map[skey]

        lid = str(r["location_id"])
        if lid not in state["_sites"]:
            state["_sites"][lid] = {
                "site_name": r["site_name"],
                "total_plants": 0,
                "fleet_types": {},
            }
        site = state["_sites"][lid]

        ft = r["fleet_type"]
        cnt = r["cnt"]
        if ft and cnt > 0:
            site["fleet_types"][ft] = cnt
            site["total_plants"] += cnt
            state["total_plants"] += cnt

    result = []
    for state in states_map.values():
        sites = [s for s in state["_sites"].values() if s["total_plants"] > 0]
        if not sites:
            continue
        sites.sort(key=lambda s: s["total_plants"], reverse=True)
        result.append({
            "state_name": state["state_name"],
            "state_code": state["state_code"],
            "region": state["region"],
            "total_plants": state["total_plants"],
            "sites": sites,
        })
    result.sort(key=lambda s: s["total_plants"], reverse=True)

    return {"success": True, "data": result}


# ════════════════════════════════════════════════════════════════════════
# Report Generator — unified endpoint for weekly/monthly/quarterly/yearly
# ════════════════════════════════════════════════════════════════════════


def _period_range(period: str, ref: date) -> dict[str, Any]:
    """Compute date range and label for the given period."""
    iso = ref.isocalendar()
    if period == "weekly":
        start = ref - timedelta(days=ref.weekday())
        end = start + timedelta(days=6)
        return {"date_from": start, "date_to": end, "label": f"Week {iso[1]}, {iso[0]}"}
    elif period == "monthly":
        start = ref.replace(day=1)
        last_day = calendar.monthrange(ref.year, ref.month)[1]
        end = ref.replace(day=last_day)
        return {"date_from": start, "date_to": end, "label": f"{calendar.month_name[ref.month]} {ref.year}"}
    elif period == "quarterly":
        q = (ref.month - 1) // 3 + 1
        start = date(ref.year, (q - 1) * 3 + 1, 1)
        last_m = q * 3
        end = date(ref.year, last_m, calendar.monthrange(ref.year, last_m)[1])
        return {"date_from": start, "date_to": end, "label": f"Q{q} {ref.year}"}
    else:  # yearly
        return {"date_from": date(ref.year, 1, 1), "date_to": date(ref.year, 12, 31), "label": str(ref.year)}


@router.get("/generate")
async def generate_report(
    current_user: Annotated[CurrentUser, Depends(require_management_or_admin)],
    period: str = Query(..., pattern="^(weekly|monthly|quarterly|yearly)$"),
    ref_date: date = Query(default_factory=date.today, alias="date"),
    location_id: UUID | None = None,
    state_id: UUID | None = None,
    fleet_type: str | None = Query(None),
) -> dict[str, Any]:
    """Generate a comprehensive fleet report for the given period."""
    pr = _period_range(period, ref_date)
    d_from, d_to = pr["date_from"], pr["date_to"]

    # ── As-of vs live fleet source ───────────────────────────────────
    # A report for a PAST period must show the fleet as it was THEN:
    # each plant's latest weekly snapshot on/before the period end
    # (condition carries forward past unknown weeks; plants first seen
    # after the period end did not exist yet). Reports covering today
    # use live plants_master.
    historical = d_to < date.today()
    if historical:
        # $1 in the fleet params is ALWAYS the as-of date
        fleet_src = """
            (WITH seen AS (
                SELECT DISTINCT ON (r.plant_id) r.plant_id
                FROM plant_weekly_records r
                WHERE r.week_ending_date <= $1
                ORDER BY r.plant_id, r.week_ending_date DESC
            ), latest_cond AS (
                SELECT DISTINCT ON (r.plant_id) r.plant_id, r.condition
                FROM plant_weekly_records r
                WHERE r.week_ending_date <= $1 AND r.condition IS NOT NULL
                ORDER BY r.plant_id, r.week_ending_date DESC
            ), latest_loc AS (
                SELECT DISTINCT ON (r.plant_id) r.plant_id, r.location_id
                FROM plant_weekly_records r
                WHERE r.week_ending_date <= $1 AND r.location_id IS NOT NULL
                ORDER BY r.plant_id, r.week_ending_date DESC
            )
            SELECT pm.id, pm.fleet_number, pm.description, pm.fleet_type,
                   lc.condition, ll.location_id
            FROM seen
            JOIN plants_master pm ON pm.id = seen.plant_id
            LEFT JOIN latest_cond lc ON lc.plant_id = seen.plant_id
            LEFT JOIN latest_loc ll ON ll.plant_id = seen.plant_id)
        """
        fleet_base_params: list = [d_to]
    else:
        fleet_src = """
            (SELECT pm.id, pm.fleet_number, pm.description, pm.fleet_type,
                    pm.condition, pm.current_location_id AS location_id
             FROM plants_master pm)
        """
        fleet_base_params = []

    # ── Build dynamic WHERE fragments (over the fleet source `f`) ────
    plant_conds: list[str] = []
    plant_params: list[Any] = list(fleet_base_params)
    if location_id:
        plant_params.append(str(location_id))
        plant_conds.append(f"f.location_id = ${len(plant_params)}::uuid")
    if state_id:
        plant_params.append(str(state_id))
        plant_conds.append(f"l.state_id = ${len(plant_params)}::uuid")
    if fleet_type:
        plant_params.append(fleet_type)
        plant_conds.append(f"f.fleet_type = ${len(plant_params)}")
    pw = " AND ".join(plant_conds) if plant_conds else "TRUE"

    # Spare parts filter
    sp_conds: list[str] = []
    sp_params: list[Any] = [d_from, d_to]  # $1, $2 always date range
    if location_id:
        sp_params.append(str(location_id))
        sp_conds.append(f"sp.location_id = ${len(sp_params)}::uuid")
    if state_id:
        sp_params.append(str(state_id))
        sp_conds.append(f"loc.state_id = ${len(sp_params)}::uuid")
    if fleet_type:
        sp_params.append(fleet_type)
        sp_conds.append(f"pm2.fleet_type = ${len(sp_params)}")
    sp_where = (" AND " + " AND ".join(sp_conds)) if sp_conds else ""
    sp_join_pm = "LEFT JOIN plants_master pm2 ON pm2.id = sp.plant_id" if fleet_type else ""

    # Transfer filter
    tr_conds: list[str] = []
    tr_params: list[Any] = [d_from, d_to]
    if fleet_type:
        tr_params.append(fleet_type)
        tr_conds.append(f"pm3.fleet_type = ${len(tr_params)}")
    tr_where = (" AND " + " AND ".join(tr_conds)) if tr_conds else ""
    tr_join_pm = "JOIN plants_master pm3 ON pm3.id = t.plant_id" if fleet_type else ""

    # ── Parallel queries ─────────────────────────────────────────────

    async def q_fleet_condition():
        return await fetchrow(
            f"""SELECT count(*)::int AS total_plants,
                       count(*) FILTER (WHERE f.condition = 'working')::int AS working,
                       count(*) FILTER (WHERE f.condition = 'standby')::int AS standby,
                       count(*) FILTER (WHERE f.condition = 'breakdown')::int AS breakdown,
                       count(*) FILTER (WHERE f.condition = 'missing')::int AS missing,
                       count(*) FILTER (WHERE f.condition = 'scrap')::int AS scrap,
                       count(*) FILTER (WHERE f.condition = 'off_hire')::int AS off_hire,
                       count(*) FILTER (WHERE f.condition IS NULL)::int AS unknown
                FROM {fleet_src} f
                LEFT JOIN locations l ON l.id = f.location_id
                WHERE {pw}""",
            *plant_params,
        )

    async def q_fleet_by_type():
        return await fetch(
            f"""SELECT COALESCE(f.fleet_type, 'Unknown') AS fleet_type,
                       count(*)::int AS total,
                       count(*) FILTER (WHERE f.condition = 'working')::int AS working,
                       count(*) FILTER (WHERE f.condition = 'standby')::int AS standby,
                       count(*) FILTER (WHERE f.condition = 'breakdown')::int AS breakdown,
                       count(*) FILTER (WHERE f.condition IS NULL
                                        OR f.condition NOT IN ('working','standby','breakdown'))::int AS other
                FROM {fleet_src} f
                LEFT JOIN locations l ON l.id = f.location_id
                WHERE {pw}
                GROUP BY f.fleet_type ORDER BY total DESC""",
            *plant_params,
        )

    async def q_states():
        # COALESCE buckets keep every plant visible: no location and
        # no state each get an explicit row so totals always tie out.
        return await fetch(
            f"""SELECT COALESCE(s.name, '(No location)') AS name,
                       COALESCE(s.code, '—') AS code,
                       s.region,
                       count(DISTINCT f.location_id)::int AS sites_count,
                       count(f.id)::int AS total_plants,
                       count(f.id) FILTER (WHERE f.condition = 'working')::int AS working,
                       count(f.id) FILTER (WHERE f.condition = 'breakdown')::int AS breakdown,
                       count(f.id) FILTER (WHERE f.condition = 'missing')::int AS missing,
                       count(f.id) FILTER (WHERE f.condition = 'scrap')::int AS scrap,
                       count(f.id) FILTER (WHERE f.condition IS NULL)::int AS unknown
                FROM {fleet_src} f
                LEFT JOIN locations l ON l.id = f.location_id
                LEFT JOIN states s ON s.id = l.state_id
                WHERE {pw}
                GROUP BY s.name, s.code, s.region
                ORDER BY total_plants DESC""",
            *plant_params,
        )

    async def q_sites():
        return await fetch(
            f"""SELECT COALESCE(l.name, '(No location)') AS location_name,
                       s.name AS state_name, s.code AS state_code,
                       count(f.id)::int AS total_plants,
                       count(f.id) FILTER (WHERE f.condition = 'working')::int AS working,
                       count(f.id) FILTER (WHERE f.condition = 'breakdown')::int AS breakdown,
                       count(f.id) FILTER (WHERE f.condition = 'standby')::int AS standby,
                       count(f.id) FILTER (WHERE f.condition = 'missing')::int AS missing,
                       count(f.id) FILTER (WHERE f.condition = 'scrap')::int AS scrap,
                       count(f.id) FILTER (WHERE f.condition IS NULL)::int AS unknown
                FROM {fleet_src} f
                LEFT JOIN locations l ON l.id = f.location_id
                LEFT JOIN states s ON s.id = l.state_id
                WHERE {pw}
                GROUP BY l.name, s.name, s.code
                ORDER BY total_plants DESC""",
            *plant_params,
        )

    async def q_site_fleet_types():
        """Fleet type distribution per site (as-of aware)."""
        return await fetch(
            f"""SELECT COALESCE(l.name, '(No location)') AS location_name,
                       f.fleet_type,
                       count(f.id)::int AS cnt
                FROM {fleet_src} f
                LEFT JOIN locations l ON l.id = f.location_id
                WHERE {pw} AND f.fleet_type IS NOT NULL
                GROUP BY l.name, f.fleet_type
                ORDER BY l.name, cnt DESC""",
            *plant_params,
        )

    # Cross-PO aggregations use total_cost_ngn so foreign-currency POs are
    # converted to NGN before summing. total_cost (original currency) would
    # naively add e.g. £ + ₦ values.
    async def q_spare_parts_summary():
        return await fetchrow(
            f"""SELECT count(*)::int AS total_items,
                       count(DISTINCT sp.purchase_order_number)::int AS total_pos,
                       count(DISTINCT sp.plant_id)::int AS plants_with_parts,
                       COALESCE(sum(sp.total_cost_ngn), 0)::float AS total_spend,
                       COALESCE(avg(sp.total_cost_ngn), 0)::float AS avg_cost_per_item
                FROM spare_parts sp
                LEFT JOIN locations loc ON loc.id = sp.location_id
                {sp_join_pm}
                WHERE sp.replaced_date BETWEEN $1 AND $2 {sp_where}""",
            *sp_params,
        )

    async def q_top_suppliers():
        return await fetch(
            f"""SELECT COALESCE(s.name, sp.supplier) AS supplier_name,
                       count(*)::int AS items_count,
                       count(DISTINCT sp.purchase_order_number)::int AS po_count,
                       COALESCE(sum(sp.total_cost_ngn), 0)::float AS total_spend
                FROM spare_parts sp
                LEFT JOIN suppliers s ON s.id = sp.supplier_id
                LEFT JOIN locations loc ON loc.id = sp.location_id
                {sp_join_pm}
                WHERE sp.replaced_date BETWEEN $1 AND $2 {sp_where}
                GROUP BY COALESCE(s.name, sp.supplier)
                HAVING COALESCE(s.name, sp.supplier) IS NOT NULL
                ORDER BY total_spend DESC LIMIT 10""",
            *sp_params,
        )

    async def q_high_cost_plants():
        return await fetch(
            f"""SELECT pm.fleet_number, pm.description, pm.fleet_type, pm.condition,
                       l.name AS location_name,
                       count(sp.id)::int AS parts_count,
                       COALESCE(sum(sp.total_cost_ngn), 0)::float AS total_spend
                FROM spare_parts sp
                JOIN plants_master pm ON pm.id = sp.plant_id
                LEFT JOIN locations l ON l.id = pm.current_location_id
                LEFT JOIN locations loc ON loc.id = sp.location_id
                WHERE sp.replaced_date BETWEEN $1 AND $2
                    {"AND sp.location_id = $" + str(sp_params.index(str(location_id)) + 1) + "::uuid" if location_id else ""}
                    {"AND loc.state_id = $" + str(sp_params.index(str(state_id)) + 1) + "::uuid" if state_id else ""}
                    {"AND pm.fleet_type = $" + str(sp_params.index(fleet_type) + 1) if fleet_type else ""}
                GROUP BY pm.fleet_number, pm.description, pm.fleet_type, pm.condition, l.name
                ORDER BY total_spend DESC""",
            *sp_params,
        )

    async def q_sites_spend():
        return await fetch(
            f"""SELECT l.name AS location_name, s.name AS state_name,
                       COALESCE(sum(sp.total_cost_ngn), 0)::float AS total_spend,
                       count(*)::int AS items_count,
                       count(DISTINCT sp.purchase_order_number)::int AS po_count
                FROM spare_parts sp
                JOIN locations l ON l.id = sp.location_id
                LEFT JOIN states s ON s.id = l.state_id
                {sp_join_pm}
                WHERE sp.replaced_date BETWEEN $1 AND $2 {sp_where}
                GROUP BY l.name, s.name
                ORDER BY total_spend DESC""",
            *sp_params,
        )

    async def q_unattributed_spend():
        """Spend with no plant link (workshop/general stock) — shown as an
        explicit row so the per-plant list ties out to the headline.
        Skipped when a fleet-type filter is active (plant-scoped by definition)."""
        if fleet_type:
            return None
        return await fetchrow(
            f"""SELECT count(*)::int AS items_count,
                       COALESCE(sum(sp.total_cost_ngn), 0)::float AS total_spend
                FROM spare_parts sp
                LEFT JOIN locations loc ON loc.id = sp.location_id
                WHERE sp.replaced_date BETWEEN $1 AND $2 AND sp.plant_id IS NULL
                    {"AND sp.location_id = $" + str(sp_params.index(str(location_id)) + 1) + "::uuid" if location_id else ""}
                    {"AND loc.state_id = $" + str(sp_params.index(str(state_id)) + 1) + "::uuid" if state_id else ""}""",
            *[a for a in sp_params if not (fleet_type and a == fleet_type)],
        )

    async def q_unlocated_spend():
        """Spend with no location — explicit row for the site ranking.
        Skipped when a location/state filter is active."""
        if location_id or state_id:
            return None
        return await fetchrow(
            f"""SELECT count(*)::int AS items_count,
                       count(DISTINCT sp.purchase_order_number)::int AS po_count,
                       COALESCE(sum(sp.total_cost_ngn), 0)::float AS total_spend
                FROM spare_parts sp
                {sp_join_pm}
                WHERE sp.replaced_date BETWEEN $1 AND $2 AND sp.location_id IS NULL
                    {"AND pm2.fleet_type = $" + str(sp_params.index(fleet_type) + 1) if fleet_type else ""}""",
            *sp_params,
        )

    async def q_transfer_details():
        return await fetch(
            f"""SELECT pm3.fleet_number, pm3.fleet_type, pm3.description,
                       fl.name AS from_location, tl.name AS to_location,
                       t.transfer_date
                FROM plant_transfers t
                JOIN plants_master pm3 ON pm3.id = t.plant_id
                LEFT JOIN locations fl ON fl.id = t.from_location_id
                LEFT JOIN locations tl ON tl.id = t.to_location_id
                WHERE t.transfer_date BETWEEN $1 AND $2
                    AND t.status = 'confirmed' {tr_where}
                ORDER BY t.transfer_date DESC""",
            *tr_params,
        )

    # ── Execute all in parallel ──────────────────────────────────────
    (
        fc, fbt, states, sites, sp_sum, suppliers, hc_plants, site_spend,
        tr_details, site_ft_rows, unattributed, unlocated,
    ) = await asyncio.gather(
        q_fleet_condition(),
        q_fleet_by_type(),
        q_states(),
        q_sites(),
        q_spare_parts_summary(),
        q_top_suppliers(),
        q_high_cost_plants(),
        q_sites_spend(),
        q_transfer_details(),
        q_site_fleet_types(),
        q_unattributed_spend(),
        q_unlocated_spend(),
    )

    # ── Reconciliation rows: breakdowns must tie out to the headline ──
    hc_plants = [dict(r) for r in hc_plants]
    if unattributed and unattributed["items_count"]:
        hc_plants.append({
            "fleet_number": "—",
            "description": "Workshop / general stock (not tied to a plant)",
            "fleet_type": None,
            "condition": None,
            "location_name": None,
            "parts_count": unattributed["items_count"],
            "total_spend": unattributed["total_spend"],
        })

    site_spend = [dict(r) for r in site_spend]
    if unlocated and unlocated["items_count"]:
        site_spend.append({
            "location_name": "(No location recorded)",
            "state_name": None,
            "total_spend": unlocated["total_spend"],
            "items_count": unlocated["items_count"],
            "po_count": unlocated["po_count"],
        })

    # Build site fleet type map: { location_name: { fleet_type: count } }
    site_fleet_map: dict[str, dict[str, int]] = {}
    for r in site_ft_rows:
        loc = r["location_name"]
        if loc not in site_fleet_map:
            site_fleet_map[loc] = {}
        if r["fleet_type"]:
            site_fleet_map[loc][r["fleet_type"]] = r["cnt"]

    # ── Resolve filter names for the response ────────────────────────
    filter_loc_name = None
    filter_state_name = None
    if location_id:
        r = await fetchrow("SELECT name FROM locations WHERE id = $1::uuid", str(location_id))
        filter_loc_name = r["name"] if r else None
    if state_id:
        r = await fetchrow("SELECT name FROM states WHERE id = $1::uuid", str(state_id))
        filter_state_name = r["name"] if r else None

    total = fc["total_plants"] or 0
    working = fc["working"] or 0

    return {
        "success": True,
        "data": {
            "meta": {
                "period": period,
                "label": pr["label"],
                "date_from": d_from.isoformat(),
                "date_to": d_to.isoformat(),
                "generated_at": date.today().isoformat(),
                "as_of": d_to.isoformat() if historical else "live",
                "historical": historical,
                "filters": {
                    "location_name": filter_loc_name,
                    "state_name": filter_state_name,
                    "fleet_type": fleet_type,
                },
            },
            "fleet_condition": {
                "total_plants": total,
                "working": working,
                "standby": fc["standby"] or 0,
                "breakdown": fc["breakdown"] or 0,
                "missing": fc["missing"] or 0,
                "scrap": fc["scrap"] or 0,
                "off_hire": fc["off_hire"] or 0,
                "unknown": fc["unknown"] or 0,
                "utilization_rate": round(working / total * 100, 1) if total else 0,
            },
            "fleet_by_type": fbt,
            "states_summary": states,
            "sites_breakdown": [
                {**dict(s), "fleet_types": site_fleet_map.get(s["location_name"], {})}
                for s in sites
            ],
            "spare_parts": {
                "summary": sp_sum,
                "top_suppliers": suppliers,
                "high_cost_plants": hc_plants,
                "sites_ranking": site_spend,
            },
            "transfers": {
                "total": len(tr_details),
                "details": tr_details,
            },
        },
    }
