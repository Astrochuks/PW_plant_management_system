"""Executive brief — the exceptions, computed.

The executive summary answers "where do we stand". This answers "what
should the MD do about it": a ranked list of findings the workbook does
not surface on its own, each carrying the naira it is worth so the page
can lead with the biggest one.

Nothing here is hard-coded to a project. Every finding is derived per
project from the stored ledgers, so the brief grows with the portfolio —
a site added next month is analysed the same way on its first upload.

The money (contract, work done, cost, net, certified, unpaid) is NOT
recomputed here — the caller already holds it from build_portfolio, and
two computations of the same figure is two chances to disagree.
"""

from datetime import date
from typing import Any

from app.core.pool import fetch
from app.services.project_overview import _f, _fn

# A fuel-log run this long stops being a coincidence and starts being a
# copy-paste: the same machines drawing the same litres, week after week.
REPEAT_RUN_MIN = 3
# Below this the price moved with the market, not with a decision.
PRICE_MOVE_MIN = 0.10
# A site that has not reported in this long is steering by memory.
STALE_DAYS_MIN = 21

# Per project per stored week: what the Cost Report says we bought (the
# money truth) against what the per-plant sheet says we burned, plus a
# fingerprint of that sheet's rows so a re-sent copy is detectable.
_SQL = """
SELECT r.project_id, r.year, r.week_number, r.week_ending_date,
       ago.quantity_this_week AS charged,
       ago.rate_ngn           AS rate,
       ago.amount_this_week   AS amount,
       d.litres               AS logged,
       d.plants,
       d.fingerprint
FROM project_weekly_reports r
LEFT JOIN LATERAL (
    SELECT quantity_this_week, rate_ngn, amount_this_week
    FROM project_cost_report
    WHERE weekly_report_id = r.id
      AND description = 'Diesel' AND cost_category = 'AGO'
    ORDER BY amount_this_week DESC NULLS LAST LIMIT 1
) ago ON TRUE
LEFT JOIN LATERAL (
    SELECT sum(total_litres) AS litres,
           count(*)::int     AS plants,
           md5(string_agg(fleet_number_raw || ':' || total_litres,
                          ',' ORDER BY fleet_number_raw)) AS fingerprint
    FROM project_diesel_consumption
    WHERE weekly_report_id = r.id
) d ON TRUE
ORDER BY r.project_id, r.year, r.week_number
"""


def _longest_repeat(weeks: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The longest run of consecutive stored weeks whose per-plant fuel
    sheet is byte-identical. Consecutive in STORED terms — a missing week
    does not break the run, because the sheet still came over unchanged."""
    best: dict[str, Any] | None = None
    run: list[dict[str, Any]] = []

    def close(r: list[dict[str, Any]]) -> None:
        nonlocal best
        if len(r) >= REPEAT_RUN_MIN and (best is None or len(r) > best["weeks"]):
            best = {
                "weeks": len(r),
                "from_year": r[0]["year"], "from_week": r[0]["week_number"],
                "to_year": r[-1]["year"], "to_week": r[-1]["week_number"],
                "plants": r[0]["plants"],
                "litres": _f(r[0]["logged"]),
            }

    for w in weeks:
        if not w["fingerprint"] or not w["plants"]:
            close(run)
            run = []
            continue
        if run and run[-1]["fingerprint"] == w["fingerprint"]:
            run.append(w)
        else:
            close(run)
            run = [w]
    close(run)
    return best


def _price_move(weeks: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The most recent week-on-week change in what we pay per litre."""
    priced = [w for w in weeks if _fn(w["rate"])]
    if len(priced) < 2:
        return None
    prev, curr = priced[-2], priced[-1]
    r0, r1 = _f(prev["rate"]), _f(curr["rate"])
    if not r0 or abs(r1 - r0) / r0 < PRICE_MOVE_MIN:
        return None

    def pct(a: float, b: float) -> float | None:
        return (b - a) / a if a else None

    return {
        "from_year": prev["year"], "from_week": prev["week_number"],
        "to_year": curr["year"], "to_week": curr["week_number"],
        "from_rate": r0, "to_rate": r1,
        "rate_pct": pct(r0, r1),
        "litres_pct": pct(_f(prev["charged"]), _f(curr["charged"])),
        "spend_pct": pct(_f(prev["amount"]), _f(curr["amount"])),
        # what the move costs at the volume we are actually buying
        "extra_naira": (r1 - r0) * _f(curr["charged"]),
    }


async def build_findings(today: date, projects: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Findings for every project in `projects` (the portfolio rows), each
    with the naira it is worth so the caller can rank and take the top N.

    `projects` supplies identity and reporting freshness — this function
    only reads the fuel ledgers.
    """
    rows = await fetch(_SQL)

    by_project: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        by_project.setdefault(str(r["project_id"]), []).append(dict(r))

    findings: list[dict[str, Any]] = []

    for p in projects:
        pid = p["id"]
        name = p.get("short_name") or p.get("project_name") or "—"
        weeks = by_project.get(pid, [])

        def add(kind: str, severity: str, impact: float | None, facts: dict[str, Any]) -> None:
            findings.append({
                "project_id": pid, "project": name,
                "kind": kind, "severity": severity,
                "impact_naira": impact,
                "facts": facts,
            })

        # ── fuel: bought vs attributed to a machine ──────────────────────
        charged = sum(_f(w["charged"]) for w in weeks)
        logged = sum(_f(w["logged"]) for w in weeks)
        spend = sum(_f(w["amount"]) for w in weeks)
        gap = charged - logged
        avg_rate = (spend / charged) if charged else 0.0
        repeat = _longest_repeat(weeks)

        if charged and gap > 0 and gap / charged >= 0.02:
            add(
                "fuel_unattributed",
                "high" if gap / charged >= 0.10 else "medium",
                gap * avg_rate,
                {
                    "charged_litres": charged,
                    "logged_litres": logged,
                    "gap_litres": gap,
                    "gap_share": gap / charged,
                    "avg_rate": avg_rate,
                    "ago_spend": spend,
                    "weeks": len(weeks),
                    # the same sheet arriving unchanged is WHY the gap opens,
                    # so the two travel together and read as one story
                    "repeat": repeat,
                },
            )
        elif repeat:
            add("fuel_repeated_log", "medium", None, {"repeat": repeat, "weeks": len(weeks)})

        # ── fuel: what we pay per litre ──────────────────────────────────
        move = _price_move(weeks)
        if move:
            move["ago_spend"] = spend
            add(
                "diesel_price",
                "high" if (move["rate_pct"] or 0) >= 0.25 else "medium",
                abs(move["extra_naira"]),
                move,
            )

        # ── reporting freshness ──────────────────────────────────────────
        days = p.get("days_since_report")
        if days is not None and days >= STALE_DAYS_MIN:
            add(
                "stale_reporting",
                "high" if days >= 90 else "medium",
                None,
                {
                    "days": days,
                    "year": p.get("latest_year"),
                    "week": p.get("latest_week"),
                    "week_ending": p.get("latest_week_ending"),
                    "weeks_received": p.get("weeks_received"),
                },
            )
        elif days is None:
            add("never_reported", "medium", None, {})

    # biggest money first; the findings that carry no naira (freshness,
    # a stale log with no measurable gap) fall in behind, worst first
    rank = {"high": 0, "medium": 1}
    findings.sort(key=lambda f: (
        f["impact_naira"] is None,
        -(f["impact_naira"] or 0),
        rank.get(f["severity"], 9),
    ))
    return findings
