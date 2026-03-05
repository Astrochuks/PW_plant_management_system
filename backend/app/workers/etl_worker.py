"""ETL background workers for processing uploaded files.

Handles async processing of:
- Weekly report Excel files
- Purchase order Excel files

Uses AI-powered remarks parsing for:
- Plant condition derivation (unified field)
- Transfer detection
- Anomaly tracking
"""

import io
import json
import re
import traceback
from datetime import date, datetime
from typing import Any

import pandas as pd

from app.config import get_settings
from app.core.database import get_supabase_admin_client  # Only for Storage downloads
from app.core.pool import fetch, fetchrow, fetchval, execute, executemany
from app.core.events import broadcast
from app.monitoring.logging import get_logger
from app.services.remarks_parser import (
    parse_remarks_batch,
    derive_condition,
    ParsedRemarks,
)
from app.services.transfer_service import get_transfer_service

logger = get_logger(__name__)


def _parse_count(status: str) -> int:
    """Parse row count from asyncpg status string like 'DELETE 5' or 'UPDATE 3'."""
    if status:
        parts = status.split()
        if parts and parts[-1].isdigit():
            return int(parts[-1])
    return 0


async def cleanup_submission_data(submission_id: str) -> dict[str, int]:
    """Delete all data related to a submission for reprocessing.

    This enables "smart reprocessing" - when a user re-uploads a file for the
    same week/location, we clean up old data and process fresh.

    Args:
        submission_id: The submission ID to clean up.

    Returns:
        Dict with counts of deleted records.
    """
    cleanup_stats = {
        "weekly_records_deleted": 0,
        "transfers_deleted": 0,
        "events_deleted": 0,
    }

    try:
        # 1. Delete weekly records for this submission
        status = await execute(
            "DELETE FROM plant_weekly_records WHERE submission_id = $1::uuid",
            submission_id,
        )
        cleanup_stats["weekly_records_deleted"] = _parse_count(status)

        # 2. Delete transfers sourced from this submission
        status = await execute(
            "DELETE FROM plant_transfers WHERE source_submission_id = $1::uuid",
            submission_id,
        )
        cleanup_stats["transfers_deleted"] = _parse_count(status)

        # 3. Delete events sourced from this submission (if tracked)
        try:
            status = await execute(
                "DELETE FROM plant_events WHERE submission_id = $1::uuid",
                submission_id,
            )
            cleanup_stats["events_deleted"] = _parse_count(status)
        except Exception:
            pass  # Column may not exist

        # 4. Reset submission stats
        await execute(
            """UPDATE weekly_report_submissions SET
                status = 'pending', plants_processed = 0, plants_created = 0,
                plants_updated = 0, processing_stats = '{}'::jsonb,
                errors = NULL, warnings = NULL,
                processing_started_at = NULL, processing_completed_at = NULL
            WHERE id = $1::uuid""",
            submission_id,
        )

        logger.info(
            "Cleaned up submission data for reprocessing",
            submission_id=submission_id,
            **cleanup_stats,
        )

    except Exception as e:
        logger.error("Failed to cleanup submission data", submission_id=submission_id, error=str(e))

    return cleanup_stats


def resolve_location_conflict(
    existing: dict,
    current: dict,
    prev_week_location_id: str | None = None,
) -> tuple[str, str]:
    """Resolve when a plant appears in two locations in the same week.

    Priority order:
    1. NEW location wins (different from last week) - plant has moved there
    2. Physical verification (P) wins
    3. More hours worked
    4. Remarks clarity
    5. Later upload wins (current)

    Args:
        existing: The existing record from a different location.
        current: The current record being processed.
        prev_week_location_id: Where the plant was last week (if known).

    Returns:
        Tuple of (winning_location_id, reason).
    """
    current_loc = current["location_id"]
    existing_loc = existing["location_id"]

    # 1. NEW location wins (if we know where plant was last week)
    if prev_week_location_id:
        if current_loc != prev_week_location_id and existing_loc == prev_week_location_id:
            # Current is NEW location, existing is OLD - current wins
            return current_loc, "New location (plant moved from previous week)"
        if existing_loc != prev_week_location_id and current_loc == prev_week_location_id:
            # Existing is NEW location, current is OLD - existing wins
            return existing_loc, "New location (plant moved from previous week)"

    # 2. Physical verification
    current_pv = current.get("physical_verification", False)
    existing_pv = existing.get("physical_verification", False)

    if current_pv and not existing_pv:
        return current_loc, "Current has physical verification"
    if existing_pv and not current_pv:
        return existing_loc, "Existing has physical verification"

    # 3. More hours worked
    current_hours = current.get("_usage", {}).get("hours_worked", 0)
    existing_hours = existing.get("hours_worked", 0)

    if current_hours > existing_hours:
        return current_loc, f"More hours ({current_hours} vs {existing_hours})"
    if existing_hours > current_hours:
        return existing_loc, f"More hours ({existing_hours} vs {current_hours})"

    # 4. Remarks clarity
    current_remarks = current.get("remarks") or ""
    existing_remarks = existing.get("remarks") or ""

    if current_remarks and not existing_remarks:
        return current_loc, "Current has remarks"
    if existing_remarks and not current_remarks:
        return existing_loc, "Existing has remarks"

    # 5. Later upload wins (current is being processed now)
    return current_loc, "Later upload takes precedence"


# Column mappings for weekly reports
WEEKLY_COLUMN_MAP = {
    # Serial number
    "s/n": "serial_number",
    "s/no": "serial_number",
    "s/no.": "serial_number",
    "sn": "serial_number",
    "serial no": "serial_number",
    "serial number": "serial_number",
    # Fleet number
    "fleet no": "fleet_number",
    "fleet no.": "fleet_number",
    "fleet number": "fleet_number",
    "fleet_no": "fleet_number",
    "fleetnumber": "fleet_number",  # No space variant
    # Description
    "equipment description": "description",
    "equipment_description": "description",
    "description": "description",
    "fleetdescription": "description",  # No space variant
    "fleet description": "description",
    # Physical verification
    "physical verification": "physical_verification",
    "physical_verification": "physical_verification",
    "physical plant verification": "physical_verification",
    "physical plant\nverification": "physical_verification",  # With newline
    "p.p.v": "physical_verification",
    "ppv": "physical_verification",
    # Usage hours
    "hours worked": "hours_worked",
    "hours_worked": "hours_worked",
    "hrs worked": "hours_worked",
    "working hours": "hours_worked",
    "s/b hour": "standby_hours",
    "s/b hours": "standby_hours",
    "standby hours": "standby_hours",
    "standby_hours": "standby_hours",
    "sb hour": "standby_hours",
    "b/d hour": "breakdown_hours",
    "b/d hours": "breakdown_hours",
    "breakdown hours": "breakdown_hours",
    "breakdown_hours": "breakdown_hours",
    "bd hour": "breakdown_hours",
    # Off hire
    "off hire": "off_hire",
    "off_hire": "off_hire",
    "offhire": "off_hire",
    # Transfers
    "transf. from": "transfer_from",
    "transf from": "transfer_from",
    "transfer from": "transfer_from",
    "transferred from": "transfer_from",
    "transferd from": "transfer_from",
    "transfered from": "transfer_from",
    "transf. to": "transfer_to",
    "transf to": "transfer_to",
    "transfer to": "transfer_to",
    "transferred to": "transfer_to",
    "transferd to": "transfer_to",
    "transfered to": "transfer_to",
    # Remarks
    "remarks": "remarks",
    "remark": "remarks",
}


def normalize_fleet_number(value: Any) -> str | None:
    """Normalize fleet number to standard format.

    Removes ALL internal spaces to ensure consistent matching.
    e.g., "AF 25" -> "AF25", "T 462" -> "T462"
    """
    if pd.isna(value):
        return None

    s = str(value).strip().upper()

    # Remove common prefixes
    for prefix in ["FLEET NO:", "FLEET NO.", "FLEET:", "NO.", "NO:"]:
        if s.startswith(prefix):
            s = s[len(prefix):].strip()

    # Skip invalid values
    if not s or s in ("NAN", "NONE", "N/A", "-", ""):
        return None

    # Remove ALL internal spaces to ensure consistent matching
    # "AF 25" -> "AF25", "T 462" -> "T462"
    s = s.replace(" ", "")

    return s if len(s) >= 2 else None


def derive_physical_verification(phys_value: Any, remarks_value: Any) -> bool:
    """Derive physical verification status from column value and remarks.

    Logic:
    1. If physical verification column has value:
       - "P" = verified (True)
       - "O" = not verified (False)
       - Other values: check for common patterns
    2. If column is empty/missing, check remarks:
       - Normalize remarks (remove whitespace, lowercase)
       - Look for "missing", "notseen", "not seen" → False
       - Otherwise → True (plant is in report, assume verified)
    """
    # Check explicit column first
    if pd.notna(phys_value):
        val = str(phys_value).strip().upper()

        # P = Present/Verified
        if val == "P":
            return True
        # O = Out/Not verified
        if val == "O":
            return False

        # Check other common patterns
        val_lower = val.lower()
        if val_lower in ("true", "yes", "1", "verified", "present", "✓", "✔"):
            return True
        if val_lower in ("false", "no", "0", "not verified", "unverified", "absent", "x"):
            return False

    # Column empty or missing - check remarks
    if pd.notna(remarks_value):
        # Normalize: remove all whitespace, lowercase
        remarks_normalized = "".join(str(remarks_value).lower().split())

        # Keywords indicating plant not seen/verified
        not_seen_indicators = [
            "notseen",
            "notfound",
            "missing",
            "unavailable",
            "cannotlocate",
            "notavailable",
            "notpresent",
            "absent",
        ]

        for indicator in not_seen_indicators:
            if indicator in remarks_normalized:
                return False

    # Default to True if plant appears in weekly report
    return True


def parse_hours(value: Any) -> float:
    """Parse hours value from Excel, handling various formats."""
    if pd.isna(value):
        return 0.0

    try:
        if isinstance(value, (int, float)):
            return max(0.0, float(value))

        # Handle string values
        s = str(value).strip().lower()
        # Remove common suffixes
        s = s.replace("hrs", "").replace("hr", "").replace("h", "").strip()

        if not s or s in ("nan", "none", "-", "n/a"):
            return 0.0

        return max(0.0, float(s))
    except (ValueError, TypeError):
        return 0.0


def parse_off_hire(value: Any) -> bool:
    """Parse off-hire status from Excel."""
    if pd.isna(value):
        return False

    val = str(value).strip().lower()
    return val in ("yes", "y", "true", "1", "x", "✓", "off")


def map_columns(df: pd.DataFrame, column_map: dict[str, str]) -> pd.DataFrame:
    """Map DataFrame columns to standardized names."""
    rename_map = {}
    for col in df.columns:
        # Normalize: lowercase, strip whitespace, normalize internal whitespace
        col_normalized = str(col).lower().strip()
        # Also try with newlines replaced by space
        col_no_newline = col_normalized.replace("\n", " ")
        col_no_newline = " ".join(col_no_newline.split())  # Collapse whitespace
        # Also try with dots removed (handles "fleet . no." → "fleet no")
        col_no_dots = col_no_newline.replace(".", "").strip()
        col_no_dots = " ".join(col_no_dots.split())

        if col_normalized in column_map:
            rename_map[col] = column_map[col_normalized]
        elif col_no_newline in column_map:
            rename_map[col] = column_map[col_no_newline]
        elif col_no_dots in column_map:
            rename_map[col] = column_map[col_no_dots]

    return df.rename(columns=rename_map)


def find_header_row(file_content: bytes | io.BytesIO, max_rows: int = 10) -> int:
    """Auto-detect the header row by scanning for fleet number column keywords.

    Scans the first `max_rows` rows looking for cells that match known column
    headers (e.g., 'fleet no', 'fleet number'). Returns the 0-indexed row number.
    Falls back to row 3 (the legacy default) if no match found.

    Args:
        file_content: Raw bytes or BytesIO of the Excel file.
        max_rows: How many rows to scan.

    Returns:
        0-indexed header row number.
    """
    fleet_keywords = {"fleet no", "fleet no.", "fleet number", "fleet_no", "fleetnumber"}

    try:
        buf = io.BytesIO(file_content) if isinstance(file_content, bytes) else file_content
        buf.seek(0)
        df_raw = pd.read_excel(buf, sheet_name=0, header=None, nrows=max_rows)

        for i in range(len(df_raw)):
            for val in df_raw.iloc[i]:
                if pd.notna(val):
                    # Normalize: lowercase, collapse whitespace, remove dots/extra punctuation
                    normalized = str(val).strip().lower().replace("\n", " ")
                    # Collapse multiple spaces and normalize "fleet . no." → "fleet no."
                    normalized = " ".join(normalized.split())
                    # Also try with dots removed for matching "fleet . no." → "fleet no"
                    no_dots = normalized.replace(".", "").strip()
                    no_dots = " ".join(no_dots.split())
                    if normalized in fleet_keywords or no_dots in fleet_keywords:
                        return i
    except Exception:
        pass

    return 3  # Legacy default


