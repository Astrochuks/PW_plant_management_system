#!/usr/bin/env python3
"""
Fix physical verification for plants based on weekly reports.

Rules:
- P = Verified (physical_verification = true)
- Blank or O = NOT SEEN (physical_verification = false)
- Remarks: "not seen", "missing" = NOT SEEN
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
WEEKLY_REPORTS_DIR = Path('new plants')


def normalize_fleet_number(value):
    """Normalize fleet number to uppercase with no spaces."""
    if pd.isna(value) or value is None:
        return None
    s = str(value).strip().upper().replace(' ', '')
    return s if s else None


def derive_physical_verification(verification_value, remarks_value):
    """
    Derive physical verification status.

    Rules:
    - P = True (verified)
    - O, blank, or empty = False (not seen)
    - Remarks with "not seen", "missing" = False
    """
    # Check direct verification column
    if pd.notna(verification_value):
        v = str(verification_value).strip().upper()
        if v == 'P':
            return True
        if v == 'O' or v == '':
            return False

    # Check remarks for negative indicators
    if pd.notna(remarks_value):
        remarks = str(remarks_value).strip().upper()
        negative_indicators = ['NOT SEEN', 'MISSING', 'NOT FOUND', 'N/A', 'UNAVAILABLE']
        for neg in negative_indicators:
            if neg in remarks:
                return False

    # Default: not verified
    return False


def main():
    print("=" * 60)
    print("FIX PHYSICAL VERIFICATION")
    print("=" * 60)

    # Connect to Supabase
    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Get current plants
    print("\n1. Loading plants from database...")
    result = client.table("plants").select("id, fleet_number, physical_verification").execute()
    plants_db = {p["fleet_number"]: p for p in result.data}
    print(f"   Found {len(plants_db)} plants")

    # Process weekly reports
    print(f"\n2. Processing weekly reports from {WEEKLY_REPORTS_DIR}...")

    # Track verification status from ALL reports
    verification_status = {}  # fleet_number -> True/False

    # Column mapping
    column_map = {
        "fleetnumber": "fleet_number",
        "fleet number": "fleet_number",
        "s/no": "row_num",
        "s/no.": "row_num",
        "remark": "remarks",
        "remarks": "remarks",
        "physical plant\nverification": "physical_verification",
        "physical plant verification": "physical_verification",
        "physical verification": "physical_verification",
    }

    files_processed = 0
    for file_path in sorted(WEEKLY_REPORTS_DIR.glob("*.xlsx")):
        try:
            # Read with header at row 3 (0-indexed)
            df = pd.read_excel(file_path, sheet_name=0, header=3)

            # Normalize column names
            df.columns = [str(c).lower().strip() for c in df.columns]

            # Map columns
            rename_map = {}
            for col in df.columns:
                if col in column_map:
                    rename_map[col] = column_map[col]
            df = df.rename(columns=rename_map)

            if 'fleet_number' not in df.columns:
                continue

            # Process rows
            for _, row in df.iterrows():
                fleet_num = normalize_fleet_number(row.get('fleet_number'))
                if not fleet_num:
                    continue

                verification_col = row.get('physical_verification')
                remarks_col = row.get('remarks')

                is_verified = derive_physical_verification(verification_col, remarks_col)

                # If ANY report shows verified, mark as verified
                # (latest status would be better, but we take any P as verified)
                if fleet_num not in verification_status:
                    verification_status[fleet_num] = is_verified
                elif is_verified:
                    verification_status[fleet_num] = True

            files_processed += 1

        except Exception as e:
            print(f"   Error processing {file_path.name}: {e}")

    print(f"   Processed {files_processed} files")
    print(f"   Found verification data for {len(verification_status)} plants")

    # Count verified vs not verified
    verified_count = sum(1 for v in verification_status.values() if v)
    not_verified_count = sum(1 for v in verification_status.values() if not v)
    print(f"   Verified (P): {verified_count}")
    print(f"   Not Seen: {not_verified_count}")

    # Update database
    print("\n3. Updating plants in database...")
    updated = 0
    errors = 0

    for fleet_number, is_verified in verification_status.items():
        if fleet_number in plants_db:
            plant = plants_db[fleet_number]
            current_status = plant.get("physical_verification", False)

            # Only update if status differs
            if current_status != is_verified:
                try:
                    client.table("plants").update({
                        "physical_verification": is_verified
                    }).eq("id", plant["id"]).execute()
                    updated += 1
                except Exception as e:
                    errors += 1
                    print(f"   Error updating {fleet_number}: {e}")

    print(f"   Updated: {updated}")
    print(f"   Errors: {errors}")

    # Verify
    print("\n4. Verifying...")
    result = client.table("plants").select("physical_verification").execute()
    verified_in_db = sum(1 for p in result.data if p.get("physical_verification"))
    not_verified_in_db = sum(1 for p in result.data if not p.get("physical_verification"))
    print(f"   Verified in DB: {verified_in_db}")
    print(f"   Not verified in DB: {not_verified_in_db}")

    print("\n" + "=" * 60)
    print("PHYSICAL VERIFICATION FIX COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    main()
