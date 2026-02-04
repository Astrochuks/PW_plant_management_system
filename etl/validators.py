"""
Data validation functions.

Validates extracted data before loading to database.
"""

from dataclasses import dataclass
from typing import Optional
from collections import Counter

from .extractors import ExtractedPlant, ExtractedSparePart


@dataclass
class ValidationResult:
    """Result of validation."""
    valid: bool
    errors: list[str]
    warnings: list[str]
    stats: dict


class PlantValidator:
    """Validates extracted plant data."""

    def __init__(self):
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def validate(self, plants: list[ExtractedPlant]) -> ValidationResult:
        """Validate a list of plants."""
        stats = {
            "total": len(plants),
            "valid": 0,
            "invalid": 0,
            "duplicates": 0,
        }

        # Check for duplicates
        fleet_numbers = [p.fleet_number for p in plants]
        duplicates = [fn for fn, count in Counter(fleet_numbers).items() if count > 1]

        if duplicates:
            stats["duplicates"] = len(duplicates)
            self.warnings.append(
                f"Found {len(duplicates)} duplicate fleet numbers: {duplicates[:10]}"
                + ("..." if len(duplicates) > 10 else "")
            )

        # Validate each plant
        for plant in plants:
            issues = self._validate_plant(plant)
            if issues:
                stats["invalid"] += 1
                for issue in issues:
                    self.warnings.append(f"Plant {plant.fleet_number}: {issue}")
            else:
                stats["valid"] += 1

        return ValidationResult(
            valid=len(self.errors) == 0,
            errors=self.errors.copy(),
            warnings=self.warnings.copy(),
            stats=stats,
        )

    def _validate_plant(self, plant: ExtractedPlant) -> list[str]:
        """Validate a single plant. Returns list of issues."""
        issues = []

        # Fleet number is required
        if not plant.fleet_number:
            issues.append("Missing fleet_number")

        # Year validation
        if plant.year_of_manufacture is not None:
            if plant.year_of_manufacture < 1900 or plant.year_of_manufacture > 2100:
                issues.append(f"Invalid year: {plant.year_of_manufacture}")

        # Cost validation
        if plant.purchase_cost is not None and plant.purchase_cost < 0:
            issues.append(f"Negative cost: {plant.purchase_cost}")

        return issues


class SparePartValidator:
    """Validates extracted spare part data."""

    def __init__(self):
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def validate(self, parts: list[ExtractedSparePart]) -> ValidationResult:
        """Validate a list of spare parts."""
        stats = {
            "total": len(parts),
            "valid": 0,
            "invalid": 0,
            "missing_date": 0,
            "missing_cost": 0,
        }

        for part in parts:
            issues = self._validate_part(part)
            if issues:
                stats["invalid"] += 1
            else:
                stats["valid"] += 1

            if not part.replaced_date:
                stats["missing_date"] += 1
            if not part.unit_cost:
                stats["missing_cost"] += 1

        return ValidationResult(
            valid=len(self.errors) == 0,
            errors=self.errors.copy(),
            warnings=self.warnings.copy(),
            stats=stats,
        )

    def _validate_part(self, part: ExtractedSparePart) -> list[str]:
        """Validate a single spare part. Returns list of issues."""
        issues = []

        # Fleet number is required
        if not part.fleet_number:
            issues.append("Missing fleet_number")

        # Quantity must be positive
        if part.quantity is not None and part.quantity <= 0:
            issues.append(f"Invalid quantity: {part.quantity}")

        # Cost must be non-negative
        if part.unit_cost is not None and part.unit_cost < 0:
            issues.append(f"Negative cost: {part.unit_cost}")

        return issues
