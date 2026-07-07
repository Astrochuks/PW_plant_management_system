"""Sheet parsers for project weekly-report workbooks (T2.4–T2.13).

One pure function per sheet: worksheet in → row dicts out (keys aligned
with the target table columns) + warnings. Everything anchor-based
(weekly_report_parsing) — no fixed cell addresses. Cumulative workbook
columns (Previous / To Date) are deliberately ignored per the PRD rule:
THIS WEEK is the only stored fact.

parse_workbook() orchestrates: manifest check first, then each sheet in
isolation — one broken sheet marks itself 'failed' with specifics and
never sinks the others.
"""

from __future__ import annotations

import re
from typing import Any

from openpyxl.workbook.workbook import Workbook

from app.services.weekly_report_parsing import (
    WORKBOOK_MANIFEST,
    cell_date,
    cell_number,
    cell_text,
    check_workbook,
    find_header_row,
    find_label_value,
    iter_table_rows,
    norm,
    resolve_sheet,
)

_NOISE_ROWS = re.compile(
    r"^(sub-?total|total|grand total|instructions?)\b", re.IGNORECASE
)


def _num(row: dict, *keys: str) -> float | None:
    """First parseable number among the row's keys (tolerant lookup)."""
    for key in keys:
        for k, v in row.items():
            if k != "_row" and k.startswith(key):
                n = cell_number(v)
                if n is not None:
                    return n
    return None


def _txt(row: dict, *keys: str) -> str | None:
    for key in keys:
        for k, v in row.items():
            if k != "_row" and k.startswith(key):
                t = cell_text(v)
                if t is not None:
                    return t
    return None


def _dt(row: dict, *keys: str):
    for key in keys:
        for k, v in row.items():
            if k != "_row" and k.startswith(key):
                d = cell_date(v)
                if d is not None:
                    return d
    return None


# ---------------------------------------------------------------------------
# T2.4 — Contract Summary → identity + snapshot
# ---------------------------------------------------------------------------

def parse_contract_summary(ws) -> dict[str, Any]:
    warnings: list[str] = []

    identity = {
        "client_raw": cell_text(find_label_value(ws, r"^client$")),
        "project_name": cell_text(find_label_value(ws, r"^name of contract")),
        "short_name": cell_text(find_label_value(ws, r"^short name")),
        "original_contract_amount": cell_number(
            find_label_value(ws, r"^original contract amount")
        ),
        "current_contract_amount": cell_number(
            find_label_value(ws, r"^current contract amount")
        ),
        "award_date": cell_date(find_label_value(ws, r"date of contract award")),
        "commencement_date": cell_date(
            find_label_value(ws, r"contract commencement date")
        ),
        "original_duration_months": cell_number(
            find_label_value(ws, r"original contract duration")
        ),
        "original_completion_date": cell_date(
            find_label_value(ws, r"original contract completion")
        ),
        "extension_of_time_months": cell_number(
            find_label_value(ws, r"extension of time granted")
        ),
        "revised_completion_date": cell_date(
            find_label_value(ws, r"^revised completion date")
        ),
    }
    for key in ("project_name", "original_contract_amount"):
        if identity[key] is None:
            warnings.append(f"Contract Summary: {key} not found")

    snapshot = {
        "original_contract_amount": identity["original_contract_amount"],
        "current_contract_amount": identity["current_contract_amount"],
        "works_certified": cell_number(
            find_label_value(ws, r"works vetted & certified|works vetted and certified")
        ),
        "retention_held": cell_number(
            find_label_value(ws, r"retention money - deducted")
        ),
        "advance_unrecovered": cell_number(
            find_label_value(ws, r"advance payment (yet to be recovered|r)")
        ),
        "apg_expiry": cell_date(find_label_value(ws, r"apg.*expir")),
    }
    return {"identity": identity, "snapshot": snapshot, "warnings": warnings}


