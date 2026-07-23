"""Project report pack — one JSON document for any period.

Mirrors the fleet report generator's contract: period + reference date
→ date window → every section computed from the ledgers for exactly
that window, with to-date figures as of the last stored week on or
before the window's end (movement + baseline/gap adjustments — the
same as-of arithmetic the Work & Cost tab uses).

Conventions (WORKBOOK_ARITHMETIC.md):
  work Incl. VAT   = works × 1.075 (excl contingency — the earnings convention)
  certified        = cert ledger cumulative gross, as recorded
  certified unpaid = certified − cert-type payments (FIFO per certificate)
  net              = work Incl. VAT − costs
"""

import calendar
from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.core.pool import fetch, fetchrow

VAT = 1.075

PERIODS = ("weekly", "monthly", "quarterly", "yearly", "to-date")


def _f(v: Any) -> float:
    return 0.0 if v is None else float(v)


def period_range(period: str, ref: date) -> dict[str, Any]:
    """Date window + label for the given period (to-date is open-start)."""
    iso = ref.isocalendar()
    if period == "weekly":
        start = ref - timedelta(days=ref.weekday())
        return {"date_from": start, "date_to": start + timedelta(days=6),
                "label": f"Week {iso[1]}, {iso[0]}"}
    if period == "monthly":
        last = calendar.monthrange(ref.year, ref.month)[1]
        return {"date_from": ref.replace(day=1), "date_to": ref.replace(day=last),
                "label": f"{calendar.month_name[ref.month]} {ref.year}"}
    if period == "quarterly":
        q = (ref.month - 1) // 3 + 1
        last_m = q * 3
        return {"date_from": date(ref.year, (q - 1) * 3 + 1, 1),
                "date_to": date(ref.year, last_m, calendar.monthrange(ref.year, last_m)[1]),
                "label": f"Q{q} {ref.year}"}
    if period == "yearly":
        return {"date_from": date(ref.year, 1, 1), "date_to": date(ref.year, 12, 31),
                "label": str(ref.year)}
    # to-date: everything up to the reference date
    return {"date_from": date(2000, 1, 1), "date_to": ref, "label": f"To date · {ref.isoformat()}"}