def extract_metadata(df_raw: pd.DataFrame) -> tuple[str | None, str | None]:
    """Extract location and week ending date from report metadata."""
    location = None
    week_ending = None

    try:
        for i in range(min(4, len(df_raw))):
            row = df_raw.iloc[i].tolist()
            for j, val in enumerate(row):
                if pd.notna(val):
                    val_str = str(val).upper()
                    if "SITE LOCATION" in val_str:
                        for k in range(j + 1, len(row)):
                            if pd.notna(row[k]):
                                loc = str(row[k]).strip()
                                if loc and "SITE" not in loc.upper() and len(loc) > 2:
                                    location = loc.upper()
                                    break
                    if "WEEKENDING" in val_str or "WEEK ENDING" in val_str:
                        for k in range(j + 1, len(row)):
                            if pd.notna(row[k]):
                                week_ending = str(row[k])
                                break
    except Exception:
        pass

    return location, week_ending


async def process_weekly_report(
    job_id: str,
    storage_path: str,
    location_id: str,
    is_reprocess: bool = False,
) -> dict[str, Any]:
    """Process a weekly report Excel file.

    Args:
        job_id: The submission job ID.
        storage_path: Path to file in Supabase storage.
        location_id: Location UUID.
        is_reprocess: If True, cleanup existing data first.

    Returns:
        Processing result with stats.
    """
    settings = get_settings()

    result = {
        "success": False,
        "plants_processed": 0,
        "plants_created": 0,
        "plants_updated": 0,
        "errors": [],
        "warnings": [],
    }

    # Processing stats for detailed tracking
    processing_stats = {
        "condition_breakdown": {},
        "transfers": {
            "detected": 0,
            "inbound_confirmed": 0,
            "outbound_pending": 0,
        },
        "ai_parsing": {
            "total": 0,
            "high_confidence": 0,
            "low_confidence": 0,
            "fallback": 0,
        },
        "conflicts": {
            "detected": 0,
            "resolved": 0,
        },
        "anomalies": [],
    }

    try:
        # If reprocessing, cleanup existing data first
        if is_reprocess:
            cleanup_stats = await cleanup_submission_data(job_id)
            logger.info("Cleaned up for reprocessing", job_id=job_id, **cleanup_stats)

        # Update status to processing
        await execute(
            """UPDATE weekly_report_submissions SET status = 'processing',
                processing_started_at = $2 WHERE id = $1::uuid""",
            job_id, datetime.utcnow(),
        )

        logger.info("Starting weekly report processing", job_id=job_id, storage_path=storage_path)

        # Get submission data for week info
        submission = await fetchrow(
            "SELECT year, week_number, week_ending_date FROM weekly_report_submissions WHERE id = $1::uuid",
            job_id,
        )

        if not submission:
            raise ValueError("Submission not found")

        submission_year = submission["year"]
        submission_week = submission["week_number"]
        submission_week_ending = submission["week_ending_date"]

        # Download file from storage (stays on Supabase SDK)
        storage_client = get_supabase_admin_client()
        file_data = storage_client.storage.from_("reports").download(storage_path)

        # Parse Excel file
        df_raw = pd.read_excel(io.BytesIO(file_data), sheet_name=0, header=None)
        extracted_location, week_ending = extract_metadata(df_raw)

        # Auto-detect header row, then read with that row as header
        header_row = find_header_row(file_data)
        logger.info("Detected header row", header_row=header_row, job_id=job_id)
        df = pd.read_excel(io.BytesIO(file_data), sheet_name=0, header=header_row)
        df = map_columns(df, WEEKLY_COLUMN_MAP)

        if "fleet_number" not in df.columns:
            result["errors"].append("No fleet_number column found in file")
            raise ValueError("Invalid file format: no fleet_number column")

        # Extract fleet numbers from file and only fetch those from DB
        file_fleet_numbers = [
            normalize_fleet_number(fn) for fn in df.get("fleet_number", [])
            if normalize_fleet_number(fn)
        ]
        relevant_plants = await fetch(
            "SELECT id, fleet_number FROM plants_master WHERE fleet_number = ANY($1::text[])",
            list(set(file_fleet_numbers)),
        )

        fleet_to_id = {p["fleet_number"]: p["id"] for p in relevant_plants}
        logger.info("Loaded matching plants for lookup", count=len(fleet_to_id))

        # Process each row - first pass to collect data for batch AI parsing
        plants_to_insert = []
        plants_to_update = []
        plants_for_parsing = []  # Data for AI batch parsing

        for idx, row in df.iterrows():
            fleet_num = normalize_fleet_number(row.get("fleet_number"))
            if not fleet_num:
                continue

            result["plants_processed"] += 1

            physical_verification = derive_physical_verification(
                row.get("physical_verification"),
                row.get("remarks"),
            )

            # Extract usage data
            hours_worked = parse_hours(row.get("hours_worked"))
            standby_hours = parse_hours(row.get("standby_hours"))
            breakdown_hours = parse_hours(row.get("breakdown_hours"))
            off_hire = parse_off_hire(row.get("off_hire"))

            # Extract transfer info from columns (may be empty - AI will parse from remarks)
            transfer_from = None
            if pd.notna(row.get("transfer_from")):
                transfer_from = str(row.get("transfer_from")).strip() or None

            transfer_to = None
            if pd.notna(row.get("transfer_to")):
                transfer_to = str(row.get("transfer_to")).strip() or None

            description = None
            if pd.notna(row.get("description")):
                description = str(row.get("description")).strip() or None

            remarks = None
            if pd.notna(row.get("remarks")):
                remarks = str(row.get("remarks")).strip() or None

            # Collect data for AI parsing - include transfer columns
            plants_for_parsing.append({
                "fleet_number": fleet_num,
                "remarks": remarks,
                "hours_worked": hours_worked,
                "standby_hours": standby_hours,
                "breakdown_hours": breakdown_hours,
                "off_hire": off_hire,
                "transfer_from": transfer_from,
                "transfer_to": transfer_to,
            })

            # Data for updating the main plants table
            plant_data = {
                "fleet_number": fleet_num,
                "description": description,
                "remarks": remarks,
                "physical_verification": physical_verification,
                "current_location_id": location_id,
                "last_verified_date": submission_week_ending,
                "last_verified_year": submission_year,
                "last_verified_week": submission_week,
                "updated_at": datetime.utcnow(),
                # Usage data for weekly tracking (not stored in plants table)
                "_usage": {
                    "hours_worked": hours_worked,
                    "standby_hours": standby_hours,
                    "breakdown_hours": breakdown_hours,
                    "off_hire": off_hire,
                    "transfer_from": transfer_from,
                    "transfer_to": transfer_to,
                },
            }

            if fleet_num in fleet_to_id:
                # Update existing plant
                plants_to_update.append({
                    "id": fleet_to_id[fleet_num],
                    **plant_data,
                })
            else:
                # New plant - will resolve fleet_type in batch later
                plant_data["condition"] = "unverified"  # Default for new plants
                plants_to_insert.append(plant_data)

        # For plants with no remarks AND no usage, use previous week's remarks for condition derivation
        # Get plant IDs that have no data
        plants_needing_prev_remarks = [
            p for p in plants_for_parsing
            if not p.get("remarks")
            and p.get("hours_worked", 0) == 0
            and p.get("standby_hours", 0) == 0
            and p.get("breakdown_hours", 0) == 0
        ]

        if plants_needing_prev_remarks:
            try:
                # Get previous week
                prev_week = submission_week - 1
                prev_year = submission_year
                if prev_week < 1:
                    prev_week = 52
                    prev_year = submission_year - 1

                # Get fleet numbers that need previous remarks
                fleet_nums_needing = [p["fleet_number"] for p in plants_needing_prev_remarks]

                # Get plant IDs for these fleet numbers
                plant_ids_needing = [fleet_to_id.get(fn) for fn in fleet_nums_needing if fn in fleet_to_id]
                plant_ids_needing = [pid for pid in plant_ids_needing if pid]

                if plant_ids_needing:
                    # Fetch previous week's records (single query with ANY)
                    prev_remarks_by_plant_id = {}
                    prev_remarks_rows = await fetch(
                        """SELECT plant_id, remarks, hours_worked, standby_hours, breakdown_hours
                           FROM plant_weekly_records
                           WHERE year = $1 AND week_number = $2 AND plant_id = ANY($3::uuid[])""",
                        prev_year, prev_week, plant_ids_needing,
                    )
                    for r in prev_remarks_rows:
                        prev_remarks_by_plant_id[r["plant_id"]] = r

                    # Create reverse lookup: plant_id -> fleet_number
                    id_to_fleet = {v: k for k, v in fleet_to_id.items()}

                    # Apply previous remarks to plants_for_parsing (for condition derivation only)
                    for plant_data in plants_for_parsing:
                        fn = plant_data["fleet_number"]
                        plant_id = fleet_to_id.get(fn)
                        if plant_id and plant_id in prev_remarks_by_plant_id:
                            prev_record = prev_remarks_by_plant_id[plant_id]
                            # Only use for parsing if current has no data
                            if (not plant_data.get("remarks")
                                and plant_data.get("hours_worked", 0) == 0
                                and plant_data.get("standby_hours", 0) == 0
                                and plant_data.get("breakdown_hours", 0) == 0):
                                # Use previous remarks for AI parsing
                                plant_data["remarks"] = prev_record.get("remarks")
                                plant_data["hours_worked"] = prev_record.get("hours_worked", 0)
                                plant_data["standby_hours"] = prev_record.get("standby_hours", 0)
                                plant_data["breakdown_hours"] = prev_record.get("breakdown_hours", 0)
                                plant_data["_using_prev_week"] = True  # Flag for logging

                    logger.info(
                        "Using previous week remarks for condition derivation",
                        count=len([p for p in plants_for_parsing if p.get("_using_prev_week")]),
                    )

            except Exception as e:
                logger.warning("Failed to fetch previous week remarks", error=str(e))

        # AI batch parsing of remarks
        logger.info("Starting AI remarks parsing", count=len(plants_for_parsing), job_id=job_id)
        parsed_remarks = await parse_remarks_batch(plants_for_parsing)
        logger.info("AI parsing complete", parsed_count=len(parsed_remarks), job_id=job_id)

        # Track AI parsing stats
        processing_stats["ai_parsing"]["total"] = len(parsed_remarks)

        # Apply parsed condition to plants (unified field - no more separate status)
        for plant in plants_to_insert + plants_to_update:
            fn = plant["fleet_number"]
            parsed = parsed_remarks.get(fn)
            if parsed:
                usage = plant.get("_usage", {})
                # Derive final condition from AI parsing + hours data + off_hire column
                condition = derive_condition(
                    parsed=parsed,
                    hours_worked=usage.get("hours_worked", 0),
                    standby_hours=usage.get("standby_hours", 0),
                    breakdown_hours=usage.get("breakdown_hours", 0),
                    off_hire=usage.get("off_hire", False),
                )
                plant["condition"] = condition
                plant["condition_confidence"] = parsed.confidence
                # Store parsed data for weekly record
                plant["_parsed"] = parsed

                # Track condition breakdown
                processing_stats["condition_breakdown"][condition] = (
                    processing_stats["condition_breakdown"].get(condition, 0) + 1
                )

                # Track AI confidence levels
                if parsed.confidence >= 0.7:
                    processing_stats["ai_parsing"]["high_confidence"] += 1
                elif parsed.confidence >= 0.4:
                    processing_stats["ai_parsing"]["low_confidence"] += 1
                    # Log low confidence as anomaly
                    processing_stats["anomalies"].append({
                        "fleet_number": fn,
                        "issue": "Low AI confidence",
                        "confidence": round(parsed.confidence, 2),
                        "remarks": (plant.get("remarks") or "")[:100],
                        "derived_condition": condition,
                    })
                else:
                    processing_stats["ai_parsing"]["fallback"] += 1

        # Batch insert new plants (exclude _usage field)
        if plants_to_insert:
            try:
                # Batch resolve fleet types for all new plants (single query)
                fleet_prefixes = await fetch("SELECT prefix, fleet_type FROM fleet_number_prefixes")
                prefix_to_type = {p["prefix"]: p["fleet_type"] for p in fleet_prefixes}

                # Apply fleet types based on prefix
                for plant in plants_to_insert:
                    fn = plant.get("fleet_number", "")
                    match = re.match(r'^([A-Z]+)', fn.replace(" ", ""))
                    if match:
                        prefix = match.group(1)
                        if prefix in prefix_to_type:
                            plant["fleet_type"] = prefix_to_type[prefix]

                # Insert one by one to get RETURNING IDs
                created_count = 0
                for plant in plants_to_insert:
                    row = await fetchrow(
                        """INSERT INTO plants_master (fleet_number, description, remarks,
                            physical_verification, current_location_id, last_verified_date,
                            last_verified_year, last_verified_week, updated_at, condition,
                            condition_confidence, fleet_type)
                        VALUES ($1, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10, $11, $12)
                        RETURNING id, fleet_number""",
                        plant["fleet_number"], plant.get("description"), plant.get("remarks"),
                        plant.get("physical_verification"), plant.get("current_location_id"),
                        plant.get("last_verified_date"), plant.get("last_verified_year"),
                        plant.get("last_verified_week"), plant.get("updated_at"),
                        plant.get("condition"), plant.get("condition_confidence"),
                        plant.get("fleet_type"),
                    )
                    if row:
                        plant["id"] = row["id"]
                        created_count += 1

                result["plants_created"] = created_count

                # Record initial location history for new plants
                location_history_params = [
                    (p["id"], location_id, datetime.utcnow(), "First seen in weekly report")
                    for p in plants_to_insert if p.get("id")
                ]
                if location_history_params:
                    await executemany(
                        """INSERT INTO plant_location_history (plant_id, location_id, start_date, transfer_reason)
                           VALUES ($1::uuid, $2::uuid, $3, $4)""",
                        location_history_params,
                    )

                logger.info("Inserted new plants", count=result["plants_created"], job_id=job_id)
            except Exception as e:
                result["errors"].append(f"Failed to insert plants: {str(e)}")
                logger.error("Failed to insert plants", error=str(e), job_id=job_id)

        # Check for location conflicts (plant appearing in multiple locations same week)
        # Query existing records for this week from OTHER locations
        # Batch the query to avoid URL length limits (max ~50 UUIDs per query)
        plant_ids_to_check = [p["id"] for p in plants_to_update if p.get("id")]
        existing_by_plant = {}
        prev_week_locations = {}  # Where each plant was last week

        if plant_ids_to_check:
            try:
                # Get previous week's locations for conflict resolution
                prev_week = submission_week - 1
                prev_year = submission_year
                if prev_week < 1:
                    prev_week = 52
                    prev_year = submission_year - 1

                # Single query with ANY (no batching needed with asyncpg)
                prev_loc_rows = await fetch(
                    """SELECT plant_id, location_id FROM plant_weekly_records
                       WHERE year = $1 AND week_number = $2 AND plant_id = ANY($3::uuid[])""",
                    prev_year, prev_week, plant_ids_to_check,
                )
                for r in prev_loc_rows:
                    prev_week_locations[r["plant_id"]] = r["location_id"]

                # Check for existing records at OTHER locations this week
                conflict_rows = await fetch(
                    """SELECT plant_id, location_id, hours_worked, remarks, physical_verification, transfer_from
                       FROM plant_weekly_records
                       WHERE year = $1 AND week_number = $2 AND location_id != $3::uuid
                         AND plant_id = ANY($4::uuid[])""",
                    submission_year, submission_week, location_id, plant_ids_to_check,
                )
                for r in conflict_rows:
                    existing_by_plant[r["plant_id"]] = r

                # Resolve conflicts
                plants_to_skip = set()
                for plant in plants_to_update:
                    plant_id = plant.get("id")
                    if plant_id and plant_id in existing_by_plant:
                        existing = existing_by_plant[plant_id]
                        current = {
                            "location_id": location_id,
                            "physical_verification": plant.get("physical_verification"),
                            "remarks": plant.get("remarks"),
                            "_usage": plant.get("_usage", {}),
                        }

                        # Pass previous week location for smart resolution
                        prev_loc = prev_week_locations.get(plant_id)
                        winner_location, reason = resolve_location_conflict(existing, current, prev_loc)
                        processing_stats["conflicts"]["detected"] += 1

                        if winner_location == location_id:
                            # Current wins - mark existing record as conflicting
                            await execute(
                                """UPDATE plant_weekly_records SET conflict_status = 'conflicting'
                                   WHERE plant_id = $1::uuid AND year = $2 AND week_number = $3
                                     AND location_id = $4::uuid""",
                                plant_id, submission_year, submission_week, existing["location_id"],
                            )

                            processing_stats["conflicts"]["resolved"] += 1
                            processing_stats["anomalies"].append({
                                "fleet_number": plant["fleet_number"],
                                "issue": "Location conflict resolved",
                                "conflicting_locations": [existing["location_id"], location_id],
                                "winner": location_id,
                                "reason": reason,
                            })
                        else:
                            # Existing wins - skip this plant's update
                            plants_to_skip.add(plant_id)
                            processing_stats["anomalies"].append({
                                "fleet_number": plant["fleet_number"],
                                "issue": "Location conflict - skipped",
                                "conflicting_locations": [existing["location_id"], location_id],
                                "winner": existing["location_id"],
                                "reason": reason,
                            })

                # Filter out skipped plants
                if plants_to_skip:
                    plants_to_update = [p for p in plants_to_update if p.get("id") not in plants_to_skip]
                    logger.info("Skipped plants due to location conflicts", count=len(plants_to_skip), job_id=job_id)

            except Exception as e:
                logger.warning("Failed to check for location conflicts", error=str(e), job_id=job_id)

        # Batch update existing plants using executemany
        if plants_to_update:
            try:
                await executemany(
                    """UPDATE plants_master SET
                        description = COALESCE($2, description),
                        remarks = $3,
                        physical_verification = $4,
                        current_location_id = $5::uuid,
                        last_verified_date = $6,
                        last_verified_year = $7,
                        last_verified_week = $8,
                        updated_at = $9,
                        condition = COALESCE($10, condition),
                        condition_confidence = COALESCE($11, condition_confidence)
                    WHERE id = $1::uuid""",
                    [
                        (
                            p["id"], p.get("description"), p.get("remarks"),
                            p.get("physical_verification"), p.get("current_location_id"),
                            p.get("last_verified_date"), p.get("last_verified_year"),
                            p.get("last_verified_week"), p.get("updated_at"),
                            p.get("condition"), p.get("condition_confidence"),
                        )
                        for p in plants_to_update
                    ],
                )
                result["plants_updated"] = len(plants_to_update)
                logger.info("Batch updated plants", count=result["plants_updated"], job_id=job_id)
            except Exception as e:
                result["warnings"].append(f"Failed to batch update plants: {str(e)}")
                logger.error("Failed to batch update plants", error=str(e), job_id=job_id)

        # Record weekly location data for plants and detect movements
        all_plants = plants_to_insert + plants_to_update
        tracking_result = await _record_plant_locations(
            job_id,
            location_id,
            [p["fleet_number"] for p in all_plants],
            plant_details=all_plants,  # Pass full plant details for tracking
            parsed_remarks=parsed_remarks,  # Pass AI parsed data for transfer detection
            processing_stats=processing_stats,  # Pass stats for transfer tracking
        )

        # Add tracking stats to result
        result["movements_detected"] = tracking_result.get("movements_detected", 0)
        result["new_plants_tracked"] = tracking_result.get("new_plants", 0)
        result["transfers_detected"] = tracking_result.get("transfers_detected", 0)
        result["transfers_confirmed"] = tracking_result.get("transfers_confirmed", 0)

        # Update transfer stats from tracking
        processing_stats["transfers"]["detected"] = tracking_result.get("transfers_detected", 0)
        processing_stats["transfers"]["inbound_confirmed"] = tracking_result.get("transfers_confirmed", 0)
        processing_stats["transfers"]["outbound_pending"] = tracking_result.get("outbound_pending", 0)

        result["success"] = len(result["errors"]) == 0

        # Update submission with results INCLUDING processing_stats
        final_status = "completed" if result["success"] else "partial" if result["plants_processed"] > 0 else "failed"

        # Limit anomalies to 50 to avoid huge JSON
        if len(processing_stats["anomalies"]) > 50:
            processing_stats["anomalies"] = processing_stats["anomalies"][:50]
            processing_stats["anomalies_truncated"] = True

        await execute(
            """UPDATE weekly_report_submissions SET
                status = $2, processing_completed_at = $3,
                plants_processed = $4, plants_created = $5, plants_updated = $6,
                processing_stats = $7::jsonb,
                errors = $8::jsonb, warnings = $9::jsonb
            WHERE id = $1::uuid""",
            job_id, final_status, datetime.utcnow(),
            result["plants_processed"], result["plants_created"], result["plants_updated"],
            json.dumps(processing_stats),
            json.dumps(result["errors"]) if result["errors"] else None,
            json.dumps(result["warnings"]) if result["warnings"] else None,
        )

        broadcast("plants", "import", f"{result['plants_processed']} plants processed")
        broadcast("uploads", "complete")

        # Create notification for plant officer
        await _create_notification(
            title=f"Weekly report processed",
            message=f"Processed {result['plants_processed']} plants: {result['plants_created']} new, {result['plants_updated']} updated",
            notification_type="report_processed" if result["success"] else "warning",
            data={"job_id": job_id, "location_id": location_id},
        )

        # Generate automated insights for this site + week
        try:
            from app.services.insights_service import generate_site_insights
            insight_result = await generate_site_insights(location_id, submission_week_ending)
            result["insights_generated"] = insight_result.get("insights_generated", 0)
            logger.info(
                "Post-ETL insights generated",
                job_id=job_id,
                insights=result["insights_generated"],
            )
        except Exception as ie:
            logger.warning("Insight generation failed (non-fatal)", error=str(ie))

        logger.info(
            "Weekly report processing complete",
            job_id=job_id,
            plants_processed=result["plants_processed"],
            plants_created=result["plants_created"],
            plants_updated=result["plants_updated"],
            success=result["success"],
        )

    except Exception as e:
        error_msg = repr(e) if not str(e) else str(e)
        logger.exception("Weekly report processing failed", job_id=job_id, error=error_msg)

        result["errors"].append(f"Processing failed: {error_msg}")

        # Update submission as failed
        try:
            await execute(
                """UPDATE weekly_report_submissions SET
                    status = 'failed', processing_completed_at = $2, errors = $3::jsonb
                WHERE id = $1::uuid""",
                job_id, datetime.utcnow(), json.dumps(result["errors"]),
            )
        except Exception:
            pass

        # Create failure notification
        await _create_notification(
            title="Weekly report processing failed",
            message=f"Error: {error_msg[:200]}",
            notification_type="report_failed",
            data={"job_id": job_id, "error": str(e)[:500]},
        )

    return result


