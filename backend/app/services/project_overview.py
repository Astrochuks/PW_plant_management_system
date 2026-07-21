"""Project KPI dashboard — every Overview figure computed from the
ledgers and atomic weekly facts, per docs/WORKBOOK_ARITHMETIC.md.

Conventions (decision log §7, updated for the KPI dashboard):
  works to date     = Σ stored this-week + baseline/gap adjustments
                      (== the BEME sheet's own Sub-Total cumulative, kobo-exact)
  works incl VAT    = works × 1.075 (VAT only — the earnings convention)
  contingency & VOP = BEME tail accrual: subtotal₂ − subtotal₁ per column,
                      × 1.075 for the incl-VAT presentation (verified vs the
                      sheet's own GRAND TOTAL: works×1.075 + accrual×1.075
                      == grand_total, kobo-exact on Akwa W05)
  certified         = certificate ledger cumulative gross AS RECORDED —
                      the ledger's own dashboard treats it as the certified
                      value for payment comparison (98% paid identity);
                      no ×1.075 re-grossing
  paid              = latest payments ledger only (v_project_payments_latest)
  certified not paid= certified − CERT-TYPE payments (advances excluded —
                      subtracting total gross goes negative once advances
                      outrun the certified/paid gap)
  net earnings      = works incl VAT − costs to date (Weekly Summary defn)
  net margin        = net ÷ works incl VAT
  physical %        = works ÷ BEME sub-total contract (tail verbatim,
                      falling back to Σ item contract amounts)

ONE query, one round trip: scalar subqueries + json_agg. Parallel
per-figure queries stampede the Supavisor pool; sequential ones stack
RTTs. All subqueries hit (project_id, …) indexes.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from app.core.pool import fetchrow

VAT = 1.075
DAYS_PER_MONTH = 30.4375

_SQL = """
WITH latest AS (
    SELECT id, year, week_number, week_ending_date, beme_pct_complete,
           beme_tail
    FROM project_weekly_reports WHERE project_id = $1::uuid
    ORDER BY year DESC, week_number DESC LIMIT 1
),
prev AS (
    SELECT id, year, week_number, week_ending_date, beme_tail
    FROM project_weekly_reports WHERE project_id = $1::uuid
    ORDER BY year DESC, week_number DESC OFFSET 1 LIMIT 1
),
last_cert AS (
    SELECT * FROM project_certificates WHERE project_id = $1::uuid
    ORDER BY gross_value_works_done DESC NULLS LAST LIMIT 1
)
SELECT
  (SELECT row_to_json(x) FROM (
     SELECT p.id, p.project_name, p.short_name, p.client, p.status,
            p.project_type, p.work_nature, p.current_contract_sum,
            p.original_contract_sum, p.award_date, p.commencement_date,
            p.revised_completion_date, p.original_duration_months,
            s.name AS state_name
     FROM projects p LEFT JOIN states s ON s.id = p.state_id
     WHERE p.id = $1::uuid) x)                                   AS project,
  (SELECT row_to_json(l) FROM latest l)                          AS latest,
  (SELECT sum(amount_this_week) FROM project_beme_progress
    WHERE project_id = $1::uuid)                                 AS works_stored,
  (SELECT sum(amount) FROM project_ledger_adjustments
    WHERE project_id = $1::uuid AND ledger = 'beme')             AS works_adj,
  (SELECT coalesce(sum(amount_this_week), 0)
     FROM project_beme_progress
    WHERE weekly_report_id = (SELECT id FROM latest))            AS works_this_week,
  (SELECT sum(contract_amount) FROM project_beme_items
    WHERE project_id = $1::uuid)                                 AS scope,
  (SELECT sum(amount_this_week) FROM project_cost_report
    WHERE project_id = $1::uuid)                                 AS cost_stored,
  (SELECT sum(amount) FROM project_ledger_adjustments
    WHERE project_id = $1::uuid AND ledger = 'cost')             AS cost_adj,
  (SELECT coalesce(sum(amount_this_week), 0)
     FROM project_cost_report
    WHERE weekly_report_id = (SELECT id FROM latest))            AS cost_this_week,
  (SELECT row_to_json(p) FROM prev p)                            AS prev_week,
  (SELECT coalesce(sum(amount_this_week), 0)
     FROM project_beme_progress
    WHERE weekly_report_id = (SELECT id FROM prev))              AS works_prev_week,
  (SELECT coalesce(sum(amount_this_week), 0)
     FROM project_cost_report
    WHERE weekly_report_id = (SELECT id FROM prev))              AS cost_prev_week,
  (SELECT row_to_json(x) FROM (
     SELECT count(*)::int AS total, count(date_vetted)::int AS vetted
     FROM project_certificates WHERE project_id = $1::uuid) x)   AS certs,
  (SELECT gross_value_works_done FROM last_cert)                 AS cert_gross,
  (SELECT total_retention_held FROM last_cert)                   AS retention_held,
  (SELECT retention_released FROM last_cert)                     AS retention_released,
  (SELECT advance_recovery FROM last_cert)                       AS advance_recovery,
  (SELECT row_to_json(x) FROM (
     SELECT count(*)::int AS n, sum(gross_amount) AS gross,
            sum(net_amount) AS net,
            sum(gross_amount) FILTER (WHERE payment_type ILIKE '%advance%') AS advances,
            sum(gross_amount) FILTER (WHERE payment_type ILIKE '%cert%')    AS certs_paid
     FROM v_project_payments_latest WHERE project_id = $1::uuid) x) AS pay,
  (SELECT json_agg(row_to_json(x)
                   ORDER BY x.sort_order NULLS LAST, x.bill_code)
     FROM (
       SELECT c.bill_code, max(c.bill_name) AS name,
              max(c.sort_order) AS sort_order,
              -- sheet's own bill total (verbatim) beats Σ items, which
              -- can carry rows the sheet excludes from its bill total
              coalesce(max(bb.contract_amount),
                       sum(c.contract_amount)) AS beme_amount,
              sum(c.amount_done) AS to_date,
              coalesce(sum(tw.amt), 0) AS this_week,
              coalesce(sum(pv.amt), 0) AS last_week
       FROM v_project_beme_cumulative c
       LEFT JOIN project_beme_bills bb
         ON bb.project_id = c.project_id AND bb.bill_code = c.bill_code
       LEFT JOIN LATERAL (
         SELECT sum(p.amount_this_week) AS amt
         FROM project_beme_progress p
         WHERE p.item_id = c.item_id
           AND p.weekly_report_id = (SELECT id FROM latest)) tw ON true
       LEFT JOIN LATERAL (
         SELECT sum(p.amount_this_week) AS amt
         FROM project_beme_progress p
         WHERE p.item_id = c.item_id
           AND p.weekly_report_id = (SELECT id FROM prev)) pv ON true
       WHERE c.project_id = $1::uuid
       GROUP BY c.bill_code) x)                                  AS bills,
  (SELECT json_agg(row_to_json(x) ORDER BY x.to_date DESC)
     FROM (
       SELECT u.cat, sum(u.tw) AS this_week, sum(u.lw) AS last_week,
              sum(u.td) AS to_date
       FROM (
         SELECT coalesce(cost_category, 'Uncategorised') AS cat,
                coalesce(sum(amount_this_week) FILTER (
                  WHERE weekly_report_id = (SELECT id FROM latest)), 0) AS tw,
                coalesce(sum(amount_this_week) FILTER (
                  WHERE weekly_report_id = (SELECT id FROM prev)), 0) AS lw,
                coalesce(sum(amount_this_week), 0) AS td
         FROM project_cost_report
         WHERE project_id = $1::uuid GROUP BY 1
         UNION ALL
         SELECT coalesce(nullif(split_part(cost_key, '|', 2), ''),
                         'Uncategorised'),
                0, 0, coalesce(sum(amount), 0)
         FROM project_ledger_adjustments
         WHERE project_id = $1::uuid AND ledger = 'cost'
         GROUP BY 1
       ) u
       GROUP BY u.cat) x)                                        AS cost_categories,
  (SELECT row_to_json(x) FROM (
     SELECT coalesce(sum(manning_this_week)
              FILTER (WHERE department !~* 'casual'), 0)::int AS direct,
            coalesce(sum(manning_this_week)
              FILTER (WHERE department ~* 'casual'), 0)::int  AS casual
     FROM project_labour_strength
     WHERE weekly_report_id = (SELECT id FROM latest)) x)        AS labour,
  (SELECT coalesce(sum(
       coalesce(saturday_litres,0) + coalesce(sunday_litres,0)
     + coalesce(monday_litres,0) + coalesce(tuesday_litres,0)
     + coalesce(wednesday_litres,0) + coalesce(thursday_litres,0)
     + coalesce(friday_litres,0)), 0)
     FROM project_diesel_consumption
    WHERE weekly_report_id = (SELECT id FROM latest))            AS diesel_litres_week,
  (SELECT coalesce(sum(amount_this_week), 0)
     FROM project_cost_report
    WHERE weekly_report_id = (SELECT id FROM latest)
      AND cost_category ILIKE 'AGO')                             AS diesel_cost_week
