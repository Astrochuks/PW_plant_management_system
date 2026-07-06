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


# ---------------------------------------------------------------------------
# T1.6 — state resolution
# ---------------------------------------------------------------------------

#: 36 states + FCT, lowercase → canonical
STATE_CANONICAL: dict[str, str] = {
    "abia": "Abia", "adamawa": "Adamawa", "akwa ibom": "Akwa Ibom",
    "anambra": "Anambra", "bauchi": "Bauchi", "bayelsa": "Bayelsa",
    "benue": "Benue", "borno": "Borno", "cross river": "Cross River",
    "delta": "Delta", "ebonyi": "Ebonyi", "edo": "Edo", "ekiti": "Ekiti",
    "enugu": "Enugu", "gombe": "Gombe", "imo": "Imo", "jigawa": "Jigawa",
    "kaduna": "Kaduna", "kano": "Kano", "katsina": "Katsina",
    "kebbi": "Kebbi", "kogi": "Kogi", "kwara": "Kwara", "lagos": "Lagos",
    "nasarawa": "Nasarawa", "niger": "Niger", "ogun": "Ogun", "ondo": "Ondo",
    "osun": "Osun", "oyo": "Oyo", "plateau": "Plateau", "rivers": "Rivers",
    "sokoto": "Sokoto", "taraba": "Taraba", "yobe": "Yobe",
    "zamfara": "Zamfara", "fct": "FCT", "abuja": "FCT",
}

#: Recurring landmarks/areas in this register → state. Curated reference
#: data (like fleet_number_prefixes); extend as new names appear.
LANDMARK_STATES: dict[str, str] = {
    # Lagos areas
    "lekki": "Lagos", "ajah": "Lagos", "apapa": "Lagos", "epe": "Lagos",
    "ikeja": "Lagos", "ikota": "Lagos", "elegushi": "Lagos", "ijora": "Lagos",
    "badagry": "Lagos", "tin can": "Lagos", "yaba": "Lagos", "iddo": "Lagos",
    "ebute metta": "Lagos", "mmia": "Lagos", "murtala muhammed": "Lagos",
    "ejigbo": "Lagos",
    # FCT
    "jabi": "FCT", "gudu": "FCT", "karu": "FCT", "kubwa": "FCT",
    "zuba": "FCT", "abaji": "FCT",
    # Plateau
    "jos": "Plateau", "vom": "Plateau", "manchok": "Plateau",
    "panyam": "Plateau", "shendam": "Plateau", "bukuru": "Plateau",
    # Others
    "ibadan": "Oyo", "ogoja": "Cross River", "ikom": "Cross River",
    "suleja": "Niger", "jalingo": "Taraba", "uyo": "Akwa Ibom",
    "minna": "Niger", "kontagora": "Niger",
}

#: Words that make a bare state-name mention NOT a state reference.
#: e.g. "River Niger", "Niger Barracks", "Niger Delta".
_STATE_FALSE_POSITIVE_PATTERNS: tuple[tuple[str, str], ...] = (
    ("niger", r"(?:river\s+niger|niger\s+(?:barracks|delta|republic))"),
    ("delta", r"(?:niger\s+delta)"),
    ("rivers", r"(?:across\s+rivers|and\s+rivers)"),
    ("katsina", r"katsina\s+ala"),  # Katsina Ala is a town in Benue
)


@dataclass(frozen=True)
class ResolvedState:
    """Result of resolving a project's state.

    method: 'sheet' | 'explicit_state' | 'state_mention' | 'landmark'
            | 'sheet_text' | 'client_default' | None
    reason (when state is None): 'ambiguous_states' | 'no_state_found'
    """

    state: str | None
    method: str | None
    reason: str | None = None
    candidates: tuple[str, ...] = ()

    @property
    def needs_review(self) -> bool:
        return self.state is None


def _distinct_states_in(text: str, *, explicit_only: bool) -> list[str]:
    """Ordered distinct canonical states mentioned in text.

    explicit_only=True → only 'X State(s)' phrases (highest confidence).
    explicit_only=False → bare word-bounded mentions, with false-positive
    guards applied.
    """
    lowered = text.lower()
    found: list[str] = []

    def _add(canonical: str) -> None:
        if canonical not in found:
            found.append(canonical)

    names = sorted(STATE_CANONICAL, key=len, reverse=True)  # multi-word first

    if explicit_only:
        # Only state names IMMEDIATELY adjacent to the "State(s)" keyword,
        # allowing joined lists: "Enugu / Kogi States" → both; but
        # "Katsina Ala ... in Benue State" → Benue only (not Katsina).
        name_alt = "|".join(re.escape(n) for n in names)
        pattern = (
            rf"\b((?:{name_alt})(?:\s*[/&,]\s*(?:{name_alt}))*)\s+states?\b"
        )
        for m in re.finditer(pattern, lowered):
            for part in re.split(r"\s*[/&,]\s*", m.group(1)):
                key = part.strip()
                if key in STATE_CANONICAL:
                    _add(STATE_CANONICAL[key])
        return found

    for name in names:
        if not re.search(rf"\b{re.escape(name)}\b", lowered):
            continue
        guard = next(
            (g for n, g in _STATE_FALSE_POSITIVE_PATTERNS if n == name), None
        )
        if guard and re.search(guard, lowered):
            # Guard hit — but a separate legitimate mention may still exist,
            # e.g. "Niger Barracks ... in Niger State" (explicit pass catches
            # that case, so here we simply skip).
            continue
        _add(STATE_CANONICAL[name])
    return found


