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
    canonicalize_client,
    classify_project,
    default_client_for_sheet,
    normalize_client_name,
    parse_register_contract_sum,
    parse_register_date,
    resolve_state,
    sheet_client_category,
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

            category = sheet_client_category(sheet_name)
            group_client = None  # row-2 group label (e.g. "Plateau State Govt.")
            client_idx = next(
                (i for i, f in col_map.items() if f == "client"), None
            )
            name_idx = next(
                (i for i, f in col_map.items() if f == "project_name"), None
            )

            for idx, row in df.iterrows():
                try:
                    # Group-label row: client filled, project name empty.
                    # Not a project — remember it as the sheet's inherited
                    # client for blank Client cells below it.
                    if client_idx is not None and name_idx is not None:
                        cell_client = row.iloc[client_idx] if client_idx < len(row) else None
                        cell_name = row.iloc[name_idx] if name_idx < len(row) else None
                        if (
                            group_client is None
                            and not (pd.isna(cell_client) or not str(cell_client).strip())
                            and (pd.isna(cell_name) or not str(cell_name).strip())
                        ):
                            group_client = str(cell_client).strip()
                            continue

                    project, row_review, row_warnings = _parse_row(
                        row, col_map, sheet_name, int(idx), batch_id
                    )
                    if project is None:
                        continue

                    # ── client identity (never the sheet name) ──────────
                    raw_client = project.pop("client_raw", None) or group_client
                    identity = canonicalize_client(
                        raw_client, category
                    ) or default_client_for_sheet(sheet_name)
                    if identity is not None:
                        project["client"] = identity.display_name
                        project["client_type"] = identity.client_type
                        project["client_state_name"] = identity.state_name
                        if not identity.confident:
                            row_review.append({
                                "sheet_name": sheet_name,
                                "row_number": int(idx) + 1,
                                "project_name": project["project_name"][:200],
                                "field": "client",
                                "raw_value": str(raw_client)[:500] if raw_client else None,
                                "reason": "unrecognized_client",
                                "suggested_value": identity.display_name,
                            })
                    else:
                        row_review.append({
                            "sheet_name": sheet_name,
                            "row_number": int(idx) + 1,
                            "project_name": project["project_name"][:200],
                            "field": "client",
                            "raw_value": None,
                            "reason": "missing_client",
                            "suggested_value": None,
                        })

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


# Date columns that only carry meaning when their cert is 'yes'
_DATE_CERT_GATES: dict[str, str] = {
    "substantial_completion_date": "substantial_completion_cert",
    "final_completion_date": "final_completion_cert",
    "maintenance_cert_date": "maintenance_cert",
}

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
        "is_legacy": True,
        "status": "legacy",  # workbook data is NEVER active (user decision)
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
            project["client_raw"] = val_str.strip()

        elif field_name == "has_award_letter":
            project["has_award_letter"] = val_str.lower() in ("yes", "y", "true", "1")

        elif field_name == "contract_sum_raw":
            cs = parse_register_contract_sum(val)
            if cs.raw is not None:
                project["contract_sum_raw"] = cs.raw
            if cs.original is not None:
                project["original_contract_sum"] = cs.original
            if cs.needs_review:
                queue(
                    "contract_sum", cs.raw, "not_plain_number",
                    suggested=(
                        None if cs.suggested_original is None
                        else f"{cs.suggested_original:,.2f}"
                    ),
                )
                if cs.suggested_variation is not None:
                    queue(
                        "variation_sum", cs.raw, "not_plain_number",
                        suggested=f"{cs.suggested_variation:,.2f}",
                    )

        elif field_name.endswith("_raw"):
            date_field = field_name.replace("_raw", "")

            # Cert dates only exist alongside a 'yes' cert (user rule):
            # raw text is preserved, but nothing parses and nothing queues.
            gating_cert = _DATE_CERT_GATES.get(date_field)
            if gating_cert is not None and project.get(gating_cert) != "yes":
                if str(val).strip():
                    project[field_name] = str(val).strip()[:500]
                continue

            parsed = parse_register_date(
                val,
                allow_narrative=(date_field == "retention_application_date"),
            )
            if parsed.raw is not None and parsed.reason != "noise":
                project[field_name] = parsed.raw
            if parsed.value is not None:
                project[date_field] = parsed.value
            if parsed.needs_review:
                queue(
                    date_field, parsed.raw, parsed.reason,
                    suggested=(
                        parsed.suggestion.isoformat() if parsed.suggestion else None
                    ),
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
            # User rule: cert values are yes/no ONLY. Anything else (dates,
            # "applied for…", narrative) → the cert stays blank and its
            # date column is gated off above. The workbook keeps the raw.
            clean = val_str.lower().strip().rstrip(".")
            if clean in ("yes", "no"):
                project[field_name] = clean

    # current_contract_sum = original + variation (variation only ever
    # arrives via human resolution now)
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
