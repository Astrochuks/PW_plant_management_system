"""ETL background workers for processing uploaded files.

Handles async processing of:
- Weekly report Excel files
- Purchase order Excel files

Uses AI-powered remarks parsing for:
- Plant status derivation
- Transfer detection
- Condition assessment
"""

import io
from datetime import datetime
from typing import Any

import pandas as pd

from app.config import get_settings
from app.core.database import get_supabase_admin_client
from app.monitoring.logging import get_logger
from app.services.remarks_parser import (
    parse_remarks_batch,
    derive_status_and_condition,
    ParsedRemarks,
)
from app.services.transfer_service import get_transfer_service

logger = get_logger(__name__)


# Column mappings for weekly reports
WEEKLY_COLUMN_MAP = {
    # Serial number
    "s/n": "serial_number",
    "s/no": "serial_number",
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
    "transf. to": "transfer_to",
    "transf to": "transfer_to",
    "transfer to": "transfer_to",
    "transferred to": "transfer_to",
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
        col_no_newline = col_normalized.replace("\n", " ").replace("  ", " ")

        if col_normalized in column_map:
            rename_map[col] = column_map[col_normalized]
        elif col_no_newline in column_map:
            rename_map[col] = column_map[col_no_newline]

    return df.rename(columns=rename_map)


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
) -> dict[str, Any]:
    """Process a weekly report Excel file.

    Args:
        job_id: The submission job ID.
        storage_path: Path to file in Supabase storage.
        location_id: Location UUID.

    Returns:
        Processing result with stats.
    """
    settings = get_settings()
    client = get_supabase_admin_client()

    result = {
        "success": False,
        "plants_processed": 0,
        "plants_created": 0,
        "plants_updated": 0,
        "errors": [],
        "warnings": [],
    }

    try:
        # Update status to processing
        client.table("weekly_report_submissions").update({
            "status": "processing",
            "processing_started_at": datetime.utcnow().isoformat(),
        }).eq("id", job_id).execute()

        logger.info("Starting weekly report processing", job_id=job_id, storage_path=storage_path)

        # Get submission data for week info
        submission = client.table("weekly_report_submissions").select(
            "year, week_number, week_ending_date"
        ).eq("id", job_id).single().execute()

        if not submission.data:
            raise ValueError("Submission not found")

        submission_year = submission.data["year"]
        submission_week = submission.data["week_number"]
        submission_week_ending = submission.data["week_ending_date"]

        # Download file from storage
        file_data = client.storage.from_("reports").download(storage_path)

        # Parse Excel file
        df_raw = pd.read_excel(io.BytesIO(file_data), sheet_name=0, header=None)
        extracted_location, week_ending = extract_metadata(df_raw)

        # Read with header row (typically row 4)
        df = pd.read_excel(io.BytesIO(file_data), sheet_name=0, header=3)
        df = map_columns(df, WEEKLY_COLUMN_MAP)

        if "fleet_number" not in df.columns:
            result["errors"].append("No fleet_number column found in file")
            raise ValueError("Invalid file format: no fleet_number column")

        # Get ALL existing plants using pagination (Supabase limits to 1000 per request)
        all_plants = []
        page_size = 1000
        offset = 0
        while True:
            page = (
                client.table("plants_master")
                .select("id, fleet_number")
                .range(offset, offset + page_size - 1)
                .execute()
            )
            all_plants.extend(page.data)
            if len(page.data) < page_size:
                break
            offset += page_size

        fleet_to_id = {p["fleet_number"]: p["id"] for p in all_plants}
        logger.info("Loaded existing plants for lookup", count=len(fleet_to_id))

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

            # Collect data for AI parsing
            plants_for_parsing.append({
                "fleet_number": fleet_num,
                "remarks": remarks,
                "hours_worked": hours_worked,
                "standby_hours": standby_hours,
                "breakdown_hours": breakdown_hours,
                "off_hire": off_hire,
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
                "updated_at": datetime.utcnow().isoformat(),
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
                plant_data["status"] = "working"
                plants_to_insert.append(plant_data)

        # AI batch parsing of remarks
        logger.info("Starting AI remarks parsing", count=len(plants_for_parsing), job_id=job_id)
        parsed_remarks = await parse_remarks_batch(plants_for_parsing)
        logger.info("AI parsing complete", parsed_count=len(parsed_remarks), job_id=job_id)

        # Apply parsed status and condition to plants
        for plant in plants_to_insert + plants_to_update:
            fn = plant["fleet_number"]
            parsed = parsed_remarks.get(fn)
            if parsed:
                usage = plant.get("_usage", {})
                # Derive final status and condition from AI parsing + hours data
                status, condition = derive_status_and_condition(
                    parsed=parsed,
                    hours_worked=usage.get("hours_worked", 0),
                    standby_hours=usage.get("standby_hours", 0),
                    breakdown_hours=usage.get("breakdown_hours", 0),
                    off_hire=usage.get("off_hire", False),
                    physical_verification=plant.get("physical_verification"),
                )
                plant["status"] = status
                plant["condition"] = condition
                plant["status_confidence"] = parsed.confidence
                # Store parsed data for weekly record
                plant["_parsed"] = parsed

        # Batch insert new plants (exclude _usage field)
        if plants_to_insert:
            try:
                # Batch resolve fleet types for all new plants (single query)
                fleet_prefixes = (
                    client.table("fleet_number_prefixes")
                    .select("prefix, fleet_type")
                    .execute()
                )
                prefix_to_type = {p["prefix"]: p["fleet_type"] for p in fleet_prefixes.data}

                # Apply fleet types based on prefix
                import re
                for plant in plants_to_insert:
                    fn = plant.get("fleet_number", "")
                    match = re.match(r'^([A-Z]+)', fn.replace(" ", ""))
                    if match:
                        prefix = match.group(1)
                        if prefix in prefix_to_type:
                            plant["fleet_type"] = prefix_to_type[prefix]

                insert_data = [
                    {k: v for k, v in p.items() if not k.startswith("_")}
                    for p in plants_to_insert
                ]
                insert_result = client.table("plants_master").insert(insert_data).execute()
                result["plants_created"] = len(insert_result.data)
                # Update plants_to_insert with generated IDs for tracking
                for i, p in enumerate(plants_to_insert):
                    p["id"] = insert_result.data[i]["id"]

                # Record initial location history for new plants
                location_history_records = [
                    {
                        "plant_id": p["id"],
                        "location_id": location_id,
                        "start_date": datetime.utcnow().isoformat(),
                        "transfer_reason": "First seen in weekly report",
                    }
                    for p in plants_to_insert if p.get("id")
                ]
                if location_history_records:
                    client.table("plant_location_history").insert(location_history_records).execute()

                logger.info("Inserted new plants", count=result["plants_created"], job_id=job_id)
            except Exception as e:
                result["errors"].append(f"Failed to insert plants: {str(e)}")
                logger.error("Failed to insert plants", error=str(e), job_id=job_id)

        # Batch update existing plants using upsert (single DB request instead of 1 per plant)
        if plants_to_update:
            try:
                update_data = [
                    {k: v for k, v in p.items() if not k.startswith("_")}
                    for p in plants_to_update
                ]
                client.table("plants_master").upsert(
                    update_data,
                    on_conflict="id",
                ).execute()
                result["plants_updated"] = len(plants_to_update)
                logger.info("Batch updated plants", count=result["plants_updated"], job_id=job_id)
            except Exception as e:
                result["warnings"].append(f"Failed to batch update plants: {str(e)}")
                logger.error("Failed to batch update plants", error=str(e), job_id=job_id)

        # Record weekly location data for plants and detect movements
        all_plants = plants_to_insert + plants_to_update
        tracking_result = await _record_plant_locations(
            client,
            job_id,
            location_id,
            [p["fleet_number"] for p in all_plants],
            plant_details=all_plants,  # Pass full plant details for tracking
            parsed_remarks=parsed_remarks,  # Pass AI parsed data for transfer detection
        )

        # Add tracking stats to result
        result["movements_detected"] = tracking_result.get("movements_detected", 0)
        result["new_plants_tracked"] = tracking_result.get("new_plants", 0)
        result["transfers_detected"] = tracking_result.get("transfers_detected", 0)
        result["transfers_confirmed"] = tracking_result.get("transfers_confirmed", 0)

        result["success"] = len(result["errors"]) == 0

        # Update submission with results
        final_status = "completed" if result["success"] else "partial" if result["plants_processed"] > 0 else "failed"

        client.table("weekly_report_submissions").update({
            "status": final_status,
            "processing_completed_at": datetime.utcnow().isoformat(),
            "plants_processed": result["plants_processed"],
            "plants_created": result["plants_created"],
            "plants_updated": result["plants_updated"],
            "errors": result["errors"] if result["errors"] else None,
            "warnings": result["warnings"] if result["warnings"] else None,
        }).eq("id", job_id).execute()

        # Create notification for plant officer
        await _create_notification(
            client,
            title=f"Weekly report processed",
            message=f"Processed {result['plants_processed']} plants: {result['plants_created']} new, {result['plants_updated']} updated",
            notification_type="report_processed" if result["success"] else "warning",
            data={"job_id": job_id, "location_id": location_id},
        )

        logger.info(
            "Weekly report processing complete",
            job_id=job_id,
            plants_processed=result["plants_processed"],
            plants_created=result["plants_created"],
            plants_updated=result["plants_updated"],
            success=result["success"],
        )

    except Exception as e:
        logger.exception("Weekly report processing failed", job_id=job_id, error=str(e))

        result["errors"].append(f"Processing failed: {str(e)}")

        # Update submission as failed
        client.table("weekly_report_submissions").update({
            "status": "failed",
            "processing_completed_at": datetime.utcnow().isoformat(),
            "errors": result["errors"],
        }).eq("id", job_id).execute()

        # Create failure notification
        await _create_notification(
            client,
            title="Weekly report processing failed",
            message=f"Error: {str(e)[:200]}",
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
    client = get_supabase_admin_client()

    result = {
        "success": False,
        "parts_processed": 0,
        "parts_created": 0,
        "errors": [],
        "warnings": [],
    }

    try:
        # Update status to processing
        client.table("purchase_order_submissions").update({
            "status": "processing",
            "processing_started_at": datetime.utcnow().isoformat(),
        }).eq("id", job_id).execute()

        logger.info("Starting purchase order processing", job_id=job_id, storage_path=storage_path)

        # Download file from storage
        file_data = client.storage.from_("reports").download(storage_path)

        # Get submission details
        submission = client.table("purchase_order_submissions").select("*").eq("id", job_id).single().execute()
        po_number = submission.data.get("po_number")
        po_date = submission.data.get("po_date")

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
                plant_result = client.table("plants_master").select("id").eq("fleet_number", fleet_num).execute()

                if not plant_result.data:
                    # Create plant if doesn't exist — resolve fleet_type from prefix
                    resolved_type = client.rpc("resolve_fleet_type", {"p_fleet_number": fleet_num}).execute()
                    new_plant = client.table("plants_master").insert({
                        "fleet_number": fleet_num,
                        "fleet_type": resolved_type.data if resolved_type.data else None,
                        "status": "unverified",
                        "physical_verification": False,
                    }).execute()
                    plant_id = new_plant.data[0]["id"]
                    result["warnings"].append(f"Created new plant for fleet: {fleet_num}")
                else:
                    plant_id = plant_result.data[0]["id"]

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
                insert_result = client.table("spare_parts").insert(parts_to_insert).execute()
                result["parts_created"] = len(insert_result.data)
                logger.info("Inserted spare parts", count=result["parts_created"], job_id=job_id)
            except Exception as e:
                result["errors"].append(f"Failed to insert spare parts: {str(e)}")
                logger.error("Failed to insert spare parts", error=str(e), job_id=job_id)

        result["success"] = len(result["errors"]) == 0

        # Update submission with results
        final_status = "completed" if result["success"] else "partial" if result["parts_processed"] > 0 else "failed"

        client.table("purchase_order_submissions").update({
            "status": final_status,
            "processing_completed_at": datetime.utcnow().isoformat(),
            "parts_processed": result["parts_processed"],
            "parts_created": result["parts_created"],
            "errors": result["errors"] if result["errors"] else None,
            "warnings": result["warnings"] if result["warnings"] else None,
        }).eq("id", job_id).execute()

        # Create notification
        await _create_notification(
            client,
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
        client.table("purchase_order_submissions").update({
            "status": "failed",
            "processing_completed_at": datetime.utcnow().isoformat(),
            "errors": result["errors"],
        }).eq("id", job_id).execute()

        # Create failure notification
        await _create_notification(
            client,
            title="Purchase order processing failed",
            message=f"Error: {str(e)[:200]}",
            notification_type="report_failed",
            data={"job_id": job_id, "error": str(e)[:500]},
        )

    return result


async def _record_plant_locations(
    client,
    submission_id: str,
    location_id: str,
    fleet_numbers: list[str],
    plant_details: list[dict[str, Any]] | None = None,
    parsed_remarks: dict[str, ParsedRemarks] | None = None,
) -> dict[str, Any]:
    """Record plant location data for the week and detect movements.

    Also handles:
    - AI-parsed transfer detection and processing
    - Confirming pending incoming transfers
    - "Latest week" logic for location updates
    - Missing plant detection

    Args:
        client: Supabase client.
        submission_id: The submission ID.
        location_id: Current location ID.
        fleet_numbers: List of fleet numbers in this report.
        plant_details: Optional list of dicts with plant details (remarks, physical_verification, etc.)
        parsed_remarks: AI-parsed remarks data keyed by fleet number.

    Returns:
        Dict with tracking stats (movements, new_plants, transfers, etc.)
    """
    tracking_result = {
        "movements_detected": 0,
        "new_plants": 0,
        "records_created": 0,
        "transfers_detected": 0,
        "transfers_confirmed": 0,
    }

    if not fleet_numbers:
        return tracking_result

    parsed_remarks = parsed_remarks or {}
    transfer_service = get_transfer_service()

    try:
        # Get plant IDs for fleet numbers
        plants = client.table("plants_master").select("id, fleet_number, current_location_id").in_("fleet_number", fleet_numbers).execute()
        fleet_to_plant = {p["fleet_number"]: p for p in plants.data}

        # Get submission details for week info
        submission = client.table("weekly_report_submissions").select(
            "year, week_number, week_ending_date"
        ).eq("id", submission_id).single().execute()

        if not submission.data:
            return tracking_result

        year = submission.data["year"]
        week_number = submission.data["week_number"]
        week_ending_date = submission.data["week_ending_date"]

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

        prev_records = (
            client.table("plant_weekly_records")
            .select("plant_id, location_id")
            .eq("year", prev_year)
            .eq("week_number", prev_week)
            .in_("plant_id", plant_ids)
            .execute()
        )
        prev_locations = {r["plant_id"]: r["location_id"] for r in prev_records.data}

        # Batch check which plants have ANY existing records (single query instead of 1 per plant)
        existing_records = (
            client.table("plant_weekly_records")
            .select("plant_id")
            .in_("plant_id", plant_ids)
            .execute()
        )
        plants_with_history = {r["plant_id"] for r in existing_records.data}

        # Check for pending transfers that should be confirmed
        confirmed_transfers = transfer_service.check_and_confirm_pending_transfers(
            plant_ids=plant_ids,
            location_id=location_id,
            submission_id=submission_id,
        )
        tracking_result["transfers_confirmed"] = len(confirmed_transfers)

        # Check which plants this is the latest week for (to update current_location)
        # Only update current_location if this is the most recent week data for the plant
        latest_weeks = (
            client.table("plant_weekly_records")
            .select("plant_id, year, week_number")
            .in_("plant_id", plant_ids)
            .order("year", desc=True)
            .order("week_number", desc=True)
            .execute()
        )
        # Build map of plant_id -> (latest_year, latest_week)
        plant_latest_week = {}
        for r in latest_weeks.data:
            pid = r["plant_id"]
            if pid not in plant_latest_week:
                plant_latest_week[pid] = (r["year"], r["week_number"])

        # Prepare weekly records and detect events
        weekly_records = []
        events_to_create = []
        location_updates = []  # Plants to update current_location

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
                # Usage data
                "hours_worked": usage.get("hours_worked", 0),
                "standby_hours": usage.get("standby_hours", 0),
                "breakdown_hours": usage.get("breakdown_hours", 0),
                "off_hire": usage.get("off_hire", False),
                "transfer_from": usage.get("transfer_from"),
                "transfer_to": usage.get("transfer_to"),
            }

            # Add AI-parsed fields
            if parsed:
                record["parsed_status"] = parsed.status
                record["parsed_transfer_direction"] = parsed.transfer_direction
                record["ai_confidence"] = parsed.confidence
                if parsed.condition_notes:
                    record["parsed_condition_keywords"] = [parsed.condition_notes]

                # Resolve transfer location to ID if detected
                if parsed.transfer_location:
                    resolved = transfer_service.resolve_location(parsed.transfer_location)
                    if resolved:
                        record["parsed_transfer_location_id"] = resolved["id"]

            weekly_records.append(record)

            # Check if this is the latest week for this plant
            existing_latest = plant_latest_week.get(plant_id)
            is_latest = (
                existing_latest is None or
                (year, week_number) >= existing_latest
            )

            # Process transfers from Excel columns first (more explicit than AI parsing)
            transfer_from_col = usage.get("transfer_from")
            transfer_to_col = usage.get("transfer_to")

            if transfer_from_col or transfer_to_col:
                # Excel columns have transfer info - create transfer record
                if transfer_from_col and not transfer_to_col:
                    # Inbound transfer - plant received from another location
                    transfer = transfer_service.create_inbound_transfer(
                        plant_id=plant_id,
                        to_location_id=location_id,
                        from_location_raw=transfer_from_col,
                        source_submission_id=submission_id,
                        source_remarks=details.get("remarks"),
                        confidence=1.0,  # High confidence - from explicit column
                    )
                    if transfer:
                        tracking_result["transfers_detected"] += 1
                        logger.info(
                            "Created inbound transfer from Excel column",
                            plant_id=str(plant_id),
                            from_location=transfer_from_col,
                        )

                elif transfer_to_col and not transfer_from_col:
                    # Outbound transfer - but only if destination is different from current location
                    to_location_resolved = transfer_service.resolve_location(transfer_to_col)
                    if to_location_resolved and to_location_resolved["id"] != location_id:
                        # Different location - create outbound transfer
                        transfer = transfer_service.create_outbound_transfer(
                            plant_id=plant_id,
                            from_location_id=location_id,
                            to_location_raw=transfer_to_col,
                            source_submission_id=submission_id,
                            source_remarks=details.get("remarks"),
                            confidence=1.0,  # High confidence - from explicit column
                        )
                        if transfer:
                            tracking_result["transfers_detected"] += 1
                            logger.info(
                                "Created outbound transfer from Excel column",
                                plant_id=str(plant_id),
                                to_location=transfer_to_col,
                            )
                    # If transfer_to matches current location, ignore (plant is already here)

                elif transfer_from_col and transfer_to_col:
                    # Both columns filled - need to check if transfer_to is current location
                    # If transfer_to matches current location, it just confirms arrival (inbound only)
                    # If transfer_to is different, it's a pass-through (inbound + outbound)

                    # Create inbound (confirmed) since plant is in this report
                    transfer = transfer_service.create_inbound_transfer(
                        plant_id=plant_id,
                        to_location_id=location_id,
                        from_location_raw=transfer_from_col,
                        source_submission_id=submission_id,
                        source_remarks=details.get("remarks"),
                        confidence=1.0,
                    )
                    if transfer:
                        tracking_result["transfers_detected"] += 1
                        logger.info(
                            "Created inbound transfer from Excel columns",
                            plant_id=str(plant_id),
                            from_location=transfer_from_col,
                        )

                    # Check if transfer_to is a DIFFERENT location than current
                    to_location_resolved = transfer_service.resolve_location(transfer_to_col)
                    if to_location_resolved and to_location_resolved["id"] != location_id:
                        # transfer_to is a different location - create outbound (pass-through)
                        transfer = transfer_service.create_outbound_transfer(
                            plant_id=plant_id,
                            from_location_id=location_id,
                            to_location_raw=transfer_to_col,
                            source_submission_id=submission_id,
                            source_remarks=details.get("remarks"),
                            confidence=1.0,
                        )
                        if transfer:
                            tracking_result["transfers_detected"] += 1
                            logger.info(
                                "Created outbound transfer (pass-through) from Excel columns",
                                plant_id=str(plant_id),
                                to_location=transfer_to_col,
                            )
                    # If transfer_to matches current location, no outbound needed - just arrived here

            # Process AI-detected transfers (only if no Excel column transfers were created)
            elif parsed and parsed.transfer_detected:
                transfer = transfer_service.process_transfer_from_parsed(
                    plant_id=plant_id,
                    current_location_id=location_id,
                    parsed=parsed,
                    submission_id=submission_id,
                    remarks=details.get("remarks"),
                )
                if transfer:
                    tracking_result["transfers_detected"] += 1

            # Track plants that should have location updated (only for latest week)
            if is_latest and parsed and parsed.transfer_direction != "outbound":
                # Don't update location for outbound transfers - plant is leaving
                location_updates.append(plant_id)

            # Check for movement (location change from previous week)
            prev_location = prev_locations.get(plant_id)
            if prev_location and prev_location != location_id:
                # Plant has moved!
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
            client.table("plant_weekly_records").upsert(
                weekly_records,
                on_conflict="plant_id,year,week_number",
            ).execute()
            tracking_result["records_created"] = len(weekly_records)

        # Update current_location only for plants where this is the latest week
        if location_updates:
            client.table("plants_master").update({
                "current_location_id": location_id,
            }).in_("id", location_updates).execute()

        # Create events
        if events_to_create:
            client.table("plant_events").insert(events_to_create).execute()

        # Update plant_location_history for movements
        for event in events_to_create:
            if event["event_type"] == "movement":
                # Close previous location record
                client.table("plant_location_history").update({
                    "end_date": week_ending_date,
                }).eq("plant_id", event["plant_id"]).is_("end_date", "null").execute()

                # Create new location record
                client.table("plant_location_history").insert({
                    "plant_id": event["plant_id"],
                    "location_id": event["to_location_id"],
                    "start_date": week_ending_date,
                    "transfer_reason": "Weekly report update",
                }).execute()

        # Detect missing plants - plants at this location last week but not in current report
        # Only mark as missing if this is the latest week we have data for
        try:
            # Get all plants that were at THIS location in previous week
            prev_at_location = (
                client.table("plant_weekly_records")
                .select("plant_id")
                .eq("location_id", location_id)
                .eq("year", prev_year)
                .eq("week_number", prev_week)
                .execute()
            )
            prev_plant_ids = {r["plant_id"] for r in prev_at_location.data}

            # Current report plant IDs
            current_plant_ids = set(plant_ids)

            # Missing = was here last week, not in current report
            missing_plant_ids = prev_plant_ids - current_plant_ids

            if missing_plant_ids:
                # Check if any of these missing plants have pending outbound transfers
                pending_transfers = (
                    client.table("plant_transfers")
                    .select("plant_id")
                    .in_("plant_id", list(missing_plant_ids))
                    .eq("status", "pending")
                    .eq("direction", "outbound")
                    .execute()
                )
                plants_with_pending_transfer = {r["plant_id"] for r in pending_transfers.data}

                # For plants truly missing (no pending transfer), mark as unknown location
                truly_missing = missing_plant_ids - plants_with_pending_transfer

                for missing_id in truly_missing:
                    # Check if this week is the latest for this plant
                    latest_check = (
                        client.table("plant_weekly_records")
                        .select("year, week_number")
                        .eq("plant_id", missing_id)
                        .order("year", desc=True)
                        .order("week_number", desc=True)
                        .limit(1)
                        .execute()
                    )

                    if latest_check.data:
                        latest = latest_check.data[0]
                        # Only mark as missing if prev week was the latest record
                        if (latest["year"], latest["week_number"]) == (prev_year, prev_week):
                            # Set current_location to NULL (unknown)
                            client.table("plants_master").update({
                                "current_location_id": None,
                                "status": "unverified",
                            }).eq("id", missing_id).execute()

                            # Close location history
                            client.table("plant_location_history").update({
                                "end_date": week_ending_date,
                            }).eq("plant_id", missing_id).eq("location_id", location_id).is_("end_date", "null").execute()

                            # Get fleet number for logging
                            plant_info = client.table("plants_master").select("fleet_number").eq("id", missing_id).execute()
                            fn = plant_info.data[0]["fleet_number"] if plant_info.data else "unknown"

                            # Create missing event
                            client.table("plant_events").insert({
                                "plant_id": missing_id,
                                "event_type": "missing",
                                "event_date": week_ending_date,
                                "year": year,
                                "week_number": week_number,
                                "from_location_id": location_id,
                                "details": {"fleet_number": fn},
                                "remarks": f"Plant {fn} not found in Week {week_number} report - location now unknown",
                            }).execute()

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
    client,
    title: str,
    message: str,
    notification_type: str,
    data: dict[str, Any] | None = None,
) -> None:
    """Create an in-app notification for admins."""
    try:
        client.table("notifications").insert({
            "title": title,
            "message": message,
            "type": notification_type,
            "data": data,
            "target_role": "admin",
            "read": False,
        }).execute()
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
