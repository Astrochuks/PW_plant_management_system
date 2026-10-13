"""Text conventions shared by the API and the UI.

title_case(): the house style for project names, short names and clients
(decision 2026-10-13: Title Case everywhere, whatever was typed). The
TypeScript twin is `titleCase()` in frontend/src/lib/format.ts — the two
must agree; tests/test_text.py holds the golden cases both are checked
against.

Rules
  - whitespace trimmed and collapsed
  - every word capitalised, the rest lowered: CONSTRUCTION → Construction
  - small words stay lower unless they open the name: of, and, the, in,
    at, on, for, to, a, an, by, with, from, over, via
  - parts around '-', '–', '/' are each capitalised: MARU - LUGGA, U/SARKI
  - words with digits keep the leading letter run capitalised and letter
    runs after a digit lowered: 6TH → 6th, 16.5KM → 16.5km, CH30 → Ch30,
    LOT2 → Lot2, 2-SPAN → 2-Span
  - known acronyms stay upper: LGA, FCT, FERMA, NNPC, NDDC, PHCN, JV, II–IV
  - the apostrophe lowers what follows: CHONG'O'PYENG → Chong'o'pyeng
"""

from __future__ import annotations

import re

SMALL_WORDS = frozenset(
    "of and the in at on for to a an by with from over via".split())
ACRONYMS = frozenset(
    "LGA LGAS FCT FERMA NNPC NDDC PHCN KRPC JV II III IV VI VII VIII IX".split())

_SEP = re.compile(r"([\-–/])")


def _cap_core(core: str) -> str:
    if not core:
        return core
    upper = core.upper()
    if upper in ACRONYMS:
        return upper
    if any(ch.isdigit() for ch in core):
        # leading letters capitalised; letters after a digit lowered
        out, after_digit, first = [], False, True
        for ch in core:
            if ch.isdigit():
                after_digit = True
                out.append(ch)
            elif ch.isalpha():
                out.append(ch.lower() if (after_digit or not first) else ch.upper())
                first = False
            else:
                out.append(ch)
        return "".join(out)
    low = core.lower()
    # apostrophes: Chong'o'pyeng — capitalise only the first letter
    return low[0].upper() + low[1:]


def _title_word(word: str, first: bool) -> str:
    # peel punctuation that wraps the word: (NINE) → (Nine), "ROAD." → "Road."
    m = re.match(r"^([^\w]*)(.*?)([^\w]*)$", word)
    lead, core, trail = m.group(1), m.group(2), m.group(3)
    if not core:
        return word
    if not first and core.lower() in SMALL_WORDS and core.upper() not in ACRONYMS:
        return lead + core.lower() + trail
    parts = _SEP.split(core)  # keeps the separators
    parts = [p if _SEP.fullmatch(p) else _cap_core(p) for p in parts]
    return lead + "".join(parts) + trail


def slugify(value: str | None, max_len: int = 80) -> str:
    """A readable address segment: lower-case, hyphenated, ASCII letters and
    digits only, at most max_len characters, trimmed at a word boundary.
    'Akwa Ibom Airport Apron' → 'akwa-ibom-airport-apron'. Uniqueness is the
    caller's job (-2, -3 … suffixes)."""
    s = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    if len(s) > max_len:
        s = s[:max_len].rsplit("-", 1)[0] if "-" in s[:max_len] else s[:max_len]
    return s.strip("-")


def title_case(value: str | None) -> str | None:
    """House Title Case for a name; None stays None, blank stays blank."""
    if value is None:
        return None
    words = value.strip().split()
    if not words:
        return ""
    return " ".join(_title_word(w, i == 0) for i, w in enumerate(words))