def _landmark_states_in(text: str) -> list[str]:
    lowered = text.lower()
    found: list[str] = []
    for landmark, state in LANDMARK_STATES.items():
        if re.search(rf"\b{re.escape(landmark)}\b", lowered) and state not in found:
            found.append(state)
    return found


def resolve_state(
    project_name: str,
    sheet_name: str,
    client_default_state: str | None = None,
) -> ResolvedState:
    """Resolve the state for one register row. Never raises.

    Pass order (PRD v2 FR-A1, hardcoded row-index maps removed):
      0. sheet named after a state              → that state
      1. explicit "X State" phrase in name      → single: resolve; multi: queue
      2. bare state mention (guarded)           → single: resolve; multi: queue
      3. curated landmark match                 → single: resolve; multi: queue
      4. state mention in the sheet name        → e.g. "FCDA ABUJA" → FCT
      5. client default state                   → resolve
      6. nothing                                → queue
    """
    try:
        sheet_key = (sheet_name or "").strip().lower()
        if sheet_key in STATE_CANONICAL:
            return ResolvedState(STATE_CANONICAL[sheet_key], "sheet")

        name = str(project_name or "")

        explicit = _distinct_states_in(name, explicit_only=True)
        if len(explicit) == 1:
            return ResolvedState(explicit[0], "explicit_state")
        if len(explicit) > 1:
            return ResolvedState(None, None, "ambiguous_states", tuple(explicit))

        mentions = _distinct_states_in(name, explicit_only=False)
        if len(mentions) == 1:
            return ResolvedState(mentions[0], "state_mention")
        if len(mentions) > 1:
            return ResolvedState(None, None, "ambiguous_states", tuple(mentions))

        landmarks = _landmark_states_in(name)
        if len(landmarks) == 1:
            return ResolvedState(landmarks[0], "landmark")
        if len(landmarks) > 1:
            return ResolvedState(None, None, "ambiguous_states", tuple(landmarks))

        sheet_mentions = _distinct_states_in(sheet_name or "", explicit_only=False)
        if len(sheet_mentions) == 1:
            return ResolvedState(sheet_mentions[0], "sheet_text")

        if client_default_state:
            return ResolvedState(client_default_state, "client_default")

        return ResolvedState(None, None, "no_state_found")
    except Exception:  # defensive backstop — contract says never raise
        return ResolvedState(None, None, "no_state_found")


def extract_client_default_state(client_name: Any) -> str | None:
    """State implied by a client's own name ("Plateau State Govt." → Plateau).

    Used to seed clients.default_state_id. Returns None unless exactly one
    state is mentioned — never guesses.
    """
    try:
        if not client_name:
            return None
        states = _distinct_states_in(str(client_name), explicit_only=False)
        return states[0] if len(states) == 1 else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# T1.7 — project type / work nature classification
# ---------------------------------------------------------------------------

PROJECT_TYPES = (
    "road", "bridge", "drainage", "building", "airport", "water",
    "infrastructure", "other",
)
WORK_NATURES = (
    "construction", "dualization", "rehabilitation", "maintenance",
    "emergency_repair", "completion",
)

