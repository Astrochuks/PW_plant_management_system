"""
Column name mappings for normalizing inconsistent Excel column headers.

This module handles the various column name variations found across different
Excel files and sheets, mapping them to standardized column names.
"""

from typing import Dict, Set


# =====================================================
# SPARE PARTS COLUMN MAPPINGS
# =====================================================

# Date column variations -> 'replaced_date'
SPARE_PARTS_DATE_COLUMNS: Set[str] = {
    "date replaced",
    "p o-date",
    "po - date",
    "po -date",
    "po date",
    "p o -date",
    "p o-date",
    # With trailing spaces
    "po - date ",
    "po -date ",
    "po date ",
    "p o -date ",
    "p o-date ",
}

# Equipment column variations -> 'equipment_type'
SPARE_PARTS_EQUIPMENT_COLUMNS: Set[str] = {
    "equipment          i.d",
    "equipment          type",
    "equipment i.d",
    "equipment type",
    "equipment id",
}

# Reason column variations -> 'reason_for_change'
SPARE_PARTS_REASON_COLUMNS: Set[str] = {
    "reason for  change (wear, damage, preventive schedule)",
    "reason for  change (wear, damage, preventive schedule) maintainance",
    "reason for change (wear, damage, preventive schedule)",
    "reason for change",
}

# Work order column variations -> 'purchase_order_number'
SPARE_PARTS_WORK_ORDER_COLUMNS: Set[str] = {
    "work order job number",
    "work order number",
    "job number",
    "po number",
}

# Complete mapping for spare parts normalization
SPARE_PARTS_COLUMN_MAP: Dict[str, str] = {
    # Date columns
    **{col: "replaced_date" for col in SPARE_PARTS_DATE_COLUMNS},

    # Equipment columns
    **{col: "equipment_type" for col in SPARE_PARTS_EQUIPMENT_COLUMNS},

    # Reason columns
    **{col: "reason_for_change" for col in SPARE_PARTS_REASON_COLUMNS},

    # Work order columns
    **{col: "purchase_order_number" for col in SPARE_PARTS_WORK_ORDER_COLUMNS},

    # Standard columns (just normalize casing/spacing)
    "part   number": "part_number",
    "part number": "part_number",
    "supplier": "supplier",
    "sparepart description": "description",
    "spare part description": "description",
    "cost of spare parts": "cost",
    "cost of spareparts": "cost",
    "cost": "cost",
    "quantity used": "quantity_used",
    "quantity": "quantity_used",
    "location": "location",
    "remarks": "remarks",
    "remark": "remarks",
}


# =====================================================
# NEW PLANTS COLUMN MAPPINGS
# =====================================================

# S/NO variations -> 's_no'
NEW_PLANTS_SNO_COLUMNS: Set[str] = {
    "s/no",
    "s/no.",
    "sno",
    "s.no",
    "serial",
}

# Standby hours variations -> 'standby_hours'
NEW_PLANTS_STANDBY_COLUMNS: Set[str] = {
    "s/b hour",
    "s/b hours",
    "standby",
    "standy by",
    "standyby",
}

# Complete mapping for new plants normalization
NEW_PLANTS_COLUMN_MAP: Dict[str, str] = {
    # S/NO columns
    **{col: "s_no" for col in NEW_PLANTS_SNO_COLUMNS},

    # Standby columns
    **{col: "standby_hours" for col in NEW_PLANTS_STANDBY_COLUMNS},

    # Standard columns
    "fleetnumber": "fleet_number",
    "fleet number": "fleet_number",
    "fleetdescription": "description",
    "fleet description": "description",
    "hours worked": "hours_worked",
    "b/d hour": "breakdown_hours",
    "b/d hours": "breakdown_hours",
    "breakdown hour": "breakdown_hours",
    "off hire": "off_hire",
    "transf. from": "transfer_from",
    "transfer from": "transfer_from",
    "transf. to": "transfer_to",
    "transfer to": "transfer_to",
    "remark": "remark",
    "remarks": "remark",
    "physical plant\nverification": "physical_verification",
    "physical plant verification": "physical_verification",
    "p": "verification_p",
    "o": "verification_o",
}


# =====================================================
# LEGACY PLANTS COLUMN MAPPINGS
# =====================================================

LEGACY_PLANTS_COLUMN_MAP: Dict[str, str] = {
    "fleetnumber": "fleet_number",
    "fleet number": "fleet_number",
    "fleetdescription": "description",
    "fleet description": "description",
    "fleettypedescription": "fleet_type",
    "fleet type description": "fleet_type",
    "fleet type": "fleet_type",
    "make": "make",
    "model": "model",
    "chasisnumber": "chassis_number",
    "chasis number": "chassis_number",
    "chassis number": "chassis_number",
    "location": "location",
    "yearofmanufacture": "year_of_manufacture",
    "year of manufacture": "year_of_manufacture",
    "year": "year_of_manufacture",
    "mserialnumber": "serial_m",
    "m serial number": "serial_m",
    "eserialnumber": "serial_e",
    "e serial number": "serial_e",
}


def normalize_column_name(col: str, mapping: Dict[str, str]) -> str:
    """
    Normalize a column name using the provided mapping.

    Args:
        col: Original column name
        mapping: Dictionary mapping original names to normalized names

    Returns:
        Normalized column name, or original if no mapping found
    """
    # Clean the column name
    cleaned = str(col).lower().strip()

    # Try direct lookup
    if cleaned in mapping:
        return mapping[cleaned]

    # Try without extra spaces
    no_extra_spaces = " ".join(cleaned.split())
    if no_extra_spaces in mapping:
        return mapping[no_extra_spaces]

    # Return original if no mapping found
    return cleaned.replace(" ", "_").replace("/", "_").replace(".", "")


def normalize_dataframe_columns(df, mapping: Dict[str, str]):
    """
    Normalize all column names in a DataFrame.

    Args:
        df: pandas DataFrame
        mapping: Column name mapping dictionary

    Returns:
        DataFrame with normalized column names
    """
    new_columns = {}
    for col in df.columns:
        new_columns[col] = normalize_column_name(col, mapping)

    return df.rename(columns=new_columns)
