"""
Data processors for transforming Excel data into database-ready format.

Handles:
- Extracting data from Excel files
- Cleaning and normalizing data
- Physical verification logic
- Merging current and legacy data
"""

import re
import pandas as pd
import numpy as np
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Set
from dataclasses import dataclass

from .column_mappings import (
    normalize_dataframe_columns,
    SPARE_PARTS_COLUMN_MAP,
    NEW_PLANTS_COLUMN_MAP,
    LEGACY_PLANTS_COLUMN_MAP,
)


@dataclass
class ProcessingResult:
    """Result of a processing operation."""
    success: bool
    data: Optional[pd.DataFrame]
    errors: List[str]
    warnings: List[str]
    stats: Dict[str, int]


class PlantProcessor:
    """Processes plant data from Excel files."""

    def __init__(self, debug: bool = False):
        self.debug = debug
        self.errors: List[str] = []
        self.warnings: List[str] = []

    def _log(self, message: str, level: str = "INFO"):
        """Log a message if debug is enabled."""
        if self.debug:
            print(f"[{level}] {message}")

    def _clean_fleet_number(self, fleet_num: str) -> str:
        """Normalize fleet number format."""
        if pd.isna(fleet_num):
            return ""

        # Convert to string and strip whitespace
        cleaned = str(fleet_num).strip().upper()

        # Remove extra spaces but keep single space between parts
        cleaned = " ".join(cleaned.split())

        return cleaned

    def _determine_physical_verification(
        self, row: pd.Series, has_verification_col: bool
    ) -> bool:
        """
        Determine physical verification status based on available data.

        Logic:
        - If physical_verification column exists and has value 'P' -> True
        - If no verification column but remark is non-empty -> True
        - Otherwise -> False
        """
        # Check direct verification column
        if has_verification_col:
            verification = row.get("physical_verification", "")
            if pd.notna(verification) and str(verification).strip().upper() == "P":
                return True

        # Check verification_p column (some files have this)
        verification_p = row.get("verification_p", "")
        if pd.notna(verification_p) and str(verification_p).strip():
            return True

        # Fall back to remark column
        remark = row.get("remark", "")
        if pd.notna(remark) and str(remark).strip():
            # Non-empty remark indicates the plant was seen/verified
            remark_str = str(remark).strip().upper()
            # Check for negative indicators
            negative_indicators = ["MISSING", "NOT FOUND", "NOT SEEN", "N/A"]
            if any(neg in remark_str for neg in negative_indicators):
                return False
            return True

        return False

    def _extract_site_from_file(self, df_raw: pd.DataFrame, filename: str) -> str:
        """Extract site/location name from the Excel file metadata rows."""
        # Try to find site in first few rows
        for i in range(min(3, len(df_raw))):
            row = df_raw.iloc[i].tolist()
            for j, val in enumerate(row):
                if isinstance(val, str) and "SITE LOCATION" in val.upper():
                    # Site name is in the next non-null column
                    for k in range(j + 1, len(row)):
                        if pd.notna(row[k]) and isinstance(row[k], str):
                            site = row[k].strip()
                            # Skip if it's still part of the header
                            if "SITE" not in site.upper() and len(site) > 2:
                                return site
                            break

        # Fall back to extracting from filename
        # Remove "WEEK X.xlsx" pattern
        site = re.sub(r"\s*WEEK\s*\d+\.xlsx$", "", filename, flags=re.IGNORECASE)
        return site.strip()

    def process_new_plants(self, new_plants_dir: Path) -> ProcessingResult:
        """
        Process all current plant files from the new plants directory.

        Returns combined DataFrame with normalized columns and site information.
        """
        self._log(f"Processing new plants from: {new_plants_dir}")

        all_plants = []
        stats = {"files_processed": 0, "plants_found": 0, "errors": 0}

        for file_path in sorted(new_plants_dir.glob("*.xlsx")):
            try:
                self._log(f"Processing: {file_path.name}")

                # Read raw to extract site info
                df_raw = pd.read_excel(file_path, sheet_name="Sheet1", header=None)

                # Extract site name
                site = self._extract_site_from_file(df_raw, file_path.name)
                self._log(f"  Site: {site}")

                # Read with header at row 3
                df = pd.read_excel(file_path, sheet_name="Sheet1", header=3)

                # Normalize columns
                df = normalize_dataframe_columns(df, NEW_PLANTS_COLUMN_MAP)

                # Skip if no fleet_number column
                if "fleet_number" not in df.columns:
                    self.warnings.append(
                        f"No fleet_number column in {file_path.name}"
                    )
                    continue

                # Check if physical_verification column exists
                has_verification_col = "physical_verification" in df.columns

                # Process each row
                plants = []
                for _, row in df.iterrows():
                    fleet_num = self._clean_fleet_number(row.get("fleet_number", ""))
                    if not fleet_num:
                        continue

                    # Determine physical verification
                    verified = self._determine_physical_verification(
                        row, has_verification_col
                    )

                    plant = {
                        "fleet_number": fleet_num,
                        "description": str(row.get("description", "")).strip()
                        if pd.notna(row.get("description"))
                        else None,
                        "location": site,
                        "physical_verification": verified,
                        "remark": str(row.get("remark", "")).strip()
                        if pd.notna(row.get("remark"))
                        else None,
                        "source": "current",
                        "is_active": True,
                    }
                    plants.append(plant)

                all_plants.extend(plants)
                stats["files_processed"] += 1
                stats["plants_found"] += len(plants)
                self._log(f"  Found {len(plants)} plants")

            except Exception as e:
                self.errors.append(f"Error processing {file_path.name}: {str(e)}")
                stats["errors"] += 1

        # Create DataFrame and deduplicate by fleet_number
        if all_plants:
            df_result = pd.DataFrame(all_plants)
            # Keep first occurrence (we'll merge later if needed)
            df_result = df_result.drop_duplicates(subset=["fleet_number"], keep="first")
            stats["unique_plants"] = len(df_result)
        else:
            df_result = pd.DataFrame()

        return ProcessingResult(
            success=stats["errors"] == 0,
            data=df_result,
            errors=self.errors.copy(),
            warnings=self.warnings.copy(),
            stats=stats,
        )

    def process_legacy_plants(self, legacy_file: Path) -> ProcessingResult:
        """
        Process legacy plant data from Plant List 2021.xlsx.

        Returns DataFrame with normalized columns.
        """
        self._log(f"Processing legacy plants from: {legacy_file}")

        stats = {"plants_found": 0, "errors": 0}

        try:
            # Read with header at row 3
            df = pd.read_excel(
                legacy_file, sheet_name="Plants & Equipment", header=3
            )

            # Normalize columns
            df = normalize_dataframe_columns(df, LEGACY_PLANTS_COLUMN_MAP)

            # Process each row
            plants = []
            for _, row in df.iterrows():
                fleet_num = self._clean_fleet_number(row.get("fleet_number", ""))
                if not fleet_num:
                    continue

                # Handle year of manufacture
                year = row.get("year_of_manufacture")
                if pd.notna(year):
                    try:
                        year = int(float(year))
                        if year < 1900 or year > 2030:
                            year = None
                    except (ValueError, TypeError):
                        year = None
                else:
                    year = None

                plant = {
                    "fleet_number": fleet_num,
                    "description": str(row.get("description", "")).strip()
                    if pd.notna(row.get("description"))
                    else None,
                    "fleet_type": str(row.get("fleet_type", "")).strip()
                    if pd.notna(row.get("fleet_type"))
                    else None,
                    "make": str(row.get("make", "")).strip()
                    if pd.notna(row.get("make"))
                    else None,
                    "model": str(row.get("model", "")).strip()
                    if pd.notna(row.get("model"))
                    else None,
                    "location": str(row.get("location", "")).strip()
                    if pd.notna(row.get("location"))
                    else None,
                    "chassis_number": str(row.get("chassis_number", "")).strip()
                    if pd.notna(row.get("chassis_number"))
                    else None,
                    "year_of_manufacture": year,
                    "serial_m": str(row.get("serial_m", "")).strip()
                    if pd.notna(row.get("serial_m"))
                    else None,
                    "serial_e": str(row.get("serial_e", "")).strip()
                    if pd.notna(row.get("serial_e"))
                    else None,
                    "source": "legacy",
                    "is_active": False,  # Will be updated during merge
                }
                plants.append(plant)

            df_result = pd.DataFrame(plants)
            df_result = df_result.drop_duplicates(subset=["fleet_number"], keep="first")
            stats["plants_found"] = len(df_result)

            self._log(f"Found {len(df_result)} legacy plants")

        except Exception as e:
            self.errors.append(f"Error processing legacy file: {str(e)}")
            stats["errors"] += 1
            df_result = pd.DataFrame()

        return ProcessingResult(
            success=stats["errors"] == 0,
            data=df_result,
            errors=self.errors.copy(),
            warnings=self.warnings.copy(),
            stats=stats,
        )

    def merge_plant_data(
        self, current_df: pd.DataFrame, legacy_df: pd.DataFrame
    ) -> ProcessingResult:
        """
        Merge current and legacy plant data.

        Rules:
        - Current data takes precedence for all fields
        - Legacy data fills in missing columns for plants that exist in current
        - Legacy location does NOT override current location
        - Plants only in legacy are kept as history (is_active=False)
        """
        self._log("Merging current and legacy plant data")

        stats = {
            "current_only": 0,
            "legacy_only": 0,
            "merged": 0,
            "total": 0,
        }

        current_fleet_nums = set(current_df["fleet_number"].unique())
        legacy_fleet_nums = set(legacy_df["fleet_number"].unique())

        merged_plants = []

        # Process current plants (these take precedence)
        for _, current_row in current_df.iterrows():
            fleet_num = current_row["fleet_number"]
            plant = current_row.to_dict()

            # Check if exists in legacy
            legacy_match = legacy_df[legacy_df["fleet_number"] == fleet_num]

            if not legacy_match.empty:
                legacy_row = legacy_match.iloc[0]
                stats["merged"] += 1

                # Fill missing fields from legacy (except location)
                fields_to_fill = [
                    "fleet_type",
                    "make",
                    "model",
                    "chassis_number",
                    "year_of_manufacture",
                ]
                for field in fields_to_fill:
                    if pd.isna(plant.get(field)) or plant.get(field) is None:
                        legacy_val = legacy_row.get(field)
                        if pd.notna(legacy_val):
                            plant[field] = legacy_val
            else:
                stats["current_only"] += 1

            # Ensure current data stays current
            plant["source"] = "current"
            plant["is_active"] = True
            merged_plants.append(plant)

        # Add legacy-only plants as historical records
        legacy_only = legacy_df[~legacy_df["fleet_number"].isin(current_fleet_nums)]
        for _, legacy_row in legacy_only.iterrows():
            plant = legacy_row.to_dict()
            plant["source"] = "legacy"
            plant["is_active"] = False
            plant["physical_verification"] = False
            merged_plants.append(plant)
            stats["legacy_only"] += 1

        df_result = pd.DataFrame(merged_plants)
        stats["total"] = len(df_result)

        self._log(
            f"Merge complete: {stats['current_only']} current-only, "
            f"{stats['legacy_only']} legacy-only, {stats['merged']} merged"
        )

        return ProcessingResult(
            success=True,
            data=df_result,
            errors=[],
            warnings=[],
            stats=stats,
        )


