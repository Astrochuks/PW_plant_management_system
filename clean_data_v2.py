#!/usr/bin/env python3
"""
Clean and re-import data with improved logic.

Fixes:
1. Ditto marks (") - proper carry-forward from previous row
2. Physical verification - correct logic with remarks fallback
"""

import os
import re
import pandas as pd
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

# Load environment
load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_KEY')
SPARE_PARTS_FILE = Path('PlantandEquipmentSparePartsTracking.xlsx')
WEEKLY_REPORTS_DIR = Path('new plants')


def normalize_fleet_number(value):
    """Normalize fleet number to uppercase with no spaces."""
    if pd.isna(value) or value is None:
        return None
    s = str(value).strip().upper().replace(' ', '')
    return s if s else None


def extract_fleet_from_sheet_name(sheet_name: str):
    """Extract fleet number from sheet name like 'SparepartLogPT169'."""
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


def is_ditto_mark(value):
    """Check if value is a ditto mark."""
    if pd.isna(value) or value is None:
        return False
    return str(value).strip() == '"'


def resolve_ditto_marks_v2(df, columns_to_resolve):
    """
    Resolve ditto marks (") by carrying forward the last valid value.

    Logic:
    - Keep track of last_valid_value for each column
    - When cell is '"', use last_valid_value
    - When cell has actual data, update last_valid_value
    - When cell is empty/None, keep as None (don't use last_valid)
    """
    df = df.copy()

    for col in columns_to_resolve:
        if col not in df.columns:
            continue

        last_valid = None

        for idx in df.index:
            val = df.at[idx, col]

            if is_ditto_mark(val):
                # Use last valid value
                df.at[idx, col] = last_valid
            elif pd.notna(val) and str(val).strip() != '':
                # Has actual data - update last valid
                last_valid = val
            # else: keep as is (None/empty)

    return df


def parse_date(value):
    """Parse date to YYYY-MM-DD string."""
    if pd.isna(value) or value is None:
        return None
    try:
        s = str(value).strip()
        if not s or s == '"':
            return None
        if isinstance(value, pd.Timestamp):
            return value.strftime("%Y-%m-%d")
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
        s = str(value).strip()
        if s == '"' or s == '':
            return 1
        qty = int(float(value))
        return qty if qty > 0 else 1
    except (ValueError, TypeError):
        return 1


def clean_string(value):
    """Clean string value, handling ditto marks."""
    if pd.isna(value) or value is None:
        return None
    s = str(value).strip()
    if s == '' or s == '"':
        return None
    return s


def get_physical_verification(pv_value, remarks_value):
    """
    Determine physical verification status.

    Logic:
    1. If PV column has 'P' → VERIFIED (True)
    2. If PV column has 'O' → NOT SEEN (False)
    3. If PV column is empty → check remarks:
       - If remarks contains 'notseen' or 'missing' → NOT SEEN (False)
       - If remarks has other content → VERIFIED (True)
       - If remarks is empty → NOT SEEN (False)
    """
    # Normalize PV column value safely
    pv_normalized = None
    try:
        if pv_value is not None and not pd.isna(pv_value):
            pv_normalized = str(pv_value).strip().lower()
            if pv_normalized == '':
                pv_normalized = None
    except Exception:
        pv_normalized = None

    # Check PV column value
    if pv_normalized == 'p':
        return True  # VERIFIED
    elif pv_normalized == 'o':
        return False  # NOT SEEN

    # PV is empty or invalid → check remarks
    return check_remarks_for_verification(remarks_value)


def check_remarks_for_verification(remarks_value):
    """
    Check remarks to determine verification status.

    Logic:
    - If remarks is empty → NOT SEEN (False)
    - If remarks contains 'notseen' or 'missing' (normalized) → NOT SEEN (False)
    - If remarks has other content → VERIFIED (True)
    """
    # Check if remarks is empty
    if remarks_value is None or pd.isna(remarks_value):
        return False  # NOT SEEN

    remarks_str = str(remarks_value).strip()
    if remarks_str == '':
        return False  # NOT SEEN

    # Normalize: remove ALL spaces, convert to lowercase
    normalized = remarks_str.replace(' ', '').lower()

    # Search for negative indicators
    if 'notseen' in normalized or 'missing' in normalized:
        return False  # NOT SEEN

    # Remarks has other content (no negative words) → VERIFIED
    return True


