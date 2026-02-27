"""Automated insights generation engine.

Generates actionable insights from weekly report data by analyzing:
- Condition changes (week-over-week)
- Site utilization scores and trends
- Chronic breakdown plants
- Idle fleet alerts
- Fleet rebalancing opportunities
- Submission compliance gaps
- Fleet type reliability
- Site performance rankings
"""

import json
from datetime import date, datetime
from typing import Any
from uuid import UUID

from app.core.pool import fetch, fetchrow, fetchval, execute
from app.monitoring.logging import get_logger

logger = get_logger(__name__)


async def generate_site_insights(
    location_id: str,
    week_ending_date: date,
) -> dict[str, Any]:
    """Generate insights for a specific site after its weekly report is processed.

    Args:
        location_id: The location UUID.
        week_ending_date: The week ending date from the submission.

    Returns:
        Dict with counts of insights generated.
    """
    result = {"insights_generated": 0, "errors": []}
    year = week_ending_date.isocalendar()[1]
    week_number = week_ending_date.isocalendar()[1]
    year = week_ending_date.year

    # Delete existing insights for this site + week to avoid duplicates on reprocessing
    await execute(
        "DELETE FROM weekly_insights WHERE location_id = $1::uuid AND week_ending_date = $2",
        location_id, week_ending_date,
    )

    try:
        # 1. Condition changes for this site
        changes = await fetch(
            "SELECT * FROM get_condition_changes($1, $2::uuid)",
            week_ending_date, location_id,
        )
        if changes:
            result["insights_generated"] += await _generate_condition_change_insights(
                changes, location_id, week_ending_date, year, week_number,
            )

        # 2. Site utilization
        scores = await fetch("SELECT * FROM get_site_utilization_scores($1)", week_ending_date)
        site_score = next((s for s in scores if str(s["location_id"]) == str(location_id)), None)
        if site_score:
            result["insights_generated"] += await _generate_utilization_insight(
                site_score, week_ending_date, year, week_number,
            )
            result["insights_generated"] += await _generate_idle_fleet_insight(
                site_score, week_ending_date, year, week_number,
            )

    except Exception as e:
        logger.exception("Failed to generate site insights", location_id=location_id, error=str(e))
        result["errors"].append(str(e))

    logger.info(
        "Site insights generated",
        location_id=location_id,
        week=str(week_ending_date),
        count=result["insights_generated"],
    )
    return result


async def generate_fleet_wide_insights(week_ending_date: date) -> dict[str, Any]:
    """Generate fleet-wide cross-site insights for a given week.

    Args:
        week_ending_date: The week ending date to analyze.

    Returns:
        Dict with counts of insights generated.
    """
    result = {"insights_generated": 0, "errors": []}
    year = week_ending_date.year
    week_number = week_ending_date.isocalendar()[1]

    # Delete existing fleet-wide insights (no location_id) for this week
    await execute(
        "DELETE FROM weekly_insights WHERE location_id IS NULL AND week_ending_date = $1",
        week_ending_date,
    )

    try:
        # 1. Fleet rebalancing opportunity
        scores = await fetch("SELECT * FROM get_site_utilization_scores($1)", week_ending_date)
        if len(scores) >= 2:
            result["insights_generated"] += await _generate_rebalancing_insight(
                scores, week_ending_date, year, week_number,
            )
            result["insights_generated"] += await _generate_site_performance_insight(
                scores, week_ending_date, year, week_number,
            )

        # 2. Chronic breakdown plants
        chronic = await fetch("SELECT * FROM get_chronic_breakdown_plants(2)")
        if chronic:
            result["insights_generated"] += await _generate_chronic_breakdown_insights(
                chronic, week_ending_date, year, week_number,
            )

        # 3. Fleet type reliability
        reliability = await fetch("SELECT * FROM get_fleet_type_reliability()")
        if reliability:
            result["insights_generated"] += await _generate_fleet_reliability_insight(
                reliability, week_ending_date, year, week_number,
            )

        # 4. Submission gaps
        result["insights_generated"] += await _generate_submission_gap_insights(
            week_ending_date, year, week_number,
        )

    except Exception as e:
        logger.exception("Failed to generate fleet-wide insights", error=str(e))
        result["errors"].append(str(e))

    logger.info(
        "Fleet-wide insights generated",
        week=str(week_ending_date),
        count=result["insights_generated"],
    )
    return result


