#!/usr/bin/env python3
"""
Run ETL Pipeline.

Usage:
    python run_etl.py              # Normal run (incremental)
    python run_etl.py --clear      # Clear all data first
    python run_etl.py --dry-run    # Extract and validate only, no loading
    python run_etl.py --debug      # Enable debug logging
"""

import argparse
import sys
from etl import run_pipeline, ETLConfig, config


def main():
    parser = argparse.ArgumentParser(description="Run Plant Management ETL Pipeline")
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Clear all existing data before loading"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Extract and validate only, don't load to database"
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug logging"
    )
    args = parser.parse_args()

    # Validate config first
    print("Validating configuration...")
    errors = config.validate()
    if errors:
        print("\nConfiguration errors:")
        for err in errors:
            print(f"  - {err}")
        print("\nPlease check your .env file and data files.")
        sys.exit(1)

    print("Configuration valid.")
    print(f"  - Legacy file: {config.legacy_file}")
    print(f"  - Spare parts: {config.spare_parts_file}")
    print(f"  - Weekly reports: {config.weekly_reports_dir}")

    if args.dry_run:
        print("\n[DRY RUN] Extraction and validation only")
        from etl import (
            WeeklyReportExtractor,
            LegacyPlantExtractor,
            SparePartsExtractor,
            PlantValidator,
            SparePartValidator,
        )

        # Extract
        print("\nExtracting current plants...")
        current_extractor = WeeklyReportExtractor(config)
        current_result = current_extractor.extract_all()
        print(f"  Found {len(current_result.data)} plants from {current_result.stats.get('files_processed', 0)} files")

        print("\nExtracting legacy plants...")
        legacy_extractor = LegacyPlantExtractor(config)
        legacy_result = legacy_extractor.extract()
        print(f"  Found {len(legacy_result.data)} plants")

        print("\nExtracting spare parts...")
        parts_extractor = SparePartsExtractor(config)
        parts_result = parts_extractor.extract()
        print(f"  Found {len(parts_result.data)} parts from {parts_result.stats.get('sheets_processed', 0)} sheets")

        # Validate
        print("\nValidating plants...")
        plant_validator = PlantValidator()
        all_plants = current_result.data + legacy_result.data
        plant_validation = plant_validator.validate(all_plants)
        print(f"  Stats: {plant_validation.stats}")

        print("\nValidating spare parts...")
        part_validator = SparePartValidator()
        part_validation = part_validator.validate(parts_result.data)
        print(f"  Stats: {part_validation.stats}")

        # Show warnings
        all_warnings = (
            current_result.warnings +
            legacy_result.warnings +
            parts_result.warnings +
            plant_validation.warnings +
            part_validation.warnings
        )
        if all_warnings:
            print(f"\nWarnings ({len(all_warnings)}):")
            for w in all_warnings[:20]:
                print(f"  - {w}")
            if len(all_warnings) > 20:
                print(f"  ... and {len(all_warnings) - 20} more")

        print("\n[DRY RUN] Complete - no data was loaded")
        return

    # Full run
    print("\nStarting ETL pipeline...")
    if args.clear:
        print("  [WARNING] Clearing existing data first")

    result = run_pipeline(clear_existing=args.clear)

    # Print result
    print("\n" + "=" * 60)
    print("PIPELINE RESULT")
    print("=" * 60)
    print(f"Success: {result.success}")
    print(f"Duration: {result.end_time - result.start_time}")

    print("\nStatistics:")
    for phase, stats in result.stats.items():
        print(f"  {phase}: {stats}")

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

    sys.exit(0 if result.success else 1)


if __name__ == "__main__":
    main()
