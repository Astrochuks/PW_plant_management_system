"""Executive summary — the portfolio in one payload.

Every figure here is the project-level figure summed up: works to date =
stored movement + baseline/gap adjustments, works Incl. VAT = ×1.075
excl contingency, certified = cert ledger cumulative as recorded,
certified-not-paid = certified − cert-type payments. Schedule status
reuses project_overview's own date helpers, so a project that reads
"Overdue" on its hub reads "Overdue" here.

Scales with the portfolio: one query for every project that has weekly
data, one for the portfolio series — never one query per project.
"""

from datetime import date
from typing import Any

from app.core.pool import fetch
from app.services.project_overview import (
    DAYS_PER_MONTH, VAT, _add_months, _as_date, _f, _fn,
)

# a project is "quiet" once its latest week is this old
STALE_REPORT_DAYS = 14
# certified money sitting uncollected this long is a cash problem
SLOW_PAYMENT_DAYS = 60
# margin falling by more than this many points period-on-period
MARGIN_DROP_PTS = 5.0

_SQL = """
WITH wk AS (
    SELECT r.project_id, r.year, r.week_number, r.week_ending_date,
           COALESCE(b.works, 0) AS works,
           COALESCE(c.cost, 0)  AS cost
    FROM project_weekly_reports r
    LEFT JOIN LATERAL (
        SELECT sum(amount_this_week) AS works
        FROM project_beme_progress WHERE weekly_report_id = r.id
    ) b ON TRUE
    LEFT JOIN LATERAL (
        SELECT sum(amount_this_week) AS cost
        FROM project_cost_report
        WHERE weekly_report_id = r.id AND cost_category IS NOT NULL
    ) c ON TRUE
),
ranked AS (
    SELECT *, row_number() OVER (
        PARTITION BY project_id ORDER BY year DESC, week_number DESC
    ) AS rn
    FROM wk
)
SELECT p.id, p.short_name, p.project_name, p.client, p.status,
       p.project_type, p.current_contract_sum,
       l.name AS location_name,
       s.name AS state_name,
       -- schedule inputs (date arithmetic happens in Python, once, shared)
       p.commencement_date, p.works_commenced_date,
       p.original_completion_date, p.revised_completion_date,
       p.original_duration_months, p.extension_of_time_months,
       p.substantial_completion_date, p.final_completion_date,

       (SELECT count(*)::int FROM project_weekly_reports r
         WHERE r.project_id = p.id)                              AS weeks_received,
       lw.year          AS latest_year,
       lw.week_number   AS latest_week,
       lw.week_ending_date AS latest_week_ending,
       lw.works         AS latest_works,
       lw.cost          AS latest_cost,
       pw.year          AS prev_year,
       pw.week_number   AS prev_week,
       pw.works         AS prev_works,
       pw.cost          AS prev_cost,

       -- scope: sheet bill total where present, else the items' own sum
       (SELECT COALESCE(sum(COALESCE(bb.contract_amount, it.items_total)), 0)
          FROM project_beme_bills bb
          LEFT JOIN LATERAL (
              SELECT sum(contract_amount) AS items_total
              FROM project_beme_items i WHERE i.bill_id = bb.id
          ) it ON TRUE
         WHERE bb.project_id = p.id)                             AS scope,

       (SELECT COALESCE(sum(pr.amount_this_week), 0)
          FROM project_beme_progress pr
          JOIN project_weekly_reports r ON r.id = pr.weekly_report_id
         WHERE r.project_id = p.id)                              AS works_stored,
       (SELECT COALESCE(sum(a.amount), 0) FROM project_ledger_adjustments a
         WHERE a.project_id = p.id AND a.ledger = 'beme')        AS works_adj,
       (SELECT COALESCE(sum(c.amount_this_week), 0)
          FROM project_cost_report c
          JOIN project_weekly_reports r ON r.id = c.weekly_report_id
         WHERE r.project_id = p.id AND c.cost_category IS NOT NULL) AS cost_stored,
       (SELECT COALESCE(sum(a.amount), 0) FROM project_ledger_adjustments a
         WHERE a.project_id = p.id AND a.ledger = 'cost')        AS cost_adj,

       (SELECT max(gross_value_works_done) FROM project_certificates
         WHERE project_id = p.id)                                AS certified,
       cert.total_retention_held                                 AS retention_held,
       cert.retention_released                                   AS retention_released,
       pay.paid_gross, pay.cert_paid, pay.last_payment_date, pay.payments_count
FROM projects p
LEFT JOIN locations l ON l.id = p.location_id
LEFT JOIN states s ON s.id = l.state_id
JOIN LATERAL (
    SELECT * FROM ranked WHERE ranked.project_id = p.id AND rn = 1
) lw ON TRUE
LEFT JOIN LATERAL (
    SELECT * FROM ranked WHERE ranked.project_id = p.id AND rn = 2
) pw ON TRUE
LEFT JOIN LATERAL (
    SELECT total_retention_held, retention_released
    FROM project_certificates
    WHERE project_id = p.id
    ORDER BY gross_value_works_done DESC NULLS LAST LIMIT 1
) cert ON TRUE
LEFT JOIN LATERAL (
    SELECT COALESCE(sum(gross_amount), 0) AS paid_gross,
           COALESCE(sum(gross_amount) FILTER (
               WHERE payment_type ILIKE '%cert%'), 0)            AS cert_paid,
           max(payment_date)                                     AS last_payment_date,
           count(*)::int                                         AS payments_count
    FROM v_project_payments_latest WHERE project_id = p.id
) pay ON TRUE
ORDER BY p.short_name NULLS LAST, p.project_name
"""