class SparePartsProcessor:
    """Processes spare parts data from Excel files."""

    def __init__(self, debug: bool = False):
        self.debug = debug
        self.errors: List[str] = []
        self.warnings: List[str] = []

    def _log(self, message: str, level: str = "INFO"):
        """Log a message if debug is enabled."""
        if self.debug:
            print(f"[{level}] {message}")

    def _extract_fleet_number_from_sheet(self, sheet_name: str) -> str:
        """
        Extract fleet number from spare parts sheet name.

        Examples:
        - SparepartLogT385 -> T385
        - SparePartLogPT169 -> PT169
        - ParePartLogT574 -> T574
        """
        # Pattern to match various sheet naming conventions
        pattern = r"(?:Spare[Pp]art[Ll]og|Pare[Pp]art[Ll]og|Sparepart)([A-Z]+\d+)"
        match = re.search(pattern, sheet_name)

        if match:
            return match.group(1).upper()

        return ""

    def _clean_date(self, date_val) -> Optional[str]:
        """Clean and validate date value."""
        if pd.isna(date_val):
            return None

        try:
            if isinstance(date_val, pd.Timestamp):
                return date_val.strftime("%Y-%m-%d")
            elif isinstance(date_val, str):
                # Try to parse string date with dayfirst=True for DD/MM/YYYY format
                parsed = pd.to_datetime(date_val, dayfirst=True, errors="coerce")
                if pd.notna(parsed):
                    return parsed.strftime("%Y-%m-%d")
            return None
        except Exception:
            return None

    def _clean_cost(self, cost_val) -> Optional[float]:
        """Clean and validate cost value."""
        if pd.isna(cost_val):
            return None

        try:
            # Remove currency symbols and commas
            if isinstance(cost_val, str):
                cost_val = re.sub(r"[₦$,\s]", "", cost_val)
            return float(cost_val)
        except (ValueError, TypeError):
            return None

    def _clean_quantity(self, qty_val) -> Optional[int]:
        """Clean and validate quantity value."""
        if pd.isna(qty_val):
            return None

        try:
            return int(float(qty_val))
        except (ValueError, TypeError):
            return None

    def process_spare_parts(self, spare_parts_file: Path) -> ProcessingResult:
        """
        Process spare parts data from all sheets.

        Returns combined DataFrame with normalized columns and fleet number links.
        """
        self._log(f"Processing spare parts from: {spare_parts_file}")

        all_parts = []
        stats = {"sheets_processed": 0, "parts_found": 0, "errors": 0, "skipped": 0}

        try:
            xl = pd.ExcelFile(spare_parts_file)

            for sheet_name in xl.sheet_names:
                try:
                    # Extract fleet number from sheet name
                    fleet_num = self._extract_fleet_number_from_sheet(sheet_name)

                    if not fleet_num:
                        self.warnings.append(
                            f"Could not extract fleet number from: {sheet_name}"
                        )
                        stats["skipped"] += 1
                        continue

                    self._log(f"Processing sheet: {sheet_name} -> {fleet_num}")

                    # Read sheet
                    df = pd.read_excel(xl, sheet_name=sheet_name)

                    # Skip empty sheets
                    if df.empty:
                        continue

                    # Normalize columns
                    df = normalize_dataframe_columns(df, SPARE_PARTS_COLUMN_MAP)

                    # Process each row
                    for _, row in df.iterrows():
                        # Skip rows that are completely empty or just headers
                        non_null_count = row.notna().sum()
                        if non_null_count < 3:
                            continue

                        part = {
                            "fleet_number": fleet_num,
                            "replaced_date": self._clean_date(
                                row.get("replaced_date")
                            ),
                            "part_number": str(row.get("part_number", "")).strip()
                            if pd.notna(row.get("part_number"))
                            else None,
                            "supplier": str(row.get("supplier", "")).strip()
                            if pd.notna(row.get("supplier"))
                            else None,
                            "description": str(row.get("description", "")).strip()
                            if pd.notna(row.get("description"))
                            else None,
                            "reason_for_change": str(
                                row.get("reason_for_change", "")
                            ).strip()
                            if pd.notna(row.get("reason_for_change"))
                            else None,
                            "cost": self._clean_cost(row.get("cost")),
                            "quantity_used": self._clean_quantity(
                                row.get("quantity_used")
                            ),
                            "purchase_order_number": str(
                                row.get("purchase_order_number", "")
                            ).strip()
                            if pd.notna(row.get("purchase_order_number"))
                            else None,
                            "remarks": str(row.get("remarks", "")).strip()
                            if pd.notna(row.get("remarks"))
                            else None,
                        }

                        # Only add if we have at least some meaningful data
                        if any(
                            v is not None and v != ""
                            for k, v in part.items()
                            if k != "fleet_number"
                        ):
                            all_parts.append(part)

                    stats["sheets_processed"] += 1

                except Exception as e:
                    self.errors.append(f"Error processing sheet {sheet_name}: {str(e)}")
                    stats["errors"] += 1

        except Exception as e:
            self.errors.append(f"Error opening spare parts file: {str(e)}")
            stats["errors"] += 1

        df_result = pd.DataFrame(all_parts) if all_parts else pd.DataFrame()
        stats["parts_found"] = len(df_result)

        self._log(f"Found {stats['parts_found']} spare parts records")

        return ProcessingResult(
            success=stats["errors"] == 0,
            data=df_result,
            errors=self.errors.copy(),
            warnings=self.warnings.copy(),
            stats=stats,
        )
