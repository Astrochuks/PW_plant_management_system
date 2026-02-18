"""Service for extracting metadata from uploaded files.

Extracts location and week ending date from weekly report Excel files
to enable "just upload" functionality without manual data entry.
"""

import io
import re
from datetime import date, datetime
from typing import Any

import pandas as pd

from app.core.database import get_supabase_admin_client
from app.monitoring.logging import get_logger

logger = get_logger(__name__)


def _is_separator_line(value: str) -> bool:
    """Check if a value is just a separator line (underscores, dashes, etc.)."""
    if not value:
        return True
    # Remove all separator characters and whitespace
    cleaned = re.sub(r'[\s_\-=\.]+', '', value)
    # If nothing left, it's a separator line
    return len(cleaned) == 0


def _extract_value_after_separator(cell_value: str, labels: list[str]) -> str | None:
    """Extract value after a label and separator from a single cell.

    Handles formats like:
    - "SITE LOCATION - KWOI KADUNA"
    - "WEEKENDING    -    01/02/26"
    - "LOCATION: ABUJA"

    Args:
        cell_value: The cell content.
        labels: List of possible label strings to look for.

    Returns:
        The extracted value or None.
    """
    val_upper = cell_value.upper()

    for label in labels:
        label_upper = label.upper()
        if label_upper in val_upper:
            # Find position after the label
            idx = val_upper.find(label_upper)
            after_label = cell_value[idx + len(label):].strip()

            # Remove leading separators (-, :, etc.) and whitespace
            after_label = re.sub(r'^[\s\-:]+', '', after_label).strip()

            # Skip if it's a separator line (underscores, dashes, etc.)
            if after_label and len(after_label) >= 2 and not _is_separator_line(after_label):
                return after_label

    return None


def extract_weekly_report_metadata(file_content: bytes) -> dict[str, Any]:
    """Extract metadata from a weekly report Excel file.

    Parses the header rows of the Excel file to extract:
    - Site location name
    - Week ending date

    Args:
        file_content: Raw bytes of the Excel file.

    Returns:
        Dict with 'location_name' and 'week_ending_date' (may be None if not found).
    """
    result = {
        "location_name": None,
        "week_ending_date": None,
        "week_ending_raw": None,
    }

    try:
        df_raw = pd.read_excel(io.BytesIO(file_content), sheet_name=0, header=None)

        # Search first 6 rows for metadata
        for i in range(min(6, len(df_raw))):
            row = df_raw.iloc[i].tolist()
            for j, val in enumerate(row):
                if pd.notna(val):
                    val_str = str(val).strip()
                    val_upper = val_str.upper()

                    # Look for site location - may be in same cell as label
                    if "SITE LOCATION" in val_upper or "SITE:" in val_upper or "LOCATION:" in val_upper:
                        # Try to extract from same cell (e.g., "SITE LOCATION - KWOI KADUNA")
                        loc = _extract_value_after_separator(val_str, ["SITE LOCATION", "LOCATION"])
                        if loc:
                            result["location_name"] = loc.upper()
                        else:
                            # Try next cells
                            for k in range(j + 1, len(row)):
                                if pd.notna(row[k]):
                                    loc = str(row[k]).strip()
                                    # Skip separators and separator lines
                                    if loc in ("-", ":", "-:", ":-") or _is_separator_line(loc):
                                        continue
                                    if loc and "SITE" not in loc.upper() and len(loc) > 2:
                                        result["location_name"] = loc.upper()
                                        break

                    # Look for week ending date - may be in same cell as label
                    # Some files use "DATE" instead of "WEEKENDING"
                    date_keywords = ["WEEKENDING", "WEEK ENDING", "WEEK-ENDING", "DATE"]
                    if any(kw in val_upper for kw in date_keywords):
                        # Try to extract from same cell (e.g., "WEEKENDING - 01/02/26" or "DATE 25/01/26")
                        date_str = _extract_value_after_separator(val_str, date_keywords)
                        if date_str:
                            result["week_ending_raw"] = date_str
                            result["week_ending_date"] = _parse_week_ending_date(date_str)
                        else:
                            # Try next cells
                            for k in range(j + 1, len(row)):
                                if pd.notna(row[k]):
                                    raw_val = str(row[k]).strip()
                                    if raw_val in ("-", ":", "-:", ":-"):
                                        continue
                                    result["week_ending_raw"] = raw_val
                                    result["week_ending_date"] = _parse_week_ending_date(row[k])
                                    break

        logger.info(
            "Extracted metadata from file",
            location_name=result["location_name"],
            week_ending_date=str(result["week_ending_date"]) if result["week_ending_date"] else None,
        )

    except Exception as e:
        logger.warning("Failed to extract metadata from file", error=str(e))

    return result


