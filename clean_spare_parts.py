#!/usr/bin/env python3
"""
Clean and re-import spare parts with proper ditto mark handling.

The Excel uses " to mean "same as above" - this script resolves those.
"""

import os
import pandas as pd
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

# Load environment
load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_KEY')
SPARE_PARTS_FILE = Path('PlantandEquipmentSparePartsTracking.xlsx')


def normalize_fleet_number(value):
    """Normalize fleet number to uppercase with no spaces."""
    if pd.isna(value) or value is None:
        return None
    s = str(value).strip().upper().replace(' ', '')
    return s if s else None


def extract_fleet_from_sheet_name(sheet_name: str):
    """Extract fleet number from sheet name like 'SparepartLogPT169'."""
    import re
    patterns = [
        r"^[Ss]pare[Pp]art[Ll]og",
        r"^[Pp]are[Pp]art[Ll]og",
        r"^[Ss]parepart",
        r"^[Ss]pare[Pp]art",
    ]
    result = sheet_name
    for pattern in patterns:
        result = re.sub(pattern, "", result)
    result = result.strip()
    return normalize_fleet_number(result) if result else None


def parse_date(value):
    """Parse date to YYYY-MM-DD string."""
    if pd.isna(value) or value is None:
        return None
    try:
        if isinstance(value, (pd.Timestamp,)):
            return value.strftime("%Y-%m-%d")
        s = str(value).strip()
        if not s or s == '"':
            return None
        parsed = pd.to_datetime(s, dayfirst=True, errors="coerce")
        if pd.notna(parsed):
            return parsed.strftime("%Y-%m-%d")
        return None
    except Exception:
        return None


def clean_cost(value):
    """Clean cost value."""
    if pd.isna(value) or value is None:
        return None
    try:
        if isinstance(value, (int, float)):
            return float(value) if value >= 0 else None
        s = str(value).strip()
        if not s or s == '"':
            return None
        import re
        s = re.sub(r'[₦$N,\s]', '', s)
        result = float(s)
        return result if result >= 0 else None
    except (ValueError, TypeError):
        return None


def clean_quantity(value):
    """Clean quantity value."""
    if pd.isna(value) or value is None:
        return 1
    try:
        if str(value).strip() == '"':
            return None  # Will be filled from above
        qty = int(float(value))
        return qty if qty > 0 else 1
    except (ValueError, TypeError):
        return 1


def resolve_ditto_marks(df, columns_to_resolve):
    """
    Resolve ditto marks (") by filling with value from row above.

    The " symbol means "same as the cell above".
    """
    df = df.copy()

    for col in columns_to_resolve:
        if col not in df.columns:
            continue

        last_valid = None
        for idx in df.index:
            val = df.at[idx, col]

            # Check if it's a ditto mark
            if pd.notna(val) and str(val).strip() == '"':
                # Replace with last valid value
                df.at[idx, col] = last_valid
            elif pd.notna(val) and str(val).strip():
                # Update last valid value
                last_valid = val

    return df


def get_plant_lookup(client):
    """Get fleet_number -> plant_id mapping from plants_master."""
    # Fetch all plants (handle pagination)
    all_plants = []
    offset = 0
    batch_size = 1000
    while True:
        result = client.table("plants_master").select("id, fleet_number").range(offset, offset + batch_size - 1).execute()
        if not result.data:
            break
        all_plants.extend(result.data)
        if len(result.data) < batch_size:
            break
        offset += batch_size
    return {p["fleet_number"]: p["id"] for p in all_plants}


def get_location_lookup(client):
    """Get location name -> location_id mapping."""
    result = client.table("locations").select("id, name").execute()
    # Create lookup with various name formats (uppercase, original, lowercase, title)
    lookup = {}
    count = len(result.data)
    for loc in result.data:
        lookup[loc["name"]] = loc["id"]
        lookup[loc["name"].upper()] = loc["id"]
        lookup[loc["name"].lower()] = loc["id"]
        lookup[loc["name"].title()] = loc["id"]
    return lookup, count


