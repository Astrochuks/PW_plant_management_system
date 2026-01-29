"""
Database loader for inserting processed data into Supabase.

Handles:
- Creating location records
- Inserting plant records with location references
- Inserting spare parts with plant references
- Transaction management and error handling
"""

import logging
from typing import Dict, List, Optional, Set, Tuple
from dataclasses import dataclass
import pandas as pd
from supabase import create_client, Client

from .config import Config


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class LoadResult:
    """Result of a load operation."""
    success: bool
    inserted: int
    updated: int
    errors: List[str]
    warnings: List[str]


class DatabaseLoader:
    """Loads processed data into Supabase database."""

    def __init__(self, config: Config):
        self.config = config
        self.client: Client = create_client(
            config.supabase_url,
            config.supabase_service_key
        )
        self.location_cache: Dict[str, str] = {}  # name -> id
        self.plant_cache: Dict[str, str] = {}  # fleet_number -> id
        self.errors: List[str] = []
        self.warnings: List[str] = []

    def _log(self, message: str, level: str = "INFO"):
        """Log a message."""
        if self.config.debug:
            print(f"[{level}] {message}")
        getattr(logger, level.lower())(message)

    def _ensure_locations(self, location_names: Set[str]) -> Dict[str, str]:
        """
        Ensure all locations exist in the database.
        Returns mapping of location name -> id.
        """
        self._log(f"Ensuring {len(location_names)} locations exist")

        # Get existing locations
        existing = self.client.table("locations").select("id, name").execute()
        existing_map = {loc["name"]: loc["id"] for loc in existing.data}

        # Find new locations
        new_locations = location_names - set(existing_map.keys())

        if new_locations:
            self._log(f"Creating {len(new_locations)} new locations")

            # Insert new locations
            for name in new_locations:
                if not name or not name.strip():
                    continue
                try:
                    result = self.client.table("locations").insert({
                        "name": name.strip()
                    }).execute()
                    if result.data:
                        existing_map[name] = result.data[0]["id"]
                except Exception as e:
                    # Handle duplicate key (race condition)
                    if "duplicate key" in str(e).lower():
                        # Fetch the existing one
                        fetch = self.client.table("locations").select("id").eq(
                            "name", name
                        ).execute()
                        if fetch.data:
                            existing_map[name] = fetch.data[0]["id"]
                    else:
                        self.errors.append(f"Failed to create location '{name}': {e}")

        self.location_cache = existing_map
        return existing_map

    def load_plants(self, df: pd.DataFrame) -> LoadResult:
        """
        Load plant data into the database.

        Performs upsert based on fleet_number.
        """
        self._log(f"Loading {len(df)} plants into database")

        if df.empty:
            return LoadResult(
                success=True,
                inserted=0,
                updated=0,
                errors=[],
                warnings=["No plants to load"]
            )

        # Get unique locations and ensure they exist
        locations = set(df["location"].dropna().unique())
        self._ensure_locations(locations)

        inserted = 0
        updated = 0
        errors = []

        # Get existing plants for upsert logic
        existing = self.client.table("plants").select("id, fleet_number").execute()
        existing_map = {p["fleet_number"]: p["id"] for p in existing.data}

        for _, row in df.iterrows():
            try:
                fleet_number = row["fleet_number"]

                # Get location_id
                location_name = row.get("location")
                location_id = None
                if pd.notna(location_name) and location_name in self.location_cache:
                    location_id = self.location_cache[location_name]

                # Prepare plant data
                plant_data = {
                    "fleet_number": fleet_number,
                    "description": row.get("description") if pd.notna(row.get("description")) else None,
                    "fleet_type": row.get("fleet_type") if pd.notna(row.get("fleet_type")) else None,
                    "make": row.get("make") if pd.notna(row.get("make")) else None,
                    "model": str(row.get("model")) if pd.notna(row.get("model")) else None,
                    "location_id": location_id,
                    "chassis_number": str(row.get("chassis_number")) if pd.notna(row.get("chassis_number")) else None,
                    "year_of_manufacture": int(row["year_of_manufacture"]) if pd.notna(row.get("year_of_manufacture")) else None,
                    "purchasing_cost": float(row["purchasing_cost"]) if pd.notna(row.get("purchasing_cost")) else None,
                    "physical_verification": bool(row.get("physical_verification", False)),
                    "remark": row.get("remark") if pd.notna(row.get("remark")) else None,
                    "is_active": bool(row.get("is_active", True)),
                    "source": row.get("source", "current"),
                }

                if fleet_number in existing_map:
                    # Update existing
                    self.client.table("plants").update(plant_data).eq(
                        "fleet_number", fleet_number
                    ).execute()
                    self.plant_cache[fleet_number] = existing_map[fleet_number]
                    updated += 1
                else:
                    # Insert new
                    result = self.client.table("plants").insert(plant_data).execute()
                    if result.data:
                        self.plant_cache[fleet_number] = result.data[0]["id"]
                        inserted += 1

            except Exception as e:
                errors.append(f"Error loading plant {row.get('fleet_number', 'unknown')}: {e}")

        self._log(f"Plants loaded: {inserted} inserted, {updated} updated, {len(errors)} errors")

        return LoadResult(
            success=len(errors) == 0,
            inserted=inserted,
            updated=updated,
            errors=errors,
            warnings=self.warnings.copy()
        )

    def load_spare_parts(self, df: pd.DataFrame) -> LoadResult:
        """
        Load spare parts data into the database.

        Links to plants by fleet_number where possible.
        """
        self._log(f"Loading {len(df)} spare parts into database")

        if df.empty:
            return LoadResult(
                success=True,
                inserted=0,
                updated=0,
                errors=[],
                warnings=["No spare parts to load"]
            )

        # Refresh plant cache if empty
        if not self.plant_cache:
            existing = self.client.table("plants").select("id, fleet_number").execute()
            self.plant_cache = {p["fleet_number"]: p["id"] for p in existing.data}

        inserted = 0
        errors = []
        unlinked = 0

        # Batch insert for efficiency
        batch_size = 100
        batch = []

        for _, row in df.iterrows():
            try:
                fleet_number = row["fleet_number"]

                # Try to find plant_id
                plant_id = self.plant_cache.get(fleet_number)

                # Also try with space variations
                if not plant_id:
                    # Try without spaces
                    alt_key = fleet_number.replace(" ", "")
                    for cached_key, cached_id in self.plant_cache.items():
                        if cached_key.replace(" ", "") == alt_key:
                            plant_id = cached_id
                            break

                if not plant_id:
                    unlinked += 1

                # Prepare spare part data
                part_data = {
                    "fleet_number": fleet_number,
                    "plant_id": plant_id,
                    "replaced_date": row.get("replaced_date") if pd.notna(row.get("replaced_date")) else None,
                    "part_number": row.get("part_number") if pd.notna(row.get("part_number")) else None,
                    "supplier": row.get("supplier") if pd.notna(row.get("supplier")) else None,
                    "description": row.get("description") if pd.notna(row.get("description")) else None,
                    "reason_for_change": row.get("reason_for_change") if pd.notna(row.get("reason_for_change")) else None,
                    "cost": float(row["cost"]) if pd.notna(row.get("cost")) else None,
                    "quantity_used": int(row["quantity_used"]) if pd.notna(row.get("quantity_used")) else None,
                    "purchase_order_number": row.get("purchase_order_number") if pd.notna(row.get("purchase_order_number")) else None,
                    "remarks": row.get("remarks") if pd.notna(row.get("remarks")) else None,
                }

                batch.append(part_data)

                # Insert batch when full
                if len(batch) >= batch_size:
                    result = self.client.table("spare_parts").insert(batch).execute()
                    inserted += len(result.data) if result.data else 0
                    batch = []

            except Exception as e:
                errors.append(f"Error preparing spare part for {row.get('fleet_number', 'unknown')}: {e}")

        # Insert remaining batch
        if batch:
            try:
                result = self.client.table("spare_parts").insert(batch).execute()
                inserted += len(result.data) if result.data else 0
            except Exception as e:
                errors.append(f"Error inserting final batch: {e}")

        self._log(f"Spare parts loaded: {inserted} inserted, {unlinked} unlinked to plants, {len(errors)} errors")

        if unlinked > 0:
            self.warnings.append(f"{unlinked} spare parts could not be linked to plants")

        return LoadResult(
            success=len(errors) == 0,
            inserted=inserted,
            updated=0,
            errors=errors,
            warnings=self.warnings.copy()
        )

    def clear_all_data(self) -> bool:
        """
        Clear all data from tables (for re-import).
        Use with caution!
        """
        self._log("Clearing all data from tables", "WARNING")

        try:
            # Delete in order to respect foreign keys
            self.client.table("spare_parts").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
            self.client.table("plants").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
            self.client.table("locations").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

            # Clear caches
            self.location_cache = {}
            self.plant_cache = {}

            self._log("All data cleared successfully")
            return True

        except Exception as e:
            self.errors.append(f"Error clearing data: {e}")
            return False

    def get_stats(self) -> Dict[str, int]:
        """Get current database statistics."""
        stats = {}

        try:
            # Count records in each table
            for table in ["locations", "plants", "spare_parts"]:
                result = self.client.table(table).select("id", count="exact").execute()
                stats[table] = result.count if result.count else 0
        except Exception as e:
            self.errors.append(f"Error getting stats: {e}")

        return stats