"""


def _f(v: Any) -> float:
    return float(v) if v is not None else 0.0


def _fn(v: Any) -> float | None:
    return float(v) if v is not None else None


def _as_date(v: Any) -> date | None:
    if v is None:
        return None
    if isinstance(v, date):
        return v
    try:
        return datetime.strptime(str(v)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _tail_accrual(tail: dict) -> dict[str, float | None]:
    """Contingency + VOP accrual per column: subtotal₂ − subtotal₁.
    The ADD CONTINGENCY / ADD VOP rows carry blank to-date cells; the
    second SUB-TOTAL embeds the accrual (verified identity: grand_total
    == subtotal₂ × 1.075, and subtotal₂ − subtotal₁ == accrual)."""
    subs = tail.get("subtotals") or []
    if len(subs) >= 2:
        s1, s2 = subs[0], subs[-1]
        return {
            k: (_f(s2.get(k)) - _f(s1.get(k)))
            if s2.get(k) is not None or s1.get(k) is not None else None
            for k in ("contract", "this_week", "previous", "total")
        }
    cont = tail.get("contingency") or {}
    vop = tail.get("vop") or {}
    both = tail.get("contingency_vop_total") or {}
    contract = (_fn(both.get("contract"))
                if both.get("contract") is not None
                else (_f(cont.get("contract")) + _f(vop.get("contract"))
                      if cont or vop else None))
    return {"contract": contract, "this_week": None,
            "previous": None, "total": None}


async def compute_project_overview(project_id: str) -> dict[str, Any]:
    row = await fetchrow(_SQL, project_id)
    if row is None or row["project"] is None:
        return {}

    project = row["project"]
    latest = row["latest"]
    pay = row["pay"] or {}
    certs = row["certs"] or {}
    labour = row["labour"] or {}
    tail = (latest or {}).get("beme_tail") or {}

    contract = _f(project.get("current_contract_sum")) or _f(project.get("original_contract_sum"))
    scope_items = _f(row["scope"])
    tail_sub1 = (tail.get("subtotals") or [{}])[0]
    scope = _f(tail_sub1.get("contract")) or scope_items

    works = _f(row["works_stored"]) + _f(row["works_adj"])
    works_tw = _f(row["works_this_week"])
    costs = _f(row["cost_stored"]) + _f(row["cost_adj"])
    costs_tw = _f(row["cost_this_week"])

    earnings = round(works * VAT, 2)          # works incl VAT, excl contingency
    earnings_tw = round(works_tw * VAT, 2)

    accrual = _tail_accrual(tail)
    cont_beme = round(_f(accrual["contract"]) * VAT, 2) if accrual["contract"] is not None else None
    cont_tw = round(_f(accrual["this_week"]) * VAT, 2) if accrual["this_week"] is not None else None
    cont_td = round(_f(accrual["total"]) * VAT, 2) if accrual["total"] is not None else None
    grand = tail.get("grand_total") or {}

    has_prev = row["prev_week"] is not None
    works_lw = _f(row["works_prev_week"]) if has_prev else None
    costs_lw = _f(row["cost_prev_week"]) if has_prev else None
    earnings_lw = round(works_lw * VAT, 2) if works_lw is not None else None
    prev_tail = (row["prev_week"] or {}).get("beme_tail") or {}
    prev_accrual = _tail_accrual(prev_tail) if has_prev else {"this_week": None}
    cont_lw = (round(_f(prev_accrual["this_week"]) * VAT, 2)
               if has_prev and prev_accrual["this_week"] is not None else None)
    net_lw = (round(earnings_lw - costs_lw, 2)
              if earnings_lw is not None and costs_lw is not None else None)

    certified = _f(row["cert_gross"])          # ledger cumulative, as recorded
    paid_gross = _f(pay.get("gross"))
    advances = _f(pay.get("advances"))
    certs_paid = _f(pay.get("certs_paid"))
    adv_recovered = _f(row["advance_recovery"])

    net = round(earnings - costs, 2)
    net_tw = round(earnings_tw - costs_tw, 2)

    # ── schedule ────────────────────────────────────────────────────────
    report_date = _as_date((latest or {}).get("week_ending_date"))
    commence = _as_date(project.get("commencement_date"))
    completion = _as_date(project.get("revised_completion_date"))
    duration = _fn(project.get("original_duration_months"))
    if duration is None and commence and completion:
        duration = round((completion - commence).days / DAYS_PER_MONTH, 1)
    months_elapsed = (round((report_date - commence).days / DAYS_PER_MONTH, 1)
                      if report_date and commence else None)
    months_overdue = (round((report_date - completion).days / DAYS_PER_MONTH, 1)
                      if report_date and completion else None)

    bills = []
    for b in (row["bills"] or []):
        beme = _f(b.get("beme_amount"))
        td = _f(b.get("to_date"))
        bills.append({
            "bill_code": b.get("bill_code"),
            "name": b.get("name") or b.get("bill_code"),
            "beme_amount": beme,
            "this_week": _f(b.get("this_week")),
            "last_week": _f(b.get("last_week")) if has_prev else None,
            "to_date": td,
            "pct_complete": round(td / beme, 4) if beme else None,
        })

    cost_categories = [
        {"category": c["cat"], "this_week": _f(c.get("this_week")),
         "last_week": _f(c.get("last_week")) if has_prev else None,
         "to_date": _f(c.get("to_date")),
         "pct_of_total": round(_f(c.get("to_date")) / costs, 4) if costs else None}
        for c in (row["cost_categories"] or [])
        if _f(c.get("to_date")) != 0 or _f(c.get("this_week")) != 0
    ]

    return {
        "project": project,
        "latest_week": None if latest is None else {
            "year": latest["year"],
            "week_number": latest["week_number"],
            "week_ending_date": latest["week_ending_date"],
            "works_this_week": works_tw,
            "cost_this_week": costs_tw,
            # this week's contribution to overall completion
            "pct_added": round(works_tw / scope, 4) if scope else None,
        },
        "prev_week": None if not has_prev else {
            "year": row["prev_week"]["year"],
            "week_number": row["prev_week"]["week_number"],
            "week_ending_date": row["prev_week"]["week_ending_date"],
            "works_this_week": _f(row["works_prev_week"]),
            "cost_this_week": _f(row["cost_prev_week"]),
        },
        "headline": {
            "contract_sum": contract,
            "pct_complete": round(works / scope, 4) if scope else None,
            "certified_to_date": certified,
            "paid_gross": paid_gross,
            "cost_to_date": round(costs, 2),
            "net_margin_pct": round(net / earnings, 4) if earnings else None,
        },
        "schedule": {
            "client": project.get("client"),
            "award_date": project.get("award_date"),
            "commencement_date": project.get("commencement_date"),
            "revised_completion_date": project.get("revised_completion_date"),
            "duration_months": duration,
            "months_elapsed": months_elapsed,
            "months_overdue": months_overdue,
            "time_elapsed_pct": (round(months_elapsed / duration, 4)
                                 if months_elapsed is not None and duration
                                 else None),
            "status": ("overdue" if months_overdue is not None and months_overdue > 0
                       else "on_track" if report_date else None),
        },
        "physical": {
            "bills": bills,
            "ladder": {
                # every rung: beme (contract column), last_week, this_week, to_date
                "works": {"beme": scope or None, "this_week": works_tw,
                          "last_week": works_lw,
                          "to_date": round(works, 2)},
                "vat": {"beme": round(scope * (VAT - 1), 2) if scope else None,
                        "this_week": round(works_tw * (VAT - 1), 2),
                        "last_week": (round(works_lw * (VAT - 1), 2)
                                      if works_lw is not None else None),
                        "to_date": round(works * (VAT - 1), 2)},
                "works_incl_vat": {"beme": round(scope * VAT, 2) if scope else None,
                                   "this_week": earnings_tw,
                                   "last_week": earnings_lw,
                                   "to_date": earnings},
                "contingency_incl_vat": {"beme": cont_beme, "this_week": cont_tw,
                                         "last_week": cont_lw,
                                         "to_date": cont_td},
                "total_incl_contingency": {
                    "beme": _fn(grand.get("contract")) or (
                        round(scope * VAT + (cont_beme or 0), 2) if scope else None),
                    "this_week": round(earnings_tw + (cont_tw or 0), 2),
                    "last_week": (round(earnings_lw + (cont_lw or 0), 2)
                                  if earnings_lw is not None else None),
                    "to_date": round(earnings + (cont_td or 0), 2),
                },
            },
            # the sheet's own cumulative Sub-Total — cross-check vs ours
            "workbook_cumulative": _fn(tail_sub1.get("total")),
        },
        "certs_payments": {
            "certificates_total": certs.get("total") or 0,
            "certificates_vetted": certs.get("vetted") or 0,
            "certified_to_date": certified,
            "payments_gross": paid_gross,
            "payments_net": _f(pay.get("net")),
            "payments_count": pay.get("n") or 0,
            "certified_not_paid": round(certified - certs_paid, 2),
            "pct_certified_paid": (round(certs_paid / certified, 4)
                                   if certified else None),
            "advance_received": advances,
            "advance_recovered": adv_recovered,
            "advance_outstanding": round(advances - adv_recovered, 2),
            "retention_held": _f(row["retention_held"]),
            "retention_released": _f(row["retention_released"]),
        },
        "cost_profitability": {
            "categories": cost_categories,
            "total_this_week": costs_tw,
            "total_last_week": costs_lw,
            "total_to_date": round(costs, 2),
            "works_incl_vat_this_week": earnings_tw,
            "works_incl_vat_last_week": earnings_lw,
            "works_incl_vat_to_date": earnings,
            "net_this_week": net_tw,
            "net_last_week": net_lw,
            "net_to_date": net,
            "margin_this_week": (round(net_tw / earnings_tw, 4)
                                 if earnings_tw else None),
            "margin_last_week": (round(net_lw / earnings_lw, 4)
                                 if net_lw is not None and earnings_lw else None),
            "margin_to_date": round(net / earnings, 4) if earnings else None,
        },
        "resources": {
            "labour_direct": labour.get("direct") or 0,
            "labour_casual": labour.get("casual") or 0,
            "diesel_litres_week": _f(row["diesel_litres_week"]),
            "diesel_cost_week": _f(row["diesel_cost_week"]),
        },
        "progress": {
            "physical_pct": round(works / scope, 4) if scope else None,
            "commercial_pct": round(certified / contract, 4) if contract else None,
            "reported_pct": (_f(latest["beme_pct_complete"]) / 100.0
                             if latest and latest.get("beme_pct_complete") is not None
                             else None),
        },
    }