async def build_report(project_id: str, period: str, ref: date) -> dict[str, Any] | None:
    pr = period_range(period, ref)
    d_from, d_to = pr["date_from"], pr["date_to"]

    project = await fetchrow(
        """SELECT p.project_name, p.short_name, p.client,
                  p.current_contract_sum, p.project_type
           FROM projects p WHERE p.id = $1::uuid""",
        project_id,
    )
    if project is None:
        return None

    # the as-of anchor: last stored week on or before the window end —
    # every "to date" figure in the pack is measured at this week
    asof = await fetchrow(
        """SELECT year, week_number, week_ending_date
           FROM project_weekly_reports
           WHERE project_id = $1::uuid AND week_ending_date <= $2
           ORDER BY year DESC, week_number DESC LIMIT 1""",
        project_id, d_to,
    )
    asof_y = asof["year"] if asof else 0
    asof_w = asof["week_number"] if asof else 0

    row = await fetchrow(
        """
        WITH wr AS (
            SELECT id, year, week_number, week_ending_date
            FROM project_weekly_reports
            WHERE project_id = $1::uuid
              AND week_ending_date BETWEEN $2 AND $3
        ),
        wk AS (
            SELECT wr.year, wr.week_number, wr.week_ending_date,
                   COALESCE(b.works, 0)  AS works,
                   COALESCE(c.total, 0)  AS cost,
                   c.by_category         AS cost_by_category,
                   ago.amount            AS diesel_cost,
                   ago.qty               AS diesel_litres,
                   COALESCE(d.litres, 0) AS diesel_logged
            FROM wr
            LEFT JOIN LATERAL (
                SELECT sum(amount_this_week) AS works
                FROM project_beme_progress WHERE weekly_report_id = wr.id
            ) b ON TRUE
            LEFT JOIN LATERAL (
                SELECT sum(cat) AS total,
                       jsonb_object_agg(cost_category, cat) AS by_category
                FROM (
                    SELECT cost_category, sum(amount_this_week) AS cat
                    FROM project_cost_report
                    WHERE weekly_report_id = wr.id AND cost_category IS NOT NULL
                    GROUP BY 1
                ) x
            ) c ON TRUE
            LEFT JOIN LATERAL (
                SELECT quantity_this_week AS qty, amount_this_week AS amount
                FROM project_cost_report
                WHERE weekly_report_id = wr.id AND description = 'Diesel'
                  AND cost_category = 'AGO'
                ORDER BY amount_this_week DESC NULLS LAST LIMIT 1
            ) ago ON TRUE
            LEFT JOIN LATERAL (
                SELECT sum(total_litres) AS litres
                FROM project_diesel_consumption WHERE weekly_report_id = wr.id
            ) d ON TRUE
        )
        SELECT
          (SELECT COALESCE(json_agg(wk ORDER BY year, week_number), '[]'::json)
             FROM wk)                                                    AS period_weeks,

          -- per bill: contract, this-period movement, to-date as of anchor
          (SELECT COALESCE(json_agg(x ORDER BY x.bill_code), '[]'::json) FROM (
              SELECT bb.bill_code, bb.name,
                     COALESCE(bb.contract_amount, it.items_total) AS contract_amount,
                     COALESCE(pd.amt, 0)                          AS period_amount,
                     COALESCE(td.moved, 0) + COALESCE(ta.adj, 0)  AS to_date_amount
              FROM project_beme_bills bb
              LEFT JOIN LATERAL (
                  SELECT sum(contract_amount) AS items_total
                  FROM project_beme_items i WHERE i.bill_id = bb.id
              ) it ON TRUE
              LEFT JOIN LATERAL (
                  SELECT sum(p.amount_this_week) AS amt
                  FROM project_beme_progress p
                  JOIN project_beme_items i ON i.id = p.item_id
                  JOIN wr ON wr.id = p.weekly_report_id
                  WHERE i.bill_id = bb.id
              ) pd ON TRUE
              LEFT JOIN LATERAL (
                  SELECT sum(p.amount_this_week) AS moved
                  FROM project_beme_progress p
                  JOIN project_beme_items i ON i.id = p.item_id
                  JOIN project_weekly_reports r ON r.id = p.weekly_report_id
                  WHERE i.bill_id = bb.id AND r.project_id = $1::uuid
                    AND (r.year, r.week_number) <= ($4, $5)
              ) td ON TRUE
              LEFT JOIN LATERAL (
                  SELECT sum(a.amount) AS adj
                  FROM project_ledger_adjustments a
                  JOIN project_beme_items i ON i.id = a.beme_item_id
                  WHERE i.bill_id = bb.id AND a.project_id = $1::uuid
                    AND a.ledger = 'beme'
                    AND (a.covers_to_year, a.covers_to_week) <= ($4, $5)
              ) ta ON TRUE
              WHERE bb.project_id = $1::uuid
          ) x)                                                           AS bills,

          -- per cost category to date as of anchor (stored + adjustments)
          (SELECT COALESCE(json_agg(x ORDER BY x.to_date_amount DESC), '[]'::json) FROM (
              SELECT COALESCE(s.cat, a.cat) AS category,
                     COALESCE(s.amt, 0) + COALESCE(a.amt, 0) AS to_date_amount
              FROM (
                  SELECT c.cost_category AS cat, sum(c.amount_this_week) AS amt
                  FROM project_cost_report c
                  JOIN project_weekly_reports r ON r.id = c.weekly_report_id
                  WHERE r.project_id = $1::uuid AND c.cost_category IS NOT NULL
                    AND (r.year, r.week_number) <= ($4, $5)
                  GROUP BY 1
              ) s
              FULL OUTER JOIN (
                  -- cost_key is 'SECTION|Category|Description' — group by
                  -- the category segment to match the stored rows
                  SELECT COALESCE(NULLIF(split_part(cost_key, '|', 2), ''),
                                  'Uncategorised') AS cat,
                         sum(amount) AS amt
                  FROM project_ledger_adjustments
                  WHERE project_id = $1::uuid AND ledger = 'cost'
                    AND (covers_to_year, covers_to_week) <= ($4, $5)
                  GROUP BY 1
              ) a ON a.cat = s.cat
          ) x)                                                           AS cost_to_date,

          -- fleet effort inside the window
          (SELECT json_build_object(
                  'plants',    count(DISTINCT u.fleet_number_raw),
                  'worked',    COALESCE(sum(u.hours_worked), 0),
                  'standby',   COALESCE(sum(u.standby_hours), 0),
                  'breakdown', COALESCE(sum(u.breakdown_hours), 0),
                  'plant_cost', COALESCE(sum(u.plant_cost), 0))
             FROM project_plant_utilization u
             JOIN wr ON wr.id = u.weekly_report_id)                      AS plant,

          -- client money: certificates (cumulative, undated by design)
          (SELECT COALESCE(json_agg(json_build_object(
                      'cert', cert_number, 'gross', gross_value_works_done)
                  ORDER BY gross_value_works_done), '[]'::json)
             FROM project_certificates
             WHERE project_id = $1::uuid
               AND gross_value_works_done IS NOT NULL)                   AS certs,
          (SELECT row_to_json(x) FROM (
              SELECT gross_value_works_done, total_retention_held, retention_released
              FROM project_certificates WHERE project_id = $1::uuid
              ORDER BY gross_value_works_done DESC NULLS LAST LIMIT 1
          ) x)                                                           AS last_cert,
          -- payments up to the window end (undated advances always carried)
          (SELECT COALESCE(json_agg(json_build_object(
                      'date', payment_date, 'type', payment_type,
                      'voucher', voucher_number, 'gross', gross_amount)
                  ORDER BY payment_date NULLS FIRST), '[]'::json)
             FROM v_project_payments_latest
             WHERE project_id = $1::uuid
               AND (payment_date IS NULL OR payment_date <= $3))         AS payments
        """,
        project_id, d_from, d_to, asof_y, asof_w,
    )

    period_weeks = row["period_weeks"] or []
    bills = row["bills"] or []
    cost_to_date_rows = row["cost_to_date"] or []
    plant = row["plant"] or {}
    certs = row["certs"] or []
    last_cert = row["last_cert"] or {}
    payments = row["payments"] or []

    # ── period rollups ────────────────────────────────────────────────
    p_works = sum(_f(w["works"]) for w in period_weeks)
    p_cost = sum(_f(w["cost"]) for w in period_weeks)
    p_earnings = p_works * VAT
    p_net = p_earnings - p_cost
    p_diesel_cost = sum(_f(w["diesel_cost"]) for w in period_weeks)
    p_charged = sum(_f(w["diesel_litres"]) for w in period_weeks)
    p_logged = sum(_f(w["diesel_logged"]) for w in period_weeks)

    p_cost_by_cat: dict[str, float] = {}
    for w in period_weeks:
        for cat, amt in (w.get("cost_by_category") or {}).items():
            p_cost_by_cat[cat] = p_cost_by_cat.get(cat, 0.0) + _f(amt)

    # ── to-date rollups (as of the anchor week) ───────────────────────
    beme_total = sum(_f(b["contract_amount"]) for b in bills)
    works_to_date = sum(_f(b["to_date_amount"]) for b in bills)
    cost_to_date = sum(_f(c["to_date_amount"]) for c in cost_to_date_rows)
    works_incl_vat = works_to_date * VAT
    beme_incl_vat = beme_total * VAT
    net_to_date = works_incl_vat - cost_to_date

    # ── client money as at window end ─────────────────────────────────
    certified = _f(last_cert.get("gross_value_works_done"))
    paid_gross = sum(_f(p["gross"]) for p in payments)
    cert_paid = sum(
        _f(p["gross"]) for p in payments
        if "cert" in str(p.get("type") or "").lower()
    )
    # FIFO: cert-type money against the cumulative certificate ladder
    unpaid: list[dict[str, Any]] = []
    prev_cum = 0.0
    for c in certs:
        cum = _f(c["gross"])
        increment = max(0.0, cum - prev_cum)
        covered = min(max(0.0, cert_paid - prev_cum), increment)
        if increment - covered > 0.5:
            unpaid.append({
                "cert": str(c["cert"]),
                "certified_to_date": cum,
                "this_certificate": increment,
                "paid_against": covered,
                "outstanding": increment - covered,
            })
        prev_cum = cum

    worked = _f(plant.get("worked"))
    standby = _f(plant.get("standby"))
    breakdown = _f(plant.get("breakdown"))
    hours_total = worked + standby + breakdown

    return {
        "meta": {
            "project_name": project["project_name"],
            "short_name": project["short_name"],
            "client": project["client"],
            "project_type": project["project_type"],
            "contract_sum": _f(project["current_contract_sum"]) or None,
            "period": period,
            "label": pr["label"],
            "date_from": d_from.isoformat(),
            "date_to": d_to.isoformat(),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "weeks_covered": [
                {"year": w["year"], "week_number": w["week_number"],
                 "week_ending_date": w["week_ending_date"]}
                for w in period_weeks
            ],
            "as_of": (
                {"year": asof["year"], "week_number": asof["week_number"],
                 "week_ending_date": asof["week_ending_date"]}
                if asof else None
            ),
        },
        "contract_summary": {
            "contract_sum": _f(project["current_contract_sum"]) or None,
            "beme_total": beme_total,
            "beme_incl_vat": beme_incl_vat,
            "works_to_date": works_to_date,
            "works_incl_vat": works_incl_vat,
            "pct_complete": (works_to_date / beme_total) if beme_total else None,
            "cost_to_date": cost_to_date,
            "net_to_date": net_to_date,
            "margin": (net_to_date / works_incl_vat) if works_incl_vat else None,
            "certified": certified or None,
            "paid_gross": paid_gross or None,
            "certified_not_paid": sum(u["outstanding"] for u in unpaid) or None,
            "retention_held": _f(last_cert.get("total_retention_held")) or None,
            "retention_released": _f(last_cert.get("retention_released")),
        },
        "period_summary": {
            "weeks": [
                {
                    "year": w["year"], "week_number": w["week_number"],
                    "week_ending_date": w["week_ending_date"],
                    "works": _f(w["works"]),
                    "earnings": _f(w["works"]) * VAT,
                    "cost": _f(w["cost"]),
                    "net": _f(w["works"]) * VAT - _f(w["cost"]),
                }
                for w in period_weeks
            ],
            "totals": {
                "works": p_works, "earnings": p_earnings,
                "cost": p_cost, "net": p_net,
                "margin": (p_net / p_earnings) if p_earnings else None,
            },
        },
        "work_done": {
            "bills": [
                {
                    "bill_code": b["bill_code"], "name": b["name"],
                    "contract_amount": _f(b["contract_amount"]),
                    "period_amount": _f(b["period_amount"]),
                    "to_date_amount": _f(b["to_date_amount"]),
                    "pct_complete": (
                        _f(b["to_date_amount"]) / _f(b["contract_amount"])
                        if _f(b["contract_amount"]) else None
                    ),
                }
                for b in bills
            ],
        },
        "costs": {
            "categories": [
                {
                    "category": c["category"],
                    "period_amount": p_cost_by_cat.get(c["category"], 0.0),
                    "to_date_amount": _f(c["to_date_amount"]),
                    "share_to_date": (
                        _f(c["to_date_amount"]) / cost_to_date if cost_to_date else None
                    ),
                }
                for c in cost_to_date_rows
            ],
        },
        "plant_diesel": {
            "plants_seen": int(plant.get("plants") or 0),
            "worked": worked, "standby": standby, "breakdown": breakdown,
            "availability": ((worked + standby) / hours_total) if hours_total else None,
            "utilisation": (worked / hours_total) if hours_total else None,
            "plant_cost": _f(plant.get("plant_cost")),
            "diesel_cost": p_diesel_cost,
            "diesel_charged": p_charged,
            "diesel_logged": p_logged,
            "attribution": (p_logged / p_charged) if p_charged else None,
        },
        "financials": {
            "certified": certified or None,
            "paid_gross": paid_gross or None,
            "payments_count": len(payments),
            "unpaid_certificates": unpaid,
            "retention_held": _f(last_cert.get("total_retention_held")) or None,
            "retention_released": _f(last_cert.get("retention_released")),
        },
    }