async def process_purchase_order(
    job_id: str,
    storage_path: str,
) -> dict[str, Any]:
    """Process a purchase order Excel file.

    Args:
        job_id: The submission job ID.
        storage_path: Path to file in Supabase storage.

    Returns:
        Processing result with stats.
    """
    settings = get_settings()

    result = {
        "success": False,
        "parts_processed": 0,
        "parts_created": 0,
        "errors": [],
        "warnings": [],
    }

    try:
        # Update status to processing
        await execute(
            """UPDATE purchase_order_submissions SET status = 'processing',
                processing_started_at = $2 WHERE id = $1::uuid""",
            job_id, datetime.utcnow(),
        )

        logger.info("Starting purchase order processing", job_id=job_id, storage_path=storage_path)

        # Download file from storage (stays on Supabase SDK)
        storage_client = get_supabase_admin_client()
        file_data = storage_client.storage.from_("reports").download(storage_path)

        # Get submission details
        submission = await fetchrow(
            "SELECT * FROM purchase_order_submissions WHERE id = $1::uuid",
            job_id,
        )
        po_number = submission.get("po_number")
        po_date = submission.get("po_date")

        # Parse Excel - PO files may have various formats
        xl = pd.ExcelFile(io.BytesIO(file_data))

        parts_to_insert = []

        # Process each sheet (each sheet might be a different fleet)
        for sheet_name in xl.sheet_names:
            try:
                df = pd.read_excel(xl, sheet_name=sheet_name, header=0)

                # Try to find fleet number from sheet name
                fleet_num = _extract_fleet_from_sheet_name(sheet_name)

                if not fleet_num:
                    # Try to get from file content
                    result["warnings"].append(f"Could not determine fleet number for sheet: {sheet_name}")
                    continue

                # Map common column names
                df = _map_po_columns(df)

                # Get plant ID for this fleet
                plant_row = await fetchrow(
                    "SELECT id FROM plants_master WHERE fleet_number = $1",
                    fleet_num,
                )

                if not plant_row:
                    # Create plant if doesn't exist — resolve fleet_type from prefix
                    resolved_type = await fetchval("SELECT resolve_fleet_type($1)", fleet_num)
                    new_plant = await fetchrow(
                        """INSERT INTO plants_master (fleet_number, fleet_type, condition, physical_verification)
                           VALUES ($1, $2, 'unverified', false) RETURNING id""",
                        fleet_num, resolved_type,
                    )
                    plant_id = new_plant["id"]
                    result["warnings"].append(f"Created new plant for fleet: {fleet_num}")
                else:
                    plant_id = plant_row["id"]

                # Process rows
                for _, row in df.iterrows():
                    if pd.isna(row.get("part_description")) and pd.isna(row.get("part_number")):
                        continue

                    result["parts_processed"] += 1

                    # Excel provides TOTAL cost, not unit cost
                    # We need to calculate unit_cost = total_cost / quantity
                    total_cost_from_excel = _clean_cost(row.get("cost") or row.get("unit_cost") or row.get("total_cost"))
                    quantity = _clean_quantity(row.get("quantity")) or 1

                    # Calculate actual unit cost
                    unit_cost = None
                    if total_cost_from_excel is not None:
                        unit_cost = round(total_cost_from_excel / quantity, 2) if quantity > 0 else total_cost_from_excel

                    part_data = {
                        "plant_id": plant_id,
                        "replaced_date": _parse_date(row.get("date")) or po_date,
                        "part_number": _clean_string(row.get("part_number")),
                        "part_description": _clean_string(row.get("part_description")),
                        "supplier": _clean_string(row.get("supplier")),
                        "reason_for_change": _clean_string(row.get("reason")),
                        "unit_cost": unit_cost,  # Calculated from Excel total / quantity
                        "quantity": quantity,
                        "purchase_order_number": po_number or _clean_string(row.get("po_number")),
                        "remarks": _clean_string(row.get("remarks")),
                    }

                    parts_to_insert.append(part_data)

            except Exception as e:
                result["warnings"].append(f"Error processing sheet {sheet_name}: {str(e)}")

        # Batch insert spare parts
        if parts_to_insert:
            try:
                await executemany(
                    """INSERT INTO spare_parts (plant_id, replaced_date, part_number, part_description,
                        supplier, reason_for_change, unit_cost, quantity, purchase_order_number, remarks)
                    VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)""",
                    [
                        (
                            p["plant_id"], p.get("replaced_date"), p.get("part_number"),
                            p.get("part_description"), p.get("supplier"), p.get("reason_for_change"),
                            p.get("unit_cost"), p.get("quantity"), p.get("purchase_order_number"),
                            p.get("remarks"),
                        )
                        for p in parts_to_insert
                    ],
                )
                result["parts_created"] = len(parts_to_insert)
                logger.info("Inserted spare parts", count=result["parts_created"], job_id=job_id)
            except Exception as e:
                result["errors"].append(f"Failed to insert spare parts: {str(e)}")
                logger.error("Failed to insert spare parts", error=str(e), job_id=job_id)

        result["success"] = len(result["errors"]) == 0

        # Update submission with results
        final_status = "completed" if result["success"] else "partial" if result["parts_processed"] > 0 else "failed"

        await execute(
            """UPDATE purchase_order_submissions SET
                status = $2, processing_completed_at = $3,
                parts_processed = $4, parts_created = $5,
                errors = $6::jsonb, warnings = $7::jsonb
            WHERE id = $1::uuid""",
            job_id, final_status, datetime.utcnow(),
            result["parts_processed"], result["parts_created"],
            json.dumps(result["errors"]) if result["errors"] else None,
            json.dumps(result["warnings"]) if result["warnings"] else None,
        )

        broadcast("spare_parts", "import", f"{result['parts_processed']} parts processed")
        broadcast("uploads", "complete")

        # Create notification
        await _create_notification(
            title="Purchase order processed",
            message=f"Processed {result['parts_processed']} parts: {result['parts_created']} created",
            notification_type="report_processed" if result["success"] else "warning",
            data={"job_id": job_id, "po_number": po_number},
        )

        logger.info(
            "Purchase order processing complete",
            job_id=job_id,
            parts_processed=result["parts_processed"],
            parts_created=result["parts_created"],
            success=result["success"],
        )

    except Exception as e:
        logger.exception("Purchase order processing failed", job_id=job_id, error=str(e))

        result["errors"].append(f"Processing failed: {str(e)}")

        # Update submission as failed
        try:
            await execute(
                """UPDATE purchase_order_submissions SET
                    status = 'failed', processing_completed_at = $2, errors = $3::jsonb
                WHERE id = $1::uuid""",
                job_id, datetime.utcnow(), json.dumps(result["errors"]),
            )
        except Exception:
            pass

        # Create failure notification
        await _create_notification(
            title="Purchase order processing failed",
            message=f"Error: {str(e)[:200]}",
            notification_type="report_failed",
            data={"job_id": job_id, "error": str(e)[:500]},
        )

    return result