async def generate_insights_for_week(week_ending_date: date) -> dict[str, Any]:
    """Generate all insights for a given week (admin-triggered).

    Runs both per-site and fleet-wide insight generation.
    """
    result = {"site_insights": 0, "fleet_insights": 0, "errors": []}

    # Get all locations that have submissions for this week
    locations = await fetch(
        "SELECT DISTINCT location_id FROM weekly_report_submissions WHERE week_ending_date = $1",
        week_ending_date,
    )

    for loc in locations:
        site_result = await generate_site_insights(str(loc["location_id"]), week_ending_date)
        result["site_insights"] += site_result["insights_generated"]
        result["errors"].extend(site_result["errors"])

    fleet_result = await generate_fleet_wide_insights(week_ending_date)
    result["fleet_insights"] = fleet_result["insights_generated"]
    result["errors"].extend(fleet_result["errors"])

    return result


# ---------------------------------------------------------------------------
# Insight generators
# ---------------------------------------------------------------------------


async def _generate_condition_change_insights(
    changes: list[dict],
    location_id: str,
    week_ending_date: date,
    year: int,
    week_number: int,
) -> int:
    """Generate insights from condition changes at a site."""
    count = 0

    # Group changes by direction
    degraded = [c for c in changes if _is_degradation(c["prev_condition"], c["curr_condition"])]
    improved = [c for c in changes if _is_improvement(c["prev_condition"], c["curr_condition"])]

    location_name = changes[0]["location_name"] if changes else "Unknown"

    if degraded:
        severity = "critical" if len(degraded) >= 5 else "warning"
        breakdown_count = sum(1 for c in degraded if c["curr_condition"] in ("breakdown", "faulty"))
        examples = degraded[:5]
        example_text = ", ".join(
            f"{c['fleet_number']} ({c['prev_condition']}\u2192{c['curr_condition']})" for c in examples
        )

        await _insert_insight(
            insight_type="condition_change",
            severity=severity,
            title=f"{location_name}: {len(degraded)} plants degraded this week",
            description=(
                f"{len(degraded)} plants at {location_name} moved to worse condition states. "
                f"{f'{breakdown_count} entered breakdown/faulty. ' if breakdown_count else ''}"
                f"Examples: {example_text}."
            ),
            recommendation=(
                "Review breakdown plants for urgent repair needs. "
                "Check if spare parts are available. "
                "Consider temporary replacements for critical equipment."
            ),
            data={
                "degraded_count": len(degraded),
                "breakdown_count": breakdown_count,
                "changes": [
                    {"fleet_number": c["fleet_number"], "fleet_type": c["fleet_type"],
                     "from": c["prev_condition"], "to": c["curr_condition"]}
                    for c in degraded[:20]
                ],
            },
            week_ending_date=week_ending_date,
            year=year,
            week_number=week_number,
            location_id=location_id,
        )
        count += 1

    if improved and len(improved) >= 3:
        await _insert_insight(
            insight_type="condition_change",
            severity="info",
            title=f"{location_name}: {len(improved)} plants improved this week",
            description=(
                f"{len(improved)} plants at {location_name} moved to better condition states. "
                f"Maintenance and repairs showing results."
            ),
            recommendation=None,
            data={
                "improved_count": len(improved),
                "changes": [
                    {"fleet_number": c["fleet_number"], "from": c["prev_condition"], "to": c["curr_condition"]}
                    for c in improved[:10]
                ],
            },
            week_ending_date=week_ending_date,
            year=year,
            week_number=week_number,
            location_id=location_id,
        )
        count += 1

    return count


async def _generate_utilization_insight(
    score: dict,
    week_ending_date: date,
    year: int,
    week_number: int,
) -> int:
    """Generate utilization alert if site is underperforming."""
    pct = float(score["utilization_pct"] or 0)
    total = int(score["total_plants"])
    change = float(score["change_pct"] or 0)
    name = score["location_name"]

    # Only alert for significant sites
    if total < 20:
        return 0

    # Critical: large site with very low utilization
    if pct < 20:
        severity = "critical"
    elif pct < 40 or change <= -10:
        severity = "warning"
    else:
        return 0  # Normal utilization, no insight needed

    direction = "down" if change < 0 else "up" if change > 0 else "unchanged"
    change_text = f" ({direction} {abs(change):.1f}%)" if change != 0 else ""

    await _insert_insight(
        insight_type="utilization_alert",
        severity=severity,
        title=f"{name} utilization at {pct:.0f}%{change_text}",
        description=(
            f"{name} has {total} plants but only {score['working']} are working ({pct:.0f}% utilization). "
            f"{score['standby']} on standby, {score['breakdown']} in breakdown/faulty, "
            f"{score['missing']} missing."
        ),
        recommendation=(
            "Review standby equipment for redeployment to higher-demand sites. "
            "Prioritize breakdown repairs for high-value assets. "
            "Investigate missing plants with physical verification."
        ),
        data={
            "utilization_pct": pct,
            "prev_utilization_pct": float(score["prev_utilization_pct"]) if score["prev_utilization_pct"] else None,
            "change_pct": change,
            "total": total,
            "working": int(score["working"]),
            "standby": int(score["standby"]),
            "breakdown": int(score["breakdown"]),
            "missing": int(score["missing"]),
        },
        week_ending_date=week_ending_date,
        year=year,
        week_number=week_number,
        location_id=str(score["location_id"]),
    )
    return 1


