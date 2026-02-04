"""
Data loading to Supabase.

Handles:
- Fleet type normalization (create if not exists)
- Location normalization (create if not exists)
- Plant upsert with merge logic (current takes precedence)
- Location history creation
- Spare parts loading
"""

from dataclasses import dataclass
from typing import Optional
from supabase import create_client, Client

from .config import ETLConfig
from .extractors import ExtractedPlant, ExtractedSparePart


@dataclass
class LoadResult:
    """Result of a load operation."""
    success: bool
    inserted: int
    updated: int
    errors: list[str]
    warnings: list[str]


class SupabaseLoader:
    """Loads data to Supabase."""

    def __init__(self, config: ETLConfig):
        self.config = config
        self.client: Client = create_client(config.supabase_url, config.supabase_key)
        self.errors: list[str] = []
        self.warnings: list[str] = []

        # Caches for normalized lookups
        self._fleet_type_cache: dict[str, str] = {}  # name -> id
        self._location_cache: dict[str, str] = {}  # name -> id

    def _get_or_create_fleet_type(self, name: str) -> Optional[str]:
        """Get fleet type ID, creating if needed."""
        if not name:
            return None

        name_upper = name.upper().strip()
        if name_upper in self._fleet_type_cache:
            return self._fleet_type_cache[name_upper]

        try:
            # Try to find existing
            result = self.client.table("fleet_types").select("id").eq("name", name_upper).execute()

            if result.data:
                self._fleet_type_cache[name_upper] = result.data[0]["id"]
                return result.data[0]["id"]

            # Create new
            result = self.client.table("fleet_types").insert({"name": name_upper}).execute()

            if result.data:
                self._fleet_type_cache[name_upper] = result.data[0]["id"]
                return result.data[0]["id"]

        except Exception as e:
            self.warnings.append(f"Error with fleet type '{name}': {e}")

        return None

    def _get_or_create_location(self, name: str) -> Optional[str]:
        """Get location ID, creating if needed."""
        if not name:
            return None

        name_upper = name.upper().strip()
        if name_upper in self._location_cache:
            return self._location_cache[name_upper]

        try:
            # Try to find existing
            result = self.client.table("locations").select("id").eq("name", name_upper).execute()

            if result.data:
                self._location_cache[name_upper] = result.data[0]["id"]
                return result.data[0]["id"]

            # Create new
            result = self.client.table("locations").insert({"name": name_upper}).execute()

            if result.data:
                self._location_cache[name_upper] = result.data[0]["id"]
                return result.data[0]["id"]

        except Exception as e:
            self.warnings.append(f"Error with location '{name}': {e}")

        return None

    def _get_existing_plant(self, fleet_number: str) -> Optional[dict]:
        """Get existing plant by fleet number."""
        try:
            result = self.client.table("plants").select("*").eq("fleet_number", fleet_number).execute()
            return result.data[0] if result.data else None
        except Exception as e:
            self.warnings.append(f"Error fetching plant {fleet_number}: {e}")
            return None

    def _merge_plant_data(
        self,
        existing: Optional[dict],
        current: Optional[ExtractedPlant],
        legacy: Optional[ExtractedPlant]
    ) -> dict:
        """
        Merge plant data with precedence rules.

        Priority:
        1. Current data always takes precedence
        2. Legacy fills in missing fields (except location)
        3. Existing DB data as fallback
        """
        result = {}

        # Start with existing data if any
        if existing:
            result = {
                "description": existing.get("description"),
                "fleet_type_id": existing.get("fleet_type_id"),
                "make": existing.get("make"),
                "model": existing.get("model"),
                "chassis_number": existing.get("chassis_number"),
                "year_of_manufacture": existing.get("year_of_manufacture"),
                "purchase_cost": existing.get("purchase_cost"),
            }

        # Layer legacy data (fills gaps, NOT location)
        if legacy:
            if not result.get("description") and legacy.description:
                result["description"] = legacy.description
            if not result.get("fleet_type_id") and legacy.fleet_type:
                result["fleet_type_id"] = self._get_or_create_fleet_type(legacy.fleet_type)
            if not result.get("make") and legacy.make:
                result["make"] = legacy.make
            if not result.get("model") and legacy.model:
                result["model"] = legacy.model
            if not result.get("chassis_number") and legacy.chassis_number:
                result["chassis_number"] = legacy.chassis_number
            if not result.get("year_of_manufacture") and legacy.year_of_manufacture:
                result["year_of_manufacture"] = legacy.year_of_manufacture
            if not result.get("purchase_cost") and legacy.purchase_cost:
                result["purchase_cost"] = legacy.purchase_cost

        # Layer current data (takes precedence)
        if current:
            if current.description:
                result["description"] = current.description
            # Note: current weekly reports don't have fleet_type, make, model, etc.
            # But if they did, they would override here

        return result

    def load_plants(
        self,
        current_plants: list[ExtractedPlant],
        legacy_plants: list[ExtractedPlant],
        week_ending_date: Optional[str] = None
    ) -> LoadResult:
        """
        Load plants to database with merge logic.

        - Current plants get location history
        - Legacy-only plants: no location history
        - Merge fields with current taking precedence
        """
        inserted = 0
        updated = 0

        # Index by fleet number
        current_by_fleet = {p.fleet_number: p for p in current_plants}
        legacy_by_fleet = {p.fleet_number: p for p in legacy_plants}

        # All unique fleet numbers
        all_fleet_numbers = set(current_by_fleet.keys()) | set(legacy_by_fleet.keys())

        for fleet_number in all_fleet_numbers:
            try:
                current = current_by_fleet.get(fleet_number)
                legacy = legacy_by_fleet.get(fleet_number)
                existing = self._get_existing_plant(fleet_number)

                # Merge data
                merged = self._merge_plant_data(existing, current, legacy)

                # Determine status
                status = "active"
                if existing:
                    status = existing.get("status", "active")

                # Build plant record
                plant_data = {
                    "fleet_number": fleet_number,
                    "description": merged.get("description"),
                    "fleet_type_id": merged.get("fleet_type_id"),
                    "make": merged.get("make"),
                    "model": merged.get("model"),
                    "chassis_number": merged.get("chassis_number"),
                    "year_of_manufacture": merged.get("year_of_manufacture"),
                    "purchase_cost": merged.get("purchase_cost"),
                    "status": status,
                }

                if existing:
                    # Update existing
                    self.client.table("plants").update(plant_data).eq("id", existing["id"]).execute()
                    updated += 1
                    plant_id = existing["id"]
                else:
                    # Insert new
                    result = self.client.table("plants").insert(plant_data).execute()
                    inserted += 1
                    plant_id = result.data[0]["id"]

                # Handle location history for CURRENT plants only
                if current and current.location:
                    location_id = self._get_or_create_location(current.location)
                    if location_id:
                        self._add_location_history(
                            plant_id=plant_id,
                            location_id=location_id,
                            start_date=week_ending_date,
                            transfer_reason=f"ETL import from {current.source_file}"
                        )

            except Exception as e:
                self.errors.append(f"Error loading plant {fleet_number}: {e}")

        return LoadResult(
            success=len(self.errors) == 0,
            inserted=inserted,
            updated=updated,
            errors=self.errors.copy(),
            warnings=self.warnings.copy(),
        )

    def _add_location_history(
        self,
        plant_id: str,
        location_id: str,
        start_date: Optional[str],
        transfer_reason: Optional[str] = None
    ):
        """Add location history entry if location changed."""
        from datetime import datetime

        try:
            # Check current location
            result = self.client.table("plants").select("current_location_id").eq("id", plant_id).execute()

            if result.data:
                current_loc = result.data[0].get("current_location_id")

                # Only add if location changed
                if current_loc != location_id:
                    # start_date is required - use provided date or current date
                    effective_date = start_date or datetime.now().strftime("%Y-%m-%d")

                    history_data = {
                        "plant_id": plant_id,
                        "location_id": location_id,
                        "start_date": effective_date,
                    }
                    if transfer_reason:
                        history_data["transfer_reason"] = transfer_reason

                    self.client.table("plant_location_history").insert(history_data).execute()
                    # Trigger will auto-update current_location_id

        except Exception as e:
            self.warnings.append(f"Error adding location history for plant {plant_id}: {e}")

    def create_plants_for_spare_parts(
        self,
        spare_parts: list[ExtractedSparePart],
        existing_fleet_numbers: set[str]
    ) -> LoadResult:
        """
        Create placeholder plants for spare parts that reference unknown fleet numbers.
        """
        inserted = 0

        # Find fleet numbers in spare parts not in plants
        spare_part_fleets = {p.fleet_number for p in spare_parts}
        missing = spare_part_fleets - existing_fleet_numbers

        for fleet_number in missing:
            try:
                # Check if plant exists first (in case cache is stale)
                existing = self._get_existing_plant(fleet_number)
                if existing:
                    continue  # Plant already exists, skip

                plant_data = {
                    "fleet_number": fleet_number,
                    "description": "Created from spare parts tracking",
                    "status": "active",
                }
                self.client.table("plants").insert(plant_data).execute()
                inserted += 1

            except Exception as e:
                # Ignore duplicate key errors - plant already exists
                if "23505" in str(e):  # PostgreSQL duplicate key error code
                    continue
                self.errors.append(f"Error creating plant for spare part {fleet_number}: {e}")

        return LoadResult(
            success=len(self.errors) == 0,
            inserted=inserted,
            updated=0,
            errors=self.errors.copy(),
            warnings=self.warnings.copy(),
        )

    def load_spare_parts(self, parts: list[ExtractedSparePart]) -> LoadResult:
        """Load spare parts to database."""
        inserted = 0

        # First, get plant ID lookup
        plant_lookup = self._get_plant_id_lookup()

        for part in parts:
            try:
                plant_id = plant_lookup.get(part.fleet_number)
                if not plant_id:
                    self.warnings.append(f"No plant found for spare part fleet {part.fleet_number}")
                    continue

                part_data = {
                    "plant_id": plant_id,
                    "replaced_date": part.replaced_date,
                    "part_number": part.part_number,
                    "part_description": part.part_description,
                    "supplier": part.supplier,
                    "reason_for_change": part.reason_for_change,
                    "unit_cost": part.unit_cost,
                    "quantity": part.quantity or 1,
                    "purchase_order_number": part.purchase_order_number,
                    "remarks": part.remarks,
                }

                self.client.table("spare_parts").insert(part_data).execute()
                inserted += 1

            except Exception as e:
                self.errors.append(f"Error loading spare part for {part.fleet_number}: {e}")

        return LoadResult(
            success=len(self.errors) == 0,
            inserted=inserted,
            updated=0,
            errors=self.errors.copy(),
            warnings=self.warnings.copy(),
        )

    def _get_plant_id_lookup(self) -> dict[str, str]:
        """Get mapping of fleet_number -> plant_id."""
        try:
            result = self.client.table("plants").select("id, fleet_number").execute()
            return {p["fleet_number"]: p["id"] for p in result.data}
        except Exception as e:
            self.errors.append(f"Error fetching plant lookup: {e}")
            return {}

    def get_all_fleet_numbers(self) -> set[str]:
        """Get all fleet numbers currently in database."""
        try:
            result = self.client.table("plants").select("fleet_number").execute()
            return {p["fleet_number"] for p in result.data}
        except Exception as e:
            self.errors.append(f"Error fetching fleet numbers: {e}")
            return set()

    def clear_all_data(self):
        """Clear all data from tables (for fresh load). Use with caution."""
        try:
            # Order matters due to foreign keys
            self.client.table("spare_parts").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
            self.client.table("plant_location_history").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
            self.client.table("plants").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
            self.client.table("locations").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
            self.client.table("fleet_types").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
        except Exception as e:
            self.errors.append(f"Error clearing data: {e}")