async def _record_plant_locations(
    submission_id: str,
    location_id: str,
    fleet_numbers: list[str],
    plant_details: list[dict[str, Any]] | None = None,
    parsed_remarks: dict[str, ParsedRemarks] | None = None,
    processing_stats: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Record plant location data for the week and detect movements.

    Also handles:
    - AI-parsed transfer detection and processing
    - Confirming pending incoming transfers
    - "Latest week" logic for location updates
    - Missing plant detection
    - Conflict status marking for duplicate records

    Args:
        submission_id: The submission ID.
        location_id: Current location ID.
        fleet_numbers: List of fleet numbers in this report.
        plant_details: Optional list of dicts with plant details (remarks, physical_verification, etc.)
        parsed_remarks: AI-parsed remarks data keyed by fleet number.
        processing_stats: Optional stats dict to update with transfer counts.

    Returns:
        Dict with tracking stats (movements, new_plants, transfers, etc.)
    """
    tracking_result = {
        "movements_detected": 0,
        "new_plants": 0,
        "records_created": 0,
        "transfers_detected": 0,
        "transfers_confirmed": 0,
        "outbound_pending": 0,
    }

    if not fleet_numbers:
        return tracking_result

    parsed_remarks = parsed_remarks or {}
    processing_stats = processing_stats or {}
    transfer_service = get_transfer_service()

    try:
        # Get plant IDs for fleet numbers (single query with ANY)
        plants_rows = await fetch(
            "SELECT id, fleet_number, current_location_id FROM plants_master WHERE fleet_number = ANY($1::text[])",
            fleet_numbers,
        )
        fleet_to_plant = {p["fleet_number"]: p for p in plants_rows}

        # Get submission details for week info
        submission = await fetchrow(
            "SELECT year, week_number, week_ending_date FROM weekly_report_submissions WHERE id = $1::uuid",
            submission_id,
        )

        if not submission:
            return tracking_result

        year = submission["year"]
        week_number = submission["week_number"]
        week_ending_date = submission["week_ending_date"]

        # Build details lookup if provided
        details_lookup = {}
        if plant_details:
            for d in plant_details:
                if d.get("fleet_number"):
                    details_lookup[d["fleet_number"]] = d

        # Get previous week's records for these plants to detect movements
        prev_week = week_number - 1
        prev_year = year
        if prev_week < 1:
            prev_week = 52
            prev_year = year - 1

        plant_ids = [fleet_to_plant[fn]["id"] for fn in fleet_numbers if fn in fleet_to_plant]

        # No batching needed with asyncpg — use ANY() for all IN queries
        prev_records_data = await fetch(
            """SELECT plant_id, location_id FROM plant_weekly_records
               WHERE year = $1 AND week_number = $2 AND plant_id = ANY($3::uuid[])""",
            prev_year, prev_week, plant_ids,
        )
        prev_locations = {r["plant_id"]: r["location_id"] for r in prev_records_data}

        # Check which plants have ANY existing records
        existing_records_data = await fetch(
            "SELECT DISTINCT plant_id FROM plant_weekly_records WHERE plant_id = ANY($1::uuid[])",
            plant_ids,
        )
        plants_with_history = {r["plant_id"] for r in existing_records_data}

        # Check for pending transfers that should be confirmed
        confirmed_transfers = await transfer_service.check_and_confirm_pending_transfers(
            plant_ids=plant_ids,
            location_id=location_id,
            submission_id=submission_id,
        )
        tracking_result["transfers_confirmed"] = len(confirmed_transfers)

        # Check which plants this is the latest week for (to update current_location)
        latest_weeks_data = await fetch(
            "SELECT plant_id, year, week_number FROM plant_weekly_records WHERE plant_id = ANY($1::uuid[])",
            plant_ids,
        )
        # Build map of plant_id -> (latest_year, latest_week)
        plant_latest_week = {}
        for r in sorted(latest_weeks_data, key=lambda x: (x["year"], x["week_number"]), reverse=True):
            pid = r["plant_id"]
            if pid not in plant_latest_week:
                plant_latest_week[pid] = (r["year"], r["week_number"])

        # Prepare weekly records and detect events
        weekly_records = []
        events_to_create = []
        location_updates = []  # Plants to update current_location

        # Batch transfer collection for speed - ONLY outbound transfers
        # We don't track inbound - if plant is in this report, it's already here
        outbound_transfers_to_create = []

        # Internal/closed locations to ignore for transfer tracking
        # These are areas within sites, not separate locations
        IGNORED_TRANSFER_LOCATIONS = {
            "PW SCRAP", "SCRAP", "SCRAB", "SCRAP YARD",  # Scrap yard within sites
            "ASHAKA", "BAUCHI",  # Closed sites
            "DID NOT RECEIVE", "DID NOT RECEIVE IT", "NOT RECEIVED",  # Not locations
            "WORKSHOP", "PLANT WORKSHOP",  # Internal areas
        }

        for fn in fleet_numbers:
            if fn not in fleet_to_plant:
                continue

            plant = fleet_to_plant[fn]
            plant_id = plant["id"]
            details = details_lookup.get(fn, {})
            usage = details.get("_usage", {})
            parsed = parsed_remarks.get(fn)

            # Create weekly record with usage data and AI-parsed fields
            record = {
                "plant_id": plant_id,
                "location_id": location_id,
                "submission_id": submission_id,
                "year": year,
                "week_number": week_number,
                "week_ending_date": week_ending_date,
                "physical_verification": details.get("physical_verification", True),
                "remarks": details.get("remarks"),
                "raw_description": details.get("description"),
                "raw_remarks": details.get("remarks"),
                # Condition from AI parsing
                "condition": details.get("condition"),
                # Usage data
                "hours_worked": usage.get("hours_worked", 0),
                "standby_hours": usage.get("standby_hours", 0),
                "breakdown_hours": usage.get("breakdown_hours", 0),
                "off_hire": usage.get("off_hire", False),
                "transfer_from": usage.get("transfer_from"),
                "transfer_to": usage.get("transfer_to"),
                # Mark as primary (winner) if this is from a conflict resolution
                "conflict_status": "primary" if details.get("_conflict_resolved") else None,
            }

            # Add AI-parsed fields
            if parsed:
                record["parsed_condition"] = parsed.condition
                record["parsed_transfer_direction"] = parsed.transfer_direction
                record["ai_confidence"] = parsed.confidence
                if parsed.condition_notes:
                    record["parsed_condition_keywords"] = [parsed.condition_notes]

                # Resolve transfer location to ID if detected
                if parsed.transfer_location:
                    resolved = await transfer_service.resolve_location(parsed.transfer_location)
                    if resolved:
                        record["parsed_transfer_location_id"] = resolved["id"]

            weekly_records.append(record)

            # Check if this is the latest week for this plant
            existing_latest = plant_latest_week.get(plant_id)
            is_latest = (
                existing_latest is None or
                (year, week_number) >= existing_latest
            )

            # Collect OUTBOUND transfers only (plant going TO another location)
            # We don't track inbound - if plant is in this report, it's already here
            transfer_to_col = usage.get("transfer_to")

            if transfer_to_col:
                # Check if this is an internal/ignored location
                transfer_to_upper = transfer_to_col.upper().strip()
                is_ignored = any(ignored in transfer_to_upper for ignored in IGNORED_TRANSFER_LOCATIONS)

                if not is_ignored:
                    # Try to resolve to a valid location
                    to_location_resolved = await transfer_service.resolve_location(transfer_to_col)
                    if to_location_resolved and to_location_resolved["id"] != location_id:
                        # Valid different location - create outbound transfer
                        outbound_transfers_to_create.append({
                            "plant_id": str(plant_id),
                            "from_location_id": str(location_id),
                            "to_location_id": to_location_resolved["id"],
                            "from_location_raw": None,
                            "to_location_raw": transfer_to_col,
                            "transfer_date": week_ending_date,
                            "direction": "outbound",
                            "status": "pending",
                            "source_submission_id": str(submission_id),
                            "source_remarks": details.get("remarks"),
                            "parsed_confidence": 1.0,
                            "_fleet_number": fn,
                        })
                    elif not to_location_resolved:
                        # Could not resolve - log warning but don't fail
                        logger.warning(
                            "Could not resolve transfer_to location",
                            fleet_number=fn,
                            transfer_to=transfer_to_col,
                        )

            # Process AI-detected OUTBOUND transfers (only if no Excel column transfer)
            elif parsed and parsed.transfer_detected and parsed.transfer_direction == "outbound" and parsed.transfer_location:
                transfer_loc_upper = parsed.transfer_location.upper().strip()
                is_ignored = any(ignored in transfer_loc_upper for ignored in IGNORED_TRANSFER_LOCATIONS)

                if not is_ignored:
                    to_loc = await transfer_service.resolve_location(parsed.transfer_location)
                    if to_loc and to_loc["id"] != location_id:
                        outbound_transfers_to_create.append({
                            "plant_id": str(plant_id),
                            "from_location_id": str(location_id),
                            "to_location_id": to_loc["id"],
                            "from_location_raw": None,
                            "to_location_raw": parsed.transfer_location,
                            "transfer_date": week_ending_date,
                            "direction": "outbound",
                            "status": "pending",
                            "source_submission_id": str(submission_id),
                            "source_remarks": details.get("remarks"),
                            "parsed_confidence": parsed.confidence,
                            "_fleet_number": fn,
                        })

            # Track plants that should have location updated (only for latest week)
            if is_latest and parsed and parsed.transfer_direction != "outbound":
                # Don't update location for outbound transfers - plant is leaving
                location_updates.append(plant_id)

            # Check for movement (location change from previous week)
            # This is AUTOMATIC transfer detection - plant appeared in new location
            prev_location = prev_locations.get(plant_id)
            if prev_location and prev_location != location_id:
                # Plant has moved! Create CONFIRMED transfer automatically
                events_to_create.append({
                    "plant_id": plant_id,
                    "event_type": "movement",
                    "event_date": week_ending_date,
                    "year": year,
                    "week_number": week_number,
                    "from_location_id": prev_location,
                    "to_location_id": location_id,
                    "details": {"fleet_number": fn},
                    "remarks": f"Plant {fn} moved from previous location",
                })
                tracking_result["movements_detected"] += 1

                # Create CONFIRMED transfer record (automatic detection)
                # Check if there's already a pending transfer for this plant
                existing_pending = await fetchrow(
                    """SELECT id FROM plant_transfers
                       WHERE plant_id = $1::uuid AND to_location_id = $2::uuid AND status = 'pending'""",
                    str(plant_id), str(location_id),
                )

                if existing_pending:
                    # Confirm the existing pending transfer
                    await execute(
                        """UPDATE plant_transfers SET status = 'confirmed',
                            confirmed_at = $2, confirmed_by_submission_id = $3::uuid
                        WHERE id = $1::uuid""",
                        existing_pending["id"], datetime.utcnow(), str(submission_id),
                    )

                    # Clear pending transfer from plant
                    await execute(
                        "UPDATE plants_master SET pending_transfer_id = NULL WHERE id = $1::uuid",
                        str(plant_id),
                    )

                    tracking_result["transfers_confirmed"] = tracking_result.get("transfers_confirmed", 0) + 1
                else:
                    # Create new CONFIRMED transfer (automatic detection)
                    try:
                        await execute(
                            """INSERT INTO plant_transfers (plant_id, from_location_id, to_location_id,
                                transfer_date, direction, status, confirmed_at,
                                confirmed_by_submission_id, source_submission_id,
                                source_remarks, parsed_confidence)
                            VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'inbound', 'confirmed',
                                $5, $6::uuid, $6::uuid, $7, 1.0)""",
                            str(plant_id), str(prev_location), str(location_id),
                            week_ending_date, datetime.utcnow(),
                            str(submission_id), details.get("remarks"),
                        )
                        tracking_result["transfers_detected"] += 1
                        logger.info(
                            "Created automatic transfer (plant moved)",
                            fleet_number=fn,
                            from_location=str(prev_location),
                            to_location=str(location_id),
                        )
                    except Exception as e:
                        logger.warning("Failed to create automatic transfer", error=str(e), fleet_number=fn)
            elif not prev_location and plant_id not in prev_locations:
                # Check if this is first time seeing this plant at ANY location
                if plant_id not in plants_with_history:
                    # New plant being tracked
                    events_to_create.append({
                        "plant_id": plant_id,
                        "event_type": "new",
                        "event_date": week_ending_date,
                        "year": year,
                        "week_number": week_number,
                        "to_location_id": location_id,
                        "details": {"fleet_number": fn},
                        "remarks": f"Plant {fn} first recorded in system",
                    })
                    tracking_result["new_plants"] += 1

        # Upsert weekly records
        if weekly_records:
            await executemany(
                """INSERT INTO plant_weekly_records (
                    plant_id, location_id, submission_id, year, week_number,
                    week_ending_date, physical_verification, remarks, raw_description,
                    raw_remarks, condition, hours_worked, standby_hours, breakdown_hours,
                    off_hire, transfer_from, transfer_to, conflict_status,
                    parsed_condition, parsed_transfer_direction, ai_confidence,
                    parsed_condition_keywords, parsed_transfer_location_id)
                VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23::uuid)
                ON CONFLICT (plant_id, year, week_number) DO UPDATE SET
                    location_id = EXCLUDED.location_id, submission_id = EXCLUDED.submission_id,
                    week_ending_date = EXCLUDED.week_ending_date,
                    physical_verification = EXCLUDED.physical_verification,
                    remarks = EXCLUDED.remarks, raw_description = EXCLUDED.raw_description,
                    raw_remarks = EXCLUDED.raw_remarks, condition = EXCLUDED.condition,
                    hours_worked = EXCLUDED.hours_worked, standby_hours = EXCLUDED.standby_hours,
                    breakdown_hours = EXCLUDED.breakdown_hours, off_hire = EXCLUDED.off_hire,
                    transfer_from = EXCLUDED.transfer_from, transfer_to = EXCLUDED.transfer_to,
                    conflict_status = EXCLUDED.conflict_status,
                    parsed_condition = EXCLUDED.parsed_condition,
                    parsed_transfer_direction = EXCLUDED.parsed_transfer_direction,
                    ai_confidence = EXCLUDED.ai_confidence,
                    parsed_condition_keywords = EXCLUDED.parsed_condition_keywords,
                    parsed_transfer_location_id = EXCLUDED.parsed_transfer_location_id""",
                [
                    (
                        r["plant_id"], r["location_id"], r["submission_id"],
                        r["year"], r["week_number"], r["week_ending_date"],
                        r.get("physical_verification", True), r.get("remarks"),
                        r.get("raw_description"), r.get("raw_remarks"),
                        r.get("condition"), r.get("hours_worked", 0),
                        r.get("standby_hours", 0), r.get("breakdown_hours", 0),
                        r.get("off_hire", False), r.get("transfer_from"),
                        r.get("transfer_to"), r.get("conflict_status"),
                        r.get("parsed_condition"), r.get("parsed_transfer_direction"),
                        r.get("ai_confidence"), r.get("parsed_condition_keywords"),
                        r.get("parsed_transfer_location_id"),
                    )
                    for r in weekly_records
                ],
            )
            tracking_result["records_created"] = len(weekly_records)

        # Batch insert OUTBOUND transfers for speed
        if outbound_transfers_to_create:
            try:
                # Insert one by one to get RETURNING IDs for pending_transfer_id
                plant_to_transfer = {}
                for t in outbound_transfers_to_create:
                    row = await fetchrow(
                        """INSERT INTO plant_transfers (plant_id, from_location_id, to_location_id,
                            from_location_raw, to_location_raw, transfer_date, direction,
                            status, source_submission_id, source_remarks, parsed_confidence)
                        VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::uuid, $10, $11)
                        RETURNING id""",
                        t["plant_id"], t["from_location_id"], t["to_location_id"],
                        t.get("from_location_raw"), t.get("to_location_raw"),
                        t["transfer_date"], t["direction"], t["status"],
                        t["source_submission_id"], t.get("source_remarks"),
                        t.get("parsed_confidence"),
                    )
                    if row:
                        plant_to_transfer[t["plant_id"]] = row["id"]

                # Update plants with pending_transfer_id
                for pid, tid in plant_to_transfer.items():
                    await execute(
                        "UPDATE plants_master SET pending_transfer_id = $1::uuid WHERE id = $2::uuid",
                        tid, pid,
                    )

                tracking_result["transfers_detected"] += len(outbound_transfers_to_create)
                tracking_result["outbound_pending"] += len(outbound_transfers_to_create)
                logger.info(
                    "Batch created outbound transfers",
                    count=len(outbound_transfers_to_create),
                    fleet_numbers=[t["_fleet_number"] for t in outbound_transfers_to_create],
                )
            except Exception as e:
                logger.warning("Failed to batch insert outbound transfers", error=str(e))

        # Update current_location only for plants where this is the latest week
        if location_updates:
            await execute(
                "UPDATE plants_master SET current_location_id = $1::uuid WHERE id = ANY($2::uuid[])",
                location_id, location_updates,
            )

        # Create events
        if events_to_create:
            await executemany(
                """INSERT INTO plant_events (plant_id, event_type, event_date, year, week_number,
                    from_location_id, to_location_id, details, remarks)
                VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7::uuid, $8::jsonb, $9)""",
                [
                    (
                        e["plant_id"], e["event_type"], e["event_date"],
                        e.get("year"), e.get("week_number"),
                        e.get("from_location_id"), e.get("to_location_id"),
                        json.dumps(e.get("details", {})), e.get("remarks"),
                    )
                    for e in events_to_create
                ],
            )

        # Batch update plant_location_history for movements
        movement_events = [e for e in events_to_create if e["event_type"] == "movement"]
        if movement_events:
            try:
                # Close previous location records
                for event in movement_events:
                    await execute(
                        """UPDATE plant_location_history SET end_date = $1
                           WHERE plant_id = $2::uuid AND end_date IS NULL""",
                        week_ending_date, event["plant_id"],
                    )

                # Batch insert new location records
                location_history_params = [
                    (e["plant_id"], e["to_location_id"], week_ending_date, "Weekly report update")
                    for e in movement_events
                ]
                if location_history_params:
                    await executemany(
                        """INSERT INTO plant_location_history (plant_id, location_id, start_date, transfer_reason)
                           VALUES ($1::uuid, $2::uuid, $3, $4)""",
                        location_history_params,
                    )
                    logger.info(
                        "Updated location history for movements",
                        count=len(location_history_params),
                    )
            except Exception as e:
                logger.warning("Failed to update location history for movements", error=str(e))

        # Detect missing plants - plants at this location last week but not in current report
        try:
            # Get all plants that were at THIS location in previous week
            prev_at_location = await fetch(
                """SELECT plant_id FROM plant_weekly_records
                   WHERE location_id = $1::uuid AND year = $2 AND week_number = $3""",
                location_id, prev_year, prev_week,
            )
            prev_plant_ids = {r["plant_id"] for r in prev_at_location}

            # Current report plant IDs
            current_plant_ids = set(plant_ids)

            # Missing = was here last week, not in current report
            missing_plant_ids = prev_plant_ids - current_plant_ids

            if missing_plant_ids:
                missing_list = list(missing_plant_ids)

                # Check pending outbound transfers (single query)
                pending_rows = await fetch(
                    """SELECT plant_id FROM plant_transfers
                       WHERE plant_id = ANY($1::uuid[]) AND status = 'pending' AND direction = 'outbound'""",
                    missing_list,
                )
                plants_with_pending_transfer = {r["plant_id"] for r in pending_rows}

                # For plants truly missing (no pending transfer), mark as unknown location
                truly_missing = missing_plant_ids - plants_with_pending_transfer

                if truly_missing:
                    truly_missing_list = list(truly_missing)

                    # Batch get latest week for all truly missing plants
                    latest_weeks = await fetch(
                        """SELECT DISTINCT ON (plant_id) plant_id, year, week_number
                           FROM plant_weekly_records
                           WHERE plant_id = ANY($1::uuid[])
                           ORDER BY plant_id, year DESC, week_number DESC""",
                        truly_missing_list,
                    )
                    latest_week_by_plant = {r["plant_id"]: (r["year"], r["week_number"]) for r in latest_weeks}

                    # Batch get fleet numbers
                    fleet_info = await fetch(
                        "SELECT id, fleet_number FROM plants_master WHERE id = ANY($1::uuid[])",
                        truly_missing_list,
                    )
                    fleet_map = {r["id"]: r["fleet_number"] for r in fleet_info}

                    for missing_id in truly_missing:
                        latest = latest_week_by_plant.get(missing_id)
                        # Only mark as missing if prev week was the latest record
                        if latest and latest == (prev_year, prev_week):
                            fn = fleet_map.get(missing_id, "unknown")

                            # Set current_location to NULL and condition to missing
                            await execute(
                                "UPDATE plants_master SET current_location_id = NULL, condition = 'missing' WHERE id = $1::uuid",
                                missing_id,
                            )

                            # Close location history
                            await execute(
                                """UPDATE plant_location_history SET end_date = $1
                                   WHERE plant_id = $2::uuid AND location_id = $3::uuid AND end_date IS NULL""",
                                week_ending_date, missing_id, location_id,
                            )

                            # Create missing event
                            await execute(
                                """INSERT INTO plant_events (plant_id, event_type, event_date, year, week_number,
                                    from_location_id, details, remarks)
                                VALUES ($1::uuid, 'missing', $2, $3, $4, $5::uuid, $6::jsonb, $7)""",
                                missing_id, week_ending_date, year, week_number, location_id,
                                json.dumps({"fleet_number": fn}),
                                f"Plant {fn} not found in Week {week_number} report - location now unknown",
                            )

                            tracking_result["plants_missing"] = tracking_result.get("plants_missing", 0) + 1

                            logger.info(
                                "Plant marked as missing",
                                fleet_number=fn,
                                last_location=location_id,
                                last_week=prev_week,
                            )

        except Exception as e:
            logger.warning("Failed to detect missing plants", error=str(e))

        logger.info(
            "Plant tracking recorded",
            submission_id=submission_id,
            records=tracking_result["records_created"],
            movements=tracking_result["movements_detected"],
            new_plants=tracking_result["new_plants"],
            transfers_detected=tracking_result["transfers_detected"],
            transfers_confirmed=tracking_result["transfers_confirmed"],
            plants_missing=tracking_result.get("plants_missing", 0),
        )

    except Exception as e:
        logger.warning("Failed to record plant locations", error=str(e))

    return tracking_result


async def _create_notification(
    title: str,
    message: str,
    notification_type: str,
    data: dict[str, Any] | None = None,
) -> None:
    """Create an in-app notification for admins."""
    try:
        await execute(
            """INSERT INTO notifications (title, message, type, data, target_role, read)
               VALUES ($1, $2, $3, $4::jsonb, 'admin', false)""",
            title, message, notification_type,
            json.dumps(data) if data else None,
        )
    except Exception as e:
        logger.warning("Failed to create notification", error=str(e))


def _extract_fleet_from_sheet_name(sheet_name: str) -> str | None:
    """Extract fleet number from Excel sheet name."""
    import re

    sheet_name = sheet_name.strip()

    # Pattern: "PW 001" or "PW001" or "PW-001"
    match = re.match(r"^(PW[\s\-]?\d+)", sheet_name, re.IGNORECASE)
    if match:
        return normalize_fleet_number(match.group(1))

    # Pattern: Just fleet number at start
    match = re.match(r"^([A-Z]+[\s\-]?\d+)", sheet_name, re.IGNORECASE)
    if match:
        return normalize_fleet_number(match.group(1))

    return None


def _map_po_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Map purchase order columns to standard names."""
    column_map = {
        "date": "date",
        "replaced date": "date",
        "replacement date": "date",
        "part no": "part_number",
        "part no.": "part_number",
        "part number": "part_number",
        "part_no": "part_number",
        "description": "part_description",
        "part description": "part_description",
        "item description": "part_description",
        "supplier": "supplier",
        "vendor": "supplier",
        "reason": "reason",
        "reason for change": "reason",
        "reason_for_change": "reason",
        # Note: Excel typically provides TOTAL cost, not unit cost
        # The ETL will calculate unit_cost = cost / quantity
        "cost": "cost",
        "cost of spare parts": "cost",
        "cost of spareparts": "cost",
        "spare parts cost": "cost",
        "total cost": "total_cost",
        "total_cost": "total_cost",
        "amount": "cost",
        "price": "cost",
        "unit cost": "unit_cost",
        "unit_cost": "unit_cost",
        "qty": "quantity",
        "quantity": "quantity",
        "quantity used": "quantity",
        "qty used": "quantity",
        "po number": "po_number",
        "po no": "po_number",
        "po_number": "po_number",
        "purchase order": "po_number",
        "remarks": "remarks",
        "notes": "remarks",
    }

    rename_map = {}
    for col in df.columns:
        col_lower = str(col).lower().strip()
        if col_lower in column_map:
            rename_map[col] = column_map[col_lower]

    return df.rename(columns=rename_map)