def main():
    print("=" * 60)
    print("SPARE PARTS CLEANUP AND RE-IMPORT")
    print("=" * 60)

    # Connect to Supabase
    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Step 1: Clear existing spare_parts
    print("\n1. Clearing existing spare_parts...")
    client.table("spare_parts").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    print("   Done.")

    # Step 2: Get plant and location lookups
    print("\n2. Loading lookups...")
    plant_lookup = get_plant_lookup(client)
    print(f"   Found {len(plant_lookup)} plants in plants_master.")

    location_lookup, location_count = get_location_lookup(client)
    print(f"   Found {location_count} locations.")

    # Step 3: Process Excel file
    print(f"\n3. Processing {SPARE_PARTS_FILE}...")
    xl = pd.ExcelFile(SPARE_PARTS_FILE)

    # Column mapping - NOTE: "cost of spare parts" is TOTAL cost, not unit cost
    column_map = {
        "p o-date": "replaced_date",
        "po - date": "replaced_date",
        "po -date": "replaced_date",
        "po date": "replaced_date",
        "date replaced": "replaced_date",
        "equipment          type": "equipment_type",
        "equipment type": "equipment_type",
        "part   number": "part_number",
        "part number": "part_number",
        "supplier": "supplier",
        "sparepart description": "part_description",
        "spare part description": "part_description",
        "reason for  change (wear, damage, preventive schedule)": "reason_for_change",
        "reason for change (wear, damage, preventive schedule)": "reason_for_change",
        "reason for change": "reason_for_change",
        "cost of spare parts": "total_cost",  # This is TOTAL cost, not unit
        "cost of spareparts": "total_cost",
        "cost": "total_cost",
        "quantity used": "quantity",
        "quantity": "quantity",
        "work order job number": "purchase_order_number",
        "work order number": "purchase_order_number",
        "location": "location",
        "remarks": "remarks",
        "remark": "remarks",
    }

    # Columns that can have ditto marks (resolve " to value from row above)
    ditto_columns = [
        'replaced_date', 'equipment_type', 'part_number', 'supplier',
        'part_description', 'reason_for_change', 'total_cost', 'quantity',
        'purchase_order_number', 'location', 'remarks'
    ]

    all_parts = []
    location_history_entries = []  # Collect location history from spare parts dates
    sheets_processed = 0
    sheets_skipped = 0

    for sheet_name in xl.sheet_names:
        fleet_num = extract_fleet_from_sheet_name(sheet_name)

        if not fleet_num:
            sheets_skipped += 1
            continue

        try:
            # Read with header at row 0 (first row is header)
            df = pd.read_excel(xl, sheet_name=sheet_name, header=0)

            if df.empty or len(df) < 1:
                continue

            # Normalize column names
            df.columns = [str(c).lower().strip() for c in df.columns]

            # Map columns
            rename_map = {}
            for col in df.columns:
                if col in column_map:
                    rename_map[col] = column_map[col]
            df = df.rename(columns=rename_map)

            # Resolve ditto marks BEFORE processing
            df = resolve_ditto_marks(df, ditto_columns)

            # Process rows
            for _, row in df.iterrows():
                # Skip mostly empty rows
                non_null = row.notna().sum()
                if non_null < 3:
                    continue

                # Parse values
                replaced_date = parse_date(row.get('replaced_date'))
                part_number = str(row.get('part_number', '')).strip() if pd.notna(row.get('part_number')) else None
                part_description = str(row.get('part_description', '')).strip() if pd.notna(row.get('part_description')) else None
                supplier = str(row.get('supplier', '')).strip() if pd.notna(row.get('supplier')) else None
                reason = str(row.get('reason_for_change', '')).strip() if pd.notna(row.get('reason_for_change')) else None

                # IMPORTANT: Excel has TOTAL cost, we need to calculate unit_cost
                total_cost = clean_cost(row.get('total_cost'))
                quantity = clean_quantity(row.get('quantity')) or 1
                unit_cost = None
                if total_cost is not None and quantity > 0:
                    unit_cost = total_cost / quantity

                po_number = str(row.get('purchase_order_number', '')).strip() if pd.notna(row.get('purchase_order_number')) else None
                remarks = str(row.get('remarks', '')).strip() if pd.notna(row.get('remarks')) else None

                # Clean up any remaining ditto marks that weren't resolved
                if part_number == '"': part_number = None
                if part_description == '"': part_description = None
                if supplier == '"': supplier = None
                if reason == '"': reason = None
                if po_number == '"': po_number = None
                if remarks == '"': remarks = None

                # Parse location and look up location_id
                location_name = str(row.get('location', '')).strip() if pd.notna(row.get('location')) else None
                if location_name == '"': location_name = None
                location_id = None
                if location_name:
                    location_id = location_lookup.get(location_name) or location_lookup.get(location_name.upper())

                # Skip if no meaningful data
                if not (replaced_date or part_description or total_cost):
                    continue

                # Get plant_id
                plant_id = plant_lookup.get(fleet_num)
                if not plant_id:
                    # Create plant if it doesn't exist in plants_master
                    # NOTE: current_location_id is NULL - spare parts location is historical,
                    # not current. Current location comes from weekly reports only.
                    try:
                        result = client.table("plants_master").insert({
                            "fleet_number": fleet_num,
                            "description": f"Created from spare parts tracking",
                            "status": "unverified",
                            "physical_verification": False,
                            "current_location_id": None,  # Unknown until appears in weekly report
                        }).execute()
                        plant_id = result.data[0]["id"]
                        plant_lookup[fleet_num] = plant_id
                        print(f"   Created plant: {fleet_num}")
                    except Exception as e:
                        if "23505" not in str(e):  # Not a duplicate error
                            print(f"   Error creating plant {fleet_num}: {e}")
                        continue

                all_parts.append({
                    "plant_id": plant_id,
                    "location_id": location_id,  # WHERE the purchase was made
                    "po_date": replaced_date,    # Use as PO date (date of purchase)
                    "replaced_date": replaced_date,
                    "part_number": part_number,
                    "part_description": part_description,
                    "supplier": supplier,
                    "reason_for_change": reason,
                    "unit_cost": unit_cost,
                    "quantity": quantity,
                    "purchase_order_number": po_number,
                    "remarks": remarks,
                })

                # Collect location history entry if we have date and location
                # This is HISTORICAL data - shows where plant was at this date
                if replaced_date and location_id:
                    location_history_entries.append({
                        "plant_id": plant_id,
                        "location_id": location_id,
                        "start_date": replaced_date,
                        "transfer_reason": "Location from spare parts record",
                    })

            sheets_processed += 1

        except Exception as e:
            print(f"   Error processing sheet {sheet_name}: {e}")

    print(f"   Processed {sheets_processed} sheets, skipped {sheets_skipped}")
    print(f"   Found {len(all_parts)} spare parts records")

    # Step 4: Insert spare parts in batches
    print("\n4. Inserting spare parts...")
    batch_size = 50
    inserted = 0
    errors = 0

    for i in range(0, len(all_parts), batch_size):
        batch = all_parts[i:i + batch_size]
        try:
            client.table("spare_parts").insert(batch).execute()
            inserted += len(batch)
            print(f"   Inserted {inserted}/{len(all_parts)}...", end='\r')
        except Exception as e:
            errors += len(batch)
            print(f"\n   Error inserting batch: {e}")

    print(f"\n   Inserted: {inserted}, Errors: {errors}")

    # Step 5: Insert location history from spare parts (historical location data)
    print("\n5. Creating location history from spare parts...")
    if location_history_entries:
        # Deduplicate: keep unique plant_id + location_id + start_date combinations
        seen = set()
        unique_entries = []
        for entry in location_history_entries:
            key = (entry["plant_id"], entry["location_id"], entry["start_date"])
            if key not in seen:
                seen.add(key)
                unique_entries.append(entry)

        print(f"   {len(unique_entries)} unique location history entries to create")

        # Insert in batches, ignore duplicates (plant may already have location from weekly reports)
        history_inserted = 0
        history_skipped = 0
        for i in range(0, len(unique_entries), batch_size):
            batch = unique_entries[i:i + batch_size]
            for entry in batch:
                try:
                    # Check if this plant already has a location history entry
                    # Only add if it's a NEW location at a DIFFERENT date
                    existing = client.table("plant_location_history").select("id, start_date").eq(
                        "plant_id", entry["plant_id"]
                    ).eq("location_id", entry["location_id"]).execute()

                    if not existing.data:
                        # No existing entry for this plant+location, create it
                        client.table("plant_location_history").insert(entry).execute()
                        history_inserted += 1
                    else:
                        history_skipped += 1
                except Exception as e:
                    history_skipped += 1

        print(f"   Created: {history_inserted}, Skipped (already exists): {history_skipped}")
    else:
        print("   No location history entries to create")

    # Step 6: Verify
    print("\n6. Verifying...")
    result = client.table("spare_parts").select("id", count="exact").execute()
    print(f"   Total spare parts in database: {result.count}")

    # Check location_id population
    result_with_loc = client.table("spare_parts").select("id", count="exact").not_.is_("location_id", "null").execute()
    print(f"   Records with location_id: {result_with_loc.count}")

    # Check for remaining ditto marks
    for col in ['supplier', 'reason_for_change', 'part_description']:
        result = client.table("spare_parts").select("id").eq(col, '"').execute()
        if result.data:
            print(f"   WARNING: {len(result.data)} records still have ditto marks in {col}")

    print("\n" + "=" * 60)
    print("CLEANUP COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    main()
