"""Pure parsing functions for the project register (Award Letters parser v2).

Design contract (PRD v2 §8.1 + tasks T1.4/T1.5):
  - NEVER raises on bad input — every failure returns a structured reason.
  - NEVER silently drops information — the raw value always travels with
    the result, and anything ambiguous carries a reason/warning the caller
    must route to the review queue.
  - Deterministic and side-effect free: unit-testable in isolation.

These functions are wired into the parser in T1.8; until then the legacy
functions in award_letters_parser.py remain the live (golden-locked) path.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

# ---------------------------------------------------------------------------
# Shared vocabulary
# ---------------------------------------------------------------------------

#: Values that mean "deliberately no data" — not a parse failure.
NOISE_VALUES: frozenset[str] = frozenset({
    "nil", "nill", "n/a", "na", "n.a", "-", "none", "", "tbc", "tbd",
})

#: Narrative status words that carry meaning but no parseable date.
NARRATIVE_STATUS_VALUES: frozenset[str] = frozenset({
    "ongoing", "not yet due", "abuja to advice", "100% claimed",
})

_MONTH_PAT = (
    r"(?:January|February|March|April|May|June|July|August|"
    r"September|October|November|December|"
    r"Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
)

_MONTH_TYPOS: dict[str, str] = {
    "februar": "February",
    "novemebr": "November",
    "novemeber": "November",
    "septmber": "September",
    "sepetember": "September",
    "ocotber": "October",
    "agust": "August",
    "feburary": "February",
    "januray": "January",
}

_MONTH_WORDS: frozenset[str] = frozenset(
    m.lower()
    for m in (
        "January February March April May June July August September "
        "October November December Jan Feb Mar Apr May Jun Jul Aug Sep "
        "Oct Nov Dec".split()
    )
)

_DATE_FORMATS = [
    "%d %B, %Y", "%d %B %Y", "%B %d, %Y", "%B %d %Y",
    "%d %b, %Y", "%d %b %Y", "%b %d, %Y", "%b %d %Y",
    "%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%d", "%d-%m-%Y",
    "%d-%B-%Y", "%d-%b-%Y",
    "%B, %Y", "%B %Y", "%b, %Y", "%b %Y",
    "%Y",
]


# ---------------------------------------------------------------------------
# T1.5 — date parsing
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ParsedDate:
    """Result of parsing one register date cell.

    reason values:
      None                  clean parse — trust the value
      'empty'               cell empty / not text
      'noise'               deliberate no-data marker ("Nil", "-", "N/A")
      'narrative_status'    status words with no date ("Ongoing")
      'narrative_with_date' date extracted from prose — review recommended
      'narrative_no_date'   prose with no extractable date — review required
      'multi_date'          several dates present; first taken — review
      'unparseable'         nothing worked — review required
    """

    value: date | None
    raw: str | None
    reason: str | None

    @property
    def needs_review(self) -> bool:
        return self.reason in (
            "narrative_with_date", "narrative_no_date", "multi_date", "unparseable"
        )


def _clean_date_text(text: str) -> str:
    cleaned = text
    for typo, fix in _MONTH_TYPOS.items():
        cleaned = re.sub(rf"\b{typo}\b", fix, cleaned, flags=re.IGNORECASE)
    # ordinal suffixes incl. the "4ht" typo
    cleaned = re.sub(r"(\d+)(st|nd|rd|th|ht)\b", r"\1", cleaned, flags=re.IGNORECASE)
    # "JAN,8, 2018" → "JAN 8, 2018"
    cleaned = re.sub(r"([A-Za-z]{3,}),\s*(\d{1,2})\b", r"\1 \2", cleaned)
    # "13 December. 2012" → "13 December, 2012"
    cleaned = re.sub(r"\.(\s*\d{4})", r",\1", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().rstrip(",.").strip()
    return cleaned


def _try_formats(cleaned: str) -> date | None:
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return None


def _find_date_mentions(cleaned: str) -> list[str]:
    """All 'day Month year' / 'Month year' substrings, day-form first."""
    full = [
        f"{m.group(1)} {m.group(2)}, {m.group(3)}"
        for m in re.finditer(
            rf"\b(\d{{1,2}})\s+({_MONTH_PAT}),?\s+(\d{{4}})\b", cleaned, re.IGNORECASE
        )
    ]
    if full:
        return full
    return [
        f"{m.group(1)} {m.group(2)}"
        for m in re.finditer(rf"\b({_MONTH_PAT}),?\s+(\d{{4}})\b", cleaned, re.IGNORECASE)
    ]


def _has_narrative_words(cleaned: str) -> bool:
    """True when the text contains words that are not part of a date."""
    for word in re.findall(r"[A-Za-z]{3,}", cleaned):
        if word.lower() not in _MONTH_WORDS:
            return True
    return False


def parse_register_date(raw: Any) -> ParsedDate:
    """Parse one register date cell. Never raises."""
    try:
        # Already a real date/datetime (openpyxl/pandas often deliver these)
        if isinstance(raw, datetime):
            return ParsedDate(raw.date(), str(raw), None)
        if isinstance(raw, date):
            return ParsedDate(raw, str(raw), None)

        if raw is None:
            return ParsedDate(None, None, "empty")

        text = str(raw).strip()
        if not text:
            return ParsedDate(None, None, "empty")

        lowered = text.lower().rstrip(".").strip()
        if lowered in NOISE_VALUES or lowered in ("no", "yes"):
            return ParsedDate(None, text, "noise")
        if lowered in NARRATIVE_STATUS_VALUES:
            return ParsedDate(None, text, "narrative_status")

        cleaned = _clean_date_text(text)

        # Multiple dates joined by '&' → take the first, flag it
        if "&" in cleaned:
            first = cleaned.split("&")[0].strip().rstrip(",").strip()
            value = _try_formats(first)
            if value is None:
                mentions = _find_date_mentions(first)
                value = _try_formats(mentions[0]) if mentions else None
            return ParsedDate(value, text, "multi_date" if value else "unparseable")

        # Straight parse of the whole cleaned string
        value = _try_formats(cleaned)
        if value is not None:
            return ParsedDate(value, text, None)

        # Comma-chained dates: "15 February, 2001, 16 November, 2006"
        parts = [p.strip() for p in cleaned.split(",")]
        if len(parts) >= 3:
            candidate = f"{parts[0]}, {parts[1]}"
            value = _try_formats(candidate)
            if value is not None:
                return ParsedDate(value, text, "multi_date")

        # Date embedded in prose: "Applied for 17 November, 2014"
        mentions = _find_date_mentions(cleaned)
        if mentions:
            value = _try_formats(mentions[0])
            if value is not None:
                reason = "multi_date" if len(mentions) > 1 else (
                    "narrative_with_date" if _has_narrative_words(cleaned) else None
                )
                return ParsedDate(value, text, reason)

        if _has_narrative_words(cleaned):
            return ParsedDate(None, text, "narrative_no_date")
        return ParsedDate(None, text, "unparseable")

    except Exception:  # defensive backstop — contract says never raise
        return ParsedDate(None, str(raw) if raw is not None else None, "unparseable")


# ---------------------------------------------------------------------------
# T1.4 — contract sum decomposition
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ContractSum:
    """Decomposed contract sum.

    warnings values (any combination):
      'revised_used_final'      "Revised from X to Y" → Y used
      'multi_currency'          NGN + foreign amounts present; NGN used
      'foreign_currency'        sum is not in NGN
      'total_mismatch'          original + variation != stated total (>1% off)
      'ambiguous_numbers'       several numbers, structure unclear; first used
      'no_numbers_found'        text cell with nothing numeric — review
    """

    original: float | None
    variation: float | None
    total: float | None
    currency: str | None
    raw: str | None
    warnings: tuple[str, ...] = field(default=())

    @property
    def needs_review(self) -> bool:
        return any(
            w in ("total_mismatch", "ambiguous_numbers", "no_numbers_found")
            for w in self.warnings
        )


def _extract_numbers(text: str) -> list[float]:
    cleaned = text.replace("N", "").replace("₦", "").replace("€", "").replace("$", "")
    out: list[float] = []
    for token in re.findall(r"[\d][\d,]*\.?\d*", cleaned):
        try:
            val = float(token.replace(",", ""))
        except ValueError:
            continue
        if val > 0:
            out.append(val)
    return out


def parse_register_contract_sum(raw: Any) -> ContractSum:
    """Decompose one contract-sum cell. Never raises."""
    try:
        if raw is None or (isinstance(raw, float) and raw != raw):  # NaN check
            return ContractSum(None, None, None, None, None)

        if isinstance(raw, (int, float)):
            return ContractSum(float(raw), None, None, "NGN", str(raw))

        text = str(raw).strip()
        if not text or text.lower().rstrip(".") in NOISE_VALUES:
            return ContractSum(None, None, None, None, text or None)

        lowered = text.lower()

        # Foreign / mixed currency first — number extraction differs
        if "ngn" in lowered and "usd" in lowered:
            m = re.search(r"([\d,]+\.?\d*)\s*NGN", text, re.IGNORECASE)
            if m:
                return ContractSum(
                    float(m.group(1).replace(",", "")), None, None, "NGN", text,
                    ("multi_currency",),
                )
        if "euro" in lowered or "eur " in lowered:
            nums = _extract_numbers(text)
            if nums:
                return ContractSum(nums[0], None, None, "EUR", text, ("foreign_currency",))
        if "usd" in lowered or "dollar" in lowered:
            nums = _extract_numbers(text)
            if nums:
                return ContractSum(nums[0], None, None, "USD", text, ("foreign_currency",))

        # "Revised from X to Y" / "Revised to Y from X" / "X then to Y"
        if "revised" in lowered or "then to" in lowered:
            m_to = re.search(r"\bto:?\s+([\d,]+\.?\d*)", text, re.IGNORECASE)
            nums = _extract_numbers(text)
            final = (
                float(m_to.group(1).replace(",", "")) if m_to
                else (nums[-1] if nums else None)
            )
            if final is not None:
                return ContractSum(final, None, None, "NGN", text, ("revised_used_final",))
            return ContractSum(None, None, None, None, text, ("no_numbers_found",))

        # "Original: X, Variation: Y, TOTAL: Z" and variants
        has_structure = "original" in lowered or "variation" in lowered or "total" in lowered
        if has_structure:
            m_total = re.search(r"total\s*:?\s*([\d,]+\.?\d*)", text, re.IGNORECASE)
            total = float(m_total.group(1).replace(",", "")) if m_total else None
            nums = _extract_numbers(text)
            if total is not None and total in nums:
                nums = [n for n in nums if n != total] or nums
            original = nums[0] if nums else None
            variation = nums[1] if len(nums) >= 2 else None

            warnings: list[str] = []
            if total is not None and original is not None and variation is not None:
                if abs((original + variation) - total) > 0.01 * total:
                    warnings.append("total_mismatch")
            if len(nums) > 2:
                warnings.append("ambiguous_numbers")
            return ContractSum(original, variation, total, "NGN", text, tuple(warnings))

        # Generic
        nums = _extract_numbers(text)
        if not nums:
            return ContractSum(None, None, None, None, text, ("no_numbers_found",))
        if len(nums) == 1:
            return ContractSum(nums[0], None, None, "NGN", text)
        return ContractSum(nums[0], None, None, "NGN", text, ("ambiguous_numbers",))

    except Exception:  # defensive backstop — contract says never raise
        return ContractSum(
            None, None, None, None,
            str(raw) if raw is not None else None,
            ("no_numbers_found",),
        )