# ---------------------------------------------------------------------------
# T2.5 — Weekly Summary → long rows (this-week values only)
# ---------------------------------------------------------------------------

def parse_weekly_summary(ws) -> dict[str, Any]:
    warnings: list[str] = []
    rows: list[dict[str, Any]] = []

    # The sheet holds >=2 blocks, each headed by a row containing a
    # "This Week" column: Works Completed and Costs to Date.
    header_hits: list[tuple[int, dict[str, int]]] = []
    seen_rows: set[int] = set()
    for probe_start in range(1, 60):
        hit = find_header_row(
            _window(ws, probe_start), ["this week"], min_matches=1, max_row=1
        )
        if hit is not None:
            actual_row = probe_start
            if actual_row not in seen_rows:
                seen_rows.add(actual_row)
                header_hits.append((actual_row, hit[1]))

    if not header_hits:
        return {"rows": [], "warnings": ["Weekly Summary: no 'This Week' headers found"]}

    for block_idx, (hrow, cols) in enumerate(header_hits):
        section_label = None
        # section name = leftmost text on the header row
        for c in range(1, 6):
            t = cell_text(ws.cell(row=hrow, column=c).value)
            if t:
                section_label = t
                break
        section = section_label or f"BLOCK {block_idx + 1}"

        next_header = (
            header_hits[block_idx + 1][0]
            if block_idx + 1 < len(header_hits)
            else hrow + 40
        )
        this_week_col = cols.get("this week")
        pct_col = next(
            (col for name, col in cols.items() if name.startswith("%")), None
        )

        for r in range(hrow + 1, next_header):
            # item name: first text cell in cols A..C that isn't a bullet
            name = None
            for c in range(1, 4):
                t = cell_text(ws.cell(row=r, column=c).value)
                if t and t not in ("•", "-"):
                    name = t
                    break
            if not name:
                continue
            value = cell_number(ws.cell(row=r, column=this_week_col).value)
            pct = cell_number(ws.cell(row=r, column=pct_col).value) if pct_col else None
            if value is None and pct is None:
                continue  # section separators / prose
            if value is not None:
                rows.append({
                    "section": section, "item": name,
                    "metric": "this_week", "value": value, "raw_value": None,
                })
            if pct is not None:
                rows.append({
                    "section": section, "item": name,
                    "metric": "pct_complete", "value": pct, "raw_value": None,
                })
    return {"rows": rows, "warnings": warnings}


class _window:
    """Tiny worksheet view starting at a given row (for repeated header
    scans without re-walking the whole sheet)."""

    def __init__(self, ws, start_row: int):
        self._ws = ws
        self._start = start_row

    def iter_rows(self, min_row=1, max_row=1, max_col=40):
        yield from self._ws.iter_rows(
            min_row=self._start, max_row=self._start + max_row - 1, max_col=max_col
        )


# ---------------------------------------------------------------------------
# T2.6 — Plant Return
# ---------------------------------------------------------------------------

def parse_plant_return(ws) -> dict[str, Any]:
    warnings: list[str] = []
    hit = find_header_row(ws, ["fleet no", "description", "hours worked"])
    if hit is None:
        return {"rows": [], "warnings": ["Plant Return: header row not found"]}
    hrow, cols = hit

    rows = []
    for r in iter_table_rows(ws, hrow, cols):
        fleet = _txt(r, "fleet no")
        if not fleet or _NOISE_ROWS.match(fleet):
            continue
        rows.append({
            "fleet_number_raw": fleet,
            "description": _txt(r, "description"),
            "plant_category": _txt(r, "plant category"),
            "hours_worked": _num(r, "hours worked") or 0,
            "standby_hours": _num(r, "s/b hours", "standby") or 0,
            "breakdown_hours": _num(r, "b/d hours", "breakdown") or 0,
            "rate_ngn": _num(r, "rate"),
            "plant_cost": _num(r, "plant cost"),
            "transferred_from": _txt(r, "transfered from", "transferred from"),
            "current_location": _txt(r, "current location"),
            "remarks": _txt(r, "remarks"),
        })
    if not rows:
        warnings.append("Plant Return: no fleet rows parsed")
    return {"rows": rows, "warnings": warnings}