def _parse_week_ending_date(value: Any) -> date | None:
    """Parse week ending date from various formats.

    Args:
        value: The raw date value from Excel.

    Returns:
        Parsed date or None if parsing fails.
    """
    if pd.isna(value):
        return None

    try:
        # Handle pandas Timestamp or datetime
        if isinstance(value, (datetime, pd.Timestamp)):
            return value.date() if hasattr(value, "date") else value

        # Handle date object
        if isinstance(value, date):
            return value

        # Handle string
        if isinstance(value, str):
            val_str = value.strip()

            # First try ISO format before normalizing (preserve dashes for YYYY-MM-DD)
            if re.match(r'^\d{4}-\d{2}-\d{2}$', val_str):
                try:
                    return datetime.strptime(val_str, "%Y-%m-%d").date()
                except ValueError:
                    pass

            # Normalize: remove extra spaces around separators (e.g., "25 /01/26" -> "25/01/26")
            val_str = re.sub(r'\s*[/\-]\s*', '/', val_str)

            # Try common date formats
            formats = [
                "%d/%m/%Y",
                "%m/%d/%Y",
                "%d/%m/%y",
                "%m/%d/%y",
                "%Y/%m/%d",
            ]

            for fmt in formats:
                try:
                    return datetime.strptime(val_str, fmt).date()
                except ValueError:
                    continue

            # Try to extract date pattern from string
            # Match patterns like "01/02/2026" or "2026-02-01"
            date_pattern = re.search(r"(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})", val_str)
            if date_pattern:
                d, m, y = date_pattern.groups()
                y = int(y)
                if y < 100:
                    y += 2000
                try:
                    return date(y, int(m), int(d))
                except ValueError:
                    try:
                        return date(y, int(d), int(m))  # Try swapping day/month
                    except ValueError:
                        pass

    except Exception as e:
        logger.debug("Could not parse date", value=str(value), error=str(e))

    return None


def lookup_location_by_name(location_name: str) -> dict[str, Any] | None:
    """Look up a location by name with fuzzy matching.

    Args:
        location_name: The location name to search for.

    Returns:
        Dict with location 'id' and 'name', or None if not found.
    """
    if not location_name:
        return None

    # Skip separator lines (underscores, dashes, etc.)
    if _is_separator_line(location_name):
        logger.warning("Skipping separator line as location name", value=location_name[:50])
        return None

    client = get_supabase_admin_client()
    name_upper = location_name.upper().strip()

    # Try exact match first
    result = (
        client.table("locations")
        .select("id, name")
        .ilike("name", name_upper)
        .execute()
    )

    if result.data:
        return result.data[0]

    # Try contains match (e.g., "KWOI KADUNA" matches "KWOI KADUNA")
    result = (
        client.table("locations")
        .select("id, name")
        .ilike("name", f"%{name_upper}%")
        .execute()
    )

    if result.data:
        # If multiple matches, prefer exact word match
        for loc in result.data:
            if name_upper in loc["name"].upper():
                return loc
        return result.data[0]

    # Try partial match (location name contains our search term)
    # Split search term and try first word
    first_word = name_upper.split()[0] if name_upper else ""
    if first_word and len(first_word) >= 3:
        result = (
            client.table("locations")
            .select("id, name")
            .ilike("name", f"{first_word}%")
            .execute()
        )

        if result.data:
            return result.data[0]

    logger.warning("Could not find location", search_name=location_name)
    return None


