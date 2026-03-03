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
    "substantial completion cert": "substantial_completion_cert",
    "final completion cert": "final_completion_cert",
    "maintenance cert": "maintenance_cert",
    "date application for retention": "retention_application_date_raw",
    "date application for retension": "retention_application_date_raw",
    "paid: yes or no": "retention_paid",
    "paid": "retention_paid",
    "amount paid": "retention_amount_paid",
}

# Columns whose next "date" sibling maps to a specific raw field
_CERT_DATE_TARGETS: dict[str, str] = {
    "substantial_completion_cert": "substantial_completion_date_raw",
    "final_completion_cert": "final_completion_date_raw",
    "maintenance_cert": "maintenance_cert_date_raw",
}


def parse_free_text_date(text: str | None) -> date | None:
    """Parse free-text dates like '30th March, 2006', 'Jan 2020', '2018'."""
    if not text or not isinstance(text, str):
        return None
    text = text.strip()
    if not text or text.lower() in ("nil", "n/a", "-", "none", "nill", ""):
        return None

    # If it's already a datetime-like object from pandas
    if isinstance(text, (datetime, date)):
        return text if isinstance(text, date) else text.date()

    # Remove ordinal suffixes: 1st, 2nd, 3rd, 4th
    cleaned = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().rstrip(",").strip()
    # Handle period instead of comma (e.g. "13th December. 2012")
    cleaned = re.sub(r"\.(\s*\d{4})", r",\1", cleaned)

    # If multiple dates separated by &, just take the first one
    if "&" in cleaned:
        cleaned = cleaned.split("&")[0].strip().rstrip(",").strip()

    formats = [
        "%d %B, %Y", "%d %B %Y", "%B %d, %Y", "%B %d %Y",
        "%d %b, %Y", "%d %b %Y", "%b %d, %Y", "%b %d %Y",
        "%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%d", "%d-%m-%Y",
        "%d-%B-%Y", "%d-%b-%Y",
        "%B, %Y", "%B %Y", "%b %Y",
        "%Y",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue

    logger.debug("Could not parse date", raw_text=text)
    return None


def parse_contract_sum(raw: Any) -> dict[str, Any]:
    """Parse contract sum — may be numeric, or narrative text.

    Returns dict with original_contract_sum, variation_sum, contract_sum_raw.
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
    result["contract_sum_raw"] = text

    # Extract all numbers from the text
    numbers = re.findall(r"[\d,]+\.?\d*", text.replace("N", "").replace("₦", ""))
    cleaned: list[float] = []
    for n in numbers:
        try:
            cleaned.append(float(n.replace(",", "")))
        except ValueError:
            continue

    if len(cleaned) == 1:
        result["original_contract_sum"] = cleaned[0]
    elif len(cleaned) >= 2:
        if "variation" in text.lower():
            result["original_contract_sum"] = cleaned[0]
            result["variation_sum"] = cleaned[1]
        else:
            result["original_contract_sum"] = cleaned[0]

    return result


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
    """Determine the state_name for a project row.

    Logic:
    - State-named sheets → sheet name is the state
    - FERMA → extract from project name
    - PRIVATE CLIENTS → hardcoded by row number
    - FCDA ABUJA → FCT
    - FAAN → hardcoded by row number
    - FMW → hardcoded by row number
    """
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

    Handles positional 'Date' columns that follow each cert column.
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
            # If this is a cert column, queue the date target
            if matched_field in _CERT_DATE_TARGETS:
                date_queue.append(_CERT_DATE_TARGETS[matched_field])
        elif col_lower == "date" and date_queue:
            col_map[i] = date_queue.pop(0)

    return col_map


def _is_noise_value(val: str) -> bool:
    """Check if a cell value is noise (e.g. 'File not in Lagos', 'Ongoing', etc.)."""
    lower = val.strip().lower()
    noise_patterns = [
        "file not in", "file not seen", "not concluded",
        "abuja to advice", "not given",
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

    project: dict[str, Any] = {
        "project_name": str(project_name).strip(),
        "source_sheet": sheet_name,
        "source_row": row_idx + 1,
        "import_batch_id": batch_id,
        "client": sheet_name.strip().upper(),
        "status": "legacy",
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
                parsed_date = val if isinstance(val, date) else val.date()
            else:
                parsed_date = parse_free_text_date(val_str)
            if parsed_date:
                project[date_field] = parsed_date

        elif field_name == "retention_amount_paid":
            try:
                cleaned_val = str(val).replace(",", "").replace("N", "").replace("₦", "")
                cleaned_val = re.sub(r"[^\d.]", "", cleaned_val)
                if cleaned_val:
                    project[field_name] = float(cleaned_val)
            except (ValueError, TypeError):
                pass

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
            # Normalize
            clean = val_str.lower().strip()[:50]
            project[field_name] = clean

    # Compute current_contract_sum
    orig = project.get("original_contract_sum")
    var = project.get("variation_sum")
    if orig is not None:
        project["current_contract_sum"] = (orig or 0) + (var or 0)

    return project