# ---------------------------------------------------------------------------
# T2.7 — Diesel Consumption
# ---------------------------------------------------------------------------

def parse_diesel(ws) -> dict[str, Any]:
    warnings: list[str] = []
    hit = find_header_row(ws, ["fleet no", "description", "total fuel"], min_matches=2)
    if hit is None:
        return {"rows": [], "warnings": ["Diesel: header row not found"]}
    hrow, cols = hit

    day_keys = ("saturday", "sunday", "monday", "tuesday", "wednesday",
                "thursday", "friday")
    rows = []
    for r in iter_table_rows(ws, hrow, cols):
        fleet = _txt(r, "fleet no")
        if not fleet or _NOISE_ROWS.match(fleet):
            continue
        day_values = {f"{d}_litres": (_num(r, d) or 0) for d in day_keys}
        total_claimed = _num(r, "total fuel")
        day_sum = sum(day_values.values())
        if total_claimed is not None and abs(day_sum - total_claimed) > 0.01:
            warnings.append(
                f"Diesel {fleet}: day sum {day_sum:g} != sheet total {total_claimed:g}"
            )
        rows.append({
            "fleet_number_raw": fleet,
            "description": _txt(r, "description"),
            "plant_category": _txt(r, "plant category"),
            **day_values,
        })

    used_this_week = cell_number(find_label_value(ws, r"^used this week"))
    total_parsed = sum(sum(v for k, v in row.items() if k.endswith("_litres"))
                       for row in rows)
    if used_this_week is not None and abs(total_parsed - used_this_week) > 0.01:
        warnings.append(
            f"Diesel: parsed total {total_parsed:g}L != sheet 'Used This Week' "
            f"{used_this_week:g}L"
        )
    return {"rows": rows, "warnings": warnings}


# ---------------------------------------------------------------------------
# T2.8 — Cost Report (this-week amounts only)
# ---------------------------------------------------------------------------

def parse_cost_report(ws) -> dict[str, Any]:
    warnings: list[str] = []
    hit = find_header_row(
        ws, ["description", "cost category", "amount"], min_matches=2
    )
    if hit is None:
        return {"rows": [], "warnings": ["Cost Report: header row not found"]}
    hrow, cols = hit

    this_week_col = next(
        (col for name, col in cols.items()
         if name.startswith("amount") and "this week" in name),
        None,
    )
    rows = []
    section = None
    for r in iter_table_rows(ws, hrow, cols, stop_after_blank=15):
        desc = _txt(r, "description")
        category = _txt(r, "cost category")
        amount_this_week = (
            cell_number(ws.cell(row=r["_row"], column=this_week_col).value)
            if this_week_col else _num(r, "amount this week")
        )
        # Section banners ("PLANT DEPARTMENT", "MATERIALS") sit in the
        # S/No column with no numbers anywhere on the row
        sno = _txt(r, "s/no")
        banner = next(
            (t for t in (sno, desc)
             if t and t.isupper() and len(t) > 3 and not t.replace(" ", "").isdigit()),
            None,
        )
        if banner and category is None and amount_this_week is None                 and _num(r, "rate") is None:
            section = banner
            continue
        if not desc:
            continue
        rows.append({
            "section": section,
            "description": desc,
            "cost_category": category,
            "unit": _txt(r, "unit"),
            "quantity_this_week": _num(r, "quantity this week"),
            "rate_ngn": _num(r, "rate"),
            "amount_this_week": amount_this_week or 0,
        })
    if not rows:
        warnings.append("Cost Report: no rows parsed")
    return {"rows": rows, "warnings": warnings}


# ---------------------------------------------------------------------------
# T2.9 — Certificates + Payments
# ---------------------------------------------------------------------------

