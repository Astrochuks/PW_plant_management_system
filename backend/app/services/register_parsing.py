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

# STRICT: the register's own three patterns only (day-month-year with
# ordinals handled upstream, month-year, bare year). Numeric slash/dash
# dates are ambiguous (DD/MM vs MM/DD) → they queue instead.
_DATE_FORMATS = [
    "%d %B, %Y", "%d %B %Y", "%B %d, %Y", "%B %d %Y",
    "%d %b, %Y", "%d %b %Y", "%b %d, %Y", "%b %d %Y",
    "%B, %Y", "%B %Y", "%b, %Y", "%b %Y",
    "%Y",
]


# ---------------------------------------------------------------------------
# T1.5 — date parsing
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ParsedDate:
    """Result of parsing one register date cell (STRICT rules, user decision
    2026-07-06: only the register's own patterns parse — "7th July, 2000",
    "July, 2000", "2000" — everything else queues with nothing written).

    reason values:
      None                  clean parse — trust the value
      'empty'               cell empty / not text
      'noise'               deliberate no-data marker ("Nil", "-", "N/A")
      'narrative_status'    status words with no date ("Ongoing") — review
      'narrative_with_date' date found in prose. Only written when the
                            field allows narrative extraction (retention
                            application date); elsewhere queued with the
                            extraction as a suggestion
      'narrative_no_date'   prose with no extractable date — review
      'multi_date'          several dates present; NOTHING written; first
                            date offered as suggestion — review
      'unparseable'         nothing worked — review
    """

    value: date | None
    raw: str | None
    reason: str | None
    suggestion: date | None = None
    needs_review: bool = False


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


def parse_register_date(raw: Any, *, allow_narrative: bool = False) -> ParsedDate:
    """Parse one register date cell under the STRICT rules. Never raises.

    allow_narrative=True (retention application date only): "Applied for
    17th November, 2014" → the date is extracted AND written. Everywhere
    else narrative text queues with the extraction as a suggestion.
    """
    try:
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
            return ParsedDate(None, text, "narrative_status", needs_review=True)

        cleaned = _clean_date_text(text)

        # Multiple dates → STRICT: write nothing, offer the first as a
        # suggestion for the human to confirm.
        mentions = _find_date_mentions(cleaned)
        is_multi = (
            "&" in cleaned
            or len(mentions) > 1
            or (len(cleaned.split(",")) >= 3 and len(mentions) >= 1
                and _try_formats(cleaned) is None
                and not _has_narrative_words(cleaned))
        )
        if is_multi:
            first = cleaned.split("&")[0].strip().rstrip(",").strip()
            suggestion = _try_formats(first)
            if suggestion is None and mentions:
                suggestion = _try_formats(mentions[0])
            return ParsedDate(
                None, text, "multi_date", suggestion=suggestion, needs_review=True
            )

        # Straight parse of the whole cleaned string — the clean path
        value = _try_formats(cleaned)
        if value is not None:
            return ParsedDate(value, text, None)

        # Prose containing exactly one date
        if mentions:
            extracted = _try_formats(mentions[0])
            if extracted is not None:
                if allow_narrative:
                    return ParsedDate(extracted, text, "narrative_with_date")
                return ParsedDate(
                    None, text, "narrative_with_date",
                    suggestion=extracted, needs_review=True,
                )

        if _has_narrative_words(cleaned):
            return ParsedDate(None, text, "narrative_no_date", needs_review=True)
        return ParsedDate(None, text, "unparseable", needs_review=True)

    except Exception:  # defensive backstop — contract says never raise
        return ParsedDate(
            None, str(raw) if raw is not None else None, "unparseable",
            needs_review=True,
        )


# ---------------------------------------------------------------------------
# T1.4 — contract sum decomposition
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ContractSum:
    """Decomposed contract sum (STRICT rules, user decision 2026-07-06):
    only a plain number parses ("2,000,982.7" → 2000982.7). Anything with
    letters, '&', 'Original:', 'Revised…' etc. parses NOTHING and queues,
    carrying the parser's best reading as suggestions for the human.
    """

    original: float | None
    variation: float | None
    total: float | None
    currency: str | None
    raw: str | None
    warnings: tuple[str, ...] = field(default=())
    needs_review: bool = False
    suggested_original: float | None = None
    suggested_variation: float | None = None


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


def _suggest_contract_decomposition(text: str) -> tuple[float | None, float | None]:
    """Best-effort (original, variation) reading of a non-plain contract-sum
    cell — used ONLY as queue suggestions, never written to the register."""
    lowered = text.lower()

    if "revised" in lowered or "then to" in lowered:
        m_to = re.search(r"\bto:?\s+([\d,]+\.?\d*)", text, re.IGNORECASE)
        if m_to:
            try:
                return float(m_to.group(1).replace(",", "")), None
            except ValueError:
                pass
        nums = _extract_numbers(text)
        return (nums[-1] if nums else None), None

    if "ngn" in lowered:
        m = re.search(r"([\d,]+\.?\d*)\s*NGN", text, re.IGNORECASE)
        if m:
            try:
                return float(m.group(1).replace(",", "")), None
            except ValueError:
                pass

    nums = _extract_numbers(text)
    m_total = re.search(r"total\s*:?\s*([\d,]+\.?\d*)", text, re.IGNORECASE)
    if m_total:
        try:
            total = float(m_total.group(1).replace(",", ""))
            nums = [n for n in nums if n != total] or nums
        except ValueError:
            pass
    original = nums[0] if nums else None
    variation = nums[1] if len(nums) >= 2 else None
    return original, variation


