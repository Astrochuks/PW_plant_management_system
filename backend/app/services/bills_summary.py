"""The bill's summary — bills → works total → adders → contract figure.

Pure, unit-tested, Decimal throughout. One place computes it so the page,
the export and any report agree to the kobo. Each adder is applied in
order to a running subtotal that starts at the works total:

    percent_of_works    value % of the works total
    percent_of_running  value % of the running subtotal (VAT on top of
                        provisions, the usual last rung)
    amount              a fixed naira amount (a provisional sum)

Amounts are quantised to 2 dp — the stored precision (CLAUDE.md rule 1).
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

ADDER_KINDS = ("percent_of_works", "percent_of_running", "amount")
MAX_ADDERS = 12
TWO_DP = Decimal("0.01")


def _dec(v: Any) -> Decimal:
    return Decimal("0") if v is None else Decimal(str(v))


def _q(v: Decimal) -> Decimal:
    return v.quantize(TWO_DP, rounding=ROUND_HALF_UP)


def validate_adders(adders: Any) -> list[dict[str, Any]]:
    """Return a clean list or raise ValueError with a message for the user."""
    if adders is None:
        return []
    if not isinstance(adders, list):
        raise ValueError("adders must be a list")
    if len(adders) > MAX_ADDERS:
        raise ValueError(f"at most {MAX_ADDERS} adders")
    out: list[dict[str, Any]] = []
    for i, a in enumerate(adders, 1):
        if not isinstance(a, dict):
            raise ValueError(f"adder {i} must be an object")
        name = str(a.get("name") or "").strip()
        kind = a.get("kind")
        if not name or len(name) > 120:
            raise ValueError(f"adder {i}: name is required (max 120 characters)")
        if kind not in ADDER_KINDS:
            raise ValueError(f"adder {i} ({name}): kind must be one of {', '.join(ADDER_KINDS)}")
        try:
            value = Decimal(str(a.get("value")))
        except Exception as e:  # noqa: BLE001
            raise ValueError(f"adder {i} ({name}): value must be a number") from e
        if value < 0:
            raise ValueError(f"adder {i} ({name}): value cannot be negative")
        if kind != "amount" and value > 1000:
            raise ValueError(f"adder {i} ({name}): a percentage above 1000% is not a rate")
        out.append({"name": name, "kind": kind, "value": float(value)})
    return out


def compute_summary(bills: list[dict[str, Any]], adders: list[dict[str, Any]] | None) -> dict[str, Any]:
    """bills: [{bill_code, name, amount}] (amount = Σ items of that bill)."""
    rows = [{"bill_code": b.get("bill_code"), "name": b.get("name"), "amount": float(_q(_dec(b.get("amount"))))}
            for b in bills]
    works = _q(sum((_dec(b.get("amount")) for b in bills), Decimal("0")))
    running = works
    lines: list[dict[str, Any]] = []
    for a in adders or []:
        kind, value = a["kind"], _dec(a["value"])
        if kind == "percent_of_works":
            amount = _q(works * value / Decimal("100"))
        elif kind == "percent_of_running":
            amount = _q(running * value / Decimal("100"))
        else:
            amount = _q(value)
        running = _q(running + amount)
        lines.append({"name": a["name"], "kind": kind, "value": float(value),
                      "amount": float(amount), "running": float(running)})
    return {"bills": rows, "works_total": float(works), "lines": lines, "contract_total": float(running)}