def parse_certificates(ws) -> dict[str, Any]:
    warnings: list[str] = []
    hit = find_header_row(
        ws, ["cert number", "gross value of works don"], min_matches=1
    )
    if hit is None:
        return {"rows": [], "warnings": ["Certificates: header row not found"]}
    hrow, cols = hit

    rows = []
    for r in iter_table_rows(ws, hrow, cols):
        cert_no = _txt(r, "cert number")
        gross = _num(r, "gross value of works don")
        if cert_no is None or gross is None:
            continue
        rows.append({
            "cert_number": cert_no,
            "date_submitted": _dt(r, "date submitted"),
            "gross_value_works_done": gross,
            "add_materials_on_site": _num(r, "add materials on site"),
            "less_materials_on_site": _num(r, "less materials on site"),
            "general_bill_1": _num(r, "general bill 1"),
            "total_value_of_work_done": _num(r, "total value of work done"),
            "value_of_works_per_cert": _num(r, "value of works per cert"),
            "total_retention_held": _num(r, "total retention held"),
            "total_net_payment": _num(r, "total net payment"),
        })
    if not rows:
        warnings.append("Certificates: no cert rows parsed")
    return {"rows": rows, "warnings": warnings}


def parse_payments(ws) -> dict[str, Any]:
    warnings: list[str] = []
    hit = find_header_row(
        ws, ["voucher number", "payment type", "gross amount"], min_matches=2
    )
    if hit is None:
        return {"rows": [], "warnings": ["Payments: header row not found"]}
    hrow, cols = hit

    rows = []
    for r in iter_table_rows(ws, hrow, cols):
        voucher = _txt(r, "voucher number")
        gross = _num(r, "gross amount")
        if voucher is None and gross is None:
            continue
        row = {
            "payment_date": _dt(r, "date"),
            "voucher_number": voucher,
            "payment_type": _txt(r, "payment type"),
            "gross_amount": gross,
            "wht": _num(r, "wht") or 0,
            "vat": _num(r, "vat") or 0,
            "vetting_fee": _num(r, "vetting fee") or 0,
            "stamp_duty": _num(r, "stamp duty") or 0,
            "other_deductions": _num(r, "other") or 0,
            "net_amount": _num(r, "net amount"),
        }
        if row["gross_amount"] is not None and row["net_amount"] is not None:
            expected_net = row["gross_amount"] - (
                row["wht"] + row["vat"] + row["vetting_fee"]
                + row["stamp_duty"] + row["other_deductions"]
            )
            if abs(expected_net - row["net_amount"]) > 1.0:
                warnings.append(
                    f"Payments {voucher or '?'}: gross-deductions "
                    f"{expected_net:,.2f} != net {row['net_amount']:,.2f}"
                )
        rows.append(row)
    if not rows:
        warnings.append("Payments: no rows parsed")
    return {"rows": rows, "warnings": warnings}


# ---------------------------------------------------------------------------
# T2.10 — BEME (bills + items + this-week progress)
# ---------------------------------------------------------------------------

