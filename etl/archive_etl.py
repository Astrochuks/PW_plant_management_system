"""
Archive ETL Pipeline
Loads and cleans legacy Plant List 2021 data into archived_plants table.
"""

import re
import json
import pandas as pd
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field
from supabase import create_client, Client

from config import config


# ============================================================================
# Constants
# ============================================================================

# Invalid fleet numbers to exclude entirely
INVALID_FLEET_NUMBERS = {
    "ATLASCOPCO", "ITELTOWER", "KACHER", "LUTIAN", "NOFLEET", "PWMINNING", "TRIMER",
    "FFF",  # Placeholder value
    "FF",   # Invalid - not a proper fleet number format
}

# Patterns that indicate invalid fleet numbers
INVALID_PATTERNS = [
    r"^BKD\d+$",           # Serial number style (BKD9063038)
    r"^[A-Z]+\d+>[A-Z]+",  # Compound references (FBT18>T526, T508>WP296)
]

# Specific fixes for known data issues
SPECIFIC_FIXES = {
    "WP399": {"description": '3" WATER PUMP'},
    "WP253": {"description": "WATER PUMP"},
}

# Prefix-to-fleet-type overrides (for prefixes with bad source data)
PREFIX_FLEET_TYPE_OVERRIDES = {
    "EBM": "ELECTRIC BORING MACHINE",
    "FM": "FOLDING MACHINE",
    "GM": "GRINDING MACHINE",
    "PC": "PERSONNEL CARRIER",  # Was incorrectly PERSONAL BUS
    "ASC": "ASPHALT CUTTER",
}

# Column mapping from Excel to database (Excel columns -> DB columns)
COLUMN_MAPPING = {
    # Actual column names from Plant List 2021.xlsx
    "FLEETNUMBER": "fleet_number",
    "FLEETDESCRIPTION": "description",
    "FLEETTYPEDESCRIPTION": "fleet_type",
    "MAKE": "make",
    "MODEL": "model",
    "CHASISNUMBER": "chassis_number",
    "YEAROFMANUFACTURE": "year_of_manufacture",
    "MSERIALNUMBER": "serial_m",
    "ESERIALNUMBER": "serial_e",
    # Alternate names (for compatibility)
    "FLEET NO.": "fleet_number",
    "FLEET NO": "fleet_number",
    "DESCRIPTION": "description",
    "FLEET TYPE": "fleet_type",
    "CHASIS NO.": "chassis_number",
    "CHASIS NO": "chassis_number",
    "CHASSIS NO.": "chassis_number",
    "CHASSIS NO": "chassis_number",
    "YEAR OF MANUFACTURE": "year_of_manufacture",
    "PURCHASE COST (N)": "purchase_cost",
    "PURCHASE COST": "purchase_cost",
    "M SERIAL NUMBER": "serial_m",
    "E SERIAL NUMBER": "serial_e",
}


# ============================================================================
# Helper Functions
# ============================================================================

def extract_prefix(fleet_number: str) -> Optional[str]:
    """Extract letter prefix from fleet number.

    Examples:
        "AC10"    -> "AC"
        "VPE102"  -> "VPE"
        "T385"    -> "T"
        "WP399"   -> "WP"
    """
    if not fleet_number:
        return None
    match = re.match(r'^([A-Z]+)', fleet_number.upper().strip())
    return match.group(1) if match else None


def is_invalid_fleet_number(fleet_number: str) -> bool:
    """Check if a fleet number should be excluded."""
    if not fleet_number:
        return True

    fn = fleet_number.upper().strip()

    # Check against explicit invalid list
    if fn in INVALID_FLEET_NUMBERS:
        return True

    # Check against patterns
    for pattern in INVALID_PATTERNS:
        if re.match(pattern, fn):
            return True

    return False


def normalize_text(value, remove_spaces: bool = False) -> Optional[str]:
    """Normalize text to uppercase, trimmed."""
    if pd.isna(value) or value is None:
        return None
    text = str(value).strip().upper()
    if text in ("", "<<ADD NEW ITEM>>", "NAN", "NONE"):
        return None
    if remove_spaces:
        text = text.replace(" ", "")
    return text