def _clean_string(value: Any) -> str | None:
    """Clean and validate string value."""
    if pd.isna(value):
        return None
    s = str(value).strip()
    return s if s and s.lower() not in ("nan", "none", "n/a", "-") else None


def _clean_cost(value: Any) -> float | None:
    """Clean and parse cost value."""
    if pd.isna(value):
        return None

    try:
        if isinstance(value, (int, float)):
            return float(value) if value >= 0 else None

        s = str(value).strip()
        # Remove currency symbols and commas
        s = s.replace("$", "").replace(",", "").replace("₦", "").strip()
        return float(s) if s else None
    except (ValueError, TypeError):
        return None


def _clean_quantity(value: Any) -> int | None:
    """Clean and parse quantity value."""
    if pd.isna(value):
        return None

    try:
        if isinstance(value, (int, float)):
            return int(value) if value > 0 else None

        s = str(value).strip()
        return int(float(s)) if s else None
    except (ValueError, TypeError):
        return None


def _parse_date(value: Any) -> str | None:
    """Parse date value to ISO format string."""
    if pd.isna(value):
        return None

    try:
        if isinstance(value, datetime):
            return value.strftime("%Y-%m-%d")
        if isinstance(value, str):
            # Try common formats
            for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y"):
                try:
                    return datetime.strptime(value.strip(), fmt).strftime("%Y-%m-%d")
                except ValueError:
                    continue
        # pandas Timestamp
        if hasattr(value, "strftime"):
            return value.strftime("%Y-%m-%d")
    except Exception:
        pass

    return None