def parse_beme(ws) -> dict[str, Any]:
    warnings: list[str] = []
    hit = find_header_row(
        ws, ["item", "description", "rate", "this week qty"], min_matches=3
    )
    if hit is None:
        return {"rows": [], "warnings": ["BEME: header row not found"]}
    hrow, cols = hit

    bill_total_rx = re.compile(r"total bill no\.?\s*(\d+)", re.IGNORECASE)
    rows = []
    current_bill = 1
    for r in iter_table_rows(ws, hrow, cols, stop_after_blank=25, max_rows=2000):
        desc = _txt(r, "description")
        code = _txt(r, "item")

        # Bill boundary markers ("Total Bill No. 1 Carried ...") — appear in
        # either the item or description column
        marker = bill_total_rx.search(f"{code or ''} {desc or ''}")
        if marker:
            current_bill = int(marker.group(1)) + 1
            continue
        # Repeated header rows inside the sheet
        if code and norm(code) == "item":
            continue
        if not desc:
            continue

        rate = _num(r, "rate")
        contract_amount = _num(r, "contract amount")
        this_week_qty = _num(r, "this week qty")
        this_week_amount = _num(r, "this week amount")
        pct = _num(r, "% of work completed", "%")

        # Group headings (e.g. "1 | PRELIMINARIES") carry no money columns
        if rate is None and contract_amount is None and this_week_qty is None \
                and this_week_amount is None:
            continue

        rows.append({
            "bill_no": current_bill,
            "item_code": code,
            "description": desc,
            "unit": _txt(r, "unit"),
            "contract_qty": _num(r, "contract qty"),
            "rate": rate,
            "contract_amount": contract_amount,
            "qty_this_week": this_week_qty,
            "amount_this_week": this_week_amount,
            "pct_complete": pct,
        })
    if not rows:
        warnings.append("BEME: no item rows parsed")
    return {"rows": rows, "warnings": warnings}


# ---------------------------------------------------------------------------
# T2.11 — Bill 1 (items from Summary; payments)
# ---------------------------------------------------------------------------

def parse_bill1_summary(ws) -> dict[str, Any]:
    """v1 ingests Bill 1 ITEMS (schedule); the per-cert claims matrix has
    dynamic columns and is deferred — flagged in warnings, never silent."""
    warnings: list[str] = ["Bill 1 Summary: per-cert claims matrix deferred (v1)"]
    hit = find_header_row(ws, ["description"], min_matches=1)
    if hit is None:
        return {"rows": [], "warnings": ["Bill 1 Summary: header row not found"]}
    hrow, cols = hit

    rows = []
    for r in iter_table_rows(ws, hrow, cols, stop_after_blank=15):
        desc = _txt(r, "description")
        if not desc or _NOISE_ROWS.match(desc):
            continue
        rows.append({
            "item_code": _txt(r, "item"),
            "description": desc,
            "unit": _txt(r, "unit"),
            "contract_qty": _num(r, "qty", "contract qty"),
            "rate": _num(r, "rate"),
            "contract_amount": _num(r, "amount", "contract amount"),
        })
    return {"rows": rows, "warnings": warnings}


def parse_bill1_payments(ws) -> dict[str, Any]:
    warnings: list[str] = []
    hit = find_header_row(ws, ["payee", "amount"], min_matches=2)
    if hit is None:
        return {"rows": [], "warnings": ["Bill 1 Payments: header row not found"]}
    hrow, cols = hit

    rows = []
    for r in iter_table_rows(ws, hrow, cols):
        payee = _txt(r, "payee")
        amount = _num(r, "amount")
        if payee is None and amount is None:
            continue
        rows.append({
            "payment_date": _dt(r, "date"),
            "description": " — ".join(
                x for x in (payee, _txt(r, "bill 1 item")) if x
            ) or None,
            "reference": _txt(r, "chq no"),
            "amount": amount,
        })
    return {"rows": rows, "warnings": warnings}


# ---------------------------------------------------------------------------
# T2.12 — Subcontractors, Labour, Materials, Hired Vehicles, Precast
# ---------------------------------------------------------------------------

def parse_subcontractors(ws) -> dict[str, Any]:
    warnings: list[str] = []
    hit = find_header_row(
        ws, ["subcontractor", "description", "agreed rate"], min_matches=2
    )
    if hit is None:
        return {"rows": [], "warnings": ["Subcontractors: header row not found"]}
    hrow, cols = hit

    rows = []
    last_sub = None
    for r in iter_table_rows(ws, hrow, cols):
        sub = _txt(r, "subcontractor")
        desc = _txt(r, "description")
        if sub:
            last_sub = sub
        if not desc:
            continue
        rows.append({
            "subcontractor_name": sub or last_sub,
            "description": desc,
            "location": _txt(r, "location"),
            "unit": _txt(r, "unit"),
            "agreed_rate": _num(r, "agreed rate"),
            "assigned_qty": _num(r, "assigned qty"),
            "qty_this_week": _num(r, "qty executed for week"),
            "amount_this_week": _num(r, "value completed this wee"),
        })
    return {"rows": rows, "warnings": warnings}