def clean_numeric(value) -> Optional[float]:
    """Clean numeric values."""
    if pd.isna(value) or value is None:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def clean_year(value) -> Optional[int]:
    """Clean year values."""
    num = clean_numeric(value)
    if num is None:
        return None
    year = int(num)
    if 1900 <= year <= 2100:
        return year
    return None


def count_non_null(row: dict) -> int:
    """Count non-null values in a row."""
    return sum(1 for v in row.values() if v is not None and str(v).strip() not in ("", "nan", "None"))


# ============================================================================
# ETL Pipeline
# ============================================================================

@dataclass
class ArchiveETLStats:
    """Statistics from the ETL run."""
    total_rows: int = 0
    invalid_excluded: int = 0
    duplicates_removed: int = 0
    fleet_types_filled: int = 0
    specific_fixes_applied: int = 0
    rows_loaded: int = 0
    prefixes_loaded: int = 0
    errors: list = field(default_factory=list)


class ArchiveETL:
    """ETL pipeline for loading legacy plant data."""

    def __init__(self, supabase: Client):
        self.supabase = supabase
        self.stats = ArchiveETLStats()
        self.prefix_mapping: dict[str, str] = {}  # prefix -> fleet_type

    def run(self, excel_path: Path) -> ArchiveETLStats:
        """Run the full ETL pipeline."""
        print(f"\n{'='*60}")
        print("ARCHIVE ETL PIPELINE")
        print(f"{'='*60}")
        print(f"Source: {excel_path}")

        # Step 1: Extract
        print("\n[1/5] Extracting data from Excel...")
        df = self._extract(excel_path)
        self.stats.total_rows = len(df)
        print(f"      Loaded {len(df)} rows")

        # Step 2: Remove invalid fleet numbers
        print("\n[2/5] Removing invalid fleet numbers...")
        df = self._remove_invalid(df)
        print(f"      {self.stats.invalid_excluded} invalid records excluded")
        print(f"      {len(df)} records remaining")

        # Step 3: Remove duplicates
        print("\n[3/5] Removing duplicates (keeping most complete)...")
        df = self._remove_duplicates(df)
        print(f"      {self.stats.duplicates_removed} duplicates removed")
        print(f"      {len(df)} unique records")

        # Step 4: Build prefix mapping and fill fleet types
        print("\n[4/5] Building prefix mapping and filling fleet types...")
        df = self._fill_fleet_types(df)
        print(f"      {len(self.prefix_mapping)} prefixes mapped")
        print(f"      {self.stats.fleet_types_filled} fleet types filled from prefix lookup")

        # Step 5: Apply specific fixes
        print("\n[5/5] Applying specific fixes...")
        df = self._apply_specific_fixes(df)
        print(f"      {self.stats.specific_fixes_applied} fixes applied")

        # Load to database
        print("\n[LOAD] Loading to Supabase...")
        self._load_prefixes()
        print(f"       Loaded {self.stats.prefixes_loaded} prefix mappings")

        self._load_plants(df)
        print(f"       Loaded {self.stats.rows_loaded} plants")

        # Summary
        print(f"\n{'='*60}")
        print("SUMMARY")
        print(f"{'='*60}")
        print(f"Total source rows:    {self.stats.total_rows}")
        print(f"Invalid excluded:     {self.stats.invalid_excluded}")
        print(f"Duplicates removed:   {self.stats.duplicates_removed}")
        print(f"Fleet types filled:   {self.stats.fleet_types_filled}")
        print(f"Specific fixes:       {self.stats.specific_fixes_applied}")
        print(f"Records loaded:       {self.stats.rows_loaded}")
        print(f"Prefix mappings:      {self.stats.prefixes_loaded}")

        if self.stats.errors:
            print(f"\nErrors ({len(self.stats.errors)}):")
            for err in self.stats.errors[:10]:
                print(f"  - {err}")
            if len(self.stats.errors) > 10:
                print(f"  ... and {len(self.stats.errors) - 10} more")

        return self.stats

    def _extract(self, excel_path: Path) -> pd.DataFrame:
        """Extract data from Excel file."""
        df = pd.read_excel(
            excel_path,
            sheet_name="Plants & Equipment",
            header=config.legacy_header_row,
        )

        # Normalize column names (uppercase, no spaces)
        df.columns = [str(c).strip().upper().replace(" ", "") for c in df.columns]

        # Debug: show what columns we found
        print(f"      Found columns: {list(df.columns)}")

        # Map columns
        rename_map = {k: v for k, v in COLUMN_MAPPING.items() if k in df.columns}
        df = df.rename(columns=rename_map)

        # Get the target column names (values from COLUMN_MAPPING)
        target_cols = set(COLUMN_MAPPING.values())

        # Keep only columns that were successfully mapped
        keep_cols = [c for c in df.columns if c in target_cols]
        df = df[keep_cols].copy()

        print(f"      Mapped columns: {keep_cols}")

        # Normalize fleet_number (remove spaces like "AC 10" -> "AC10")
        if "fleet_number" in df.columns:
            df["fleet_number"] = df["fleet_number"].apply(lambda x: normalize_text(x, remove_spaces=True))

        # Normalize other text values (keep spaces)
        for col in ["description", "fleet_type", "make", "model", "chassis_number", "serial_m", "serial_e"]:
            if col in df.columns:
                df[col] = df[col].apply(normalize_text)

        # Clean numeric columns
        if "purchase_cost" in df.columns:
            df["purchase_cost"] = df["purchase_cost"].apply(clean_numeric)
        if "year_of_manufacture" in df.columns:
            df["year_of_manufacture"] = df["year_of_manufacture"].apply(clean_year)

        # Remove rows with no fleet number
        df = df[df["fleet_number"].notna()].copy()

        return df

    def _remove_invalid(self, df: pd.DataFrame) -> pd.DataFrame:
        """Remove invalid fleet numbers."""
        valid_mask = ~df["fleet_number"].apply(is_invalid_fleet_number)
        invalid_count = (~valid_mask).sum()
        self.stats.invalid_excluded = invalid_count
        return df[valid_mask].copy()

    def _remove_duplicates(self, df: pd.DataFrame) -> pd.DataFrame:
        """Remove duplicates, keeping most complete record."""
        # Add completeness score
        df["_completeness"] = df.apply(lambda row: count_non_null(row.to_dict()), axis=1)

        # Sort by completeness (descending) and keep first
        df = df.sort_values("_completeness", ascending=False)

        before = len(df)
        df = df.drop_duplicates(subset=["fleet_number"], keep="first")
        after = len(df)

        self.stats.duplicates_removed = before - after

        # Remove helper column
        df = df.drop(columns=["_completeness"])

        return df

    def _fill_fleet_types(self, df: pd.DataFrame) -> pd.DataFrame:
        """Build prefix mapping and fill missing fleet types."""
        # Apply manual overrides first
        self.prefix_mapping.update(PREFIX_FLEET_TYPE_OVERRIDES)

        # First pass: build prefix -> fleet_type mapping from rows that have fleet_type
        for _, row in df.iterrows():
            fleet_number = row["fleet_number"]
            fleet_type = row["fleet_type"]

            if fleet_type and fleet_number:
                prefix = extract_prefix(fleet_number)
                # Don't override manual fixes
                if prefix and prefix not in self.prefix_mapping:
                    self.prefix_mapping[prefix] = fleet_type

        # Second pass: fill missing fleet types using prefix mapping
        def fill_fleet_type(row):
            if row["fleet_type"]:
                return row["fleet_type"], "original"

            prefix = extract_prefix(row["fleet_number"])
            if prefix and prefix in self.prefix_mapping:
                self.stats.fleet_types_filled += 1
                return self.prefix_mapping[prefix], "prefix_lookup"

            # Fallback to description if unique prefix
            if row["description"]:
                return row["description"], "description"

            return None, None

        df["_fleet_type_result"] = df.apply(fill_fleet_type, axis=1)
        df["fleet_type"] = df["_fleet_type_result"].apply(lambda x: x[0])
        df["fleet_type_source"] = df["_fleet_type_result"].apply(lambda x: x[1])
        df = df.drop(columns=["_fleet_type_result"])

        return df

    def _apply_specific_fixes(self, df: pd.DataFrame) -> pd.DataFrame:
        """Apply specific fixes for known data issues."""
        for fleet_number, fixes in SPECIFIC_FIXES.items():
            mask = df["fleet_number"] == fleet_number
            if mask.any():
                for col, value in fixes.items():
                    df.loc[mask, col] = value
                    self.stats.specific_fixes_applied += 1

        return df

    def _load_prefixes(self):
        """Load prefix mappings to database."""
        # Clear existing
        self.supabase.table("fleet_number_prefixes").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

        # Insert new
        records = []
        for prefix, fleet_type in self.prefix_mapping.items():
            records.append({
                "prefix": prefix,
                "fleet_type": fleet_type,
                "example_fleet_number": f"{prefix}1",
            })

        if records:
            self.supabase.table("fleet_number_prefixes").insert(records).execute()
            self.stats.prefixes_loaded = len(records)

    def _load_plants(self, df: pd.DataFrame):
        """Load plants to database."""
        # Clear existing
        self.supabase.table("archived_plants").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

        # Prepare records
        records = []
        for _, row in df.iterrows():
            raw_data = row.to_dict()
            # Convert any non-serializable values
            for k, v in raw_data.items():
                if pd.isna(v):
                    raw_data[k] = None
                elif hasattr(v, 'item'):  # numpy types
                    raw_data[k] = v.item()

            cleaning_notes = []
            if row.get("fleet_type_source") == "prefix_lookup":
                cleaning_notes.append("Fleet type filled from prefix lookup")
            elif row.get("fleet_type_source") == "description":
                cleaning_notes.append("Fleet type filled from description")

            if row["fleet_number"] in SPECIFIC_FIXES:
                cleaning_notes.append(f"Specific fix applied: {SPECIFIC_FIXES[row['fleet_number']]}")

            record = {
                "fleet_number": row["fleet_number"],
                "description": row.get("description"),
                "fleet_type": row.get("fleet_type"),
                "fleet_type_source": row.get("fleet_type_source"),
                "make": row.get("make"),
                "model": row.get("model"),
                "chassis_number": row.get("chassis_number"),
                "year_of_manufacture": int(row["year_of_manufacture"]) if pd.notna(row.get("year_of_manufacture")) else None,
                "purchase_cost": float(row["purchase_cost"]) if pd.notna(row.get("purchase_cost")) else None,
                "serial_m": row.get("serial_m"),
                "serial_e": row.get("serial_e"),
                "raw_data": raw_data,
                "cleaning_notes": cleaning_notes if cleaning_notes else None,
            }
            records.append(record)

        # Insert in batches
        batch_size = 100
        for i in range(0, len(records), batch_size):
            batch = records[i:i + batch_size]
            try:
                self.supabase.table("archived_plants").insert(batch).execute()
                self.stats.rows_loaded += len(batch)
            except Exception as e:
                self.stats.errors.append(f"Batch {i//batch_size + 1}: {str(e)}")


# ============================================================================
# Main
# ============================================================================

def main():
    """Run the archive ETL pipeline."""
    # Validate config
    errors = config.validate()
    if errors:
        print("Configuration errors:")
        for e in errors:
            print(f"  - {e}")
        return

    # Create Supabase client
    supabase = create_client(config.supabase_url, config.supabase_key)

    # Run ETL
    etl = ArchiveETL(supabase)
    stats = etl.run(config.legacy_file)

    print("\nDone!")


if __name__ == "__main__":
    main()