#: type → keyword patterns. Order of the OUTER list is only a tiebreak;
#: primary asset = the type whose keyword appears EARLIEST in the name
#: ("Roads & Bridges" → road; "Bridge with Approach Roads" → bridge).
_TYPE_PATTERNS: tuple[tuple[str, str], ...] = (
    ("airport", r"\bairports?\b(?!\s+road)|\bapron\b|\brunway\b|\btaxiway\b|\bairfield\b"),
    ("bridge", r"\bbridges?\b|\bflyover\b"),
    ("water", r"\bwater\s+(?:schemes?|tanks?|works|supply)\b|\bborehole\b|\bdam\b"),
    ("drainage", r"\bdrain(?:age|s)?\b|\bculverts?\b|\berosion\b|\bflood\b|\bcanal\b"
                 r"|\bdredging\b|\bchanneli[sz]ation\b|\bcreek\b"),
    ("building", r"\bbuildings?\b|\bmarket\b|\bhospital\b|\bschool\b|\bchurch\b"
                 r"|\bmosque\b|\bhostel\b|\bquarters\b|\bhous(?:e|ing)\b|\bestate\b"
                 r"|\bcomplex\b|\boffice\b|\bstadium\b"),
    # NOTE: work-verbs (asphalt/overlay/pavement) deliberately NOT here —
    # they describe the work, not the asset ("Overlay of Airport Runway"
    # is an airport job). They live in _NATURE_PATTERNS instead.
    ("road", r"\broads?\b|\bdualiz?s?ation\b|\bdualisation\b|\bcarriageway\b"
             r"|\bexpressway\b|\bstreets?\b|\bbye?-?pass\b|\bring\s+road\b"
             r"|\bjunction\b|\binterchange\b"
             r"|\bhighway\b|\blanes?\b|\bspur\b|\bcres(?:c)?ents?\b"
             r"|\bloop\b|\bterminus\b"),
    ("infrastructure", r"\binfrastructur\w*\b|\bearthworks?\b|\blandscaping\b"
                       r"|\bjetty\b|\bferry\b|\bconveyor\b|\breclamation\b"
                       r"|\bfence\b|\bwall\b|\bpipe\s+works?\b|\baerators?\b"
                       r"|\bsite\s+development\b|\bexternal\s+works\b"
                       r"|\bmotor\s+park\b"),
)

_NATURE_PATTERNS: tuple[tuple[str, str], ...] = (
    # Priority order (first match wins) — most specific verbs first
    ("emergency_repair", r"\bemergency\b"),
    ("dualization", r"\bdualiz?s?ation\b|\bdualisation\b"),
    ("completion", r"\bcompletion\s+of\b|\bremobiliz?s?ation\b"),
    ("maintenance", r"\bmaintenance\b"),
    ("rehabilitation", r"\brehabilitation\b|\breconstru?ction\b|\brecoonstruction\b"
                       r"|\breconstuction\b|\bupgrading\b|\brenovation\b"
                       r"|\bremedial\b|\brepairs?\b|\boverlay\b|\bstrengthening\b"
                       r"|\brealignment\b|\bscarification\b|\basphalting\b"
                       r"|\bdredging\b"),
    ("construction", r"\bconstruction\b|\bprovision\b|\bdevelopment\b"
                     r"|\bextension\b|\bimprovement\b|\bdualiz?s?ation\b"),
)


@dataclass(frozen=True)
class ClassifiedProject:
    """project_type/work_nature guess for one register row.

    confident=False → the caller must queue for human confirmation and
    must NOT write the guess as authoritative.
    """

    project_type: str
    work_nature: str
    confident: bool
    type_matches: tuple[str, ...] = ()
    type_confident: bool = False
    nature_confident: bool = False

    @property
    def needs_review(self) -> bool:
        return not self.confident


def classify_project(project_name: Any) -> ClassifiedProject:
    """Classify a project by its register name. Never raises.

    The primary asset is the type whose keyword appears EARLIEST in the
    name — "Construction of Roads & Bridges" is a road job with bridges,
    "Kpantinapu Bridge with Approach Roads" is a bridge job with roads.
    """
    try:
        name = str(project_name or "").lower()
        if not name.strip():
            return ClassifiedProject("other", "construction", False)

        # --- type: earliest keyword position wins -------------------------
        hits: list[tuple[int, str]] = []
        for ptype, pattern in _TYPE_PATTERNS:
            m = re.search(pattern, name)
            if m:
                hits.append((m.start(), ptype))
        hits.sort()
        matched_types = tuple(t for _, t in hits)

        if not hits:
            project_type, type_confident = "other", False
        else:
            project_type, type_confident = hits[0][1], True

        # --- nature: priority order ----------------------------------------
        work_nature, nature_confident = "construction", False
        for nature, pattern in _NATURE_PATTERNS:
            if re.search(pattern, name):
                work_nature, nature_confident = nature, True
                break

        return ClassifiedProject(
            project_type=project_type,
            work_nature=work_nature,
            confident=type_confident and nature_confident,
            type_matches=matched_types,
            type_confident=type_confident,
            nature_confident=nature_confident,
        )
    except Exception:  # defensive backstop — contract says never raise
        return ClassifiedProject("other", "construction", False)


def normalize_client_name(name: Any) -> str:
    """Canonical client-matching key: uppercase, punctuation stripped,
    whitespace collapsed. 'Plateau State Govt.' == 'PLATEAU STATE GOVT'."""
    s = re.sub(r"[^\w\s]", " ", str(name or "").upper())
    return re.sub(r"\s+", " ", s).strip()