def parse_labour(ws) -> dict[str, Any]:
    warnings: list[str] = []
    hit = find_header_row(ws, ["department", "manning this week"])
    if hit is None:
        return {"rows": [], "warnings": ["Labour: header row not found"]}
    hrow, cols = hit

    rows = []
    for r in iter_table_rows(ws, hrow, cols):
        dept = _txt(r, "department")
        if not dept or _NOISE_ROWS.match(dept):
            continue
        manning = _num(r, "manning this week")
        rows.append({
            "department": dept,
            "manning_this_week": int(manning) if manning is not None else 0,
            "manning_previous_week": int(_num(r, "manning previous week") or 0),
            "movement": int(_num(r, "movement") or 0),
            "comment": _txt(r, "comment"),
        })
    return {"rows": rows, "warnings": warnings}


def parse_materials(ws) -> dict[str, Any]:
    warnings: list[str] = []
    hit = find_header_row(
        ws, ["description", "opening stock", "closing stock"], min_matches=2
    )
    if hit is None:
        return {"rows": [], "warnings": ["Materials: header row not found"]}
    hrow, cols = hit

    rows = []
    for r in iter_table_rows(ws, hrow, cols):
        desc = _txt(r, "description")
        if not desc or _NOISE_ROWS.match(desc):
            continue
        rows.append({
            "sheet_source": "materials",
            "material_name": desc,
            "unit": _txt(r, "unit"),
            "unit_cost": _num(r, "current price"),
            "opening_stock": _num(r, "opening stock"),
            "received": _num(r, "received"),
            "used": _num(r, "total used"),
            "closing_stock": _num(r, "closing stock"),
        })
    return {"rows": rows, "warnings": warnings}


def parse_hired_vehicles(ws) -> dict[str, Any]:
    warnings: list[str] = []
    hit = find_header_row(ws, ["description", "days worked", "rate"], min_matches=2)
    if hit is None:
        return {"rows": [], "warnings": ["Hired Vehicles: header row not found"]}
    hrow, cols = hit

    rows = []
    for r in iter_table_rows(ws, hrow, cols):
        desc = _txt(r, "description")
        owners = _txt(r, "owners")
        amount = _num(r, "amount")
        days = _num(r, "days worked")
        if desc is None and owners is None:
            continue
        if not any(v for v in (desc, days, amount)):
            continue
        rows.append({
            "registration_no": _txt(r, "reg. no", "reg no"),
            "description": desc,
            "section": _txt(r, "section"),
            "owners": owners,
            "days_worked": days,
            "rate_ngn": _num(r, "rate"),
            "amount_ngn": amount or 0,
            "remarks": _txt(r, "remarks"),
        })
    return {"rows": rows, "warnings": warnings}


def parse_precast(ws) -> dict[str, Any]:
    warnings: list[str] = []
    hit = find_header_row(ws, ["description", "cast this week"], min_matches=1)
    if hit is None:
        return {"rows": [], "warnings": ["Precast: header row not found"]}
    hrow, cols = hit

    rows = []
    for r in iter_table_rows(ws, hrow, cols):
        desc = _txt(r, "description")
        if not desc or _NOISE_ROWS.match(desc):
            continue
        rows.append({
            "description": desc,
            "size": _txt(r, "size"),
            "uom": _txt(r, "uom"),
            "cast_this_week": _num(r, "cast this week"),
            "used_this_week": _num(r, "used this week"),
            "balance_available": _num(r, "balance available"),
            "closing_stock": _num(r, "closing stock"),
        })
    return {"rows": rows, "warnings": warnings}


