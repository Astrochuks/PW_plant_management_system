"""
Configuration for ETL pipeline.
Loads settings from environment variables.
"""

import os
from pathlib import Path
from dataclasses import dataclass
from typing import Optional
from dotenv import load_dotenv


# Load .env file
load_dotenv(Path(__file__).parent.parent / ".env")


@dataclass
class ETLConfig:
    """ETL Pipeline configuration."""

    # Supabase connection
    supabase_url: str
    supabase_key: str

    # File paths
    base_dir: Path
    legacy_file: Path
    spare_parts_file: Path
    weekly_reports_dir: Path

    # Processing settings
    legacy_header_row: int = 3  # 0-indexed (Excel row 4)
    weekly_header_row: int = 3  # 0-indexed (Excel row 4)
    spare_parts_header_row: int = 0  # 0-indexed (Excel row 1)

    # Debug
    debug: bool = False

    @classmethod
    def from_env(cls) -> "ETLConfig":
        """Load configuration from environment variables."""
        base_dir = Path(__file__).parent.parent

        return cls(
            supabase_url=os.getenv("SUPABASE_URL", ""),
            supabase_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
            base_dir=base_dir,
            legacy_file=base_dir / "Plant List 2021.xlsx",
            spare_parts_file=base_dir / "PlantandEquipmentSparePartsTracking.xlsx",
            weekly_reports_dir=base_dir / "new plants",
            debug=os.getenv("DEBUG", "false").lower() == "true",
        )

    def validate(self) -> list[str]:
        """Validate configuration. Returns list of errors."""
        errors = []

        if not self.supabase_url:
            errors.append("SUPABASE_URL is required")
        if not self.supabase_key:
            errors.append("SUPABASE_SERVICE_ROLE_KEY is required")
        if not self.legacy_file.exists():
            errors.append(f"Legacy file not found: {self.legacy_file}")
        if not self.spare_parts_file.exists():
            errors.append(f"Spare parts file not found: {self.spare_parts_file}")
        if not self.weekly_reports_dir.exists():
            errors.append(f"Weekly reports directory not found: {self.weekly_reports_dir}")

        return errors


# Global config instance
config = ETLConfig.from_env()
