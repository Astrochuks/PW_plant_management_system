"""Bill of quantities import — the pure part (no I/O), unit-tested.

Takes what `parse_beme` read off a sheet (bills + item rows, deterministic
anchor-based parsing, CLAUDE.md rule 8) and shapes it into the preview the
admin sees before a revision is recorded: bills with their items in sheet
order, our Σ per bill against the sheet's own "Total Bill … carried to
summary", a works total, and the parser's warnings.

Money is summed as Decimal and handed over at 2 dp — the stored precision
(CLAUDE.md rule 1); nothing is rounded for display here.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

TOLERANCE = Decimal("0.01")


def _dec(v: Any) -> Decimal:
    if v is None:
        return Decimal("0")
    return Decimal(str(v))


def pick_beme_sheet(parsed_by_sheet: dict[str, dict[str, Any]]) -> str | None:
    """The sheet that parsed the most priced item rows wins; None if no
    sheet produced any item."""
    best: tuple[int, str] | None = None
    for title, parsed in parsed_by_sheet.items():
        n = len(parsed.get("rows") or [])
        if n and (best is None or n > best[0]):
            best = (n, title)
    return best[1] if best else None


def shape_preview(parsed: dict[str, Any]) -> dict[str, Any]:
    """parse_beme output → import preview (bills with items, totals, checks)."""
    by_code: dict[str, dict[str, Any]] = {}
    bills: list[dict[str, Any]] = []
    for b in parsed.get("bills") or []:
        ob = {
            "bill_code": b["bill_code"],
            "bill_no": b.get("bill_no"),
            "sort_order": b.get("sort_order") or (len(bills) + 1),
            "name": b.get("name"),
            "sheet_total": b.get("sheet_total_contract"),
            "items": [],
        }
        by_code[b["bill_code"]] = ob
        bills.append(ob)

    seen: dict[tuple[str, str, str], int] = {}
    for pos, r in enumerate(parsed.get("rows") or [], 1):
        ob = by_code.get(r["bill_code"])
        if ob is None:  # an item whose bill header the sheet never printed
            ob = {"bill_code": r["bill_code"], "bill_no": r.get("bill_no"),
                  "sort_order": len(bills) + 1, "name": None, "sheet_total": None, "items": []}
            by_code[r["bill_code"]] = ob
            bills.append(ob)
        code = r.get("item_code") or ""
        key = (r["bill_code"], code, r["description"])
        dup = seen.get(key, 0)
        seen[key] = dup + 1
        ob["items"].append({
            "item_code": code,
            "description": r["description"],
            "unit": r.get("unit"),
            "contract_qty": r.get("contract_qty"),
            "rate": r.get("rate"),
            "contract_amount": r.get("contract_amount"),
            "dup_seq": dup,
            "sort_order": pos,
        })

    works = Decimal("0")
    for ob in bills:
        total = sum((_dec(i["contract_amount"]) for i in ob["items"]), Decimal("0"))
        ob["items_total"] = float(total.quantize(Decimal("0.01")))
        ob["item_count"] = len(ob["items"])
        st = ob["sheet_total"]
        ob["matches_sheet"] = None if st is None else abs(total - _dec(st)) <= TOLERANCE
        works += total

    return {
        "bills": bills,
        "bill_count": len(bills),
        "item_count": sum(ob["item_count"] for ob in bills),
        "works_total": float(works.quantize(Decimal("0.01"))),
        "mismatched_bills": [ob["bill_code"] for ob in bills if ob["matches_sheet"] is False],
        "warnings": list(parsed.get("warnings") or []),
    }


def assign_dup_seq(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Re-number duplicates (same code + description inside one bill) so the
    identity key (bill, item_code, description, dup_seq) stays unique."""
    seen: dict[tuple[str, str], int] = {}
    out = []
    for i in items:
        key = (i.get("item_code") or "", i["description"])
        d = seen.get(key, 0)
        seen[key] = d + 1
        out.append({**i, "dup_seq": d})
    return out
