"""Living Contract Summary — every Overview figure computed from the
ledgers and atomic weekly facts, per docs/WORKBOOK_ARITHMETIC.md.

Conventions (decision log §7):
  works to date   = Σ stored this-week + baseline/gap adjustments
                    (== the workbook's own cumulative, kobo-exact)
  earnings        = works × 1.075 (VAT only, no contingency)
  certified       = certificate ledger cumulative gross (× 1.075 incl VAT)
  paid            = latest payments ledger only (v_project_payments_latest)
  net earnings    = earnings − costs to date (Weekly Summary definition)
  WIP             = earnings − certified incl VAT
  physical %      = works ÷ BEME scope (Σ item contract amounts)

ONE query, one round trip: scalar subqueries + json_agg. Parallel
per-figure queries stampede the Supavisor pool; sequential ones stack
RTTs. All subqueries hit (project_id, …) indexes.
"""

from __future__ import annotations

from typing import Any

from app.core.pool import fetchrow

VAT = 1.075

_SQL = """
WITH latest AS (
    SELECT id, year, week_number, week_ending_date, beme_pct_complete
    FROM project_weekly_reports WHERE project_id = $1::uuid
    ORDER BY year DESC, week_number DESC LIMIT 1
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
            p.revised_completion_date, s.name AS state_name
     FROM projects p LEFT JOIN states s ON s.id = p.state_id
     WHERE p.id = $1::uuid) x)                                   AS project,
  (SELECT row_to_json(l) FROM latest l)                          AS latest,
  (SELECT sum(amount_this_week) FROM project_beme_progress
    WHERE project_id = $1::uuid)                                 AS works_stored,
  (SELECT sum(amount) FROM project_ledger_adjustments
    WHERE project_id = $1::uuid AND ledger = 'beme')             AS works_adj,
  (SELECT sum(contract_amount) FROM project_beme_items
    WHERE project_id = $1::uuid)                                 AS scope,
  (SELECT sum(amount_this_week) FROM project_cost_report
    WHERE project_id = $1::uuid)                                 AS cost_stored,
  (SELECT sum(amount) FROM project_ledger_adjustments
    WHERE project_id = $1::uuid AND ledger = 'cost')             AS cost_adj,
  (SELECT count(*) FROM project_certificates
    WHERE project_id = $1::uuid)::int                            AS cert_count,
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
  (SELECT row_to_json(x) FROM (
     SELECT count(*)::int AS total,
            count(*) FILTER (WHERE severity IN ('warning','error'))::int AS serious,
            count(*) FILTER (WHERE weekly_report_id = (SELECT id FROM latest))::int AS latest_week
     FROM project_sheet_flags WHERE project_id = $1::uuid) x)    AS flags,
  (SELECT json_agg(json_build_array(year, week_number) ORDER BY year, week_number)
     FROM project_weekly_reports WHERE project_id = $1::uuid)    AS stored_weeks,
  (SELECT json_agg(DISTINCT jsonb_build_array(
            covers_from_year, covers_from_week, covers_to_year, covers_to_week))
     FROM project_ledger_adjustments
    WHERE project_id = $1::uuid AND kind = 'gap')                AS gap_ranges,
  (SELECT count(DISTINCT u.fleet_number_raw) FROM (
      SELECT fleet_number_raw FROM project_plant_utilization
       WHERE project_id = $1::uuid AND plant_id IS NULL
      UNION ALL
      SELECT fleet_number_raw FROM project_diesel_consumption
       WHERE project_id = $1::uuid AND plant_id IS NULL
         AND NOT coalesce(is_cost_centre, false)) u
    WHERE u.fleet_number_raw IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM project_fleet_aliases a
        WHERE a.raw_normalized =
              upper(replace(trim(u.fleet_number_raw), ' ', ''))))::int AS fleet_unresolved,
  (SELECT json_agg(row_to_json(w)) FROM (
     SELECT wr.year, wr.week_number, wr.week_ending_date,
            (SELECT count(*)::int FROM project_sheet_flags f
              WHERE f.weekly_report_id = wr.id)                  AS flags,
            (SELECT coalesce(sum(bp.amount_this_week), 0)
               FROM project_beme_progress bp
              WHERE bp.weekly_report_id = wr.id)                 AS works_this_week,
            (SELECT coalesce(sum(cr.amount_this_week), 0)
               FROM project_cost_report cr
              WHERE cr.weekly_report_id = wr.id)                 AS cost_this_week,
            s.id AS submission_id
     FROM project_weekly_reports wr
     LEFT JOIN project_report_submissions s
       ON s.project_id = wr.project_id AND s.year = wr.year
      AND s.week_number = wr.week_number
     WHERE wr.project_id = $1::uuid
     ORDER BY wr.year DESC, wr.week_number DESC LIMIT 8) w)      AS recent_weeks
"""


