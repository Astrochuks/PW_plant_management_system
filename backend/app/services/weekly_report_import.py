"""Weekly-report persistence v2 — the locked parse spec (2026-07-08).

Facts stored:
  - this-week rows per sheet (delete-header-cascade replace = idempotent)
  - reported-previous per BEME item / cost row (baseline & gap inputs)
  - ledger adjustments (baseline + gap) — RECOMPUTED from stored data
    whenever the set of stored weeks changes, never frozen at ingest
  - sheet flags: cross-checks, staleness, variances (powers preview + audit)

Cross-check philosophy: the workbook's own totals are never data — we
recompute everything and record agreement/disagreement as flags.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

import asyncpg

from app.monitoring.logging import get_logger
from app.workers.etl_worker import normalize_fleet_number

logger = get_logger(__name__)


async def _resolve_fleet(
    conn: asyncpg.Connection, raw_numbers: list[str]
) -> tuple[dict[str, str], list[str]]:
    """{raw → plant_id} via normalized fleet numbers; unresolved raws listed.

    Resolution order: plants_master exact match, then the alias table
    (durable manual verdicts). An 'external' alias (hired vehicle,
    contractor kit) is neither resolved nor unresolved — the row keeps
    plant_id NULL and the number stays out of the review queue."""
    normalized: dict[str, list[str]] = {}
    for raw in raw_numbers:
        n = normalize_fleet_number(raw)
        if n:
            normalized.setdefault(n, []).append(raw)
    if not normalized:
        return {}, []

    rows = await conn.fetch(
        "SELECT id, fleet_number FROM plants_master WHERE fleet_number = ANY($1::text[])",
        list(normalized.keys()),
    )
    by_norm = {r["fleet_number"]: str(r["id"]) for r in rows}

    leftover = [n for n in normalized if n not in by_norm]
    aliases: dict[str, tuple[str, str | None]] = {}
    if leftover:
        alias_rows = await conn.fetch(
            """SELECT raw_normalized, kind, plant_id
               FROM project_fleet_aliases WHERE raw_normalized = ANY($1::text[])""",
            leftover,
        )
        aliases = {r["raw_normalized"]: (r["kind"], str(r["plant_id"]) if r["plant_id"] else None)
                   for r in alias_rows}

    resolved: dict[str, str] = {}
    unresolved: list[str] = []
    for norm_num, raws in normalized.items():
        for raw in raws:  # every raw spelling maps, not just the first
            if norm_num in by_norm:
                resolved[raw] = by_norm[norm_num]
            elif norm_num in aliases:
                kind, plant_id = aliases[norm_num]
                if kind == "plant":
                    resolved[raw] = plant_id
                # 'external': saved with NULL plant_id, not queued
            else:
                unresolved.append(raw)
    return resolved, unresolved


def _pct_from_summary(parsed: dict) -> float | None:
    """Overall physical % from the Weekly Summary totals row (0–100)."""
    for row in parsed["sheets"].get("Weekly Summary", {}).get("rows", []):
        if (
            row["metric"] == "pct_complete"
            and row["item"].lower().startswith("total works completed")
        ):
            v = row["value"]
            return round(v * 100, 2) if v <= 1.5 else round(v, 2)
    return None


def _rows_hash(rows: Any) -> str:
    """Stable content hash for stale-copy detection."""
    return hashlib.sha256(
        json.dumps(rows, sort_keys=True, default=str).encode()
    ).hexdigest()


def _item_key(r: dict) -> tuple:
    return (r["bill_code"], r["item_code"] or "", r["description"], r.get("dup_seq", 0))


def _cost_key(r: dict) -> str:
    return f"{r.get('section') or ''}|{r.get('cost_category') or ''}|{r['description']}"


# ═══════════════════════════════════════════════════════════════════════
# Adjustments: baseline + gap facts, recomputed from stored data
# ═══════════════════════════════════════════════════════════════════════

async def recompute_adjustments(
    conn: asyncpg.Connection, project_id: str
) -> dict[str, Any]:
    """Derive baseline + gap facts for BEME and Cost ledgers from the
    stored reported-previous columns. Pure function of stored weeks:
    uploading a missing week later automatically dissolves its gap.

    Also flags chain breaks: ADJACENT weeks whose reported-previous
    disagrees with our cumulative (a site inconsistency, not a gap).
    """
    stats = {"baseline": 0, "gap": 0, "chain_breaks": 0}
    await conn.execute(
        "DELETE FROM project_ledger_adjustments WHERE project_id = $1::uuid",
        project_id,
    )

    reports = await conn.fetch(
        """SELECT id, year, week_number FROM project_weekly_reports
           WHERE project_id = $1::uuid ORDER BY year, week_number""",
        project_id,
    )
    if not reports:
        return stats

    def adjacent(prev, cur) -> bool:
        return prev["year"] == cur["year"] and cur["week_number"] == prev["week_number"] + 1

    chain_flags: list[tuple] = []

    # ── BEME ledger ─────────────────────────────────────────────────────
    prog = await conn.fetch(
        """SELECT p.weekly_report_id, p.item_id, p.year, p.week_number,
                  p.qty_this_week, p.amount_this_week,
                  p.qty_previous_reported, p.amount_previous_reported
           FROM project_beme_progress p
           WHERE p.project_id = $1::uuid
           ORDER BY p.year, p.week_number""",
        project_id,
    )
    by_report: dict[str, list] = {}
    for r in prog:
        by_report.setdefault(str(r["weekly_report_id"]), []).append(r)

    beme_adj: list[tuple] = []
    cum: dict[str, tuple[float, float]] = {}  # item_id → (qty, amount)
    prev_report = None
    for rep in reports:
        rid = str(rep["id"])
        rows = by_report.get(rid, [])
        if not rows:
            prev_report = rep
            continue
        if prev_report is None or not cum:
            # earliest stored week: its reported-previous IS the baseline
            for r in rows:
                q = float(r["qty_previous_reported"] or 0)
                a = float(r["amount_previous_reported"] or 0)
                if q or a:
                    beme_adj.append((
                        project_id, "beme", "baseline", str(r["item_id"]), None,
                        None, None, rep["year"], rep["week_number"], q, a, rid,
                    ))
                cum[str(r["item_id"])] = (
                    q + float(r["qty_this_week"] or 0),
                    a + float(r["amount_this_week"] or 0),
                )
        else:
            is_adj = adjacent(prev_report, rep)
            for r in rows:
                iid = str(r["item_id"])
                got_q, got_a = cum.get(iid, (0.0, 0.0))
                rep_q = float(r["qty_previous_reported"] or 0)
                rep_a = float(r["amount_previous_reported"] or 0)
                dq, da = rep_q - got_q, rep_a - got_a
                if abs(da) > 1.0 or abs(dq) > 0.01:
                    if is_adj:
                        chain_flags.append((
                            rid, project_id, "BEME & Works Completed Fd",
                            "chain_break", "warning",
                            f"item reported-previous ₦{rep_a:,.2f} != our "
                            f"cumulative ₦{got_a:,.2f} with no missing weeks",
                            {"item_id": iid, "delta": round(da, 2)},
                        ))
                        stats["chain_breaks"] += 1
                    else:
                        beme_adj.append((
                            project_id, "beme", "gap", iid, None,
                            prev_report["year"], prev_report["week_number"],
                            rep["year"], rep["week_number"], dq, da, rid,
                        ))
                cum[iid] = (rep_q + float(r["qty_this_week"] or 0),
                            rep_a + float(r["amount_this_week"] or 0))
        prev_report = rep

    # ── Cost ledger (amounts only) ──────────────────────────────────────
    cost = await conn.fetch(
        """SELECT weekly_report_id, year, week_number, section, cost_category,
                  description, amount_previous_week, amount_this_week
           FROM project_cost_report
           WHERE project_id = $1::uuid
           ORDER BY year, week_number""",
        project_id,
    )
    cost_by_report: dict[str, list] = {}
    for r in cost:
        cost_by_report.setdefault(str(r["weekly_report_id"]), []).append(r)

    cum_c: dict[str, float] = {}
    prev_report = None
    for rep in reports:
        rid = str(rep["id"])
        rows = cost_by_report.get(rid, [])
        if not rows:
            prev_report = rep
            continue
        first = prev_report is None or not cum_c
        is_adj = prev_report is not None and adjacent(prev_report, rep)
        for r in rows:
            ck = _cost_key({"section": r["section"],
                            "cost_category": r["cost_category"],
                            "description": r["description"]})
            rep_a = float(r["amount_previous_week"] or 0)
            if first:
                if rep_a:
                    beme_adj.append((
                        project_id, "cost", "baseline", None, ck,
                        None, None, rep["year"], rep["week_number"], None, rep_a, rid,
                    ))
            else:
                got_a = cum_c.get(ck, 0.0)
                da = rep_a - got_a
                if abs(da) > 1.0:
                    if is_adj:
                        chain_flags.append((
                            rid, project_id, "Cost Report", "chain_break",
                            "warning",
                            f"{r['description'][:40]!r} reported-previous "
                            f"₦{rep_a:,.2f} != our cumulative ₦{got_a:,.2f} "
                            f"with no missing weeks",
                            {"cost_key": ck, "delta": round(da, 2)},
                        ))
                        stats["chain_breaks"] += 1
                    else:
                        beme_adj.append((
                            project_id, "cost", "gap", None, ck,
                            prev_report["year"], prev_report["week_number"],
                            rep["year"], rep["week_number"], None, da, rid,
                        ))
            cum_c[ck] = rep_a + float(r["amount_this_week"] or 0)
        prev_report = rep

    if beme_adj:
        await conn.executemany(
            """INSERT INTO project_ledger_adjustments
               (project_id, ledger, kind, beme_item_id, cost_key,
                covers_from_year, covers_from_week, covers_to_year,
                covers_to_week, qty, amount, derived_from_report)
               VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6, $7, $8, $9, $10, $11,
                       $12::uuid)""",
            beme_adj, timeout=120,
        )
    if chain_flags:
        await conn.executemany(
            """INSERT INTO project_sheet_flags
               (weekly_report_id, project_id, sheet_name, flag_type,
                severity, message, detail)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)""",
            chain_flags, timeout=60,
        )
    stats["baseline"] = sum(1 for a in beme_adj if a[2] == "baseline")
    stats["gap"] = sum(1 for a in beme_adj if a[2] == "gap")
    return stats


# ═══════════════════════════════════════════════════════════════════════
# Main persist
# ═══════════════════════════════════════════════════════════════════════

async def persist_weekly_report(
    conn: asyncpg.Connection,
    project_id: str,
    year: int,
    week_number: int,
    parsed: dict[str, Any],
    user_id: str,
) -> dict[str, Any]:
    """Persist one parsed workbook for (project, year, week). Returns stats."""
    sheets = parsed["sheets"]
    warnings: list[str] = []
    counts: dict[str, int] = {}
    flags: list[tuple] = []  # (sheet, flag_type, severity, message, detail)

    def sheet_rows(name: str) -> list[dict]:
        return sheets.get(name, {}).get("rows", []) or []

    def flag(sheet: str, ftype: str, severity: str, message: str,
             detail: dict | None = None) -> None:
        flags.append((sheet, ftype, severity, message, detail or None))

    # Week-ending date: the workbook's own calendar is the authority
    week_endings = sheets.get("Lists", {}).get("week_endings", {}) or {}
    week_ending = week_endings.get((year, week_number))
    if week_ending is None:
        warnings.append(
            f"Lists calendar has no entry for {year}-W{week_number}; "
            "using computed fallback"
        )
        from datetime import date, timedelta
        jan1 = date(year, 1, 1)
        week_ending = jan1 + timedelta(days=(week_number * 7) - jan1.weekday() - 3)

    plant_rows = sheet_rows("Plant Return")
    diesel_rows = sheet_rows("Diesel Consumption")
    cost_rows = sheet_rows("Cost Report")
    beme_rows = sheet_rows("BEME & Works Completed Fd")

    # sheet content hashes for stale-copy detection
    day_cols = ("saturday_litres", "sunday_litres", "monday_litres",
                "tuesday_litres", "wednesday_litres", "thursday_litres",
                "friday_litres")
    sheet_hashes = {
        "Diesel Consumption": _rows_hash(
            [(r["fleet_number_raw"], *(r[c] for c in day_cols)) for r in diesel_rows]
        ),
        "Plant Return:standby": _rows_hash(
            [(r["fleet_number_raw"], r["standby_hours"]) for r in plant_rows]
        ),
        "Plant Return:breakdown": _rows_hash(
            [(r["fleet_number_raw"], r["breakdown_hours"]) for r in plant_rows]
        ),
    }

    async with conn.transaction():
        # ── previous stored week (for staleness comparison) — must be read
        # BEFORE the delete below in case this is a re-upload of that week
        prev_hashes_row = await conn.fetchrow(
            """SELECT sheet_hashes, year, week_number FROM project_weekly_reports
               WHERE project_id = $1::uuid
                 AND (year, week_number) < ($2, $3)
               ORDER BY year DESC, week_number DESC LIMIT 1""",
            project_id, year, week_number,
        )

        # ── idempotent replace: kill the previous header, cascade children
        await conn.execute(
            """DELETE FROM project_weekly_reports
               WHERE project_id = $1::uuid AND year = $2 AND week_number = $3""",
            project_id, year, week_number,
        )

        report_id = str(await conn.fetchval(
            """INSERT INTO project_weekly_reports
               (project_id, year, week_number, week_ending_date, status,
                submitted_by, beme_pct_complete, sheets_processed, sheet_hashes,
                beme_tail)
               VALUES ($1::uuid, $2, $3, $4, 'completed', $5::uuid, $6,
                       $7::jsonb, $8::jsonb, $9::jsonb)
               RETURNING id""",
            project_id, year, week_number, week_ending, user_id,
            _pct_from_summary(parsed),
            {n: s["status"] for n, s in sheets.items()},
            sheet_hashes,
            sheets.get("BEME & Works Completed Fd", {}).get("tail") or None,
        ))

        # ── fleet resolution across plant + diesel sheets ────────────────
        all_fleet = [r["fleet_number_raw"] for r in plant_rows] + [
            r["fleet_number_raw"] for r in diesel_rows if not r.get("is_cost_centre")
        ]
        fleet_map, unresolved = await _resolve_fleet(conn, all_fleet)
        if unresolved:
            warnings.append(
                f"{len(set(unresolved))} fleet numbers not in plants_master: "
                + ", ".join(sorted(set(unresolved))[:10])
            )

        base = (report_id, project_id, year, week_number, week_ending)

        # ── plant utilization (full roster incl. idle) ───────────────────
        await conn.executemany(
            """INSERT INTO project_plant_utilization
               (weekly_report_id, project_id, year, week_number, week_ending_date,
                fleet_number_raw, plant_id, description, plant_category,
                hours_worked, standby_hours, breakdown_hours, rate_ngn,
                plant_cost, transferred_from, current_location, remarks)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5,
                       $6, $7::uuid, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)""",
            [
                (*base, r["fleet_number_raw"], fleet_map.get(r["fleet_number_raw"]),
                 r["description"], r["plant_category"], r["hours_worked"],
                 r["standby_hours"], r["breakdown_hours"], r["rate_ngn"],
                 r["plant_cost"], r["transferred_from"], r["current_location"],
                 r["remarks"])
                for r in plant_rows
            ],
            timeout=120,
        )
        counts["project_plant_utilization"] = len(plant_rows)

        # ── diesel (fuel events only) ────────────────────────────────────
        await conn.executemany(
            """INSERT INTO project_diesel_consumption
               (weekly_report_id, project_id, year, week_number, week_ending_date,
                fleet_number_raw, plant_id, description, plant_category,
                saturday_litres, sunday_litres, monday_litres, tuesday_litres,
                wednesday_litres, thursday_litres, friday_litres,
                amount_ngn, is_cost_centre)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9,
                       $10, $11, $12, $13, $14, $15, $16, $17, $18)""",
            [
                (*base, r["fleet_number_raw"],
                 None if r["is_cost_centre"] else fleet_map.get(r["fleet_number_raw"]),
                 r["description"], r["plant_category"],
                 r["saturday_litres"], r["sunday_litres"], r["monday_litres"],
                 r["tuesday_litres"], r["wednesday_litres"], r["thursday_litres"],
                 r["friday_litres"], r["amount_ngn"], r["is_cost_centre"])
                for r in diesel_rows
            ],
            timeout=120,
        )
        counts["project_diesel_consumption"] = len(diesel_rows)

        # ── cost report (category rows; total row is a cross-check) ─────
        await conn.executemany(
            """INSERT INTO project_cost_report
               (weekly_report_id, project_id, year, week_number, week_ending_date,
                section, description, cost_category, unit, quantity_this_week,
                rate_ngn, amount_previous_week, amount_this_week)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10,
                       $11, $12, $13)""",
            [
                (*base, r["section"], r["description"], r["cost_category"],
                 r["unit"], r["quantity_this_week"], r["rate_ngn"],
                 r["amount_previous_week"], r["amount_this_week"])
                for r in cost_rows
            ],
            timeout=120,
        )
        counts["project_cost_report"] = len(cost_rows)

        cost_sheet_total = sheets.get("Cost Report", {}).get("sheet_total") or {}
        if cost_sheet_total.get("this_week") is not None:
            ours = sum(float(r["amount_this_week"] or 0)
                       for r in cost_rows if r["cost_category"])
            delta = ours - float(cost_sheet_total["this_week"])
            if abs(delta) > 1.0:
                flag("Cost Report", "cross_check_fail", "error",
                     f"our categorized sum ₦{ours:,.2f} != sheet total "
                     f"₦{float(cost_sheet_total['this_week']):,.2f}",
                     {"delta": round(delta, 2)})
            else:
                flag("Cost Report", "cross_check_pass", "info",
                     f"cost total reconciles: ₦{ours:,.2f}")

        # ── certificates: ledger upsert by (project, cert_number) ────────
        cert_rows = sheet_rows("Certificate Status")
        for r in cert_rows:
            await conn.execute(
                """INSERT INTO project_certificates
                   (weekly_report_id, project_id, cert_number, date_submitted,
                    gross_value_works_done, add_materials_on_site,
                    less_materials_on_site, general_bill_1,
                    total_value_of_work_done, value_of_works_per_cert,
                    total_retention_held, total_net_payment,
                    retention_released, contingency_used, contingency_deducted,
                    fluctuation_materials, advance_received,
                    total_works_executed, advance_recovery,
                    new_total, less_previously_certified)
                   VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10,
                           $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                   ON CONFLICT (project_id, cert_number) DO UPDATE SET
                       weekly_report_id = EXCLUDED.weekly_report_id,
                       date_submitted = COALESCE(EXCLUDED.date_submitted,
                                                 project_certificates.date_submitted),
                       gross_value_works_done = EXCLUDED.gross_value_works_done,
                       add_materials_on_site = EXCLUDED.add_materials_on_site,
                       less_materials_on_site = EXCLUDED.less_materials_on_site,
                       general_bill_1 = EXCLUDED.general_bill_1,
                       total_value_of_work_done = EXCLUDED.total_value_of_work_done,
                       value_of_works_per_cert = EXCLUDED.value_of_works_per_cert,
                       total_retention_held = EXCLUDED.total_retention_held,
                       total_net_payment = EXCLUDED.total_net_payment,
                       retention_released = EXCLUDED.retention_released,
                       contingency_used = EXCLUDED.contingency_used,
                       contingency_deducted = EXCLUDED.contingency_deducted,
                       fluctuation_materials = EXCLUDED.fluctuation_materials,
                       advance_received = EXCLUDED.advance_received,
                       total_works_executed = EXCLUDED.total_works_executed,
                       advance_recovery = EXCLUDED.advance_recovery,
                       new_total = EXCLUDED.new_total,
                       less_previously_certified = EXCLUDED.less_previously_certified,
                       updated_at = now()""",
                report_id, project_id, r["cert_number"], r["date_submitted"],
                r["gross_value_works_done"], r["add_materials_on_site"],
                r["less_materials_on_site"], r["general_bill_1"],
                r["total_value_of_work_done"], r["value_of_works_per_cert"],
                r["total_retention_held"], r["total_net_payment"],
                r.get("retention_released"), r.get("contingency_used"),
                r.get("contingency_deducted"), r.get("fluctuation_materials"),
                r.get("advance_received"), r.get("total_works_executed"),
                r.get("advance_recovery"), r.get("new_total"),
                r.get("less_previously_certified"),
            )
        counts["project_certificates"] = len(cert_rows)

        # Contract Summary's client-position block is frozen (~2023) — flag
        # whenever its certified figure disagrees with the cert ledger
        if cert_rows:
            ledger_certified = max(
                float(r["gross_value_works_done"] or 0) for r in cert_rows)
            snap = (parsed["sheets"].get("Contract Summary", {})
                    .get("snapshot") or {})
            snap_certified = snap.get("works_certified")
            if snap_certified is not None and ledger_certified > 0:
                drift = abs(float(snap_certified) - ledger_certified)
                if drift > ledger_certified * 0.05:
                    flag("Contract Summary", "cross_check_fail", "warning",
                         f"client-position block appears STALE: works "
                         f"certified ₦{float(snap_certified):,.2f} vs cert "
                         f"ledger cumulative ₦{ledger_certified:,.2f} — "
                         f"overview uses the ledger",
                         {"snapshot": float(snap_certified),
                          "ledger": ledger_certified})

        # ── payments: full ledger per report (readers use latest report) ─
        all_pay_rows = sheet_rows("Payments Recieved")
        pay_rows = [
            r for r in all_pay_rows
            if r["payment_date"] is not None
            or r["payment_type"] is not None
            or r["voucher_number"] is not None
        ]
        total_rows = [r for r in all_pay_rows if r not in pay_rows]
        if total_rows:
            sheet_total = max(
                (float(r["gross_amount"] or 0) for r in total_rows), default=0.0
            )
            recomputed = sum(float(r["gross_amount"] or 0) for r in pay_rows)
            if sheet_total and abs(sheet_total - recomputed) > 1.0:
                flag("Payments Recieved", "cross_check_fail", "warning",
                     f"sheet total ₦{sheet_total:,.2f} != sum of rows "
                     f"₦{recomputed:,.2f}")
        await conn.executemany(
            """INSERT INTO project_payments
               (weekly_report_id, project_id, payment_date, voucher_number,
                payment_type, gross_amount, wht, vat, vetting_fee, stamp_duty,
                other_deductions, net_amount)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)""",
            [
                (report_id, project_id, r["payment_date"], r["voucher_number"],
                 r["payment_type"], r["gross_amount"], r["wht"], r["vat"],
                 r["vetting_fee"], r["stamp_duty"], r["other_deductions"],
                 r["net_amount"])
                for r in pay_rows
            ],
            timeout=120,
        )
        counts["project_payments"] = len(pay_rows)

        # ── BEME: bills + items upserted once; progress per report ───────
        beme_sheet = sheets.get("BEME & Works Completed Fd", {})
        bill_ids: dict[str, str] = {}
        for b in beme_sheet.get("bills", []) or []:
            bill_ids[b["bill_code"]] = str(await conn.fetchval(
                """INSERT INTO project_beme_bills (project_id, bill_code,
                                                   bill_no, sort_order, name,
                                                   contract_amount)
                   VALUES ($1::uuid, $2, $3, $4, $5, $6)
                   ON CONFLICT (project_id, bill_code) DO UPDATE SET
                       name = COALESCE(EXCLUDED.name, project_beme_bills.name),
                       bill_no = COALESCE(EXCLUDED.bill_no,
                                          project_beme_bills.bill_no),
                       sort_order = COALESCE(EXCLUDED.sort_order,
                                             project_beme_bills.sort_order),
                       contract_amount = COALESCE(EXCLUDED.contract_amount,
                                                  project_beme_bills.contract_amount)
                   RETURNING id""",
                project_id, b["bill_code"], b.get("bill_no"),
                b.get("sort_order"), b["name"], b["sheet_total_contract"],
            ))
        # defensive: items referencing a bill without a header row
        for bill_code in sorted({r["bill_code"] for r in beme_rows} - set(bill_ids)):
            bill_ids[bill_code] = str(await conn.fetchval(
                """INSERT INTO project_beme_bills (project_id, bill_code)
                   VALUES ($1::uuid, $2)
                   ON CONFLICT (project_id, bill_code) DO UPDATE SET
                       bill_code = EXCLUDED.bill_code
                   RETURNING id""",
                project_id, bill_code,
            ))

        await conn.executemany(
            """INSERT INTO project_beme_items
               (project_id, bill_id, item_code, description, unit,
                contract_qty, rate, contract_amount, dup_seq)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (bill_id, item_code, description, dup_seq) DO UPDATE SET
                   contract_qty = COALESCE(EXCLUDED.contract_qty,
                                           project_beme_items.contract_qty),
                   rate = COALESCE(EXCLUDED.rate, project_beme_items.rate),
                   contract_amount = COALESCE(EXCLUDED.contract_amount,
                                              project_beme_items.contract_amount)""",
            [
                (project_id, bill_ids[r["bill_code"]], r["item_code"] or "",
                 r["description"], r["unit"], r["contract_qty"], r["rate"],
                 r["contract_amount"], r.get("dup_seq", 0))
                for r in beme_rows
            ],
            timeout=120,
        )
        item_id_map = {
            (r["bill_code"], r["item_code"], r["description"], r["dup_seq"]): str(r["id"])
            for r in await conn.fetch(
                """SELECT i.id, b.bill_code, i.item_code, i.description, i.dup_seq
                   FROM project_beme_items i
                   JOIN project_beme_bills b ON b.id = i.bill_id
                   WHERE i.project_id = $1::uuid""",
                project_id, timeout=60,
            )
        }
        await conn.executemany(
            """INSERT INTO project_beme_progress
               (weekly_report_id, project_id, item_id, year, week_number,
                week_ending_date, qty_this_week, amount_this_week,
                qty_previous_reported, amount_previous_reported)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10)""",
            [
                (report_id, project_id, item_id_map[_item_key(r)], year,
                 week_number, week_ending, r["qty_this_week"],
                 r["amount_this_week"], r["qty_previous_reported"],
                 r["amount_previous_reported"])
                for r in beme_rows
            ],
            timeout=120,
        )
        counts["project_beme_progress"] = len(beme_rows)

        # BEME cross-checks from the parser (broken sheet SUMs etc.)
        for c in beme_sheet.get("cross_checks", []) or []:
            flag("BEME & Works Completed Fd", "cross_check_fail", "warning",
                 f"{c['check']}: our sum {c['ours']:,.2f} != sheet "
                 f"{c['sheet']:,.2f}", c)

        # works vs Weekly Summary (their own rollup) — verification only
        works_ours = sum(float(r["amount_this_week"] or 0) for r in beme_rows)
        ws_subtotal = next(
            (r["value"] for r in sheet_rows("Weekly Summary")
             if r["section"] == "Works Completed" and r["item"] == "SUB-TOTAL"
             and r["metric"] == "this_week"),
            None,
        )
        if ws_subtotal is not None:
            if abs(works_ours - float(ws_subtotal)) > 1.0:
                flag("BEME & Works Completed Fd", "cross_check_fail", "warning",
                     f"BEME works this week ₦{works_ours:,.2f} != Weekly "
                     f"Summary ₦{float(ws_subtotal):,.2f}")
            else:
                flag("BEME & Works Completed Fd", "cross_check_pass", "info",
                     f"works reconcile with Weekly Summary: ₦{works_ours:,.2f}")

        # ── weekly summary (cross-check evidence, never a KPI source) ────
        ws_rows = sheet_rows("Weekly Summary")
        await conn.executemany(
            """INSERT INTO project_weekly_summary
               (weekly_report_id, project_id, year, week_number, week_ending_date,
                section, item, metric, value, raw_value)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10)""",
            [
                (*base, r["section"], r["item"], r["metric"], r["value"],
                 r["raw_value"])
                for r in ws_rows
            ],
            timeout=60,
        )
        counts["project_weekly_summary"] = len(ws_rows)

        # ── promotions (dossiers 9-13): hired / labour / subs / materials ─
        hv_rows = sheet_rows("Hired Vehicles")
        await conn.executemany(
            """INSERT INTO project_hired_vehicles
               (weekly_report_id, project_id, year, week_number, week_ending_date,
                registration_no, description, section, owners, days_worked,
                rate_ngn, amount_ngn, remarks)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10,
                       $11, $12, $13)""",
            [
                (*base, r["registration_no"], r["description"], r["section"],
                 r["owners"], r["days_worked"], r["rate_ngn"], r["amount_ngn"],
                 r["remarks"])
                for r in hv_rows
            ],
            timeout=60,
        )
        counts["project_hired_vehicles"] = len(hv_rows)

        lab_rows = sheet_rows("Labour Strength")
        await conn.executemany(
            """INSERT INTO project_labour_strength
               (weekly_report_id, project_id, year, week_number, week_ending_date,
                block, dept_slot, department, manning_this_week,
                manning_previous_week, movement, comment)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10,
                       $11, $12)""",
            [
                (*base, r["block"], r["dept_slot"], r["department"],
                 r["manning_this_week"], r["manning_previous_week"],
                 r["movement"], r["comment"])
                for r in lab_rows
            ],
            timeout=60,
        )
        counts["project_labour_strength"] = len(lab_rows)

        sub_rows = sheet_rows("Subcontractors")
        await conn.executemany(
            """INSERT INTO project_subcontractors
               (weekly_report_id, project_id, year, week_number, week_ending_date,
                subcontractor_name, description, location, unit, agreed_rate,
                assigned_qty, previous_qty, qty_this_week, qty_to_date,
                amount_this_week, value_previous, amount_to_date,
                balance_remaining, value_to_completion, remarks)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10,
                       $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)""",
            [
                (*base, r["subcontractor_name"], r["description"], r["location"],
                 r["unit"], r["agreed_rate"], r["assigned_qty"],
                 r["previous_qty"], r["qty_this_week"], r["qty_to_date"],
                 r["amount_this_week"], r["value_previous"], r["amount_to_date"],
                 r["balance_remaining"], r["value_to_completion"], r["remarks"])
                for r in sub_rows
            ],
            timeout=60,
        )
        counts["project_subcontractors"] = len(sub_rows)

        mat_rows = sheet_rows("Materials & Civils")
        await conn.executemany(
            """INSERT INTO project_materials_stock
               (weekly_report_id, project_id, year, week_number, week_ending_date,
                sheet_source, material_name, unit, unit_cost, opening_stock,
                received, closing_stock, available_for_use, used_works,
                used_precast, used_mobilisation, used_other, used,
                variance_qty, variance_value, discrepancy_qty,
                discrepancy_value, stock_maintained, remarks)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10,
                       $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
                       $22, $23, $24)""",
            [
                (*base, r["sheet_source"], r["material_name"], r["unit"],
                 r["unit_cost"], r["opening_stock"], r["received"],
                 r["closing_stock"], r["available_for_use"], r["used_works"],
                 r["used_precast"], r["used_mobilisation"], r.get("used_other"),
                 r["used"], r.get("variance_qty"), r.get("variance_value"),
                 r["discrepancy_qty"], r["discrepancy_value"],
                 r["stock_maintained"], r["remarks"])
                for r in mat_rows
            ],
            timeout=60,
        )
        counts["project_materials_stock"] = len(mat_rows)

        # ── contract snapshot (overview fields) ──────────────────────────
        snap = sheets.get("Contract Summary", {}).get("snapshot") or {}
        await conn.execute(
            """INSERT INTO project_contract_summary_snapshot
               (weekly_report_id, project_id, year, week_number, week_ending_date,
                original_contract_amount, current_contract_amount,
                works_certified, retention_held, advance_unrecovered, apg_expiry,
                client_name, contract_name, short_name, award_date,
                commencement_date, original_duration_months,
                eot_requested_months, eot_granted_months,
                revised_duration_months, overdue_weeks,
                works_submitted_not_vetted, total_works_submitted,
                retention_released, advance_recovered, gross_certified,
                apg_amount, bill1_requested, bill1_paid, bill1_outstanding)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                       $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
                       $23, $24, $25, $26, $27, $28, $29, $30)""",
            *base, snap.get("original_contract_amount"),
            snap.get("current_contract_amount"), snap.get("works_certified"),
            snap.get("retention_held"), snap.get("advance_unrecovered"),
            snap.get("apg_expiry"), snap.get("client_name"),
            snap.get("contract_name"), snap.get("short_name"),
            snap.get("award_date"), snap.get("commencement_date"),
            snap.get("original_duration_months"),
            snap.get("eot_requested_months"), snap.get("eot_granted_months"),
            snap.get("revised_duration_months"), snap.get("overdue_weeks"),
            snap.get("works_submitted_not_vetted"),
            snap.get("total_works_submitted"), snap.get("retention_released"),
            snap.get("advance_recovered"), snap.get("gross_certified"),
            snap.get("apg_amount"), snap.get("bill1_requested"),
            snap.get("bill1_paid"), snap.get("bill1_outstanding"),
        )
        counts["project_contract_summary_snapshot"] = 1

        # ── reference lists (once; conflict-free) ────────────────────────
        ref = sheets.get("Lists", {}).get("reference", []) or []
        await conn.executemany(
            """INSERT INTO project_reference_lists (list_name, item, detail, sort_order)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (list_name, item) DO NOTHING""",
            [(r["list_name"], r["item"], r["detail"], r["sort_order"]) for r in ref],
            timeout=60,
        )

        # ── cross-sheet checks → flags ───────────────────────────────────
        # 1. Plant Return footer → Cost Report "Plant Internal"
        footer = sheets.get("Plant Return", {}).get("footer") or {}
        plant_internal = next(
            (float(r["amount_this_week"] or 0) for r in cost_rows
             if r["description"] and "plant internal" in r["description"].lower()),
            None,
        )
        if footer.get("total_all") is not None and plant_internal is not None:
            adjustments = sum(float(a["amount"] or 0)
                              for a in footer.get("adjustments", []))
            net = float(footer["total_all"]) - adjustments
            if abs(net - plant_internal) > 1.0:
                flag("Plant Return", "cross_check_fail", "warning",
                     f"footer net (₦{float(footer['total_all']):,.2f} − "
                     f"consumables ₦{adjustments:,.2f} = ₦{net:,.2f}) != "
                     f"Cost Report Plant Internal ₦{plant_internal:,.2f}")
            else:
                flag("Plant Return", "cross_check_pass", "info",
                     f"footer reconciles with Cost Report Plant Internal: "
                     f"₦{plant_internal:,.2f}")

        # 2. diesel variance: litres charged (Cost Report) vs logged (events)
        ago_row = next(
            (r for r in cost_rows
             if r["description"] == "Diesel" and r["cost_category"] == "AGO"),
            None,
        )
        logged = sum(
            sum(float(r[c] or 0) for c in day_cols) for r in diesel_rows
        )
        if ago_row and ago_row.get("quantity_this_week") is not None:
            charged = float(ago_row["quantity_this_week"])
            if charged:
                coverage = logged / charged * 100
                flag("Diesel Consumption", "variance",
                     "warning" if abs(charged - logged) > charged * 0.25 else "info",
                     f"charged {charged:g}L (Cost Report) vs logged {logged:g}L "
                     f"(consumption log) — attribution coverage {coverage:.0f}%",
                     {"charged": charged, "logged": logged})

        # 3. stale-copy detection vs previous stored week
        if prev_hashes_row and prev_hashes_row["sheet_hashes"]:
            prev_hashes = prev_hashes_row["sheet_hashes"]
            if isinstance(prev_hashes, str):
                prev_hashes = json.loads(prev_hashes)
            prev_label = (f"{prev_hashes_row['year']}-W"
                          f"{prev_hashes_row['week_number']:02d}")
            if diesel_rows and prev_hashes.get("Diesel Consumption") == \
                    sheet_hashes["Diesel Consumption"]:
                flag("Diesel Consumption", "stale_copy", "warning",
                     f"identical to {prev_label} — every plant, every day. "
                     "The site appears to have copy-pasted the diesel log")
            for col, label in (("Plant Return:standby", "standby hours"),
                               ("Plant Return:breakdown", "breakdown hours")):
                if plant_rows and prev_hashes.get(col) == sheet_hashes[col]:
                    flag("Plant Return", "frozen_column", "warning",
                         f"{label} identical to {prev_label} for every plant "
                         "— column appears not to be updated")

        # parser warnings → flags (and the flat warnings list)
        for name, s in sheets.items():
            for w in s.get("warnings", []):
                flag(name, "qty_rate_violation" if "× rate" in w or "×" in w
                     else "info", "warning", w)
                warnings.append(w)

        if flags:
            await conn.executemany(
                """INSERT INTO project_sheet_flags
                   (weekly_report_id, project_id, sheet_name, flag_type,
                    severity, message, detail)
                   VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)""",
                [(report_id, project_id, *f) for f in flags],
                timeout=60,
            )
        counts["project_sheet_flags"] = len(flags)

        # ── adjustments: recompute for the whole project ─────────────────
        adj_stats = await recompute_adjustments(conn, project_id)

    warnings.extend(
        f"[flag:{f[1]}] {f[3]}" for f in flags if f[2] in ("warning", "error")
    )

    return {
        "weekly_report_id": report_id,
        "week_ending_date": week_ending,
        "row_counts": counts,
        "fleet_resolved": len(fleet_map),
        "fleet_unresolved": sorted(set(unresolved)),
        "adjustments": adj_stats,
        "warnings": warnings,
    }