# per project per week — the frontend buckets this by the page's period
# lens to build BOTH the portfolio trend and the site × period output
# matrix (the shape PW's own "General Summary Per Site Output" uses)
_SERIES_SQL = """
SELECT r.project_id, r.year, r.week_number, r.week_ending_date,
       COALESCE(b.works, 0) AS works,
       COALESCE(c.cost, 0)  AS cost
FROM project_weekly_reports r
LEFT JOIN LATERAL (
    SELECT sum(amount_this_week) AS works
    FROM project_beme_progress WHERE weekly_report_id = r.id
) b ON TRUE
LEFT JOIN LATERAL (
    SELECT sum(amount_this_week) AS cost
    FROM project_cost_report
    WHERE weekly_report_id = r.id AND cost_category IS NOT NULL
) c ON TRUE
ORDER BY r.year, r.week_number
"""


def _schedule(row: dict[str, Any], works: float, scope: float) -> dict[str, Any]:
    """Same rules as the project hub: completion freezes the overdue
    clock; lateness is measured at the latest report, not today."""
    report_date = _as_date(row.get("latest_week_ending"))
    commence = _as_date(row.get("commencement_date"))
    revised_completion = _as_date(row.get("revised_completion_date"))
    duration = _fn(row.get("original_duration_months"))
    if duration is None and commence and revised_completion:
        duration = round((revised_completion - commence).days / DAYS_PER_MONTH, 1)
    orig_completion = _as_date(row.get("original_completion_date"))
    if orig_completion is None and commence and duration is not None:
        orig_completion = _add_months(commence, duration)

    completed_date = (_as_date(row.get("substantial_completion_date"))
                      or _as_date(row.get("final_completion_date")))
    is_completed = (
        completed_date is not None
        or row.get("status") in ("completed", "retention_period")
        or (bool(scope) and works / scope >= 0.9999)
    )
    end_date = completed_date or report_date
    months_overdue = (round((end_date - revised_completion).days / DAYS_PER_MONTH, 1)
                      if end_date and revised_completion else None)
    return {
        "status": ("completed" if is_completed
                   else "overdue" if months_overdue is not None and months_overdue > 0
                   else "on_track" if revised_completion else None),
        "months_overdue": months_overdue,
        "revised_completion_date": (revised_completion.isoformat()
                                    if revised_completion else None),
        "original_completion_date": (orig_completion.isoformat()
                                     if orig_completion else None),
    }