def _f(v: Any) -> float:
    return float(v) if v is not None else 0.0


async def compute_project_overview(project_id: str) -> dict[str, Any]:
    row = await fetchrow(_SQL, project_id)
    if row is None or row["project"] is None:
        return {}

    project = row["project"]
    latest = row["latest"]
    pay = row["pay"] or {}
    flags = row["flags"] or {}

    contract = _f(project.get("current_contract_sum")) or _f(project.get("original_contract_sum"))
    scope = _f(row["scope"])
    works = _f(row["works_stored"]) + _f(row["works_adj"])
    costs = _f(row["cost_stored"]) + _f(row["cost_adj"])
    earnings = round(works * VAT, 2)
    certified = _f(row["cert_gross"])
    certified_incl_vat = round(certified * VAT, 2)
    paid_gross = _f(pay.get("gross"))
    net_earnings = round(earnings - costs, 2)
    advances = _f(pay.get("advances"))
    certs_paid = _f(pay.get("certs_paid"))

    # Missing weeks: holes inside the stored range, plus gap-adjustment
    # ranges. Weeks before the first stored week live in the baseline —
    # they are covered, not missing.
    stored = [(w[0], w[1]) for w in (row["stored_weeks"] or [])]
    missing: set[tuple[int, int]] = set()
    by_year: dict[int, list[int]] = {}
    for y, w in stored:
        by_year.setdefault(y, []).append(w)
    for y, ws in by_year.items():
        missing.update((y, w) for w in range(min(ws), max(ws)) if w not in set(ws))
    for g in (row["gap_ranges"] or []):
        y1, w1, y2, w2 = g[0], g[1], g[2] or g[0], g[3] or g[1]
        if y1 == y2:
            missing.update((y1, w) for w in range(w1, w2 + 1))
    missing -= set(stored)

    recent = row["recent_weeks"] or []

    return {
        "project": project,
        "latest_week": None if latest is None else {
            "year": latest["year"],
            "week_number": latest["week_number"],
            "week_ending_date": latest["week_ending_date"],
            "works_this_week": _f(recent[0]["works_this_week"]) if recent else 0,
            "cost_this_week": _f(recent[0]["cost_this_week"]) if recent else 0,
        },
        "ladder": {
            "contract_sum": contract,
            "beme_scope": scope,
            "works_to_date": round(works, 2),
            "earnings_to_date": earnings,
            "certified_ex_vat": certified,
            "certified_incl_vat": certified_incl_vat,
            "paid_gross": paid_gross,
            "paid_net": _f(pay.get("net")),
            "wip_incl_vat": round(earnings - certified_incl_vat, 2),
            "certified_not_paid": round(certified_incl_vat - paid_gross, 2),
        },
        "net_earnings": {
            "value": net_earnings,
            "pct": round(net_earnings / earnings, 4) if earnings else None,
            "earnings": earnings,
            "costs_to_date": round(costs, 2),
        },
        "progress": {
            "physical_pct": round(works / scope, 4) if scope else None,
            "commercial_pct": round(certified_incl_vat / contract, 4) if contract else None,
            "reported_pct": _f(latest["beme_pct_complete"])
                if latest and latest.get("beme_pct_complete") is not None else None,
        },
        "payment_status": {
            "count": pay.get("n") or 0,
            "advances": advances,
            "certs_paid": certs_paid,
            "on_account": round(paid_gross - advances - certs_paid, 2),
            "total_gross": paid_gross,
            "total_net": _f(pay.get("net")),
        },
        "certificates": {
            "count": row["cert_count"] or 0,
            "cumulative_gross": certified,
            "retention_held": _f(row["retention_held"]),
            "retention_released": _f(row["retention_released"]),
            "advance_recovery": _f(row["advance_recovery"]),
        },
        "alerts": {
            "scope_exceeds_contract": scope > contract > 0,
            "missing_weeks": sorted(missing),
            "flags_latest_week": flags.get("latest_week") or 0,
            "flags_serious": flags.get("serious") or 0,
            "flags_total": flags.get("total") or 0,
            "unresolved_fleet": row["fleet_unresolved"] or 0,
        },
        "recent_weeks": recent,
    }
