"""
ETL Pipeline Orchestrator.

Coordinates the full ETL process:
1. Extract data from all sources
2. Validate extracted data
3. Load to Supabase with merge logic
"""

import logging
from dataclasses import dataclass
from datetime import datetime

from .config import ETLConfig
from .extractors import (
    WeeklyReportExtractor,
    LegacyPlantExtractor,
    SparePartsExtractor,
    ExtractedPlant,
)
from .validators import PlantValidator, SparePartValidator
from .loaders import SupabaseLoader


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@dataclass
class PipelineResult:
    """Result of full ETL pipeline run."""
    success: bool
    start_time: datetime
    end_time: datetime
    stats: dict
    errors: list[str]
    warnings: list[str]


class ETLPipeline:
    """Main ETL pipeline orchestrator."""

    def __init__(self, config: ETLConfig):
        self.config = config
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.stats: dict = {}

    def run(self, clear_existing: bool = False) -> PipelineResult:
        """
        Run the full ETL pipeline.

        Args:
            clear_existing: If True, clear all data before loading
        """
        start_time = datetime.now()
        logger.info("=" * 60)
        logger.info("Starting ETL Pipeline")
        logger.info("=" * 60)

        try:
            # Validate config
            config_errors = self.config.validate()
            if config_errors:
                for err in config_errors:
                    self.errors.append(f"Config error: {err}")
                    logger.error(f"Config error: {err}")
                return self._build_result(start_time, success=False)

            # Initialize loader
            loader = SupabaseLoader(self.config)

            if clear_existing:
                logger.info("Clearing existing data...")
                loader.clear_all_data()

            # Phase 1: Extract
            logger.info("-" * 40)
            logger.info("Phase 1: Extraction")
            logger.info("-" * 40)

            current_plants, week_ending = self._extract_current_plants()
            legacy_plants = self._extract_legacy_plants()
            spare_parts = self._extract_spare_parts()

            self.stats["extraction"] = {
                "current_plants": len(current_plants),
                "legacy_plants": len(legacy_plants),
                "spare_parts": len(spare_parts),
                "week_ending": week_ending,
            }

            logger.info(f"Extracted {len(current_plants)} current plants")
            logger.info(f"Extracted {len(legacy_plants)} legacy plants")
            logger.info(f"Extracted {len(spare_parts)} spare parts")

            # Phase 2: Validate
            logger.info("-" * 40)
            logger.info("Phase 2: Validation")
            logger.info("-" * 40)

            plant_validator = PlantValidator()
            all_plants = current_plants + legacy_plants
            plant_validation = plant_validator.validate(all_plants)

            part_validator = SparePartValidator()
            part_validation = part_validator.validate(spare_parts)

            self.stats["validation"] = {
                "plants": plant_validation.stats,
                "spare_parts": part_validation.stats,
            }

            # Add validation warnings
            self.warnings.extend(plant_validation.warnings)
            self.warnings.extend(part_validation.warnings)

            logger.info(f"Plant validation: {plant_validation.stats}")
            logger.info(f"Spare part validation: {part_validation.stats}")

            if plant_validation.errors:
                self.errors.extend(plant_validation.errors)
            if part_validation.errors:
                self.errors.extend(part_validation.errors)

            # Phase 3: Load Plants
            logger.info("-" * 40)
            logger.info("Phase 3: Load Plants")
            logger.info("-" * 40)

            plant_result = loader.load_plants(
                current_plants=current_plants,
                legacy_plants=legacy_plants,
                week_ending_date=week_ending
            )

            self.stats["load_plants"] = {
                "inserted": plant_result.inserted,
                "updated": plant_result.updated,
            }
            self.errors.extend(plant_result.errors)
            self.warnings.extend(plant_result.warnings)

            logger.info(f"Plants: {plant_result.inserted} inserted, {plant_result.updated} updated")

            # Phase 4: Create plants for orphan spare parts
            logger.info("-" * 40)
            logger.info("Phase 4: Handle Orphan Spare Parts")
            logger.info("-" * 40)

            existing_fleets = loader.get_all_fleet_numbers()
            orphan_result = loader.create_plants_for_spare_parts(spare_parts, existing_fleets)

            self.stats["orphan_plants"] = {
                "created": orphan_result.inserted,
            }
            self.errors.extend(orphan_result.errors)
            self.warnings.extend(orphan_result.warnings)

            logger.info(f"Created {orphan_result.inserted} plants for orphan spare parts")

            # Phase 5: Load Spare Parts
            logger.info("-" * 40)
            logger.info("Phase 5: Load Spare Parts")
            logger.info("-" * 40)

            parts_result = loader.load_spare_parts(spare_parts)

            self.stats["load_spare_parts"] = {
                "inserted": parts_result.inserted,
            }
            self.errors.extend(parts_result.errors)
            self.warnings.extend(parts_result.warnings)

            logger.info(f"Spare parts: {parts_result.inserted} inserted")

            # Summary
            logger.info("=" * 60)
            logger.info("Pipeline Complete")
            logger.info("=" * 60)

            return self._build_result(start_time, success=len(self.errors) == 0)

        except Exception as e:
            self.errors.append(f"Pipeline error: {e}")
            logger.exception("Pipeline failed with exception")
            return self._build_result(start_time, success=False)

    def _extract_current_plants(self) -> tuple[list[ExtractedPlant], str | None]:
        """Extract plants from weekly reports."""
        extractor = WeeklyReportExtractor(self.config)
        result = extractor.extract_all()

        self.errors.extend(result.errors)
        self.warnings.extend(result.warnings)

        # Try to get week ending date from first file
        week_ending = None
        if result.data:
            # Use today as fallback
            week_ending = datetime.now().strftime("%Y-%m-%d")

        return result.data, week_ending

    def _extract_legacy_plants(self) -> list[ExtractedPlant]:
        """Extract plants from legacy file."""
        extractor = LegacyPlantExtractor(self.config)
        result = extractor.extract()

        self.errors.extend(result.errors)
        self.warnings.extend(result.warnings)

        return result.data

    def _extract_spare_parts(self) -> list:
        """Extract spare parts from tracking file."""
        extractor = SparePartsExtractor(self.config)
        result = extractor.extract()

        self.errors.extend(result.errors)
        self.warnings.extend(result.warnings)

        return result.data

    def _build_result(self, start_time: datetime, success: bool) -> PipelineResult:
        """Build pipeline result."""
        end_time = datetime.now()

        return PipelineResult(
            success=success,
            start_time=start_time,
            end_time=end_time,
            stats=self.stats,
            errors=self.errors.copy(),
            warnings=self.warnings.copy(),
        )


def run_pipeline(clear_existing: bool = False) -> PipelineResult:
    """Convenience function to run ETL pipeline."""
    from .config import config
    pipeline = ETLPipeline(config)
    return pipeline.run(clear_existing=clear_existing)


# CLI entry point
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run ETL Pipeline")
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Clear existing data before loading"
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug logging"
    )
    args = parser.parse_args()

    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)

    result = run_pipeline(clear_existing=args.clear)

    print("\n" + "=" * 60)
    print("PIPELINE RESULT")
    print("=" * 60)
    print(f"Success: {result.success}")
    print(f"Duration: {result.end_time - result.start_time}")
    print(f"\nStats: {result.stats}")

    if result.errors:
        print(f"\nErrors ({len(result.errors)}):")
        for err in result.errors[:20]:
            print(f"  - {err}")
        if len(result.errors) > 20:
            print(f"  ... and {len(result.errors) - 20} more")

    if result.warnings:
        print(f"\nWarnings ({len(result.warnings)}):")
        for warn in result.warnings[:20]:
            print(f"  - {warn}")
        if len(result.warnings) > 20:
            print(f"  ... and {len(result.warnings) - 20} more")