async def _generate_idle_fleet_insight(
    score: dict,
    week_ending_date: date,
    year: int,
    week_number: int,
) -> int:
    """Generate idle fleet alert if standby percentage is high."""
    total = int(score["total_plants"])
    standby = int(score["standby"])
    if total < 10 or standby < 5:
        return 0

    standby_pct = 100.0 * standby / total
    if standby_pct < 40:
        return 0

    name = score["location_name"]
    severity = "critical" if standby_pct >= 70 else "warning"

    await _insert_insight(
        insight_type="idle_fleet",
        severity=severity,
        title=f"{name}: {standby} plants idle ({standby_pct:.0f}% standby)",
        description=(
            f"{name} has {standby} of {total} plants on standby — generating no value. "
            f"These could potentially be redeployed to active sites."
        ),
        recommendation=(
            f"Review whether {name} project is still active. "
            "If project is paused or completed, redeploy standby equipment to sites with demand. "
            "Each idle excavator or truck incurs depreciation and storage costs."
        ),
        data={
            "standby": standby,
            "total": total,
            "standby_pct": round(standby_pct, 1),
        },
        week_ending_date=week_ending_date,
        year=year,
        week_number=week_number,
        location_id=str(score["location_id"]),
    )
    return 1


async def _generate_rebalancing_insight(
    scores: list[dict],
    week_ending_date: date,
    year: int,
    week_number: int,
) -> int:
    """Generate fleet rebalancing insight when utilization gap is large."""
    # Filter to sites with meaningful plant counts
    significant = [s for s in scores if int(s["total_plants"]) >= 10]
    if len(significant) < 2:
        return 0

    best = max(significant, key=lambda s: float(s["utilization_pct"] or 0))
    worst = min(significant, key=lambda s: float(s["utilization_pct"] or 0))

    best_pct = float(best["utilization_pct"] or 0)
    worst_pct = float(worst["utilization_pct"] or 0)
    gap = best_pct - worst_pct

    if gap < 50:
        return 0

    total_standby = sum(int(s["standby"]) for s in scores)

    await _insert_insight(
        insight_type="fleet_rebalancing",
        severity="warning",
        title=f"Utilization gap: {best['location_name']} {best_pct:.0f}% vs {worst['location_name']} {worst_pct:.0f}%",
        description=(
            f"Significant utilization gap across sites. "
            f"{best['location_name']} runs at {best_pct:.0f}% while "
            f"{worst['location_name']} is at {worst_pct:.0f}%. "
            f"Total fleet-wide standby: {total_standby} plants available for redeployment."
        ),
        recommendation=(
            "Analyze which sites need more equipment vs which have excess. "
            "Match idle equipment types to demand at active sites. "
            "Prioritize high-value assets (excavators, trucks, loaders) for rebalancing."
        ),
        data={
            "best_site": best["location_name"],
            "best_pct": best_pct,
            "worst_site": worst["location_name"],
            "worst_pct": worst_pct,
            "gap": round(gap, 1),
            "total_standby": total_standby,
            "site_rankings": [
                {"name": s["location_name"], "utilization_pct": float(s["utilization_pct"] or 0),
                 "total": int(s["total_plants"]), "working": int(s["working"])}
                for s in sorted(significant, key=lambda x: float(x["utilization_pct"] or 0), reverse=True)
            ],
        },
        week_ending_date=week_ending_date,
        year=year,
        week_number=week_number,
    )
    return 1