def extract_and_resolve_metadata(file_content: bytes) -> dict[str, Any]:
    """Extract metadata from file and resolve location to ID.

    This is the main entry point for auto-detection.

    Args:
        file_content: Raw bytes of the Excel file.

    Returns:
        Dict with:
        - location_id: UUID string or None
        - location_name: Resolved location name or None
        - week_ending_date: date object or None
        - extraction_warnings: List of warning messages
    """
    result = {
        "location_id": None,
        "location_name": None,
        "week_ending_date": None,
        "extraction_warnings": [],
    }

    # Extract raw metadata from file
    metadata = extract_weekly_report_metadata(file_content)

    # Resolve location
    if metadata["location_name"]:
        location = lookup_location_by_name(metadata["location_name"])
        if location:
            result["location_id"] = location["id"]
            result["location_name"] = location["name"]
        else:
            result["extraction_warnings"].append(
                f"Could not find location '{metadata['location_name']}' in database"
            )
    else:
        result["extraction_warnings"].append("Could not extract location from file header")

    # Set week ending date
    if metadata["week_ending_date"]:
        result["week_ending_date"] = metadata["week_ending_date"]
    else:
        if metadata["week_ending_raw"]:
            result["extraction_warnings"].append(
                f"Could not parse week ending date: '{metadata['week_ending_raw']}'"
            )
        else:
            result["extraction_warnings"].append("Could not find week ending date in file header")

    return result


def extract_weekly_report_preview(file_content: bytes, max_rows: int = 10) -> dict[str, Any]:
    """Extract a preview of the weekly report data for validation.

    Args:
        file_content: Raw bytes of the Excel file.
        max_rows: Maximum number of plant rows to preview.

    Returns:
        Dict with:
        - metadata: Extracted and resolved metadata (location, week ending)
        - plants_preview: List of first N plant records
        - total_plants: Total count of plants in file
        - columns_found: List of recognized columns
        - validation_warnings: Any data quality issues detected
    """
    result = {
        "metadata": extract_and_resolve_metadata(file_content),
        "plants_preview": [],
        "total_plants": 0,
        "columns_found": [],
        "validation_warnings": [],
    }

    try:
        # Reuse column map and mapping logic from ETL worker (single source of truth)
        from app.workers.etl_worker import find_header_row, map_columns, WEEKLY_COLUMN_MAP

        # Auto-detect header row
        header_row = find_header_row(file_content)
        df = pd.read_excel(io.BytesIO(file_content), sheet_name=0, header=header_row)

        # Map columns
        old_cols = set(df.columns)
        df = map_columns(df, WEEKLY_COLUMN_MAP)
        mapped_cols = [c for c in df.columns if c not in old_cols or c in WEEKLY_COLUMN_MAP.values()]
        result["columns_found"] = [c for c in df.columns if c in WEEKLY_COLUMN_MAP.values()]

        # Check for required columns
        if "fleet_number" not in df.columns:
            result["validation_warnings"].append("No fleet_number column found - file may have wrong format")
            return result

        # Filter rows with valid fleet numbers
        def is_valid_fleet(val):
            if pd.isna(val):
                return False
            s = str(val).strip().upper()
            return s and s not in ("NAN", "NONE", "N/A", "-", "") and len(s) >= 2

        valid_rows = df[df["fleet_number"].apply(is_valid_fleet)]
        result["total_plants"] = len(valid_rows)

        # Get preview rows
        preview_rows = valid_rows.head(max_rows)

        for _, row in preview_rows.iterrows():
            plant = {
                "fleet_number": str(row.get("fleet_number", "")).strip().upper(),
                "description": str(row.get("description", "")).strip() if pd.notna(row.get("description")) else None,
                "hours_worked": float(row.get("hours_worked", 0)) if pd.notna(row.get("hours_worked")) else 0,
                "standby_hours": float(row.get("standby_hours", 0)) if pd.notna(row.get("standby_hours")) else 0,
                "breakdown_hours": float(row.get("breakdown_hours", 0)) if pd.notna(row.get("breakdown_hours")) else 0,
                "remarks": str(row.get("remarks", "")).strip() if pd.notna(row.get("remarks")) else None,
            }
            result["plants_preview"].append(plant)

        # Check for potential issues
        if result["total_plants"] == 0:
            result["validation_warnings"].append("No valid plant records found in file")
        elif result["total_plants"] < 5:
            result["validation_warnings"].append(f"Only {result['total_plants']} plants found - seems low")

        # Check for duplicate fleet numbers
        fleet_numbers = valid_rows["fleet_number"].apply(lambda x: str(x).strip().upper())
        duplicates = fleet_numbers[fleet_numbers.duplicated()].unique().tolist()
        if duplicates:
            result["validation_warnings"].append(f"Duplicate fleet numbers found: {', '.join(duplicates[:5])}")

    except Exception as e:
        result["validation_warnings"].append(f"Error parsing file: {str(e)}")
        logger.warning("Failed to extract preview", error=str(e))

    return result
