"""
Data cleaning and normalization functions.

Handles:
- Fleet number normalization (AC10 format, no spaces)
- Location name normalization
- Column name mapping
- Date parsing
- Cost cleaning
- Physical verification derivation
"""

import re
import pandas as pd
from typing import Optional, Any
from datetime import datetime


# =============================================================================
# FLEET NUMBER NORMALIZATION
# =============================================================================

def normalize_fleet_number(value: Any) -> Optional[str]:
    """
    Normalize fleet number to uppercase with no spaces.

    Examples:
        "AC 10"   -> "AC10"
        "ac  10"  -> "AC10"
        " PT 169" -> "PT169"
        "T 385"   -> "T385"

    Returns None if value is empty/null.
    """
    if pd.isna(value) or value is None:
        return None

    # Convert to string and clean
    s = str(value).strip().upper()

    if not s:
        return None

    # Remove all spaces
    s = re.sub(r'\s+', '', s)

    return s if s else None


# =============================================================================
# LOCATION NORMALIZATION
# =============================================================================

def normalize_location(value: Any) -> Optional[str]:
    """
    Normalize location name.

    - Trim whitespace
    - Convert to uppercase
    - Normalize multiple spaces to single space

    Returns None if value is empty/null.
    """
    if pd.isna(value) or value is None:
        return None

    s = str(value).strip().upper()

    if not s:
        return None

    # Normalize multiple spaces
    s = re.sub(r'\s+', ' ', s)

    return s


# =============================================================================
# COLUMN NAME MAPPING
# =============================================================================

# Spare parts date column variations
SPARE_PARTS_DATE_COLUMNS = {
    "date replaced",
    "p o-date",
    "po - date",
    "po -date",
    "po date",
    "p o -date",
    "po - date ",
    "po -date ",
    "po date ",
    "p o -date ",
    "p o-date ",
}

# Spare parts column mapping
SPARE_PARTS_COLUMN_MAP = {
    # Date columns -> replaced_date
    **{col: "replaced_date" for col in SPARE_PARTS_DATE_COLUMNS},

    # Other columns
    "equipment          i.d": "equipment_type",
    "equipment          type": "equipment_type",
    "equipment type": "equipment_type",
    "part   number": "part_number",
    "part number": "part_number",
    "supplier": "supplier",
    "sparepart description": "part_description",
    "spare part description": "part_description",
    "reason for  change (wear, damage, preventive schedule)": "reason_for_change",
    "reason for  change (wear, damage, preventive schedule) maintainance": "reason_for_change",
    "reason for change (wear, damage, preventive schedule)": "reason_for_change",
    "reason for change": "reason_for_change",
    "cost of spare parts": "unit_cost",
    "cost of spareparts": "unit_cost",
    "cost": "unit_cost",
    "quantity used": "quantity",
    "quantity": "quantity",
    "work order job number": "purchase_order_number",
    "work order number": "purchase_order_number",
    "location": "location",
    "remarks": "remarks",
    "remark": "remarks",
}

# Legacy plant column mapping
LEGACY_COLUMN_MAP = {
    "fleetnumber": "fleet_number",
    "fleetdescription": "description",
    "fleettypedescription": "fleet_type",
    "make": "make",
    "model": "model",
    "chasisnumber": "chassis_number",
    "location": "location",
    "yearofmanufacture": "year_of_manufacture",
    "mserialnumber": "serial_m",
    "eserialnumber": "serial_e",
}

# Weekly report column mapping
WEEKLY_COLUMN_MAP = {
    "s/no": "row_num",
    "s/no.": "row_num",
    "fleetnumber": "fleet_number",
    "fleetdescription": "description",
    "hours worked": "hours_worked",
    "s/b hour": "standby_hours",
    "standyby": "standby_hours",
    "b/d hour": "breakdown_hours",
    "off hire": "off_hire",
    "transf. from": "transfer_from",
    "transf. to": "transfer_to",
    "remark": "remarks",
    "physical plant\nverification": "physical_verification",
    "physical plant verification": "physical_verification",
}


def normalize_column_name(col: str) -> str:
    """Normalize a column name for mapping lookup."""
    return str(col).lower().strip()


def map_columns(df: pd.DataFrame, mapping: dict) -> pd.DataFrame:
    """
    Map DataFrame columns using provided mapping.
    Columns not in mapping are kept with normalized names.
    """
    new_columns = {}
    for col in df.columns:
        normalized = normalize_column_name(col)
        if normalized in mapping:
            new_columns[col] = mapping[normalized]
        else:
            # Keep original but clean it
            new_columns[col] = re.sub(r'[^a-z0-9_]', '_', normalized)

    return df.rename(columns=new_columns)