async def _generate_site_performance_insight(
    scores: list[dict],
    week_ending_date: date,
    year: int,
    week_number: int,
) -> int:
    """Generate site performance ranking insight."""
    significant = [s for s in scores if int(s["total_plants"]) >= 10]
    if len(significant) < 4:
        return 0

    ranked = sorted(significant, key=lambda s: float(s["utilization_pct"] or 0), reverse=True)
    top3 = ranked[:3]
    bottom3 = ranked[-3:]

    top_text = ", ".join(f"{s['location_name']} ({float(s['utilization_pct'] or 0):.0f}%)" for s in top3)
    bottom_text = ", ".join(f"{s['location_name']} ({float(s['utilization_pct'] or 0):.0f}%)" for s in bottom3)

    await _insert_insight(
        insight_type="site_performance",
        severity="info",
        title=f"Site performance ranking — Week {week_number}",
        description=(
            f"Top performers: {top_text}. "
            f"Lowest performers: {bottom_text}. "
            f"{len(significant)} sites with 10+ plants evaluated."
        ),
        recommendation=None,
        data={
            "rankings": [
                {"rank": i + 1, "name": s["location_name"],
                 "utilization_pct": float(s["utilization_pct"] or 0),
                 "total": int(s["total_plants"]), "working": int(s["working"]),
                 "standby": int(s["standby"]), "breakdown": int(s["breakdown"])}
                for i, s in enumerate(ranked)
            ],
        },
        week_ending_date=week_ending_date,
        year=year,
        week_number=week_number,
    )
    return 1


async def _generate_chronic_breakdown_insights(
    chronic: list[dict],
    week_ending_date: date,
    year: int,
    week_number: int,
) -> int:
    """Generate insights for plants stuck in breakdown."""
    if not chronic:
        return 0

    severity = "critical" if len(chronic) >= 5 else "warning"
    examples = chronic[:10]
    example_text = ", ".join(
        f"{c['fleet_number']} ({c['consecutive_weeks']}w at {c['location_name']})" for c in examples
    )

    await _insert_insight(
        insight_type="chronic_breakdown",
        severity=severity,
        title=f"{len(chronic)} plants in breakdown for 2+ consecutive weeks",
        description=(
            f"{len(chronic)} plants have been stuck in breakdown, under repair, or faulty "
            f"for 2 or more consecutive weeks. "
            f"Examples: {example_text}."
        ),
        recommendation=(
            "For each chronic breakdown plant, evaluate repair cost vs replacement cost. "
            "Plants in breakdown for 4+ weeks with no progress likely need escalation. "
            "Check spare parts availability and supplier lead times."
        ),
        data={
            "count": len(chronic),
            "plants": [
                {"fleet_number": c["fleet_number"], "fleet_type": c["fleet_type"],
                 "location": c["location_name"], "condition": c["condition"],
                 "weeks": c["consecutive_weeks"], "remarks": c["latest_remarks"]}
                for c in examples
            ],
        },
        week_ending_date=week_ending_date,
        year=year,
        week_number=week_number,
    )
    return 1


async def _generate_fleet_reliability_insight(
    reliability: list[dict],
    week_ending_date: date,
    year: int,
    week_number: int,
) -> int:
    """Generate insight about fleet type breakdown rates."""
    # Only include types with concerning breakdown rates
    high_breakdown = [r for r in reliability if float(r["breakdown_rate"] or 0) >= 15]
    if not high_breakdown:
        return 0

    worst = high_breakdown[0]
    best = reliability[-1] if reliability else None
    best_text = f"{best['fleet_type']} is most reliable at {best['breakdown_rate']}%." if best else ""

    await _insert_insight(
        insight_type="fleet_reliability",
        severity="warning" if float(worst["breakdown_rate"]) >= 25 else "info",
        title=f"Fleet reliability: {worst['fleet_type']} has {worst['breakdown_rate']}% breakdown rate",
        description=(
            f"{worst['fleet_type']} has the highest breakdown rate at {worst['breakdown_rate']}% "
            f"({worst['breakdown']} of {worst['total_plants']} units). "
            f"{best_text} "
            f"{len(high_breakdown)} fleet types have breakdown rates above 15%."
        ),
        recommendation=(
            f"Review maintenance practices for {worst['fleet_type']} fleet. "
            "Consider whether age or operating conditions are contributing factors. "
            "Benchmark against manufacturer expected failure rates."
        ),
        data={
            "high_breakdown_types": [
                {"fleet_type": r["fleet_type"], "total": int(r["total_plants"]),
                 "breakdown": int(r["breakdown"]), "rate": float(r["breakdown_rate"])}
                for r in high_breakdown[:10]
            ],
            "all_types": [
                {"fleet_type": r["fleet_type"], "total": int(r["total_plants"]),
                 "rate": float(r["breakdown_rate"])}
                for r in reliability
            ],
        },
        week_ending_date=week_ending_date,
        year=year,
        week_number=week_number,
    )
    return 1


