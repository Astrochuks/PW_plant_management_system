"""Award Letters Excel parser (v2 — PRD v2 §8.1, task T1.8).

Parses the Award Letters workbook (17 sheets, each named after a client/state).
Each sheet has 15 columns with identical structure.

v2 changes:
- All cell parsing delegated to the pure functions in register_parsing
  (contract sums, dates, state resolution, type/nature classification).
- NOTHING is dropped silently: every ambiguous/unparseable cell emits a
  review item (→ project_register_review_queue) with the raw value.
- State resolution is text/landmark-based; row-index hardcoding removed
  (the old maps had already drifted — e.g. an MMIA Lagos runway mapped
  to Enugu).
"""

import io
import re
from datetime import date, datetime
from typing import Any
from uuid import uuid4

import pandas as pd

from app.monitoring.logging import get_logger
from app.services.register_parsing import (
    classify_project,
    normalize_client_name,
    parse_register_contract_sum,
    parse_register_date,
    resolve_state,
)

logger = get_logger(__name__)

# Max length for project_name in the DB
_MAX_PROJECT_NAME_LEN = 500

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


def parse_award_letters_excel(
    file_content: bytes,
    client_default_states: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Parse all sheets of the Award Letters Excel workbook.

    Args:
        file_content: the .xlsx bytes.
        client_default_states: optional {normalized_client_name: state_name}
            map (from clients.default_state_id) used as the last state-
            resolution fallback. Omitted in golden tests for determinism.

    Returns:
        {
            "projects": list[dict],
            "errors": list[dict],
            "warnings": list[dict],       # informational (not queue-worthy)
            "review_items": list[dict],   # → project_register_review_queue
            "sheets_processed": int,
            "total_rows": int,
            "import_batch_id": str,
        }
    """
    xls = pd.ExcelFile(io.BytesIO(file_content))
    batch_id = str(uuid4())
    defaults = client_default_states or {}

    all_projects: list[dict[str, Any]] = []
    all_errors: list[dict[str, Any]] = []
    all_warnings: list[dict[str, Any]] = []
    all_review: list[dict[str, Any]] = []

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
                    project, row_review, row_warnings = _parse_row(
                        row, col_map, sheet_name, int(idx), batch_id
                    )
                    if project is None:
                        continue

                    resolved = resolve_state(
                        project["project_name"],
                        sheet_name,
                        defaults.get(normalize_client_name(project.get("client"))),
                    )
                    if resolved.state:
                        project["state_name"] = resolved.state
                        project["state_resolution_method"] = resolved.method
                    else:
                        row_review.append({
                            "sheet_name": sheet_name,
                            "row_number": int(idx) + 1,
                            "project_name": project["project_name"][:200],
                            "field": "state",
                            "raw_value": project["project_name"][:200],
                            "reason": resolved.reason,
                            "suggested_value": (
                                " / ".join(resolved.candidates) or None
                            ),
                        })

                    all_projects.append(project)
                    all_review.extend(row_review)
                    all_warnings.extend(row_warnings)
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
        "review_items": all_review,
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
) -> tuple[dict[str, Any] | None, list[dict[str, Any]], list[dict[str, Any]]]:
    """Parse a single row into (project, review_items, warnings).

    Returns (None, [], []) for empty rows. NOTHING ambiguous is dropped
    silently: unparseable/narrative cells emit review items carrying the
    raw value; informational oddities emit warnings.
    """
    review: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    name_idx = next((i for i, f in col_map.items() if f == "project_name"), None)
    if name_idx is None:
        return None, [], []

    project_name = row.iloc[name_idx] if name_idx < len(row) else None
    if pd.isna(project_name) or not str(project_name).strip():
        return None, [], []

    clean_name = str(project_name).strip()
    if len(clean_name) > _MAX_PROJECT_NAME_LEN:
        clean_name = clean_name[:_MAX_PROJECT_NAME_LEN]

    def queue(field: str, raw_value: Any, reason: str, suggested: str | None = None) -> None:
        review.append({
            "sheet_name": sheet_name,
            "row_number": row_idx + 1,
            "project_name": clean_name[:200],
            "field": field,
            "raw_value": None if raw_value is None else str(raw_value)[:500],
            "reason": reason,
            "suggested_value": suggested,
        })

    def warn(field: str, raw_value: Any, message: str) -> None:
        warnings.append({
            "sheet": sheet_name,
            "row": row_idx + 1,
            "field": field,
            "raw": None if raw_value is None else str(raw_value)[:200],
            "message": message,
        })

    project: dict[str, Any] = {
        "project_name": clean_name,
        "source_sheet": sheet_name,
        "source_row": row_idx + 1,
        "import_batch_id": batch_id,
        "client": sheet_name.strip().upper(),
        "is_legacy": True,
        "register_source": "award_letters_workbook",
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
            continue  # not stored

        if field_name == "client" and val_str:
            project["client"] = val_str.strip().upper()

        elif field_name == "has_award_letter":
            project["has_award_letter"] = val_str.lower() in ("yes", "y", "true", "1")

        elif field_name == "contract_sum_raw":
            cs = parse_register_contract_sum(val)
            if cs.raw is not None:
                project["contract_sum_raw"] = cs.raw
            if cs.original is not None:
                project["original_contract_sum"] = cs.original
            if cs.variation is not None:
                project["variation_sum"] = cs.variation
            if cs.total is not None:
                project["current_contract_sum"] = cs.total
            if cs.needs_review:
                for w in cs.warnings:
                    if w in ("total_mismatch", "ambiguous_numbers", "no_numbers_found"):
                        queue(
                            "contract_sum", cs.raw, w,
                            suggested=None if cs.original is None else f"{cs.original:.2f}",
                        )
            for w in cs.warnings:
                if w in ("revised_used_final", "multi_currency", "foreign_currency"):
                    warn("contract_sum", cs.raw, w)

        elif field_name.endswith("_raw"):
            parsed = parse_register_date(val)
            date_field = field_name.replace("_raw", "")
            if parsed.raw is not None and parsed.reason != "noise":
                project[field_name] = parsed.raw
            if parsed.value is not None:
                project[date_field] = parsed.value
            if parsed.needs_review or parsed.reason == "narrative_status":
                queue(
                    date_field, parsed.raw, parsed.reason,
                    suggested=parsed.value.isoformat() if parsed.value else None,
                )

        elif field_name == "retention_amount_paid":
            parsed_amt = parse_amount(val)
            if parsed_amt is not None:
                project[field_name] = parsed_amt

        elif field_name == "retention_paid":
            clean = val_str.lower().strip()
            if clean in ("yes", "no"):
                project[field_name] = clean
            elif not _is_noise_value(val_str):
                # Narrative like "File not in Ikeja" — surface, don't drop
                queue("retention_paid", val_str, "narrative_text")

        elif field_name in (
            "substantial_completion_cert",
            "final_completion_cert",
            "maintenance_cert",
        ):
            if _is_noise_value(val_str):
                continue

            clean = val_str.strip()

            # Some cert columns hold actual dates ("9th March, 2017")
            parsed_cert = parse_register_date(clean)
            if parsed_cert.value is not None:
                date_field = {
                    "substantial_completion_cert": "substantial_completion_date",
                    "final_completion_cert": "final_completion_date",
                    "maintenance_cert": "maintenance_cert_date",
                }[field_name]
                raw_field = date_field + "_raw"
                if date_field not in project:
                    project[date_field] = parsed_cert.value
                if raw_field not in project:
                    project[raw_field] = clean
                if parsed_cert.needs_review:
                    queue(
                        date_field, clean, parsed_cert.reason,
                        suggested=parsed_cert.value.isoformat(),
                    )
            elif parsed_cert.reason in ("narrative_no_date", "unparseable") and \
                    clean.lower() not in ("yes", "no"):
                # Cert text that is neither yes/no nor a date — reviewable
                queue(field_name, clean, parsed_cert.reason)

            project[field_name] = clean.lower()[:50]

    # current_contract_sum: explicit TOTAL wins; else original + variation
    if "current_contract_sum" not in project:
        orig = project.get("original_contract_sum")
        var = project.get("variation_sum")
        if orig is not None:
            project["current_contract_sum"] = (orig or 0) + (var or 0)

    # Type / nature classification — confident axes only; uncertainty queues
    classified = classify_project(clean_name)
    if classified.type_confident:
        project["project_type"] = classified.project_type
    if classified.nature_confident:
        project["work_nature"] = classified.work_nature
    if not classified.confident:
        queue(
            "classification",
            clean_name[:200],
            "low_confidence_classification",
            suggested=f"{classified.project_type}/{classified.work_nature}",
        )

    return project, review, warnings
