"""Item-level difference between two bill revisions — what the project
manager reads before approving (PRD v2 §6). Pure, unit-tested.

Items are matched within a bill by (item code, description) and, for
repeated lines, by their occurrence order. A changed item is one whose
quantity, rate or amount differs by more than a kobo.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

TOL = Decimal("0.01")


def _dec(v: Any) -> Decimal:
    return Decimal("0") if v is None else Decimal(str(v))


def _norm(s: Any) -> str:
    return " ".join(str(s or "").split()).lower()


def _index(bills: list[dict[str, Any]]) -> dict[tuple[str, str, str, int], dict[str, Any]]:
    out: dict[tuple[str, str, str, int], dict[str, Any]] = {}
    for b in bills:
        seen: dict[tuple[str, str], int] = {}
        for i in b.get("items") or []:
            k2 = (_norm(i.get("item_code")), _norm(i.get("description")))
            n = seen.get(k2, 0)
            seen[k2] = n + 1
            out[(str(b.get("bill_code")), k2[0], k2[1], n)] = {**i, "bill_code": b.get("bill_code")}
    return out


def _money(i: dict[str, Any]) -> dict[str, float | None]:
    return {"contract_qty": None if i.get("contract_qty") is None else float(_dec(i.get("contract_qty"))),
            "rate": None if i.get("rate") is None else float(_dec(i.get("rate"))),
            "contract_amount": None if i.get("contract_amount") is None else float(_dec(i.get("contract_amount")))}


def _differs(a: dict[str, Any], b: dict[str, Any]) -> bool:
    for f in ("contract_qty", "rate", "contract_amount"):
        if abs(_dec(a.get(f)) - _dec(b.get(f))) > TOL:
            return True
    return _norm(a.get("unit")) != _norm(b.get("unit"))


def diff_bills(current: list[dict[str, Any]], proposed: list[dict[str, Any]],
               current_adders: list[dict[str, Any]] | None = None,
               proposed_adders: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    cur, new = _index(current), _index(proposed)
    cur_codes = {str(b.get("bill_code")) for b in current}
    new_codes = {str(b.get("bill_code")) for b in proposed}

    added, removed, changed = [], [], []
    for k, i in new.items():
        if k not in cur:
            added.append({"bill_code": i["bill_code"], "item_code": i.get("item_code"),
                          "description": i.get("description"), "new": _money(i)})
        elif _differs(cur[k], i):
            changed.append({"bill_code": i["bill_code"], "item_code": i.get("item_code"),
                            "description": i.get("description"), "old": _money(cur[k]), "new": _money(i),
                            "delta": float(_dec(i.get("contract_amount")) - _dec(cur[k].get("contract_amount")))})
    for k, i in cur.items():
        if k not in new:
            removed.append({"bill_code": i["bill_code"], "item_code": i.get("item_code"),
                            "description": i.get("description"), "old": _money(i)})

    works_cur = sum((_dec(i.get("contract_amount")) for i in cur.values()), Decimal("0"))
    works_new = sum((_dec(i.get("contract_amount")) for i in new.values()), Decimal("0"))
    return {
        "bills_added": sorted(new_codes - cur_codes),
        "bills_removed": sorted(cur_codes - new_codes),
        "items_added": added,
        "items_removed": removed,
        "items_changed": changed,
        "unchanged": sum(1 for k in new if k in cur and not _differs(cur[k], new[k])),
        "works_current": float(works_cur),
        "works_proposed": float(works_new),
        "works_delta": float(works_new - works_cur),
        "adders_changed": (current_adders or []) != (proposed_adders or []),
    }