def parse_register_contract_sum(raw: Any) -> ContractSum:
    """STRICT: plain numbers only; everything else queues. Never raises."""
    try:
        if raw is None or (isinstance(raw, float) and raw != raw):  # NaN
            return ContractSum(None, None, None, None, None)

        if isinstance(raw, (int, float)):
            return ContractSum(float(raw), None, None, "NGN", str(raw))

        text = str(raw).strip()
        if not text or text.lower().rstrip(".") in NOISE_VALUES:
            return ContractSum(None, None, None, None, text or None)

        # The ONLY accepted text shape: digits with comma separators and an
        # optional decimal part, e.g. "2,000,982.7"
        if re.fullmatch(r"\d[\d,]*(?:\.\d+)?", text):
            try:
                return ContractSum(float(text.replace(",", "")), None, None, "NGN", text)
            except ValueError:
                pass  # falls through to review

        so, sv = _suggest_contract_decomposition(text)
        return ContractSum(
            None, None, None, None, text,
            warnings=("not_plain_number",),
            needs_review=True,
            suggested_original=so,
            suggested_variation=sv,
        )

    except Exception:  # defensive backstop — contract says never raise
        return ContractSum(
            None, None, None, None,
            str(raw) if raw is not None else None,
            warnings=("not_plain_number",), needs_review=True,
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


# ---------------------------------------------------------------------------
# Client identity (user decisions 2026-07-06)
# ---------------------------------------------------------------------------
# - Sheet names are NOT clients. Row 2 of each sheet is a group label; the
#   Client column holds real clients; blank cells inherit the group.
# - Categories derive from the sheet: state-named → state_government;
#   FAAN/FMW/FERMA/FCDA → federal_government; PRIVATE CLIENTS → private.
# - "Govt." expands to "Government"; "Government of Akwa Ibom (State)" and
#   "Akwa Ibom State Govt" are the SAME client → "Akwa Ibom State Government".

CLIENT_CATEGORIES = ("state_government", "federal_government", "private")

_FEDERAL_SHEETS: frozenset[str] = frozenset({"FAAN", "FMW", "FERMA", "FCDA", "FCDA ABUJA"})


def sheet_client_category(sheet_name: str) -> str | None:
    """state_government | federal_government | private, from the sheet name."""
    key = (sheet_name or "").strip()
    if key.lower() in STATE_CANONICAL:
        return "state_government"
    if key.upper() in _FEDERAL_SHEETS:
        return "federal_government"
    if key.upper() == "PRIVATE CLIENTS":
        return "private"
    return None


_GOVT_TOKEN = re.compile(r"\bGOVT\b\.?|\bGOV\b\.?|\bGOVN'?T\b\.?", re.IGNORECASE)


@dataclass(frozen=True)
class ClientIdentity:
    """Canonical identity for one client mention."""

    display_name: str
    normalized_name: str
    client_type: str | None
    state_name: str | None = None   # for state governments
    confident: bool = True


def _smart_title(text: str) -> str:
    """Title-case that preserves acronyms (FAAN, FMW, RCCG…)."""
    words = []
    for w in text.split():
        if w.isupper() and 2 <= len(w) <= 6:
            words.append(w)
        else:
            words.append(w.capitalize() if w.islower() or w.isupper() else w)
    return " ".join(words)


def canonicalize_client(
    raw: Any,
    category: str | None,
    sheet_state: str | None = None,
) -> ClientIdentity | None:
    """Canonical client identity for a Client-column value. Never raises.

    Returns None for empty input (caller falls back to the sheet's group
    label / state government). confident=False → review queue.
    """
    try:
        text = re.sub(r"\s+", " ", str(raw or "").replace("_x000D_", " ")).strip(" .,;")
        if not text:
            return None

        expanded = _GOVT_TOKEN.sub("GOVERNMENT", text.upper())
        expanded = re.sub(r"\s+", " ", expanded).strip(" .,")

        # State-government patterns → one canonical entity per state
        for pattern in (
            r"^(?:THE\s+)?GOVERNMENT\s+OF\s+(.+?)(?:\s+STATE)?$",
            r"^(?:THE\s+)?(.+?)\s+STATE\s+GOVERNMENT$",
            # bare "Adamawa State" in a Client cell IS the state government
            r"^(?:THE\s+)?(.+?)\s+STATE$",
        ):
            m = re.match(pattern, expanded)
            if m:
                candidate = m.group(1).strip().lower()
                if candidate in STATE_CANONICAL:
                    state = STATE_CANONICAL[candidate]
                    display = f"{state} State Government"
                    return ClientIdentity(
                        display,
                        normalize_client_name(display),
                        "state_government",
                        state_name=state,
                    )

        # Everything else: cleaned display, category from the sheet
        display = _smart_title(_GOVT_TOKEN.sub("Government", text))
        display = re.sub(r"\s+", " ", display).strip(" .,")
        return ClientIdentity(
            display,
            normalize_client_name(display),
            category,
            state_name=None,
            confident=category is not None,
        )
    except Exception:  # defensive backstop
        return ClientIdentity(
            str(raw)[:200], normalize_client_name(raw), category, confident=False
        )


def default_client_for_sheet(sheet_name: str) -> ClientIdentity | None:
    """The client a blank Client cell inherits on a state-named sheet."""
    key = (sheet_name or "").strip().lower()
    state = STATE_CANONICAL.get(key)
    if state is None:
        return None
    display = f"{state} State Government"
    return ClientIdentity(
        display, normalize_client_name(display), "state_government", state_name=state
    )