# ---------------------------------------------------------------------------
# T2.13 — Lists (reference data + week calendar validation map)
# ---------------------------------------------------------------------------

def parse_lists(ws) -> dict[str, Any]:
    """Cols A–C: the company's daily calendar (date, week no). Remaining
    headed columns: reference lists (UOMs, categories, rates…)."""
    warnings: list[str] = []

    # calendar: build {(year, week_number): max date seen} = week-ending map
    week_endings: dict[tuple[int, int], Any] = {}
    for row in ws.iter_rows(min_row=2, max_col=3, values_only=True):
        d = cell_date(row[0])
        wk = cell_number(row[1])
        if d is None or wk is None:
            continue
        key = (d.year, int(wk))
        if key not in week_endings or d > week_endings[key]:
            week_endings[key] = d

    # reference lists from headed columns beyond C
    reference: list[dict[str, Any]] = []
    headers = {}
    for cell in next(ws.iter_rows(min_row=1, max_row=1, max_col=45)):
        if cell.column > 3 and cell.value is not None:
            t = cell_text(cell.value)
            if t:
                headers[cell.column] = t
    for col, list_name in headers.items():
        order = 0
        for r in range(2, 200):
            item = cell_text(ws.cell(row=r, column=col).value)
            if item is None:
                continue
            order += 1
            detail = cell_text(ws.cell(row=r, column=col + 1).value)
            reference.append({
                "list_name": list_name, "item": item,
                "detail": detail, "sort_order": order,
            })
    if not week_endings:
        warnings.append("Lists: calendar columns not parsed")
    return {
        "week_endings": week_endings,
        "reference": reference,
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

_SHEET_PARSERS = {
    "Contract Summary": parse_contract_summary,
    "Weekly Summary": parse_weekly_summary,
    "Plant Return": parse_plant_return,
    "Diesel Consumption": parse_diesel,
    "Cost Report": parse_cost_report,
    "Certificate Status": parse_certificates,
    "Payments Recieved": parse_payments,
    "BEME & Works Completed Fd": parse_beme,
    "Bill 1 Summary": parse_bill1_summary,
    "Bill 1 Payments": parse_bill1_payments,
    "Subcontractors": parse_subcontractors,
    "Labour Strength": parse_labour,
    "Materials & Civils": parse_materials,
    "Hired Vehicles": parse_hired_vehicles,
    "Precast": parse_precast,
    "Lists": parse_lists,
}


def parse_workbook(wb: Workbook) -> dict[str, Any]:
    """Parse all 16 sheets. One failing sheet never sinks the rest:
    each gets status ok | partial (parsed with warnings) | failed."""
    drift = check_workbook(wb)
    sheets: dict[str, dict[str, Any]] = {}

    for spec in WORKBOOK_MANIFEST:
        canonical = spec.canonical
        parser = _SHEET_PARSERS.get(canonical)
        if parser is None:
            continue
        ws = resolve_sheet(wb, spec)
        if ws is None:
            sheets[canonical] = {
                "status": "failed", "error": "sheet missing", "warnings": [],
            }
            continue
        try:
            result = parser(ws)
            warnings = result.get("warnings", [])
            payload = {k: v for k, v in result.items() if k != "warnings"}
            n_rows = len(result.get("rows", [])) if "rows" in result else None
            sheets[canonical] = {
                "status": "partial" if warnings else "ok",
                "warnings": warnings,
                "rows_parsed": n_rows,
                **payload,
            }
        except Exception as exc:  # one sheet must never sink the workbook
            sheets[canonical] = {
                "status": "failed",
                "error": f"{type(exc).__name__}: {exc}",
                "warnings": [],
            }

    return {
        "sheets": sheets,
        "drift": {
            "clean": drift.clean,
            "missing": drift.missing,
            "drifted": drift.drifted,
        },
        "identity": sheets.get("Contract Summary", {}).get("identity"),
    }
