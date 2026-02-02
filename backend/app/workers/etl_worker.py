"""ETL background workers for processing uploaded files.

Handles async processing of:
- Weekly report Excel files
- Purchase order Excel files
"""

import io
from datetime import datetime
from typing import Any

import pandas as pd

from app.config import get_settings
from app.core.database import get_supabase_admin_client
from app.monitoring.logging import get_logger

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
    # Description
    "equipment description": "description",
    "equipment_description": "description",
    "description": "description",
    # Physical verification
    "physical verification": "physical_verification",
    "physical_verification": "physical_verification",
    "physical plant verification": "physical_verification",
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
    """Normalize fleet number to standard format."""
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

    # Normalize spaces
    s = " ".join(s.split())

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
        col_lower = str(col).lower().strip()
        if col_lower in column_map:
            rename_map[col] = column_map[col_lower]

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

        # Get existing plants for this location
        existing_plants = client.table("plants").select("id, fleet_number").execute()
        fleet_to_id = {p["fleet_number"]: p["id"] for p in existing_plants.data}

        # Process each row
        plants_to_insert = []
        plants_to_update = []

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

            # Extract transfer info
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

            # Data for updating the main plants table
            plant_data = {
                "fleet_number": fleet_num,
                "description": description,
                "remarks": remarks,
                "physical_verification": physical_verification,
                "current_location_id": location_id,
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
                # New plant
                plant_data["status"] = "active"
                plants_to_insert.append(plant_data)

        # Batch insert new plants (exclude _usage field)
        if plants_to_insert:
            try:
                insert_data = [
                    {k: v for k, v in p.items() if k != "_usage"}
                    for p in plants_to_insert
                ]
                insert_result = client.table("plants").insert(insert_data).execute()
                result["plants_created"] = len(insert_result.data)
                # Update plants_to_insert with generated IDs for tracking
                for i, p in enumerate(plants_to_insert):
                    p["id"] = insert_result.data[i]["id"]
                logger.info("Inserted new plants", count=result["plants_created"], job_id=job_id)
            except Exception as e:
                result["errors"].append(f"Failed to insert plants: {str(e)}")
                logger.error("Failed to insert plants", error=str(e), job_id=job_id)

        # Batch update existing plants (exclude _usage field)
        for plant in plants_to_update:
            try:
                update_data = {k: v for k, v in plant.items() if k not in ("id", "_usage")}
                client.table("plants").update(update_data).eq("id", plant["id"]).execute()
                result["plants_updated"] += 1
            except Exception as e:
                result["warnings"].append(f"Failed to update plant {plant['fleet_number']}: {str(e)}")

        # Record weekly location data for plants and detect movements
        all_plants = plants_to_insert + plants_to_update
        tracking_result = await _record_plant_locations(
            client,
            job_id,
            location_id,
            [p["fleet_number"] for p in all_plants],
            plant_details=all_plants,  # Pass full plant details for tracking
        )

        # Add tracking stats to result
        result["movements_detected"] = tracking_result.get("movements_detected", 0)
        result["new_plants_tracked"] = tracking_result.get("new_plants", 0)

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
            notification_type="upload_complete" if result["success"] else "upload_warning",
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
            notification_type="upload_failed",
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
                plant_result = client.table("plants").select("id").eq("fleet_number", fleet_num).execute()

                if not plant_result.data:
                    # Create plant if doesn't exist
                    new_plant = client.table("plants").insert({
                        "fleet_number": fleet_num,
                        "status": "active",
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
            notification_type="upload_complete" if result["success"] else "upload_warning",
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
            notification_type="upload_failed",
            data={"job_id": job_id, "error": str(e)[:500]},
        )

    return result


async def _record_plant_locations(
    client,
    submission_id: str,
    location_id: str,
    fleet_numbers: list[str],
    plant_details: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Record plant location data for the week and detect movements.

    Args:
        client: Supabase client.
        submission_id: The submission ID.
        location_id: Current location ID.
        fleet_numbers: List of fleet numbers in this report.
        plant_details: Optional list of dicts with plant details (remarks, physical_verification, etc.)

    Returns:
        Dict with tracking stats (movements, new_plants, etc.)
    """
    tracking_result = {
        "movements_detected": 0,
        "new_plants": 0,
        "records_created": 0,
    }

    if not fleet_numbers:
        return tracking_result

    try:
        # Get plant IDs for fleet numbers
        plants = client.table("plants").select("id, fleet_number, current_location_id").in_("fleet_number", fleet_numbers).execute()
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

        prev_records = (
            client.table("plant_weekly_records")
            .select("plant_id, location_id")
            .eq("year", prev_year)
            .eq("week_number", prev_week)
            .in_("plant_id", [fleet_to_plant[fn]["id"] for fn in fleet_numbers if fn in fleet_to_plant])
            .execute()
        )
        prev_locations = {r["plant_id"]: r["location_id"] for r in prev_records.data}

        # Prepare weekly records and detect events
        weekly_records = []
        events_to_create = []

        for fn in fleet_numbers:
            if fn not in fleet_to_plant:
                continue

            plant = fleet_to_plant[fn]
            plant_id = plant["id"]
            details = details_lookup.get(fn, {})
            usage = details.get("_usage", {})

            # Create weekly record with usage data
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
            weekly_records.append(record)

            # Check for movement
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
                first_record = (
                    client.table("plant_weekly_records")
                    .select("id")
                    .eq("plant_id", plant_id)
                    .limit(1)
                    .execute()
                )
                if not first_record.data:
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

        logger.info(
            "Plant tracking recorded",
            submission_id=submission_id,
            records=tracking_result["records_created"],
            movements=tracking_result["movements_detected"],
            new_plants=tracking_result["new_plants"],
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
