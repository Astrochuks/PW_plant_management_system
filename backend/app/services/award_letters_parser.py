"""Award Letters Excel parser.

Parses the Award Letters workbook (17 sheets, each named after a client/state).
Each sheet has 15 columns with identical structure. Handles free-text dates,
narrative contract sums, and varied status values.

State assignment logic:
- Sheets named after Nigerian states → state = sheet name
- FERMA → extract state from project name text
- PRIVATE CLIENTS → hardcoded by row index
- FCDA ABUJA → all FCT (Abuja)
- FAAN → hardcoded by row index
- FMW → hardcoded by row index
"""

import io
import re
from datetime import date, datetime
from typing import Any
from uuid import uuid4

import pandas as pd

from app.monitoring.logging import get_logger

logger = get_logger(__name__)

# Max length for project_name in the DB
_MAX_PROJECT_NAME_LEN = 500

# ── All 36 Nigerian states + FCT ──────────────────────────────────────────
NIGERIAN_STATES: set[str] = {
    "abia", "adamawa", "akwa ibom", "anambra", "bauchi", "bayelsa",
    "benue", "borno", "cross river", "delta", "ebonyi", "edo",
    "ekiti", "enugu", "gombe", "imo", "jigawa", "kaduna", "kano",
    "katsina", "kebbi", "kogi", "kwara", "lagos", "nasarawa",
    "niger", "ogun", "ondo", "osun", "oyo", "plateau", "rivers",
    "sokoto", "taraba", "yobe", "zamfara", "fct",
}

# Normalised name → title-cased canonical name
_STATE_CANONICAL: dict[str, str] = {
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
    "zamfara": "Zamfara", "fct": "FCT",
}

# ── Hardcoded state mappings for non-state sheets ─────────────────────────
# Row indices are 1-based (S/No in the sheet)

_PRIVATE_CLIENTS_STATES: dict[int, str] = {
    1: "Lagos", 2: "Lagos", 3: "Lagos", 4: "Lagos",
    5: "Lagos", 6: "Lagos", 7: "Lagos", 8: "Lagos",
    9: "FCT", 10: "FCT",
    11: "Lagos", 12: "Lagos", 13: "Lagos", 14: "Lagos", 15: "Lagos",
    16: "Ogun",
    17: "Lagos", 18: "Lagos",
    19: "FCT",
}

_FAAN_STATES: dict[int, str] = {
    1: "Enugu", 2: "Enugu",
    3: "Kaduna", 4: "Kaduna",
    5: "Lagos",
    6: "Edo",
}

_FMW_STATES: dict[int, str] = {
    1: "Oyo", 2: "Plateau", 3: "Plateau", 4: "Plateau",
    5: "Plateau", 6: "Benue", 7: "Taraba",
    8: "Lagos", 9: "Cross River", 10: "Enugu",
}


# ── Column name → DB field mapping (case-insensitive) ─────────────────────
_COLUMN_MAP: dict[str, str] = {
    "s/no": "serial_number",
    "s/n": "serial_number",
    "sno": "serial_number",
    "client": "client",
    "project name": "project_name",
    "contract sum": "contract_sum_raw",
    "award letter": "has_award_letter",
    "award letter (notification)": "has_award_letter",
    "award letter(notification)": "has_award_letter",
    "substantial completion cert": "substantial_completion_cert",
    "final completion cert": "final_completion_cert",
    "maintenance cert": "maintenance_cert",
    "date application for retention": "retention_application_date_raw",
    "date application for retension": "retention_application_date_raw",
    "paid: yes or no": "retention_paid",
    "paid": "retention_paid",
    "amount paid": "retention_amount_paid",
}

# Columns whose next "Date" sibling maps to a specific raw date field.
# Award letter is included so the "Date" column after it gets mapped.
_CERT_DATE_TARGETS: dict[str, str] = {
    "has_award_letter": "award_date_raw",
    "substantial_completion_cert": "substantial_completion_date_raw",
    "final_completion_cert": "final_completion_date_raw",
    "maintenance_cert": "maintenance_cert_date_raw",
}


