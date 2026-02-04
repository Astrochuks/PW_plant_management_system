"""
Data extraction from Excel files.

Handles:
- Weekly plant reports (current data)
- Legacy plant list
- Spare parts tracking
"""

import pandas as pd
from pathlib import Path
from typing import Optional, Generator
from dataclasses import dataclass

from .config import ETLConfig
from .cleaners import (
    normalize_fleet_number,
    normalize_location,
    map_columns,
    parse_date,
    parse_week_ending_date,
    clean_cost,
    clean_quantity,
    clean_year,
    derive_physical_verification,
    extract_fleet_from_sheet_name,
    LEGACY_COLUMN_MAP,
    WEEKLY_COLUMN_MAP,
    SPARE_PARTS_COLUMN_MAP,
)


@dataclass
class ExtractedPlant:
    """Extracted and cleaned plant record."""
    fleet_number: str
    description: Optional[str]
    fleet_type: Optional[str]
    make: Optional[str]
    model: Optional[str]
    chassis_number: Optional[str]
    year_of_manufacture: Optional[int]
    purchase_cost: Optional[float]
    location: Optional[str]
    remarks: Optional[str]
    physical_verification: bool
    source: str  # 'current' or 'legacy'
    source_file: str


@dataclass
class ExtractedSparePart:
    """Extracted and cleaned spare part record."""
    fleet_number: str
    replaced_date: Optional[str]
    part_number: Optional[str]
    part_description: Optional[str]
    supplier: Optional[str]
    reason_for_change: Optional[str]
    unit_cost: Optional[float]
    quantity: Optional[int]
    purchase_order_number: Optional[str]
    remarks: Optional[str]
    source_sheet: str


@dataclass
class ExtractionResult:
    """Result of an extraction operation."""
    success: bool
    data: list
    errors: list[str]
    warnings: list[str]
    stats: dict


class WeeklyReportExtractor:
    """Extracts plant data from weekly report files."""

    def __init__(self, config: ETLConfig):
        self.config = config
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def _extract_metadata(self, df_raw: pd.DataFrame, filename: str) -> tuple[str, Optional[str]]:
        """Extract site location and week ending date from report metadata."""
        location = None
        week_ending = None

        try:
            # Row 0: Site location is typically in column after "SITE LOCATION"
            for i in range(min(4, len(df_raw))):
                row = df_raw.iloc[i].tolist()
                for j, val in enumerate(row):
                    if pd.notna(val):
                        val_str = str(val).upper()
                        if "SITE LOCATION" in val_str:
                            # Look for location in subsequent columns
                            for k in range(j + 1, len(row)):
                                if pd.notna(row[k]):
                                    loc = str(row[k]).strip()
                                    if loc and "SITE" not in loc.upper() and len(loc) > 2:
                                        location = normalize_location(loc)
                                        break
                        if "WEEKENDING" in val_str or "WEEK ENDING" in val_str:
                            # Look for date in subsequent columns
                            for k in range(j + 1, len(row)):
                                if pd.notna(row[k]):
                                    week_ending = parse_week_ending_date(row[k])
                                    break
        except Exception as e:
            self.warnings.append(f"Error extracting metadata from {filename}: {e}")

        # Fallback: extract location from filename
        if not location:
            import re
            location = re.sub(r'\s*WEEK\s*\d+\.xlsx$', '', filename, flags=re.IGNORECASE).strip()
            location = normalize_location(location)

        return location, week_ending

    def extract_file(self, file_path: Path) -> list[ExtractedPlant]:
        """Extract plants from a single weekly report file."""
        plants = []

        try:
            # Read raw for metadata
            df_raw = pd.read_excel(file_path, sheet_name=0, header=None)
            location, week_ending = self._extract_metadata(df_raw, file_path.name)

            if not location:
                self.warnings.append(f"Could not determine location for {file_path.name}")

            # Read with header at row 4 (0-indexed = 3)
            df = pd.read_excel(file_path, sheet_name=0, header=self.config.weekly_header_row)

            # Map columns
            df = map_columns(df, WEEKLY_COLUMN_MAP)

            # Check for fleet_number column
            if "fleet_number" not in df.columns:
                self.warnings.append(f"No fleet_number column in {file_path.name}")
                return plants

            # Process each row
            for _, row in df.iterrows():
                fleet_num = normalize_fleet_number(row.get("fleet_number"))
                if not fleet_num:
                    continue

                # Derive physical verification
                phys_verif = derive_physical_verification(
                    row.get("physical_verification"),
                    row.get("remarks")
                )

                plant = ExtractedPlant(
                    fleet_number=fleet_num,
                    description=str(row.get("description", "")).strip() or None
                        if pd.notna(row.get("description")) else None,
                    fleet_type=None,  # Not in weekly reports
                    make=None,
                    model=None,
                    chassis_number=None,
                    year_of_manufacture=None,
                    purchase_cost=None,
                    location=location,
                    remarks=str(row.get("remarks", "")).strip() or None
                        if pd.notna(row.get("remarks")) else None,
                    physical_verification=phys_verif,
                    source="current",
                    source_file=file_path.name,
                )
                plants.append(plant)

        except Exception as e:
            self.errors.append(f"Error processing {file_path.name}: {e}")

        return plants

    def extract_all(self) -> ExtractionResult:
        """Extract plants from all weekly report files."""
        all_plants = []
        stats = {"files_processed": 0, "plants_found": 0, "files_failed": 0}

        for file_path in sorted(self.config.weekly_reports_dir.glob("*.xlsx")):
            plants = self.extract_file(file_path)
            if plants:
                all_plants.extend(plants)
                stats["files_processed"] += 1
                stats["plants_found"] += len(plants)
            else:
                stats["files_failed"] += 1

        return ExtractionResult(
            success=len(self.errors) == 0,
            data=all_plants,
            errors=self.errors.copy(),
            warnings=self.warnings.copy(),
            stats=stats,
        )


