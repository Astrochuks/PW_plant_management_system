"""
Configuration loader for ETL pipeline.
Loads environment variables and provides database connection settings.
"""

import os
from pathlib import Path
from dotenv import load_dotenv
from dataclasses import dataclass


# Load environment variables from .env file
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)


@dataclass
class Config:
    """Application configuration loaded from environment variables."""

    supabase_url: str
    supabase_anon_key: str
    supabase_service_key: str
    database_url: str
    debug: bool

    # Data file paths
    data_dir: Path
    legacy_plant_file: Path
    spare_parts_file: Path
    new_plants_dir: Path

    @classmethod
    def load(cls) -> "Config":
        """Load configuration from environment variables."""
        base_dir = Path(__file__).parent.parent

        return cls(
            supabase_url=os.getenv("SUPABASE_URL", ""),
            supabase_anon_key=os.getenv("SUPABASE_ANON_KEY", ""),
            supabase_service_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
            database_url=os.getenv("DATABASE_URL", ""),
            debug=os.getenv("DEBUG", "false").lower() == "true",
            data_dir=base_dir,
            legacy_plant_file=base_dir / "Plant List 2021.xlsx",
            spare_parts_file=base_dir / "PlantandEquipmentSparePartsTracking.xlsx",
            new_plants_dir=base_dir / "new plants",
        )

    def validate(self) -> bool:
        """Validate that all required configuration is present."""
        errors = []

        if not self.supabase_url:
            errors.append("SUPABASE_URL is required")
        if not self.supabase_service_key:
            errors.append("SUPABASE_SERVICE_ROLE_KEY is required")
        if not self.database_url:
            errors.append("DATABASE_URL is required")
        if not self.legacy_plant_file.exists():
            errors.append(f"Legacy plant file not found: {self.legacy_plant_file}")
        if not self.spare_parts_file.exists():
            errors.append(f"Spare parts file not found: {self.spare_parts_file}")
        if not self.new_plants_dir.exists():
            errors.append(f"New plants directory not found: {self.new_plants_dir}")

        if errors:
            for error in errors:
                print(f"[CONFIG ERROR] {error}")
            return False

        return True


# Global config instance
config = Config.load()