async def save_confirmed_weekly_report(
    submission_id: str,
    location_id: str,
    year: int,
    week_number: int,
    week_ending_date: date,
    validated_plants: list[dict[str, Any]],
    missing_plants_actions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Save admin-validated weekly report data.

    This is called after admin reviews and validates the preview.
    No AI processing - just saves the validated data.

    Args:
        submission_id: The submission ID.
        location_id: Location UUID.
        year: Year.
        week_number: Week number.
        week_ending_date: Week ending date.
        validated_plants: List of validated plant data from admin.
        missing_plants_actions: Actions for missing plants (optional).

    Returns:
        Result with counts of created/updated records.
    """
    result = {
        "success": False,
        "plants_processed": 0,
        "plants_created": 0,
        "plants_updated": 0,
        "transfers_created": 0,
        "errors": [],
    }

    try:
        # Update submission status
        await execute(
            """UPDATE weekly_report_submissions SET status = 'processing',
                processing_started_at = $2 WHERE id = $1::uuid""",
            submission_id, datetime.utcnow(),
        )

        logger.info(
            "Saving confirmed weekly report",
            submission_id=submission_id,
            location_id=location_id,
            total_plants=len(validated_plants),
        )

        # Only fetch plants that are in this upload (+ missing plants)
        upload_fleet_numbers = [p["fleet_number"] for p in validated_plants]
        if missing_plants_actions:
            upload_fleet_numbers.extend(a["fleet_number"] for a in missing_plants_actions)
        # Deduplicate
        upload_fleet_numbers = list(set(upload_fleet_numbers))

        relevant_plants = await fetch(
            """SELECT id, fleet_number, last_verified_year, last_verified_week,
                      condition, current_location_id
               FROM plants_master
               WHERE fleet_number = ANY($1::text[])""",
            upload_fleet_numbers,
        )

        fleet_to_id = {p["fleet_number"]: p["id"] for p in relevant_plants}
        fleet_to_verification = {
            p["fleet_number"]: (p.get("last_verified_year") or 0, p.get("last_verified_week") or 0)
            for p in relevant_plants
        }
        fleet_to_condition = {p["fleet_number"]: p.get("condition") for p in relevant_plants}
        fleet_to_location = {p["fleet_number"]: p.get("current_location_id") for p in relevant_plants}

        # Prepare plants for upsert
        plants_to_upsert = []
        new_fleet_numbers: set[str] = set()
        weekly_records = []
        transfers_to_create = []
        inbound_transfers = []  # Collected for batch pending-transfer lookup

        for plant_data in validated_plants:
            fleet_num = plant_data["fleet_number"]
            condition = plant_data["condition"]

            # Prepare plant master data
            plant_upsert = {
                "fleet_number": fleet_num,
                "description": plant_data.get("description"),
                "remarks": plant_data.get("remarks"),
                "condition": condition,
                "physical_verification": plant_data.get("physical_verification", True),
                "updated_at": datetime.utcnow(),
            }

            # Prevent backwards overwrites: only update location/verification
            # if this upload is newer than or equal to what's already stored
            existing_verification = fleet_to_verification.get(fleet_num, (0, 0))
            is_newer_or_same = (year, week_number) >= existing_verification

            if is_newer_or_same:
                plant_upsert["current_location_id"] = location_id
                plant_upsert["last_verified_date"] = week_ending_date
                plant_upsert["last_verified_year"] = year
                plant_upsert["last_verified_week"] = week_number
            else:
                logger.info(
                    "Skipping location overwrite for older upload",
                    fleet_number=fleet_num,
                    upload_week=f"{year}-W{week_number}",
                    existing_week=f"{existing_verification[0]}-W{existing_verification[1]}",
                )

            # If new plant, set creation time and location
            is_new = fleet_num not in fleet_to_id
            if is_new:
                plant_upsert["created_at"] = datetime.utcnow()
                plant_upsert["current_location_id"] = location_id
                plant_upsert["last_verified_date"] = week_ending_date
                plant_upsert["last_verified_year"] = year
                plant_upsert["last_verified_week"] = week_number
                new_fleet_numbers.add(fleet_num)

            plants_to_upsert.append(plant_upsert)

        # Batch resolve fleet types for new plants (1 query instead of N)
        if new_fleet_numbers:
            fleet_type_rows = await fetch(
                "SELECT fn, resolve_fleet_type(fn) as ft FROM unnest($1::text[]) AS fn",
                list(new_fleet_numbers),
            )
            fleet_type_map = {r["fn"]: r["ft"] for r in fleet_type_rows}
            for p in plants_to_upsert:
                if p["fleet_number"] in new_fleet_numbers:
                    p["fleet_type"] = fleet_type_map.get(p["fleet_number"])

        # Batch upsert all plants (1 executemany call instead of N fetchrow calls)
        if plants_to_upsert:
            await executemany(
                """INSERT INTO plants_master (fleet_number, description, remarks, condition,
                    physical_verification, updated_at, current_location_id,
                    last_verified_date, last_verified_year, last_verified_week,
                    fleet_type, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8, $9, $10, $11, $12)
                ON CONFLICT (fleet_number) DO UPDATE SET
                    description = COALESCE(EXCLUDED.description, plants_master.description),
                    remarks = EXCLUDED.remarks, condition = EXCLUDED.condition,
                    physical_verification = EXCLUDED.physical_verification,
                    updated_at = EXCLUDED.updated_at,
                    current_location_id = COALESCE(EXCLUDED.current_location_id, plants_master.current_location_id),
                    last_verified_date = COALESCE(EXCLUDED.last_verified_date, plants_master.last_verified_date),
                    last_verified_year = COALESCE(EXCLUDED.last_verified_year, plants_master.last_verified_year),
                    last_verified_week = COALESCE(EXCLUDED.last_verified_week, plants_master.last_verified_week),
                    fleet_type = COALESCE(EXCLUDED.fleet_type, plants_master.fleet_type)""",
                [
                    (
                        p["fleet_number"], p.get("description"),
                        p.get("remarks"), p.get("condition"),
                        p.get("physical_verification"), p.get("updated_at"),
                        p.get("current_location_id"), p.get("last_verified_date"),
                        p.get("last_verified_year"), p.get("last_verified_week"),
                        p.get("fleet_type"),
                        p.get("created_at", datetime.utcnow()),
                    )
                    for p in plants_to_upsert
                ],
            )

            # Fetch IDs for all upserted plants (1 query)
            upserted_fleet_numbers = [p["fleet_number"] for p in plants_to_upsert]
            id_rows = await fetch(
                "SELECT id, fleet_number FROM plants_master WHERE fleet_number = ANY($1::text[])",
                upserted_fleet_numbers,
            )
            for r in id_rows:
                if r["fleet_number"] not in fleet_to_id:
                    result["plants_created"] += 1
                else:
                    result["plants_updated"] += 1
                fleet_to_id[r["fleet_number"]] = r["id"]

        result["plants_processed"] = len(plants_to_upsert)

        # Batch resolve inbound transfers — single query instead of N fetchrow calls
        if inbound_transfers:
            # Get all pending transfers that match any inbound plant+from_location pair
            inbound_plant_ids = [t["plant_id"] for t in inbound_transfers]
            pending_rows = await fetch(
                """SELECT id, plant_id, from_location_id, to_location_id
                   FROM plant_transfers
                   WHERE plant_id = ANY($1::uuid[]) AND to_location_id = $2::uuid
                     AND status = 'pending'""",
                inbound_plant_ids, location_id,
            )
            # Index by (plant_id, from_location_id) for fast lookup
            pending_map: dict[tuple[str, str], str] = {}
            for r in pending_rows:
                key = (str(r["plant_id"]), str(r["from_location_id"]))
                pending_map[key] = str(r["id"])

            confirm_ids = []
            for t in inbound_transfers:
                key = (str(t["plant_id"]), str(t["from_location_id"]))
                pending_id = pending_map.get(key)
                if pending_id:
                    confirm_ids.append(pending_id)
                else:
                    transfers_to_create.append({
                        "plant_id": t["plant_id"],
                        "from_location_id": t["from_location_id"],
                        "to_location_id": location_id,
                        "transfer_date": week_ending_date,
                        "actual_arrival_date": week_ending_date,
                        "status": "confirmed",
                        "direction": "inbound",
                        "source_submission_id": submission_id,
                        "created_at": datetime.utcnow(),
                    })

            # Batch confirm pending transfers
            if confirm_ids:
                await execute(
                    """UPDATE plant_transfers
                       SET status = 'confirmed', actual_arrival_date = $2, updated_at = $3
                       WHERE id = ANY($1::uuid[])""",
                    confirm_ids, week_ending_date, datetime.utcnow(),
                )

        # Create weekly records
        for plant_data in validated_plants:
            fleet_num = plant_data["fleet_number"]
            plant_id = fleet_to_id.get(fleet_num)

            if not plant_id:
                logger.warning("Plant not found after upsert", fleet_number=fleet_num)
                continue

            weekly_record = {
                "submission_id": submission_id,
                "plant_id": plant_id,
                "location_id": location_id,
                "year": year,
                "week_number": week_number,
                "week_ending_date": week_ending_date,
                "condition": plant_data["condition"],
                "hours_worked": plant_data.get("hours_worked", 0),
                "standby_hours": plant_data.get("standby_hours", 0),
                "breakdown_hours": plant_data.get("breakdown_hours", 0),
                "off_hire": plant_data.get("off_hire", False),
                "physical_verification": plant_data.get("physical_verification", True),
                "remarks": plant_data.get("remarks"),
                "raw_remarks": plant_data.get("remarks"),  # Same for now
            }

            weekly_records.append(weekly_record)

            # Collect transfers for batch processing
            transfer_to_id = plant_data.get("transfer_to_location_id")
            transfer_from_id = plant_data.get("transfer_from_location_id")

            # OUTBOUND transfer (plant being sent TO another location)
            if transfer_to_id:
                transfers_to_create.append({
                    "plant_id": plant_id,
                    "from_location_id": location_id,
                    "to_location_id": transfer_to_id,
                    "transfer_date": week_ending_date,
                    "status": "pending",
                    "direction": "outbound",
                    "source_submission_id": submission_id,
                    "created_at": datetime.utcnow(),
                })

            # INBOUND transfer — collect for batch lookup below
            if transfer_from_id:
                inbound_transfers.append({
                    "plant_id": plant_id,
                    "from_location_id": transfer_from_id,
                })

        # Batch upsert weekly records
        if weekly_records:
            await executemany(
                """INSERT INTO plant_weekly_records (
                    submission_id, plant_id, location_id, year, week_number,
                    week_ending_date, condition, hours_worked, standby_hours,
                    breakdown_hours, off_hire, physical_verification, remarks, raw_remarks)
                VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                ON CONFLICT (plant_id, year, week_number) DO UPDATE SET
                    submission_id = EXCLUDED.submission_id, location_id = EXCLUDED.location_id,
                    week_ending_date = EXCLUDED.week_ending_date, condition = EXCLUDED.condition,
                    hours_worked = EXCLUDED.hours_worked, standby_hours = EXCLUDED.standby_hours,
                    breakdown_hours = EXCLUDED.breakdown_hours, off_hire = EXCLUDED.off_hire,
                    physical_verification = EXCLUDED.physical_verification,
                    remarks = EXCLUDED.remarks, raw_remarks = EXCLUDED.raw_remarks""",
                [
                    (
                        r["submission_id"], r["plant_id"], r["location_id"],
                        r["year"], r["week_number"], r["week_ending_date"],
                        r.get("condition"), r.get("hours_worked", 0),
                        r.get("standby_hours", 0), r.get("breakdown_hours", 0),
                        r.get("off_hire", False), r.get("physical_verification", True),
                        r.get("remarks"), r.get("raw_remarks"),
                    )
                    for r in weekly_records
                ],
            )

        # Batch insert transfers
        if transfers_to_create:
            await executemany(
                """INSERT INTO plant_transfers (plant_id, from_location_id, to_location_id,
                    transfer_date, status, direction, source_submission_id,
                    created_at, actual_arrival_date)
                VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid, $8, $9)""",
                [
                    (
                        t["plant_id"], t.get("from_location_id"), t.get("to_location_id"),
                        t.get("transfer_date"), t["status"], t.get("direction"),
                        t.get("source_submission_id"), t.get("created_at"),
                        t.get("actual_arrival_date"),
                    )
                    for t in transfers_to_create
                ],
            )
            result["transfers_created"] = len(transfers_to_create)

        # Handle missing plants actions
        if missing_plants_actions:
            for action_data in missing_plants_actions:
                fleet_num = action_data["fleet_number"]
                action = action_data["action"]  # "transferred", "scrap", "unknown", "missing"
                plant_id = fleet_to_id.get(fleet_num)

                if not plant_id:
                    continue

                if action == "transferred" and action_data.get("transfer_to_location_id"):
                    dest_location_id = action_data["transfer_to_location_id"]

                    # Create outbound transfer for missing plant
                    await execute(
                        """INSERT INTO plant_transfers (plant_id, from_location_id, to_location_id,
                            transfer_date, status, direction, source_submission_id, created_at)
                        VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'pending', 'outbound', $5::uuid, $6)""",
                        plant_id, location_id, dest_location_id, week_ending_date,
                        submission_id, datetime.utcnow(),
                    )
                    result["transfers_created"] = result.get("transfers_created", 0) + 1

                    # Update plant location to destination
                    await execute(
                        """UPDATE plants_master SET current_location_id = $1::uuid,
                            condition = 'working', updated_at = $2 WHERE id = $3::uuid""",
                        dest_location_id, datetime.utcnow(), plant_id,
                    )

                elif action == "scrap":
                    await execute(
                        "UPDATE plants_master SET condition = 'scrap', updated_at = $1 WHERE id = $2::uuid",
                        datetime.utcnow(), plant_id,
                    )

                elif action == "missing":
                    await execute(
                        "UPDATE plants_master SET condition = 'missing', updated_at = $1 WHERE id = $2::uuid",
                        datetime.utcnow(), plant_id,
                    )

        # ============================================================
        # Create plant_events and notifications
        # ============================================================
        events_to_create = []
        notification_summaries = {
            "new_plants": [],
            "returned_plants": [],
            "transfers_out": [],
            "transfers_in": [],
            "missing_plants": [],
            "scrapped_plants": [],
        }

        # Get location name for notifications
        loc_row = await fetchrow("SELECT name FROM locations WHERE id = $1::uuid", location_id)
        location_name = loc_row["name"] if loc_row else "Unknown"

        for plant_data in validated_plants:
            fleet_num = plant_data["fleet_number"]
            plant_id = fleet_to_id.get(fleet_num)
            if not plant_id:
                continue

            prev_condition = fleet_to_condition.get(fleet_num)
            prev_location = fleet_to_location.get(fleet_num)
            is_brand_new = fleet_num not in fleet_to_condition  # Not in DB before this upload

            # Event: New plant (first time in system)
            if is_brand_new:
                events_to_create.append({
                    "plant_id": plant_id,
                    "event_type": "new",
                    "event_date": week_ending_date,
                    "year": year,
                    "week_number": week_number,
                    "to_location_id": location_id,
                    "submission_id": submission_id,
                    "details": {"fleet_number": fleet_num},
                    "remarks": f"Plant {fleet_num} first recorded at {location_name}",
                })
                notification_summaries["new_plants"].append(fleet_num)

            # Event: Returned (was missing, now found)
            elif prev_condition == "missing":
                events_to_create.append({
                    "plant_id": plant_id,
                    "event_type": "returned",
                    "event_date": week_ending_date,
                    "year": year,
                    "week_number": week_number,
                    "to_location_id": location_id,
                    "from_location_id": prev_location,
                    "submission_id": submission_id,
                    "details": {"fleet_number": fleet_num},
                    "remarks": f"Plant {fleet_num} found at {location_name} (was missing)",
                })
                notification_summaries["returned_plants"].append(fleet_num)

            # Event: Movement (location changed from a different known location)
            elif prev_location and prev_location != location_id and not is_brand_new:
                events_to_create.append({
                    "plant_id": plant_id,
                    "event_type": "movement",
                    "event_date": week_ending_date,
                    "year": year,
                    "week_number": week_number,
                    "from_location_id": prev_location,
                    "to_location_id": location_id,
                    "submission_id": submission_id,
                    "details": {"fleet_number": fleet_num},
                    "remarks": f"Plant {fleet_num} moved to {location_name}",
                })

            # Event: Outbound transfer
            transfer_to_id = plant_data.get("transfer_to_location_id")
            if transfer_to_id:
                events_to_create.append({
                    "plant_id": plant_id,
                    "event_type": "movement",
                    "event_date": week_ending_date,
                    "year": year,
                    "week_number": week_number,
                    "from_location_id": location_id,
                    "to_location_id": transfer_to_id,
                    "submission_id": submission_id,
                    "details": {"fleet_number": fleet_num, "direction": "outbound"},
                    "remarks": f"Plant {fleet_num} transferred out from {location_name}",
                })
                notification_summaries["transfers_out"].append(fleet_num)

            # Event: Inbound transfer
            transfer_from_id = plant_data.get("transfer_from_location_id")
            if transfer_from_id:
                events_to_create.append({
                    "plant_id": plant_id,
                    "event_type": "movement",
                    "event_date": week_ending_date,
                    "year": year,
                    "week_number": week_number,
                    "from_location_id": transfer_from_id,
                    "to_location_id": location_id,
                    "submission_id": submission_id,
                    "details": {"fleet_number": fleet_num, "direction": "inbound"},
                    "remarks": f"Plant {fleet_num} received at {location_name}",
                })
                notification_summaries["transfers_in"].append(fleet_num)

        # Events for missing plant actions
        if missing_plants_actions:
            for action_data in missing_plants_actions:
                fleet_num = action_data["fleet_number"]
                action = action_data["action"]
                plant_id = fleet_to_id.get(fleet_num)
                if not plant_id:
                    continue

                if action == "transferred":
                    dest_id = action_data.get("transfer_to_location_id")
                    dest_name = ""
                    if dest_id:
                        d = await fetchrow("SELECT name FROM locations WHERE id = $1::uuid", dest_id)
                        dest_name = d["name"] if d else "Unknown"
                    events_to_create.append({
                        "plant_id": plant_id,
                        "event_type": "movement",
                        "event_date": week_ending_date,
                        "year": year,
                        "week_number": week_number,
                        "from_location_id": location_id,
                        "to_location_id": dest_id,
                        "submission_id": submission_id,
                        "details": {"fleet_number": fleet_num, "action": "missing_transferred"},
                        "remarks": f"Plant {fleet_num} transferred to {dest_name} (missing from report)",
                    })
                    notification_summaries["transfers_out"].append(fleet_num)

                elif action == "missing":
                    events_to_create.append({
                        "plant_id": plant_id,
                        "event_type": "missing",
                        "event_date": week_ending_date,
                        "year": year,
                        "week_number": week_number,
                        "from_location_id": location_id,
                        "submission_id": submission_id,
                        "details": {"fleet_number": fleet_num},
                        "remarks": f"Plant {fleet_num} marked as missing from {location_name}",
                    })
                    notification_summaries["missing_plants"].append(fleet_num)

                elif action == "scrap":
                    events_to_create.append({
                        "plant_id": plant_id,
                        "event_type": "missing",
                        "event_date": week_ending_date,
                        "year": year,
                        "week_number": week_number,
                        "from_location_id": location_id,
                        "submission_id": submission_id,
                        "details": {"fleet_number": fleet_num, "action": "scrapped"},
                        "remarks": f"Plant {fleet_num} scrapped at {location_name}",
                    })
                    notification_summaries["scrapped_plants"].append(fleet_num)

        # Batch insert events
        if events_to_create:
            try:
                await executemany(
                    """INSERT INTO plant_events (plant_id, event_type, event_date, year, week_number,
                        from_location_id, to_location_id, details, remarks, submission_id)
                    VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7::uuid, $8::jsonb, $9, $10::uuid)""",
                    [
                        (
                            e["plant_id"], e["event_type"], e["event_date"],
                            e.get("year"), e.get("week_number"),
                            e.get("from_location_id"), e.get("to_location_id"),
                            json.dumps(e.get("details", {})), e.get("remarks"),
                            e.get("submission_id"),
                        )
                        for e in events_to_create
                    ],
                )
                result["events_created"] = len(events_to_create)
            except Exception as e:
                logger.warning("Failed to create plant events", error=repr(e))

        # Create notifications for significant events
        try:
            parts = []
            if notification_summaries["new_plants"]:
                n = len(notification_summaries["new_plants"])
                parts.append(f"{n} new plant{'s' if n > 1 else ''}")
            if notification_summaries["returned_plants"]:
                n = len(notification_summaries["returned_plants"])
                parts.append(f"{n} returned (was missing)")
            if notification_summaries["transfers_out"]:
                n = len(notification_summaries["transfers_out"])
                parts.append(f"{n} transferred out")
            if notification_summaries["transfers_in"]:
                n = len(notification_summaries["transfers_in"])
                parts.append(f"{n} transferred in")
            if notification_summaries["missing_plants"]:
                n = len(notification_summaries["missing_plants"])
                parts.append(f"{n} missing")
            if notification_summaries["scrapped_plants"]:
                n = len(notification_summaries["scrapped_plants"])
                parts.append(f"{n} scrapped")

            if parts:
                await _create_notification(
                    title=f"Weekly Report: {location_name} W{week_number}",
                    message=f"{location_name} Week {week_number}: {', '.join(parts)}",
                    notification_type="weekly_report",
                    data={
                        "location_id": location_id,
                        "location_name": location_name,
                        "year": year,
                        "week_number": week_number,
                        "submission_id": submission_id,
                        **{k: v for k, v in notification_summaries.items() if v},
                    },
                )
        except Exception as e:
            logger.warning("Failed to create notification", error=repr(e))

        # Update submission status
        await execute(
            """UPDATE weekly_report_submissions SET
                status = 'completed', processing_completed_at = $2,
                plants_processed = $3, plants_created = $4, plants_updated = $5
            WHERE id = $1::uuid""",
            submission_id, datetime.utcnow(),
            result["plants_processed"], result["plants_created"], result["plants_updated"],
        )

        result["success"] = True
        broadcast("plants", "import", f"{result['plants_processed']} plants saved")
        broadcast("uploads", "complete")
        logger.info(
            "Confirmed weekly report saved",
            submission_id=submission_id,
            **result,
        )

    except Exception as e:
        error_msg = repr(e) if not str(e) else str(e)
        tb = traceback.format_exc()
        logger.error(
            "Error saving confirmed weekly report",
            submission_id=submission_id,
            error=error_msg,
            traceback=tb,
        )
        result["errors"].append(error_msg)

        # Update submission status to failed
        try:
            await execute(
                "UPDATE weekly_report_submissions SET status = 'failed', errors = $2::jsonb WHERE id = $1::uuid",
                submission_id, json.dumps([error_msg]),
            )
        except Exception:
            pass

    return result


async def process_direct_submission(
    draft_id: str,
    submission_id: str,
    location_id: str,
    week_ending_date: date,
    year: int,
    week_number: int,
    submitted_by: str,
) -> dict[str, Any]:
    """Process a site engineer's direct form submission into the DB.

    Bypasses Excel parsing — data is already clean and structured.
    Mirrors the logic of save_confirmed_weekly_report but reads from
    weekly_report_draft_rows instead of an admin-validated payload.

    Steps:
    1. Load all draft rows for this draft
    2. For is_new_plant rows: INSERT into plants_master
    3. UPDATE plants_master condition + physical_verification
    4. INSERT/UPSERT into plant_weekly_records (ON CONFLICT plant_id, year, week_number)
    5. For rows with transfer_to_location_id: create plant_transfers (pending)
    6. Update plant_location_history (set current location)
    7. Mark submission completed, mark draft submitted
    """
    result: dict[str, Any] = {
        "success": False,
        "plants_processed": 0,
        "plants_created": 0,
        "plants_updated": 0,
        "transfers_pending": 0,
        "errors": [],
    }

    try:
        await execute(
            "UPDATE weekly_report_submissions SET status = 'processing', processing_started_at = $2 WHERE id = $1::uuid",
            submission_id, datetime.utcnow(),
        )

        # Load draft rows
        rows = await fetch(
            """SELECT r.*, pm.id AS resolved_plant_id
               FROM weekly_report_draft_rows r
               LEFT JOIN plants_master pm ON pm.id = r.plant_id
               WHERE r.draft_id = $1::uuid
               ORDER BY r.fleet_number""",
            draft_id,
        )

        plants_processed = 0
        plants_created = 0
        plants_updated = 0
        transfers_pending = 0
        errors: list[dict] = []

        for row in rows:
            fleet_number = row["fleet_number"]
            try:
                plant_id: str | None = None

                if row["is_new_plant"]:
                    # Create new plant in plants_master
                    existing = await fetchrow(
                        "SELECT id FROM plants_master WHERE fleet_number = $1", fleet_number
                    )
                    if existing:
                        plant_id = str(existing["id"])
                    else:
                        new_plant = await fetchrow(
                            """INSERT INTO plants_master
                                   (fleet_number, description, current_location_id, condition,
                                    physical_verification, last_verified_date, last_verified_year, last_verified_week)
                               VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8)
                               RETURNING id""",
                            fleet_number,
                            row.get("fleet_number"),  # description fallback to fleet_number
                            location_id,
                            row["condition"] or "unverified",
                            row["physical_verification"] or False,
                            week_ending_date if row["physical_verification"] else None,
                            year if row["physical_verification"] else None,
                            week_number if row["physical_verification"] else None,
                        )
                        plant_id = str(new_plant["id"])
                        plants_created += 1
                else:
                    plant_id = str(row["plant_id"]) if row["plant_id"] else None
                    if not plant_id:
                        # Try to resolve by fleet number
                        found = await fetchrow(
                            "SELECT id FROM plants_master WHERE fleet_number = $1", fleet_number
                        )
                        if found:
                            plant_id = str(found["id"])

                if not plant_id:
                    errors.append({"fleet_number": fleet_number, "error": "Plant not found"})
                    continue

                # Update plants_master condition + location + verification
                update_fields: list[str] = ["updated_at = now()"]
                update_params: list[Any] = []

                if row.get("condition"):
                    update_params.append(row["condition"])
                    update_fields.append(f"condition = ${len(update_params)}")

                if row.get("physical_verification") is not None:
                    update_params.append(row["physical_verification"])
                    update_fields.append(f"physical_verification = ${len(update_params)}")
                    if row["physical_verification"]:
                        update_params.extend([week_ending_date, year, week_number])
                        update_fields.append(f"last_verified_date = ${len(update_params) - 2}")
                        update_fields.append(f"last_verified_year = ${len(update_params) - 1}")
                        update_fields.append(f"last_verified_week = ${len(update_params)}")

                # Always update current location
                update_params.append(location_id)
                update_fields.append(f"current_location_id = ${len(update_params)}::uuid")
                update_params.append(plant_id)

                await execute(
                    f"UPDATE plants_master SET {', '.join(update_fields)} WHERE id = ${len(update_params)}::uuid",
                    *update_params,
                )
                plants_updated += 1

                # Upsert plant_weekly_record
                transfer_to_name: str | None = None
                if row.get("transfer_to_location_id"):
                    transfer_to_name = await fetchval(
                        "SELECT name FROM locations WHERE id = $1::uuid",
                        str(row["transfer_to_location_id"]),
                    )

                await execute(
                    """INSERT INTO plant_weekly_records
                           (plant_id, location_id, submission_id, year, week_number, week_ending_date,
                            physical_verification, condition, hours_worked, standby_hours,
                            breakdown_hours, off_hire, transfer_to, remarks)
                       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                       ON CONFLICT (plant_id, year, week_number)
                       DO UPDATE SET
                           location_id           = EXCLUDED.location_id,
                           submission_id         = EXCLUDED.submission_id,
                           physical_verification = EXCLUDED.physical_verification,
                           condition             = EXCLUDED.condition,
                           hours_worked          = EXCLUDED.hours_worked,
                           standby_hours         = EXCLUDED.standby_hours,
                           breakdown_hours       = EXCLUDED.breakdown_hours,
                           off_hire              = EXCLUDED.off_hire,
                           transfer_to           = EXCLUDED.transfer_to,
                           remarks               = EXCLUDED.remarks""",
                    plant_id, location_id, submission_id, year, week_number, week_ending_date,
                    row.get("physical_verification"), row.get("condition"),
                    row.get("hours_worked"), row.get("standby_hours"),
                    row.get("breakdown_hours"), row.get("off_hire") or False,
                    transfer_to_name, row.get("remarks"),
                )

                # Update location history (ensure open record for current location)
                existing_history = await fetchrow(
                    """SELECT id FROM plant_location_history
                       WHERE plant_id = $1::uuid AND end_date IS NULL""",
                    plant_id,
                )
                if existing_history is None:
                    await execute(
                        """INSERT INTO plant_location_history (plant_id, location_id, start_date)
                           VALUES ($1::uuid, $2::uuid, $3)
                           ON CONFLICT DO NOTHING""",
                        plant_id, location_id, week_ending_date,
                    )
                elif await fetchval(
                    "SELECT location_id FROM plant_location_history WHERE plant_id = $1::uuid AND end_date IS NULL",
                    plant_id,
                ) != location_id:
                    # Plant is at a different location — close old, open new
                    await execute(
                        "UPDATE plant_location_history SET end_date = $1 WHERE plant_id = $2::uuid AND end_date IS NULL",
                        week_ending_date, plant_id,
                    )
                    await execute(
                        "INSERT INTO plant_location_history (plant_id, location_id, start_date) VALUES ($1::uuid, $2::uuid, $3)",
                        plant_id, location_id, week_ending_date,
                    )

                # Create pending transfer if engineer marked this plant as transferring out
                if row.get("transfer_to_location_id"):
                    to_loc_id = str(row["transfer_to_location_id"])
                    existing_transfer = await fetchrow(
                        """SELECT id FROM plant_transfers
                           WHERE plant_id = $1::uuid AND to_location_id = $2::uuid
                             AND status = 'pending'""",
                        plant_id, to_loc_id,
                    )
                    if not existing_transfer:
                        await execute(
                            """INSERT INTO plant_transfers
                                   (plant_id, from_location_id, to_location_id,
                                    direction, status, transfer_date,
                                    source_submission_id, parsed_confidence)
                               VALUES ($1::uuid, $2::uuid, $3::uuid,
                                       'outbound', 'pending', $4,
                                       $5::uuid, 1.0)""",
                            plant_id, location_id, to_loc_id,
                            week_ending_date, submission_id,
                        )
                        transfers_pending += 1

                plants_processed += 1

            except Exception as row_err:
                logger.error(
                    "Error processing draft row",
                    fleet_number=fleet_number, error=str(row_err),
                )
                errors.append({"fleet_number": fleet_number, "error": str(row_err)})

        # Mark submission completed
        await execute(
            """UPDATE weekly_report_submissions SET
                   status = 'completed',
                   plants_processed = $2,
                   plants_created = $3,
                   plants_updated = $4,
                   processing_completed_at = $5,
                   errors = $6::jsonb
               WHERE id = $1::uuid""",
            submission_id,
            plants_processed,
            plants_created,
            plants_updated,
            datetime.utcnow(),
            json.dumps(errors) if errors else None,
        )

        # Mark draft as submitted
        await execute(
            """UPDATE weekly_report_drafts
               SET status = 'submitted', submitted_at = now(), submission_id = $1::uuid
               WHERE id = $2::uuid""",
            submission_id, draft_id,
        )

        result.update({
            "success": True,
            "plants_processed": plants_processed,
            "plants_created": plants_created,
            "plants_updated": plants_updated,
            "transfers_pending": transfers_pending,
            "errors": errors,
        })

        broadcast("plants", "import", f"{plants_processed} plants processed")
        broadcast("uploads", "complete")

        logger.info(
            "Direct submission processed",
            submission_id=submission_id,
            plants_processed=plants_processed,
            plants_created=plants_created,
            transfers_pending=transfers_pending,
        )

    except Exception as e:
        logger.error("process_direct_submission failed", submission_id=submission_id, error=str(e))
        await execute(
            "UPDATE weekly_report_submissions SET status = 'failed', errors = $2::jsonb WHERE id = $1::uuid",
            submission_id, json.dumps([{"error": str(e)}]),
        )
        raise

    return result