async def _generate_submission_gap_insights(
    week_ending_date: date,
    year: int,
    week_number: int,
) -> int:
    """Generate insights for sites that haven't submitted reports."""
    # Get all locations with plants
    all_sites = await fetch(
        """SELECT l.id, l.name, count(p.id) AS plant_count
           FROM locations l
           JOIN plants_master p ON p.current_location_id = l.id
           GROUP BY l.id, l.name
           HAVING count(p.id) >= 5
           ORDER BY count(p.id) DESC"""
    )

    # Get locations that submitted for this week
    submitted = await fetch(
        "SELECT DISTINCT location_id FROM weekly_report_submissions WHERE week_ending_date = $1",
        week_ending_date,
    )
    submitted_ids = {str(s["location_id"]) for s in submitted}

    missing = [s for s in all_sites if str(s["id"]) not in submitted_ids]
    if not missing:
        return 0

    total_plants_unreported = sum(int(s["plant_count"]) for s in missing)
    missing_names = [s["name"] for s in missing[:10]]

    await _insert_insight(
        insight_type="submission_gap",
        severity="warning" if len(missing) >= 5 else "info",
        title=f"{len(missing)} sites have not submitted Week {week_number} reports",
        description=(
            f"{len(missing)} of {len(all_sites)} active sites have not submitted reports "
            f"for the week ending {week_ending_date.strftime('%d %b %Y')}. "
            f"This leaves {total_plants_unreported} plants without current status updates. "
            f"Missing: {', '.join(missing_names)}{'...' if len(missing) > 10 else ''}."
        ),
        recommendation=(
            "Follow up with site officers at non-reporting sites. "
            "Check whether reports were submitted but failed processing. "
            "Consider setting submission deadline reminders."
        ),
        data={
            "missing_count": len(missing),
            "total_sites": len(all_sites),
            "plants_unreported": total_plants_unreported,
            "missing_sites": [
                {"name": s["name"], "plants": int(s["plant_count"])}
                for s in missing
            ],
        },
        week_ending_date=week_ending_date,
        year=year,
        week_number=week_number,
    )
    return 1


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


CONDITION_SEVERITY = {
    "working": 0,
    "standby": 1,
    "under_repair": 2,
    "faulty": 3,
    "breakdown": 4,
    "missing": 5,
    "scrap": 6,
    "off_hire": 1,
    "gpm_assessment": 2,
    "unverified": 1,
}


def _is_degradation(prev: str, curr: str) -> bool:
    """Check if condition change is a degradation."""
    return CONDITION_SEVERITY.get(curr, 0) > CONDITION_SEVERITY.get(prev, 0)


def _is_improvement(prev: str, curr: str) -> bool:
    """Check if condition change is an improvement."""
    return CONDITION_SEVERITY.get(curr, 0) < CONDITION_SEVERITY.get(prev, 0)


async def _insert_insight(
    *,
    insight_type: str,
    severity: str,
    title: str,
    description: str,
    recommendation: str | None,
    data: dict,
    week_ending_date: date,
    year: int,
    week_number: int,
    location_id: str | None = None,
    plant_id: str | None = None,
    fleet_type: str | None = None,
) -> None:
    """Insert an insight record and create notification for critical/warning."""
    await execute(
        """INSERT INTO weekly_insights
           (insight_type, severity, title, description, recommendation,
            data, week_ending_date, year, week_number,
            location_id, plant_id, fleet_type)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9,
                   $10::uuid, $11::uuid, $12)""",
        insight_type, severity, title, description, recommendation,
        json.dumps(data), week_ending_date, year, week_number,
        location_id, plant_id, fleet_type,
    )

    # Create notification for critical and warning insights
    if severity in ("critical", "warning"):
        try:
            await execute(
                """INSERT INTO notifications (title, message, type, data, target_role, read)
                   VALUES ($1, $2, $3, $4::jsonb, 'admin', false)""",
                f"[{severity.upper()}] {title}",
                description[:500],
                "insight_alert",
                json.dumps({"insight_type": insight_type, "severity": severity}),
            )
        except Exception as e:
            logger.warning("Failed to create insight notification", error=str(e))