_NOISE_DATE_VALUES: frozenset[str] = frozenset({
    "nil", "n/a", "na", "-", "none", "nill", "", "no", "yes",
    "ongoing", "n.a", "tbc", "tbd",
})

# Months for regex extraction from narrative text
_MONTH_PAT = (
    r"(?:January|February|March|April|May|June|July|August|"
    r"September|October|November|December|"
    r"Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
)

# Common typos in the data
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


def parse_free_text_date(text: str | None) -> date | None:
    """Parse free-text dates like '30th March, 2006', 'Jan 2020', '2018'.

    Also extracts dates embedded in narrative text such as:
    - 'Applied for 17th November, 2014'
    - 'Application submitted: 15th November, 2014'
    - 'Applied 13th November, 2014 (14,761,734.91)'
    - 'JAN,8TH, 2018'
    """
    if not text or not isinstance(text, str):
        return None
    text = text.strip()
    if not text or text.lower() in _NOISE_DATE_VALUES:
        return None

    # If it's already a datetime-like object from pandas
    if isinstance(text, (datetime, date)):
        return text if isinstance(text, date) else text.date()

    # Fix known month typos (e.g. "Februar" → "February")
    cleaned = text
    for typo, fix in _MONTH_TYPOS.items():
        cleaned = re.sub(rf"\b{typo}\b", fix, cleaned, flags=re.IGNORECASE)

    # Remove ordinal suffixes: 1st, 2nd, 3rd, 4th (including typos like "4ht")
    cleaned = re.sub(r"(\d+)(st|nd|rd|th|ht)\b", r"\1", cleaned, flags=re.IGNORECASE)
    # Handle "JAN,8TH, 2018" → "JAN 8, 2018" (month,day format)
    cleaned = re.sub(r"([A-Za-z]{3,}),\s*(\d{1,2})\b", r"\1 \2", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().rstrip(",").strip()
    # Handle period instead of comma (e.g. "13th December. 2012")
    cleaned = re.sub(r"\.(\s*\d{4})", r",\1", cleaned)

    # If multiple dates separated by &, just take the first one
    if "&" in cleaned:
        cleaned = cleaned.split("&")[0].strip().rstrip(",").strip()
    # Also handle comma-separated multiple dates
    if "," in cleaned:
        parts = cleaned.split(",")
        if len(parts) >= 3:
            # Could be "15th February, 2001, 16th November, 2006..."
            # Just take the first date: first two parts
            candidate = f"{parts[0].strip()}, {parts[1].strip()}"
            try_date = _try_parse_formats(candidate)
            if try_date:
                return try_date

    result = _try_parse_formats(cleaned)
    if result:
        return result

    # Fallback: extract a date substring from narrative text.
    # Handles "Applied for 17 November, 2014", etc.
    m = re.search(rf"\b(\d{{1,2}})\s+({_MONTH_PAT}),?\s+(\d{{4}})\b", cleaned, re.IGNORECASE)
    if m:
        sub = f"{m.group(1)} {m.group(2)}, {m.group(3)}"
        for fmt in ("%d %B, %Y", "%d %b, %Y"):
            try:
                return datetime.strptime(sub, fmt).date()
            except ValueError:
                continue

    # Month + year only embedded in text: "Feb, 2002", "March, 2009"
    m2 = re.search(rf"\b({_MONTH_PAT}),?\s+(\d{{4}})\b", cleaned, re.IGNORECASE)
    if m2:
        sub = f"{m2.group(1)} {m2.group(2)}"
        for fmt in ("%B %Y", "%b %Y"):
            try:
                return datetime.strptime(sub, fmt).date()
            except ValueError:
                continue

    logger.debug("Could not parse date", raw_text=text)
    return None


def _try_parse_formats(cleaned: str) -> date | None:
    """Try common date formats on a cleaned string."""
    formats = [
        "%d %B, %Y", "%d %B %Y", "%B %d, %Y", "%B %d %Y",
        "%d %b, %Y", "%d %b %Y", "%b %d, %Y", "%b %d %Y",
        "%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%d", "%d-%m-%Y",
        "%d-%B-%Y", "%d-%b-%Y",
        "%B, %Y", "%B %Y", "%b, %Y", "%b %Y",
        "%Y",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return None


def parse_contract_sum(raw: Any) -> dict[str, Any]:
    """Parse contract sum — may be numeric, or narrative text.

    Handles patterns:
    - Plain number: 18461415
    - "Original: X, Variation: Y, TOTAL: Z"
    - "Revised from X to Y" / "X then to Y" → use the final (revised) value
    - "Euro 108,313.00" → store numeric
    - "100,042,061.74 NGN & 126,098.12 USD" → use NGN value
    """
    result: dict[str, Any] = {
        "original_contract_sum": None,
        "variation_sum": None,
        "contract_sum_raw": None,
    }

    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return result

    # If pandas already decoded as a number
    if isinstance(raw, (int, float)):
        result["original_contract_sum"] = float(raw)
        result["contract_sum_raw"] = str(raw)
        return result

    text = str(raw).strip()
    if not text:
        return result
    if _is_noise_value(text):
        return result
    result["contract_sum_raw"] = text

    text_lower = text.lower()

    # Pattern: "Original: X, Variation: Y. TOTAL: Z"
    if "total" in text_lower and ("variation" in text_lower or "original" in text_lower):
        numbers = _extract_numbers(text)
        if len(numbers) >= 3:
            result["original_contract_sum"] = numbers[0]
            result["variation_sum"] = numbers[1]
            # Use the TOTAL as current_contract_sum (computed later if not set)
            return result
        elif len(numbers) == 2:
            result["original_contract_sum"] = numbers[0]
            result["variation_sum"] = numbers[1]
            return result

    # Pattern: "Revised from X to Y" / "Revised to Y from X" / "X then to Y"
    if "revised" in text_lower or "then to" in text_lower:
        numbers = _extract_numbers(text)
        if len(numbers) >= 2:
            # "Revised to Y from X" → Y comes first, use it
            # "Revised from X to Y" → Y comes last, use it
            # "X then to Y" → Y comes last, use it
            # In all patterns the value after "to" is the revised one.
            m_to = re.search(r"\bto\s+([\d,]+\.?\d*)", text, re.IGNORECASE)
            if m_to:
                try:
                    result["original_contract_sum"] = float(m_to.group(1).replace(",", ""))
                    return result
                except ValueError:
                    pass
            result["original_contract_sum"] = numbers[-1]
            return result
        elif len(numbers) == 1:
            result["original_contract_sum"] = numbers[0]
            return result

    # Pattern: "X NGN & Y USD" — use NGN value (before "NGN")
    if "ngn" in text_lower and "usd" in text_lower:
        # Take the number before "NGN"
        m = re.search(r"([\d,]+\.?\d*)\s*NGN", text, re.IGNORECASE)
        if m:
            try:
                result["original_contract_sum"] = float(m.group(1).replace(",", ""))
                return result
            except ValueError:
                pass

    # Pattern: "Euro X" or similar foreign currency
    if "euro" in text_lower or "usd" in text_lower:
        numbers = _extract_numbers(text)
        if numbers:
            result["original_contract_sum"] = numbers[0]
            return result

    # Generic: extract all numbers and use the first
    numbers = _extract_numbers(text)
    if len(numbers) == 1:
        result["original_contract_sum"] = numbers[0]
    elif len(numbers) >= 2:
        if "variation" in text_lower:
            result["original_contract_sum"] = numbers[0]
            result["variation_sum"] = numbers[1]
        else:
            result["original_contract_sum"] = numbers[0]

    return result


def _extract_numbers(text: str) -> list[float]:
    """Extract all numeric values from text, ignoring currency symbols."""
    cleaned_text = text.replace("N", "").replace("₦", "").replace("€", "").replace("$", "")
    raw_numbers = re.findall(r"[\d,]+\.?\d*", cleaned_text)
    result: list[float] = []
    for n in raw_numbers:
        try:
            val = float(n.replace(",", ""))
            if val > 0:  # Skip zero and negative
                result.append(val)
        except ValueError:
            continue
    return result


def parse_amount(raw: Any) -> float | None:
    """Parse an amount value — handles shorthand like '18.5 million', '74m', 'Nil'.

    Returns None for noise values and unparseable text.
    """
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        if pd.isna(raw):
            return None
        return float(raw)

    text = str(raw).strip()
    if not text:
        return None

    lower = text.lower()
    if lower in ("nil", "nill", "none", "n/a", "-", ""):
        return None
    if _is_noise_value(text):
        return None

    # "18.5 million" → 18_500_000
    m = re.match(r"([\d,.]+)\s*million", lower)
    if m:
        try:
            return float(m.group(1).replace(",", "")) * 1_000_000
        except ValueError:
            pass

    # "74m" or "17m" → 74_000_000
    m = re.match(r"([\d,.]+)\s*m\b", lower)
    if m:
        try:
            return float(m.group(1).replace(",", "")) * 1_000_000
        except ValueError:
            pass

    # "74b" → billion
    m = re.match(r"([\d,.]+)\s*b\b", lower)
    if m:
        try:
            return float(m.group(1).replace(",", "")) * 1_000_000_000
        except ValueError:
            pass

    # Plain number with commas/currency symbols
    try:
        cleaned = re.sub(r"[^\d.]", "", text.replace(",", ""))
        if cleaned:
            return float(cleaned)
    except (ValueError, TypeError):
        pass

    return None


def _is_nigerian_state(name: str) -> bool:
    """Check if a sheet name matches a Nigerian state."""
    return name.strip().lower() in NIGERIAN_STATES


def _extract_state_from_text(text: str) -> str | None:
    """Try to find a Nigerian state name within free text (e.g. project name).

    Searches for multi-word states first (e.g. 'Cross River', 'Akwa Ibom'),
    then single-word states.
    """
    text_lower = text.lower()

    # Check multi-word states first (sorted longest first)
    multi_word = sorted(
        [s for s in NIGERIAN_STATES if " " in s],
        key=len, reverse=True,
    )
    for state in multi_word:
        if state in text_lower:
            return _STATE_CANONICAL[state]

    # Check single-word states (must be word-bounded)
    for state in NIGERIAN_STATES:
        if " " in state:
            continue
        if re.search(rf"\b{re.escape(state)}\b", text_lower):
            return _STATE_CANONICAL[state]

    return None


def _resolve_state_for_row(
    sheet_name: str,
    project_name: str,
    row_number: int,
) -> str | None:
    """Determine the state_name for a project row."""
    sheet_upper = sheet_name.strip().upper()

    # State-named sheets
    if _is_nigerian_state(sheet_name):
        return _STATE_CANONICAL.get(sheet_name.strip().lower())

    if sheet_upper == "FERMA":
        return _extract_state_from_text(project_name)

    if sheet_upper == "PRIVATE CLIENTS":
        return _PRIVATE_CLIENTS_STATES.get(row_number)

    if sheet_upper in ("FCDA ABUJA", "FCDA"):
        return "FCT"

    if sheet_upper in ("FAAN", "FAN"):
        return _FAAN_STATES.get(row_number)

    if sheet_upper == "FMW":
        return _FMW_STATES.get(row_number)

    return None


def parse_award_letters_excel(file_content: bytes) -> dict[str, Any]:
    """Parse all sheets of the Award Letters Excel workbook.

    Returns:
        {
            "projects": list[dict],
            "errors": list[dict],
            "warnings": list[dict],
            "sheets_processed": int,
            "total_rows": int,
            "import_batch_id": str,
        }
    """
    xls = pd.ExcelFile(io.BytesIO(file_content))
    batch_id = str(uuid4())

    all_projects: list[dict[str, Any]] = []
    all_errors: list[dict[str, Any]] = []
    all_warnings: list[dict[str, Any]] = []

    for sheet_name in xls.sheet_names:
        try:
            df = pd.read_excel(xls, sheet_name=sheet_name, header=None)
            header_row = _find_header_row(df)
            if header_row is None:
                all_warnings.append({
                    "sheet": sheet_name,
                    "message": "No header row found, skipping",
                })
                continue

            df = pd.read_excel(xls, sheet_name=sheet_name, header=header_row)
            df.columns = [str(c).strip() for c in df.columns]
            col_map = _build_column_map(df.columns.tolist())

            row_number = 0
            for idx, row in df.iterrows():
                try:
                    project = _parse_row(row, col_map, sheet_name, int(idx), batch_id)
                    if project:
                        row_number += 1
                        # Resolve state
                        state_name = _resolve_state_for_row(
                            sheet_name,
                            project["project_name"],
                            row_number,
                        )
                        if state_name:
                            project["state_name"] = state_name
                        else:
                            all_warnings.append({
                                "sheet": sheet_name,
                                "row": row_number,
                                "project": project["project_name"][:60],
                                "message": "Could not determine state",
                            })
                        all_projects.append(project)
                except Exception as e:
                    all_errors.append({
                        "sheet": sheet_name,
                        "row": int(idx) + 1,
                        "error": str(e),
                    })

        except Exception as e:
            all_errors.append({
                "sheet": sheet_name,
                "error": f"Failed to read sheet: {e}",
            })

    return {
        "projects": all_projects,
        "errors": all_errors,
        "warnings": all_warnings,
        "sheets_processed": len(xls.sheet_names),
        "total_rows": len(all_projects),
        "import_batch_id": batch_id,
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _find_header_row(df: pd.DataFrame) -> int | None:
    """Find the header row by looking for known column names."""
    keywords = {"s/no", "s/n", "client", "project name", "contract sum", "award"}
    for i in range(min(10, len(df))):
        row_values = {str(v).strip().lower() for v in df.iloc[i] if pd.notna(v)}
        if len(keywords & row_values) >= 2:
            return i
    return None


def _build_column_map(columns: list[str]) -> dict[int, str]:
    """Map column index → DB field name.

    Handles positional 'Date' columns that follow each cert/award column.
    """
    col_map: dict[int, str] = {}
    # Queue of date field names to assign to upcoming "Date" columns
    date_queue: list[str] = []

    for i, col_name in enumerate(columns):
        col_lower = col_name.lower().strip()

        # Check for known column names
        matched_field: str | None = None
        for pattern, field in _COLUMN_MAP.items():
            if col_lower == pattern or col_lower.startswith(pattern):
                matched_field = field
                break

        # Special: "award date" or "date of award"
        if not matched_field and ("award" in col_lower and "date" in col_lower):
            matched_field = "award_date_raw"

        if matched_field:
            col_map[i] = matched_field
            # If this is a cert/award column, queue the date target for the
            # next "Date" column that follows it
            if matched_field in _CERT_DATE_TARGETS:
                date_queue.append(_CERT_DATE_TARGETS[matched_field])
        elif re.match(r"^date(\.\d+)?$", col_lower) and date_queue:
            # pandas renames duplicate "Date" columns to "Date.1", "Date.2", etc.
            col_map[i] = date_queue.pop(0)

    return col_map


def _is_noise_value(val: str) -> bool:
    """Check if a cell value is noise (e.g. 'File not in Lagos', 'Ongoing', etc.)."""
    lower = val.strip().lower()
    noise_patterns = [
        "file not in", "file not seen", "not concluded",
        "abuja to advice", "abuja to advise", "not given",
        "pending legal", "100% claimed",
        "work on going", "work ongoing", "no advance payment",
        "request for", "snagging", "not yet due",
        "vetted waiting", "inspection by",
    ]
    return any(p in lower for p in noise_patterns)


def _parse_row(
    row: pd.Series,
    col_map: dict[int, str],
    sheet_name: str,
    row_idx: int,
    batch_id: str,
) -> dict[str, Any] | None:
    """Parse a single row into a project dict. Returns None for empty rows."""
    # Find project_name column
    name_idx = next((i for i, f in col_map.items() if f == "project_name"), None)
    if name_idx is None:
        return None

    project_name = row.iloc[name_idx] if name_idx < len(row) else None
    if pd.isna(project_name) or not str(project_name).strip():
        return None

    # Truncate project name to DB column limit
    clean_name = str(project_name).strip()
    if len(clean_name) > _MAX_PROJECT_NAME_LEN:
        clean_name = clean_name[:_MAX_PROJECT_NAME_LEN]

    project: dict[str, Any] = {
        "project_name": clean_name,
        "source_sheet": sheet_name,
        "source_row": row_idx + 1,
        "import_batch_id": batch_id,
        "client": sheet_name.strip().upper(),
        "is_legacy": True,
    }

    for col_idx, field_name in col_map.items():
        if col_idx >= len(row):
            continue
        val = row.iloc[col_idx]
        if pd.isna(val):
            continue

        val_str = str(val).strip()
        if not val_str:
            continue

        if field_name == "serial_number":
            continue  # skip, not stored

        if field_name == "client" and val_str:
            project["client"] = val_str.strip().upper()

        elif field_name == "has_award_letter":
            project["has_award_letter"] = val_str.lower() in ("yes", "y", "true", "1")

        elif field_name == "contract_sum_raw":
            parsed = parse_contract_sum(val)
            project.update(parsed)

        elif field_name.endswith("_raw"):
            # Skip noise values for raw date fields
            if _is_noise_value(val_str):
                continue
            project[field_name] = val_str
            # Try to parse the date companion (store as date object for asyncpg)
            date_field = field_name.replace("_raw", "")
            if isinstance(val, (datetime, date)):
                parsed_date = val.date() if isinstance(val, datetime) else val
            elif isinstance(val, pd.Timestamp):
                parsed_date = val.date()
            else:
                parsed_date = parse_free_text_date(val_str)
            if parsed_date:
                project[date_field] = parsed_date

        elif field_name == "retention_amount_paid":
            parsed_amt = parse_amount(val)
            if parsed_amt is not None:
                project[field_name] = parsed_amt

        elif field_name == "retention_paid":
            clean = val_str.lower().strip()
            if clean in ("yes", "no"):
                project[field_name] = clean
            # Skip noise values like "File not in Ikeja"

        elif field_name in (
            "substantial_completion_cert",
            "final_completion_cert",
            "maintenance_cert",
        ):
            # Skip noise values
            if _is_noise_value(val_str):
                continue

            clean = val_str.strip()

            # Some cert columns contain actual dates (e.g. "9th March, 2017")
            # instead of "yes"/"no" — detect and store the date too
            parsed_cert_date = parse_free_text_date(clean)
            if parsed_cert_date:
                date_field = {
                    "substantial_completion_cert": "substantial_completion_date",
                    "final_completion_cert": "final_completion_date",
                    "maintenance_cert": "maintenance_cert_date",
                }[field_name]
                raw_field = date_field + "_raw"
                if date_field not in project:
                    project[date_field] = parsed_cert_date
                if raw_field not in project:
                    project[raw_field] = clean

            # Normalize the cert text: lowercase and truncate to 50 chars
            project[field_name] = clean.lower()[:50]

    # Compute current_contract_sum
    orig = project.get("original_contract_sum")
    var = project.get("variation_sum")
    if orig is not None:
        project["current_contract_sum"] = (orig or 0) + (var or 0)

    return project
