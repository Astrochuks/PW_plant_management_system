"""Persistence for project weekly reports (T2.15/T2.16).

One transaction on a caller-supplied connection (endpoint AND tests run
the identical path). Idempotent by construction: the (project, year,
week) header row is deleted first and every child cascades, so a
re-upload replaces cleanly.

Ledger sheets vs weekly facts:
  - Certificates: the sheet re-lists the FULL cert ledger every week →
    upserted by (project, cert_number), always reflecting the latest
    report that mentioned each cert.
  - Payments / Bill-1 payments: also full ledgers, but with no natural
    unique key → stored per report; readers use the LATEST report's rows
    (documented contract, enforced by the dashboard queries).
  - Everything else (plant, diesel, costs, BEME progress, labour,
    materials, precast, subs, hired, weekly summary, snapshot) is a
    weekly fact tied to this report.

Cross-checks never block the import — they surface as warnings
(the site's own arithmetic being wrong is a finding, not a failure).
"""

from typing import Any

import asyncpg

from app.monitoring.logging import get_logger
from app.workers.etl_worker import normalize_fleet_number

logger = get_logger(__name__)


async def _resolve_fleet(
    conn: asyncpg.Connection, raw_numbers: list[str]
) -> tuple[dict[str, str], list[str]]:
    """{raw → plant_id} via normalized fleet numbers; unresolved raws listed."""
    normalized = {}
    for raw in raw_numbers:
        n = normalize_fleet_number(raw)
        if n:
            normalized.setdefault(n, raw)
    if not normalized:
        return {}, []

    rows = await conn.fetch(
        "SELECT id, fleet_number FROM plants_master WHERE fleet_number = ANY($1::text[])",
        list(normalized.keys()),
    )
    by_norm = {r["fleet_number"]: str(r["id"]) for r in rows}

    resolved: dict[str, str] = {}
    unresolved: list[str] = []
    for norm_num, raw in normalized.items():
        if norm_num in by_norm:
            resolved[raw] = by_norm[norm_num]
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

    def sheet_rows(name: str) -> list[dict]:
        return sheets.get(name, {}).get("rows", []) or []

    # Week-ending date: the workbook's own calendar is the authority
    week_endings = sheets.get("Lists", {}).get("week_endings", {}) or {}
    week_ending = week_endings.get((year, week_number))
    if week_ending is None:
        warnings.append(
            f"Lists calendar has no entry for {year}-W{week_number}; "
            "using identity/period fallback"
        )
        from datetime import date, timedelta
        jan1 = date(year, 1, 1)
        week_ending = jan1 + timedelta(days=(week_number * 7) - jan1.weekday() - 3)

    async with conn.transaction():
        # ── idempotent replace: kill the previous header, cascade children
        await conn.execute(
            """DELETE FROM project_weekly_reports
               WHERE project_id = $1::uuid AND year = $2 AND week_number = $3""",
            project_id, year, week_number,
        )

        report_id = await conn.fetchval(
            """INSERT INTO project_weekly_reports
               (project_id, year, week_number, week_ending_date, status,
                submitted_by, beme_pct_complete, sheets_processed)
               VALUES ($1::uuid, $2, $3, $4, 'completed', $5::uuid, $6, $7::jsonb)
               RETURNING id""",
            project_id, year, week_number, week_ending, user_id,
            _pct_from_summary(parsed),
            __import__("json").dumps(
                {n: s["status"] for n, s in sheets.items()}
            ),
        )
        report_id = str(report_id)

        # ── fleet resolution across plant + diesel sheets ────────────────
        plant_rows = sheet_rows("Plant Return")
        diesel_rows = sheet_rows("Diesel Consumption")
        all_fleet = [r["fleet_number_raw"] for r in plant_rows + diesel_rows]
        fleet_map, unresolved = await _resolve_fleet(conn, all_fleet)
        if unresolved:
            warnings.append(
                f"{len(unresolved)} fleet numbers not in plants_master: "
                + ", ".join(sorted(set(unresolved))[:10])
            )

        base = (report_id, project_id, year, week_number, week_ending)

        # ── plant utilization ────────────────────────────────────────────
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

        # ── diesel ───────────────────────────────────────────────────────
        await conn.executemany(
            """INSERT INTO project_diesel_consumption
               (weekly_report_id, project_id, year, week_number, week_ending_date,
                fleet_number_raw, plant_id, description, plant_category,
                saturday_litres, sunday_litres, monday_litres, tuesday_litres,
                wednesday_litres, thursday_litres, friday_litres)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5,
                       $6, $7::uuid, $8, $9, $10, $11, $12, $13, $14, $15, $16)""",
            [
                (*base, r["fleet_number_raw"], fleet_map.get(r["fleet_number_raw"]),
                 r["description"], r["plant_category"],
                 r["saturday_litres"], r["sunday_litres"], r["monday_litres"],
                 r["tuesday_litres"], r["wednesday_litres"], r["thursday_litres"],
                 r["friday_litres"])
                for r in diesel_rows
            ],
            timeout=120,
        )
        counts["project_diesel_consumption"] = len(diesel_rows)

        # ── cost report ──────────────────────────────────────────────────
        cost_rows = sheet_rows("Cost Report")
        await conn.executemany(
            """INSERT INTO project_cost_report
               (weekly_report_id, project_id, year, week_number, week_ending_date,
                section, description, cost_category, unit, quantity_this_week,
                rate_ngn, amount_previous_week, amount_this_week)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, $12)""",
            [
                (*base, r["section"], r["description"], r["cost_category"],
                 r["unit"], r["quantity_this_week"], r["rate_ngn"],
                 r["amount_this_week"])
                for r in cost_rows
            ],
            timeout=120,
        )
        counts["project_cost_report"] = len(cost_rows)

        # ── certificates: ledger upsert by (project, cert_number) ────────
        cert_rows = sheet_rows("Certificate Status")
        for r in cert_rows:
            await conn.execute(
                """INSERT INTO project_certificates
                   (weekly_report_id, project_id, cert_number, date_submitted,
                    gross_value_works_done, add_materials_on_site,
                    less_materials_on_site, general_bill_1,
                    total_value_of_work_done, value_of_works_per_cert,
                    total_retention_held, total_net_payment)
                   VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
                       updated_at = now()""",
                report_id, project_id, r["cert_number"], r["date_submitted"],
                r["gross_value_works_done"], r["add_materials_on_site"],
                r["less_materials_on_site"], r["general_bill_1"],
                r["total_value_of_work_done"], r["value_of_works_per_cert"],
                r["total_retention_held"], r["total_net_payment"],
            )
        counts["project_certificates"] = len(cert_rows)

        # ── payments: full ledger per report (readers use latest report) ─
        pay_rows = sheet_rows("Payments Recieved")
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
        # item_code coalesced to '' (NULLs are distinct under UNIQUE →
        # would duplicate on every re-upload). Duplicate identities within
        # one sheet are merged (qty/amount summed) with a warning.
        beme_rows = sheet_rows("BEME & Works Completed Fd")
        distinct: dict[tuple, dict] = {}
        for r in beme_rows:
            key = (r["bill_no"], r["item_code"] or "", r["description"])
            if key in distinct:
                agg = distinct[key]
                agg["qty_this_week"] = (
                    ((agg["qty_this_week"] or 0) + (r["qty_this_week"] or 0)) or None
                )
                agg["amount_this_week"] = (
                    ((agg["amount_this_week"] or 0) + (r["amount_this_week"] or 0)) or None
                )
                if r["pct_complete"] is not None:
                    agg["pct_complete"] = r["pct_complete"]
                warnings.append(
                    f"BEME: duplicate item merged "
                    f"({r['item_code']} {r['description'][:40]!r})"
                )
            else:
                distinct[key] = dict(r)

        bill_ids: dict[int, str] = {}
        for bill_no in sorted({k[0] for k in distinct}):
            bill_ids[bill_no] = str(await conn.fetchval(
                """INSERT INTO project_beme_bills (project_id, bill_no)
                   VALUES ($1::uuid, $2)
                   ON CONFLICT (project_id, bill_no) DO UPDATE SET bill_no = EXCLUDED.bill_no
                   RETURNING id""",
                project_id, bill_no,
            ))

        # ONE round trip for all item upserts, one more to read ids back
        await conn.executemany(
            """INSERT INTO project_beme_items
               (project_id, bill_id, item_code, description, unit,
                contract_qty, rate, contract_amount)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (bill_id, item_code, description) DO UPDATE SET
                   contract_qty = COALESCE(EXCLUDED.contract_qty,
                                           project_beme_items.contract_qty),
                   rate = COALESCE(EXCLUDED.rate, project_beme_items.rate),
                   contract_amount = COALESCE(EXCLUDED.contract_amount,
                                              project_beme_items.contract_amount)""",
            [
                (project_id, bill_ids[k[0]], k[1], k[2], r["unit"],
                 r["contract_qty"], r["rate"], r["contract_amount"])
                for k, r in distinct.items()
            ],
            timeout=120,
        )
        item_id_map = {
            (r["bill_no"], r["item_code"], r["description"]): str(r["id"])
            for r in await conn.fetch(
                """SELECT i.id, b.bill_no, i.item_code, i.description
                   FROM project_beme_items i
                   JOIN project_beme_bills b ON b.id = i.bill_id
                   WHERE i.project_id = $1::uuid""",
                project_id, timeout=60,
            )
        }
        progress_args = [
            (report_id, project_id, item_id_map[k], year, week_number,
             week_ending, r["qty_this_week"], r["amount_this_week"],
             r["pct_complete"])
            for k, r in distinct.items()
        ]
        await conn.executemany(
            """INSERT INTO project_beme_progress
               (weekly_report_id, project_id, item_id, year, week_number,
                week_ending_date, qty_this_week, amount_this_week, pct_complete)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9)""",
            progress_args, timeout=120,
        )
        counts["project_beme_progress"] = len(progress_args)

        # ── Bill 1 ───────────────────────────────────────────────────────
        for r in sheet_rows("Bill 1 Summary"):
            await conn.execute(
                """INSERT INTO project_bill1_items
                   (project_id, item_code, description, unit, contract_qty,
                    rate, contract_amount)
                   VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
                   ON CONFLICT (project_id, item_code, description) DO NOTHING""",
                project_id, r["item_code"], r["description"], r["unit"],
                r["contract_qty"], r["rate"], r["contract_amount"],
            )
        counts["project_bill1_items"] = len(sheet_rows("Bill 1 Summary"))

        b1pay = sheet_rows("Bill 1 Payments")
        await conn.executemany(
            """INSERT INTO project_bill1_payments
               (weekly_report_id, project_id, payment_date, description,
                reference, amount)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)""",
            [
                (report_id, project_id, r["payment_date"], r["description"],
                 r["reference"], r["amount"])
                for r in b1pay
            ],
            timeout=60,
        )
        counts["project_bill1_payments"] = len(b1pay)

        # ── subcontractors / labour / materials / hired / precast ────────
        sub_rows = sheet_rows("Subcontractors")
        await conn.executemany(
            """INSERT INTO project_subcontractors
               (weekly_report_id, project_id, year, week_number, week_ending_date,
                subcontractor_name, description, location, unit, agreed_rate,
                assigned_qty, qty_this_week, amount_this_week)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)""",
            [
                (*base, r["subcontractor_name"], r["description"], r["location"],
                 r["unit"], r["agreed_rate"], r["assigned_qty"],
                 r["qty_this_week"], r["amount_this_week"])
                for r in sub_rows
            ],
            timeout=120,
        )
        counts["project_subcontractors"] = len(sub_rows)

        lab_rows = sheet_rows("Labour Strength")
        await conn.executemany(
            """INSERT INTO project_labour_strength
               (weekly_report_id, project_id, year, week_number, week_ending_date,
                department, manning_this_week, manning_previous_week, movement, comment)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10)""",
            [
                (*base, r["department"], r["manning_this_week"],
                 r["manning_previous_week"], r["movement"], r["comment"])
                for r in lab_rows
            ],
            timeout=60,
        )
        counts["project_labour_strength"] = len(lab_rows)

        mat_rows = sheet_rows("Materials & Civils")
        await conn.executemany(
            """INSERT INTO project_materials_stock
               (weekly_report_id, project_id, year, week_number, week_ending_date,
                sheet_source, material_name, unit, opening_stock, received,
                used, closing_stock, unit_cost)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)""",
            [
                (*base, r["sheet_source"], r["material_name"], r["unit"],
                 r["opening_stock"], r["received"], r["used"],
                 r["closing_stock"], r["unit_cost"])
                for r in mat_rows
            ],
            timeout=60,
        )
        counts["project_materials_stock"] = len(mat_rows)

        hired_rows = sheet_rows("Hired Vehicles")
        await conn.executemany(
            """INSERT INTO project_hired_vehicles
               (weekly_report_id, project_id, year, week_number, week_ending_date,
                registration_no, description, section, owners, days_worked,
                rate_ngn, amount_ngn, remarks)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)""",
            [
                (*base, r["registration_no"], r["description"], r["section"],
                 r["owners"], r["days_worked"], r["rate_ngn"], r["amount_ngn"],
                 r["remarks"])
                for r in hired_rows
            ],
            timeout=60,
        )
        counts["project_hired_vehicles"] = len(hired_rows)

        pre_rows = sheet_rows("Precast")
        await conn.executemany(
            """INSERT INTO project_precast
               (weekly_report_id, project_id, year, week_number, week_ending_date,
                description, size, uom, cast_this_week, used_this_week,
                balance_available, closing_stock)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)""",
            [
                (*base, r["description"], r["size"], r["uom"],
                 r["cast_this_week"], r["used_this_week"],
                 r["balance_available"], r["closing_stock"])
                for r in pre_rows
            ],
            timeout=60,
        )
        counts["project_precast"] = len(pre_rows)

        # ── weekly summary (long rows) ───────────────────────────────────
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

        # ── contract snapshot ────────────────────────────────────────────
        snap = sheets.get("Contract Summary", {}).get("snapshot") or {}
        await conn.execute(
            """INSERT INTO project_contract_summary_snapshot
               (weekly_report_id, project_id, year, week_number, week_ending_date,
                original_contract_amount, current_contract_amount,
                works_certified, retention_held, advance_unrecovered, apg_expiry)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11)""",
            *base, snap.get("original_contract_amount"),
            snap.get("current_contract_amount"), snap.get("works_certified"),
            snap.get("retention_held"), snap.get("advance_unrecovered"),
            snap.get("apg_expiry"),
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

        # ── cross-checks: the site's own arithmetic, verified ────────────
        gross_plant = sum(r["plant_cost"] or 0 for r in plant_rows)
        plant_internal = next(
            (r["amount_this_week"] for r in cost_rows
             if r["description"] and "plant internal" in r["description"].lower()),
            None,
        )
        if plant_internal is not None and gross_plant:
            adjustment = gross_plant - plant_internal
            if adjustment < 0 or adjustment > gross_plant * 0.5:
                warnings.append(
                    f"Plant cost check: raw plant cost ₦{gross_plant:,.0f} vs "
                    f"Cost Report 'Plant Internal' ₦{plant_internal:,.0f} — "
                    f"adjustment ₦{adjustment:,.0f} outside expected range"
                )

    # gather parser warnings too
    for name, s in sheets.items():
        for w in s.get("warnings", []):
            warnings.append(w)

    return {
        "weekly_report_id": report_id,
        "week_ending_date": week_ending,
        "row_counts": counts,
        "fleet_resolved": len(fleet_map),
        "fleet_unresolved": sorted(set(unresolved)),
        "warnings": warnings,
    }
