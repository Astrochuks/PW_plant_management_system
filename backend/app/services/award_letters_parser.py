"""Award Letters Excel parser.

Parses the Award Letters workbook (17 sheets, each named after a client/state).
Each sheet has 15 columns with identical structure. Handles free-text dates,
narrative contract sums, and varied status values.
"""

import io
import re
from datetime import date, datetime
from typing import Any
from uuid import uuid4

import pandas as pd

from app.monitoring.logging import get_logger

logger = get_logger(__name__)


# Column name → DB field mapping (case-insensitive)
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
    if not text or text.lower() in ("nil", "n/a", "-", "none", "nill"):
        return None

    # If it's already a datetime-like object from pandas
    if isinstance(text, (datetime, date)):
        return text if isinstance(text, date) else text.date()

    # Remove ordinal suffixes: 1st, 2nd, 3rd, 4th
    cleaned = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().rstrip(",").strip()

    formats = [
        "%d %B, %Y", "%d %B %Y", "%B %d, %Y", "%B %d %Y",
        "%d %b, %Y", "%d %b %Y", "%b %d, %Y", "%b %d %Y",
        "%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%d", "%d-%m-%Y",
        "%d-%B-%Y", "%d-%b-%Y",
        "%B %Y", "%b %Y",
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

            for idx, row in df.iterrows():
                try:
                    project = _parse_row(row, col_map, sheet_name, int(idx), batch_id)
                    if project:
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
            project[field_name] = val_str
            # Try to parse the date companion
            date_field = field_name.replace("_raw", "")
            # Handle if pandas already parsed as datetime
            if isinstance(val, (datetime, date)):
                parsed_date = val if isinstance(val, date) else val.date()
            else:
                parsed_date = parse_free_text_date(val_str)
            if parsed_date:
                project[date_field] = parsed_date.isoformat()

        elif field_name == "retention_amount_paid":
            try:
                cleaned = str(val).replace(",", "").replace("N", "").replace("₦", "")
                project[field_name] = float(cleaned)
            except (ValueError, TypeError):
                pass

        elif field_name == "retention_paid":
            project[field_name] = val_str.lower()[:10]

        elif field_name in (
            "substantial_completion_cert",
            "final_completion_cert",
            "maintenance_cert",
        ):
            project[field_name] = val_str.lower()[:50]

    # Compute current_contract_sum
    orig = project.get("original_contract_sum")
    var = project.get("variation_sum")
    if orig is not None:
        project["current_contract_sum"] = (orig or 0) + (var or 0)

    # Derive status from certification columns
    final = project.get("final_completion_cert", "")
    maint = project.get("maintenance_cert", "")
    subst = project.get("substantial_completion_cert", "")

    if final == "yes":
        project["status"] = "completed"
    elif maint == "yes" or subst == "yes":
        project["status"] = "retention_period"
    elif "ongoing" in subst:
        project["status"] = "active"
    else:
        project["status"] = "active"

    return project