class LegacyPlantExtractor:
    """Extracts plant data from legacy Plant List 2021."""

    def __init__(self, config: ETLConfig):
        self.config = config
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def extract(self) -> ExtractionResult:
        """Extract plants from legacy file."""
        plants = []
        stats = {"plants_found": 0}

        try:
            df = pd.read_excel(
                self.config.legacy_file,
                sheet_name="Plants & Equipment",
                header=self.config.legacy_header_row
            )

            # Map columns
            df = map_columns(df, LEGACY_COLUMN_MAP)

            for _, row in df.iterrows():
                fleet_num = normalize_fleet_number(row.get("fleet_number"))
                if not fleet_num:
                    continue

                plant = ExtractedPlant(
                    fleet_number=fleet_num,
                    description=str(row.get("description", "")).strip() or None
                        if pd.notna(row.get("description")) else None,
                    fleet_type=str(row.get("fleet_type", "")).strip().upper() or None
                        if pd.notna(row.get("fleet_type")) else None,
                    make=str(row.get("make", "")).strip() or None
                        if pd.notna(row.get("make")) else None,
                    model=str(row.get("model", "")).strip() or None
                        if pd.notna(row.get("model")) else None,
                    chassis_number=str(row.get("chassis_number", "")).strip() or None
                        if pd.notna(row.get("chassis_number")) else None,
                    year_of_manufacture=clean_year(row.get("year_of_manufacture")),
                    purchase_cost=clean_cost(row.get("purchase_cost")),
                    location=normalize_location(row.get("location")),
                    remarks=None,
                    physical_verification=False,  # Legacy data - not verified
                    source="legacy",
                    source_file="Plant List 2021.xlsx",
                )
                plants.append(plant)

            stats["plants_found"] = len(plants)

        except Exception as e:
            self.errors.append(f"Error processing legacy file: {e}")

        return ExtractionResult(
            success=len(self.errors) == 0,
            data=plants,
            errors=self.errors.copy(),
            warnings=self.warnings.copy(),
            stats=stats,
        )


class SparePartsExtractor:
    """Extracts spare parts data from tracking file."""

    def __init__(self, config: ETLConfig):
        self.config = config
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def extract(self) -> ExtractionResult:
        """Extract spare parts from all sheets."""
        parts = []
        stats = {"sheets_processed": 0, "parts_found": 0, "sheets_skipped": 0}

        try:
            xl = pd.ExcelFile(self.config.spare_parts_file)

            for sheet_name in xl.sheet_names:
                # Extract fleet number from sheet name
                fleet_num = extract_fleet_from_sheet_name(sheet_name)

                if not fleet_num:
                    self.warnings.append(f"Could not extract fleet number from sheet: {sheet_name}")
                    stats["sheets_skipped"] += 1
                    continue

                try:
                    df = pd.read_excel(
                        xl,
                        sheet_name=sheet_name,
                        header=self.config.spare_parts_header_row
                    )

                    if df.empty:
                        continue

                    # Map columns
                    df = map_columns(df, SPARE_PARTS_COLUMN_MAP)

                    for _, row in df.iterrows():
                        # Skip mostly empty rows
                        non_null = row.notna().sum()
                        if non_null < 3:
                            continue

                        part = ExtractedSparePart(
                            fleet_number=fleet_num,
                            replaced_date=parse_date(row.get("replaced_date")),
                            part_number=str(row.get("part_number", "")).strip() or None
                                if pd.notna(row.get("part_number")) else None,
                            part_description=str(row.get("part_description", "")).strip() or None
                                if pd.notna(row.get("part_description")) else None,
                            supplier=str(row.get("supplier", "")).strip() or None
                                if pd.notna(row.get("supplier")) else None,
                            reason_for_change=str(row.get("reason_for_change", "")).strip() or None
                                if pd.notna(row.get("reason_for_change")) else None,
                            unit_cost=clean_cost(row.get("unit_cost")),
                            quantity=clean_quantity(row.get("quantity")) or 1,
                            purchase_order_number=str(row.get("purchase_order_number", "")).strip() or None
                                if pd.notna(row.get("purchase_order_number")) else None,
                            remarks=str(row.get("remarks", "")).strip() or None
                                if pd.notna(row.get("remarks")) else None,
                            source_sheet=sheet_name,
                        )

                        # Only add if has some meaningful data
                        if part.replaced_date or part.part_description or part.unit_cost:
                            parts.append(part)

                    stats["sheets_processed"] += 1

                except Exception as e:
                    self.warnings.append(f"Error processing sheet {sheet_name}: {e}")

            stats["parts_found"] = len(parts)

        except Exception as e:
            self.errors.append(f"Error opening spare parts file: {e}")

        return ExtractionResult(
            success=len(self.errors) == 0,
            data=parts,
            errors=self.errors.copy(),
            warnings=self.warnings.copy(),
            stats=stats,
        )