# =============================================================================
# DATE PARSING
# =============================================================================

def parse_date(value: Any) -> Optional[str]:
    """
    Parse date value to YYYY-MM-DD string.
    Handles multiple formats with dayfirst=True for DD/MM/YYYY.

    Returns None if unparseable.
    """
    if pd.isna(value) or value is None:
        return None

    try:
        # If already a datetime/timestamp
        if isinstance(value, (datetime, pd.Timestamp)):
            return value.strftime("%Y-%m-%d")

        # Try parsing string
        s = str(value).strip()
        if not s:
            return None

        # Parse with dayfirst for DD/MM/YYYY format
        parsed = pd.to_datetime(s, dayfirst=True, errors="coerce")
        if pd.notna(parsed):
            return parsed.strftime("%Y-%m-%d")

        return None

    except Exception:
        return None


def parse_week_ending_date(value: Any) -> Optional[str]:
    """
    Parse week ending date from report metadata.
    Handles formats like "25-Jan-26" or datetime objects.
    """
    return parse_date(value)


# =============================================================================
# COST CLEANING
# =============================================================================

def clean_cost(value: Any) -> Optional[float]:
    """
    Clean cost value.
    - Remove currency symbols (₦, $, N)
    - Remove commas
    - Convert to float

    Returns None if invalid.
    """
    if pd.isna(value) or value is None:
        return None

    try:
        # If already numeric
        if isinstance(value, (int, float)):
            return float(value) if value >= 0 else None

        # Clean string
        s = str(value).strip()
        if not s:
            return None

        # Remove currency symbols and commas
        s = re.sub(r'[₦$N,\s]', '', s)

        # Convert to float
        result = float(s)
        return result if result >= 0 else None

    except (ValueError, TypeError):
        return None


def clean_quantity(value: Any) -> Optional[int]:
    """
    Clean quantity value.
    Returns None if invalid or <= 0.
    """
    if pd.isna(value) or value is None:
        return None

    try:
        qty = int(float(value))
        return qty if qty > 0 else None
    except (ValueError, TypeError):
        return None


def clean_year(value: Any) -> Optional[int]:
    """
    Clean year of manufacture.
    Valid range: 1900-2100.
    """
    if pd.isna(value) or value is None:
        return None

    try:
        year = int(float(value))
        return year if 1900 <= year <= 2100 else None
    except (ValueError, TypeError):
        return None


# =============================================================================
# PHYSICAL VERIFICATION DERIVATION
# =============================================================================

NEGATIVE_INDICATORS = [
    "MISSING",
    "NOT FOUND",
    "NOT SEEN",
    "N/A",
    "UNAVAILABLE",
    "UNKNOWN",
]


def derive_physical_verification(
    verification_value: Any,
    remarks_value: Any
) -> bool:
    """
    Derive physical verification status.

    Rules:
    1. If verification column has "P" -> True
    2. Else if remarks has non-negative content -> True
    3. Else -> False
    """
    # Check direct verification column
    if pd.notna(verification_value):
        v = str(verification_value).strip().upper()
        if v == "P":
            return True

    # Check remarks
    if pd.notna(remarks_value):
        remarks = str(remarks_value).strip().upper()
        if remarks:
            # Check for negative indicators
            for neg in NEGATIVE_INDICATORS:
                if neg in remarks:
                    return False
            # Has non-negative remarks -> verified
            return True

    return False


# =============================================================================
# FLEET NUMBER EXTRACTION FROM SHEET NAME
# =============================================================================

def extract_fleet_from_sheet_name(sheet_name: str) -> Optional[str]:
    """
    Extract fleet number from spare parts sheet name.

    Examples:
        "SparepartLogT385"  -> "T385"
        "SparePartLogPT169" -> "PT169"
        "ParePartLogT574"   -> "T574"
        "SparePartEG191"    -> "EG191"
    """
    # Remove common prefixes
    patterns = [
        r"^[Ss]pare[Pp]art[Ll]og",
        r"^[Pp]are[Pp]art[Ll]og",
        r"^[Ss]parepart",
        r"^[Ss]pare[Pp]art",
    ]

    result = sheet_name
    for pattern in patterns:
        result = re.sub(pattern, "", result)

    # Clean up and normalize
    result = result.strip()
    if result:
        return normalize_fleet_number(result)

    return None