def normalize_column_name(col):
    """Normalize column name for matching."""
    if pd.isna(col):
        return ''
    result = str(col).lower().strip().replace('\n', ' ')
    # Replace ALL multiple spaces with single space (loop until no more double spaces)
    while '  ' in result:
        result = result.replace('  ', ' ')
    return result


def get_plant_lookup(client):
    """Get fleet_number -> plant_id mapping (handles pagination)."""
    all_plants = []
    offset = 0
    batch_size = 1000

    while True:
        result = client.table("plants").select("id, fleet_number").range(offset, offset + batch_size - 1).execute()
        if not result.data:
            break
        all_plants.extend(result.data)
        if len(result.data) < batch_size:
            break
        offset += batch_size

    return {p["fleet_number"]: p["id"] for p in all_plants}


def clean_spare_parts(client):
    """Clean and re-import spare parts with proper ditto mark handling."""
    print("\n" + "=" * 60)
    print("CLEANING SPARE PARTS")
    print("=" * 60)

    # Clear existing
    print("\n1. Clearing existing spare_parts...")
    client.table("spare_parts").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

    # Get plant lookup
    print("2. Loading plant lookup...")
    plant_lookup = get_plant_lookup(client)
    print(f"   Found {len(plant_lookup)} plants")

    # Column mapping (handle various spellings)
    column_map = {
        'date replaced': 'replaced_date',
        'p o-date': 'replaced_date',
        'p o -date': 'replaced_date',  # With space before hyphen
        'po - date': 'replaced_date',
        'po -date': 'replaced_date',
        'po date': 'replaced_date',
        'equipment          i.d': 'equipment_type',
        'equipment i.d': 'equipment_type',
        'equipment type': 'equipment_type',
        'equipment          type': 'equipment_type',
        'part   number': 'part_number',
        'part number': 'part_number',
        'supplier': 'supplier',
        'sparepart description': 'part_description',
        'spare part description': 'part_description',
        'reason for  change (wear, damage, preventive schedule)': 'reason_for_change',
        'reason for change (wear, damage, preventive schedule)': 'reason_for_change',
        'reason for  change (wear, damage, preventive schedule) maintainance': 'reason_for_change',
        'reason for change': 'reason_for_change',
        'cost of spare parts': 'unit_cost',
        'cost of spareparts': 'unit_cost',
        'cost': 'unit_cost',
        'quantity used': 'quantity',
        'quantity': 'quantity',
        'work order job number': 'purchase_order_number',
        'work order number': 'purchase_order_number',
        'location': 'location',
        'remarks': 'remarks',
        'remark': 'remarks',
    }

    # Columns that can have ditto marks
    ditto_columns = [
        'replaced_date', 'equipment_type', 'part_number', 'supplier',
        'part_description', 'reason_for_change', 'unit_cost', 'quantity',
        'purchase_order_number', 'location', 'remarks'
    ]

    print(f"3. Processing {SPARE_PARTS_FILE}...")
    xl = pd.ExcelFile(SPARE_PARTS_FILE)

    all_parts = []
    sheets_processed = 0

    for sheet_name in xl.sheet_names:
        fleet_num = extract_fleet_from_sheet_name(sheet_name)
        if not fleet_num:
            continue

        try:
            df = pd.read_excel(xl, sheet_name=sheet_name, header=0)
            if df.empty or len(df) < 1:
                continue

            # Normalize and map column names
            df.columns = [normalize_column_name(c) for c in df.columns]
            rename_map = {c: column_map[c] for c in df.columns if c in column_map}
            df = df.rename(columns=rename_map)

            # Resolve ditto marks BEFORE processing
            df = resolve_ditto_marks_v2(df, ditto_columns)

            for _, row in df.iterrows():
                # Skip mostly empty rows
                if row.notna().sum() < 3:
                    continue

                replaced_date = parse_date(row.get('replaced_date'))
                part_description = clean_string(row.get('part_description'))
                unit_cost = clean_cost(row.get('unit_cost'))

                # Skip if no meaningful data
                if not (replaced_date or part_description or unit_cost):
                    continue

                # Get or create plant
                plant_id = plant_lookup.get(fleet_num)
                if not plant_id:
                    try:
                        result = client.table("plants").insert({
                            "fleet_number": fleet_num,
                            "description": f"Created from spare parts tracking",
                            "status": "active",
                            "physical_verification": False,
                        }).execute()
                        plant_id = result.data[0]["id"]
                        plant_lookup[fleet_num] = plant_id
                    except Exception as e:
                        if "23505" not in str(e):
                            print(f"   Error creating plant {fleet_num}: {e}")
                        continue

                all_parts.append({
                    "plant_id": plant_id,
                    "replaced_date": replaced_date,
                    "part_number": clean_string(row.get('part_number')),
                    "part_description": part_description,
                    "supplier": clean_string(row.get('supplier')),
                    "reason_for_change": clean_string(row.get('reason_for_change')),
                    "unit_cost": unit_cost,
                    "quantity": clean_quantity(row.get('quantity')),
                    "purchase_order_number": clean_string(row.get('purchase_order_number')),
                    "remarks": clean_string(row.get('remarks')),
                })

            sheets_processed += 1

        except Exception as e:
            print(f"   Error processing sheet {sheet_name}: {e}")

    print(f"   Processed {sheets_processed} sheets")
    print(f"   Found {len(all_parts)} spare parts records")

    # Insert in batches (larger batches = fewer API calls)
    print("4. Inserting spare parts...")
    batch_size = 100  # Increased from 50
    inserted = 0

    for i in range(0, len(all_parts), batch_size):
        batch = all_parts[i:i + batch_size]
        try:
            client.table("spare_parts").insert(batch).execute()
            inserted += len(batch)
        except Exception as e:
            print(f"   Error inserting batch: {e}")

    print(f"   Inserted: {inserted}")

    # Verify no ditto marks remain
    for col in ['supplier', 'reason_for_change', 'part_description']:
        result = client.table("spare_parts").select("id").eq(col, '"').execute()
        if result.data:
            print(f"   WARNING: {len(result.data)} records still have ditto in {col}")

    return inserted