async def build_portfolio(today: date) -> dict[str, Any]:
    rows = await fetch(_SQL)
    series = await fetch(_SERIES_SQL)

    projects: list[dict[str, Any]] = []
    attention: list[dict[str, Any]] = []

    for r in rows:
        works = _f(r["works_stored"]) + _f(r["works_adj"])
        cost = _f(r["cost_stored"]) + _f(r["cost_adj"])
        scope = _f(r["scope"])
        earnings = works * VAT
        net = earnings - cost
        certified = _fn(r["certified"])
        cert_paid = _f(r["cert_paid"])
        # the locked convention: only certificate-type money settles certificates
        unpaid = max(0.0, (certified or 0.0) - cert_paid) if certified else 0.0

        sched = _schedule(dict(r), works, scope)
        last_ending = _as_date(r["latest_week_ending"])
        days_since_report = (today - last_ending).days if last_ending else None
        last_payment = _as_date(r["last_payment_date"])
        days_since_payment = (today - last_payment).days if last_payment else None

        latest_earn = _f(r["latest_works"]) * VAT
        latest_net = latest_earn - _f(r["latest_cost"])
        latest_margin = (latest_net / latest_earn) if latest_earn else None
        prev_earn = _f(r["prev_works"]) * VAT
        prev_net = prev_earn - _f(r["prev_cost"])
        prev_margin = (prev_net / prev_earn) if prev_earn else None

        name = r["short_name"] or r["project_name"]
        pid = str(r["id"])

        projects.append({
            "id": pid,
            "short_name": r["short_name"],
            "project_name": r["project_name"],
            "client": r["client"],
            "status": r["status"],
            "project_type": r["project_type"],
            "location_name": r["location_name"],
            "state_name": r["state_name"],
            "contract_sum": _fn(r["current_contract_sum"]),
            "scope": scope,
            "scope_incl_vat": scope * VAT,
            "works": works,
            "works_incl_vat": earnings,
            "cost": cost,
            "net": net,
            "margin": (net / earnings) if earnings else None,
            "pct_complete": (works / scope) if scope else None,
            "certified": certified,
            "paid_gross": _fn(r["paid_gross"]),
            "certified_not_paid": unpaid or None,
            "retention_held": _fn(r["retention_held"]),
            "retention_released": _f(r["retention_released"]),
            "payments_count": r["payments_count"] or 0,
            "last_payment_date": last_payment.isoformat() if last_payment else None,
            "days_since_payment": days_since_payment,
            "weeks_received": r["weeks_received"],
            "latest_year": r["latest_year"],
            "latest_week": r["latest_week"],
            "latest_week_ending": last_ending.isoformat() if last_ending else None,
            "days_since_report": days_since_report,
            "latest_net": latest_net,
            "latest_margin": latest_margin,
            "prev_margin": prev_margin,
            "schedule": sched,
        })

        # ── attention list: only things that would change a decision ────
        def flag(severity: str, kind: str, headline: str, detail: str,
                 value: float | None = None) -> None:
            attention.append({
                "project_id": pid, "project": name, "severity": severity,
                "kind": kind, "headline": headline, "detail": detail,
                "value": value,
            })

        if sched["status"] == "overdue" and sched["months_overdue"]:
            flag("high", "overdue",
                 f"Overdue by {sched['months_overdue']:.1f} months",
                 f"Revised completion {sched['revised_completion_date']}",
                 sched["months_overdue"])
        if unpaid > 0 and (days_since_payment is None
                           or days_since_payment > SLOW_PAYMENT_DAYS):
            flag("high", "cash",
                 "Certified work uncollected",
                 (f"Last payment {days_since_payment} days ago"
                  if days_since_payment is not None else "No payment recorded"),
                 unpaid)
        if days_since_report is not None and days_since_report > STALE_REPORT_DAYS:
            flag("medium", "reporting",
                 f"No weekly report in {days_since_report} days",
                 f"Latest is W{r['latest_week']:02d} {r['latest_year']}",
                 float(days_since_report))
        if latest_margin is not None and prev_margin is not None:
            drop = (prev_margin - latest_margin) * 100
            if drop > MARGIN_DROP_PTS:
                flag("medium", "margin",
                     f"Margin fell {drop:.1f} pts",
                     f"W{r['latest_week']:02d} {latest_margin * 100:.1f}% "
                     f"vs W{r['prev_week']:02d} {prev_margin * 100:.1f}%",
                     drop)
        if latest_net < 0:
            flag("high", "loss",
                 f"Lost money in W{r['latest_week']:02d}",
                 f"Net {latest_net:,.0f} for the week", abs(latest_net))

    order = {"high": 0, "medium": 1, "low": 2}
    attention.sort(key=lambda a: (order.get(a["severity"], 9), -(a["value"] or 0)))

    active = [p for p in projects if p["status"] == "active"]
    base = active or projects

    def total(key: str) -> float:
        return sum(p[key] or 0 for p in base)

    works_incl_vat = total("works_incl_vat")
    cost_total = total("cost")
    net_total = works_incl_vat - cost_total
    unpaid_total = total("certified_not_paid")

    oldest_payment_days = max(
        (p["days_since_payment"] for p in base
         if p["certified_not_paid"] and p["days_since_payment"] is not None),
        default=None,
    )

    return {
        "generated_at": today.isoformat(),
        "totals": {
            "projects_reporting": len(base),
            "projects_total": len(projects),
            "contract_sum": total("contract_sum"),
            "scope_incl_vat": total("scope_incl_vat"),
            "works_incl_vat": works_incl_vat,
            "cost": cost_total,
            "net": net_total,
            "margin": (net_total / works_incl_vat) if works_incl_vat else None,
            "pct_complete": (total("works") / total("scope")) if total("scope") else None,
            "certified": total("certified"),
            "paid_gross": total("paid_gross"),
            "certified_not_paid": unpaid_total,
            "retention_held": total("retention_held"),
            "oldest_unpaid_days": oldest_payment_days,
            "overdue_projects": sum(
                1 for p in base if p["schedule"]["status"] == "overdue"),
        },
        "attention": attention,
        "projects": projects,
        "series": [
            {
                "project_id": str(s["project_id"]),
                "year": s["year"], "week_number": s["week_number"],
                "week_ending_date": s["week_ending_date"],
                "works": _f(s["works"]),
                "works_incl_vat": _f(s["works"]) * VAT,
                "cost": _f(s["cost"]),
                "net": _f(s["works"]) * VAT - _f(s["cost"]),
            }
            for s in series
        ],
    }