def fix_physical_verification(client):
    """Fix physical verification for plants based on weekly reports."""
    print("\n" + "=" * 60)
    print("FIXING PHYSICAL VERIFICATION")
    print("=" * 60)

    # Column name variations to check
    pv_column_variations = [
        'physical plant verification',
        'physical plant\nverification',
        'physicalplantverification',
        'physical verification',
    ]

    remarks_column_variations = [
        'remark',
        'remarks',
    ]

    fleet_column_variations = [
        'fleetnumber',
        'fleet number',
        'fleet_number',
    ]

    print(f"1. Processing weekly reports from {WEEKLY_REPORTS_DIR}...")

    # Track verification status
    verification_status = {}  # fleet_number -> bool

    files_processed = 0
    files_skipped = 0

    for file_path in sorted(WEEKLY_REPORTS_DIR.glob("*.xlsx")):
        try:
            # Read with header at row 3 (0-indexed)
            df = pd.read_excel(file_path, sheet_name=0, header=3)

            # Normalize column names
            df.columns = [normalize_column_name(c) for c in df.columns]

            # Find fleet_number column
            fleet_col = None
            for var in fleet_column_variations:
                if var in df.columns:
                    fleet_col = var
                    break

            if not fleet_col:
                files_skipped += 1
                continue

            # Find physical verification column
            pv_col = None
            for var in pv_column_variations:
                if var in df.columns:
                    pv_col = var
                    break

            # Find remarks column
            remarks_col = None
            for var in remarks_column_variations:
                if var in df.columns:
                    remarks_col = var
                    break

            # Process rows
            for _, row in df.iterrows():
                fleet_num = normalize_fleet_number(row.get(fleet_col))
                if not fleet_num:
                    continue

                pv_value = row.get(pv_col) if pv_col else None
                remarks_value = row.get(remarks_col) if remarks_col else None

                is_verified = get_physical_verification(pv_value, remarks_value)

                # If ANY report shows verified, mark as verified
                if fleet_num not in verification_status:
                    verification_status[fleet_num] = is_verified
                elif is_verified:
                    verification_status[fleet_num] = True

            files_processed += 1

        except Exception as e:
            files_skipped += 1
            # print(f"   Error processing {file_path.name}: {e}")

    print(f"   Processed {files_processed} files, skipped {files_skipped}")
    print(f"   Found data for {len(verification_status)} plants")

    verified_count = sum(1 for v in verification_status.values() if v)
    not_verified_count = sum(1 for v in verification_status.values() if not v)
    print(f"   Verified (P or good remarks): {verified_count}")
    print(f"   Not Seen (O, missing, notseen, or empty): {not_verified_count}")
    print(f"   (Will use ~{(verified_count // 100) + (not_verified_count // 100) + 2} batch API calls instead of {len(verification_status)} individual calls)")

    # Update database
    print("2. Updating plants in database...")

    # Get all plants (with pagination)
    plants_db = get_plant_lookup(client)
    print(f"   Loaded {len(plants_db)} plants from database")

    # Group plants by verification status for batch updates
    verified_ids = []
    not_verified_ids = []

    for fleet_number, is_verified in verification_status.items():
        if fleet_number in plants_db:
            plant_id = plants_db[fleet_number]
            if is_verified:
                verified_ids.append(plant_id)
            else:
                not_verified_ids.append(plant_id)

    updated = 0

    # Batch update verified plants (in chunks of 100 to avoid URL length limits)
    batch_size = 100
    for i in range(0, len(verified_ids), batch_size):
        batch = verified_ids[i:i + batch_size]
        try:
            client.table("plants").update({
                "physical_verification": True
            }).in_("id", batch).execute()
            updated += len(batch)
        except Exception as e:
            print(f"   Error batch updating verified: {e}")

    # Batch update not verified plants
    for i in range(0, len(not_verified_ids), batch_size):
        batch = not_verified_ids[i:i + batch_size]
        try:
            client.table("plants").update({
                "physical_verification": False
            }).in_("id", batch).execute()
            updated += len(batch)
        except Exception as e:
            print(f"   Error batch updating not verified: {e}")

    print(f"   Updated: {updated}")

    # Verify using count queries
    print("3. Verifying...")
    verified_result = client.table("plants").select("id", count="exact").eq("physical_verification", True).execute()
    not_verified_result = client.table("plants").select("id", count="exact").eq("physical_verification", False).execute()
    print(f"   Verified in DB: {verified_result.count}")
    print(f"   Not Seen in DB: {not_verified_result.count}")

    return updated


def main():
    print("=" * 60)
    print("DATA CLEANUP V2")
    print("=" * 60)

    # Connect to Supabase
    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Clean spare parts
    spare_parts_count = clean_spare_parts(client)

    # Fix physical verification
    pv_updated = fix_physical_verification(client)

    # Final summary
    print("\n" + "=" * 60)
    print("CLEANUP COMPLETE")
    print("=" * 60)

    result = client.table("plants").select("id", count="exact").execute()
    print(f"\nTotal plants: {result.count}")

    verified_result = client.table("plants").select("id", count="exact").eq("physical_verification", True).execute()
    not_verified_result = client.table("plants").select("id", count="exact").eq("physical_verification", False).execute()
    print(f"Verified: {verified_result.count}")
    print(f"Not Seen: {not_verified_result.count}")

    result = client.table("spare_parts").select("id", count="exact").execute()
    print(f"Spare Parts: {result.count}")

    # Check for any remaining ditto marks
    for col in ['supplier', 'reason_for_change', 'part_description', 'part_number']:
        result = client.table("spare_parts").select("id").eq(col, '"').execute()
        if result.data:
            print(f"WARNING: {len(result.data)} spare parts still have '\"' in {col}")


if __name__ == "__main__":
    main()
