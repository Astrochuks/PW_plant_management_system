#!/usr/bin/env python3
"""
Main ETL script for Plant Management System.

This script orchestrates the entire ETL process:
1. Extract data from Excel files
2. Transform/clean/normalize data
3. Load into Supabase database

Usage:
    python -m etl.run_etl [--clear] [--dry-run] [--plants-only] [--spare-parts-only]

Options:
    --clear           Clear existing data before loading
    --dry-run         Process data but don't load to database
    --plants-only     Only process and load plants
    --spare-parts-only Only process and load spare parts
"""

import argparse
import sys
import json
from datetime import datetime
from pathlib import Path

from .config import config
from .processors import PlantProcessor, SparePartsProcessor
from .loader import DatabaseLoader


def print_banner():
    """Print script banner."""
    print("=" * 70)
    print("  PLANT MANAGEMENT SYSTEM - ETL PIPELINE")
    print("=" * 70)
    print(f"  Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)
    print()


def print_section(title: str):
    """Print section header."""
    print()
    print("-" * 70)
    print(f"  {title}")
    print("-" * 70)


def print_result(result, section_name: str):
    """Print processing result."""
    print(f"\n  {section_name} Results:")
    print(f"    Success: {'Yes' if result.success else 'No'}")

    if hasattr(result, 'stats'):
        print(f"    Statistics:")
        for key, value in result.stats.items():
            print(f"      - {key}: {value}")

    if hasattr(result, 'inserted'):
        print(f"    Inserted: {result.inserted}")
    if hasattr(result, 'updated'):
        print(f"    Updated: {result.updated}")

    if result.warnings:
        print(f"    Warnings ({len(result.warnings)}):")
        for w in result.warnings[:5]:
            print(f"      - {w}")
        if len(result.warnings) > 5:
            print(f"      ... and {len(result.warnings) - 5} more")

    if result.errors:
        print(f"    Errors ({len(result.errors)}):")
        for e in result.errors[:5]:
            print(f"      - {e}")
        if len(result.errors) > 5:
            print(f"      ... and {len(result.errors) - 5} more")


def run_etl(
    clear_data: bool = False,
    dry_run: bool = False,
    plants_only: bool = False,
    spare_parts_only: bool = False
) -> bool:
    """
    Run the complete ETL pipeline.

    Args:
        clear_data: Whether to clear existing data before loading
        dry_run: If True, process data but don't load to database
        plants_only: Only process plants, skip spare parts
        spare_parts_only: Only process spare parts, skip plants

    Returns:
        True if successful, False otherwise
    """
    print_banner()

    # Validate configuration
    print("Validating configuration...")
    if not config.validate():
        print("\n[ERROR] Configuration validation failed!")
        return False
    print("  Configuration OK")

    # Initialize components
    plant_processor = PlantProcessor(debug=config.debug)
    spare_parts_processor = SparePartsProcessor(debug=config.debug)
    loader = DatabaseLoader(config) if not dry_run else None

    success = True
    plants_df = None
    spare_parts_df = None

    # Clear data if requested
    if clear_data and not dry_run and loader:
        print_section("CLEARING EXISTING DATA")
        if not loader.clear_all_data():
            print("  [WARNING] Failed to clear some data")

    # Process Plants
    if not spare_parts_only:
        print_section("STEP 1: PROCESSING CURRENT PLANTS")

        current_result = plant_processor.process_new_plants(config.new_plants_dir)
        print_result(current_result, "Current Plants")

        if not current_result.success:
            print("  [WARNING] Current plants processing had errors")

        print_section("STEP 2: PROCESSING LEGACY PLANTS")

        legacy_result = plant_processor.process_legacy_plants(config.legacy_plant_file)
        print_result(legacy_result, "Legacy Plants")

        if not legacy_result.success:
            print("  [WARNING] Legacy plants processing had errors")

        print_section("STEP 3: MERGING PLANT DATA")

        if current_result.data is not None and legacy_result.data is not None:
            merge_result = plant_processor.merge_plant_data(
                current_result.data, legacy_result.data
            )
            print_result(merge_result, "Merged Plants")
            plants_df = merge_result.data
        else:
            print("  [ERROR] Cannot merge - missing data")
            success = False

        # Load plants
        if not dry_run and loader and plants_df is not None:
            print_section("STEP 4: LOADING PLANTS TO DATABASE")
            load_result = loader.load_plants(plants_df)
            print_result(load_result, "Plants Load")
            if not load_result.success:
                success = False

    # Process Spare Parts
    if not plants_only:
        print_section("STEP 5: PROCESSING SPARE PARTS")

        spare_result = spare_parts_processor.process_spare_parts(config.spare_parts_file)
        print_result(spare_result, "Spare Parts")
        spare_parts_df = spare_result.data

        if not spare_result.success:
            print("  [WARNING] Spare parts processing had errors")

        # Load spare parts
        if not dry_run and loader and spare_parts_df is not None and not spare_parts_df.empty:
            print_section("STEP 6: LOADING SPARE PARTS TO DATABASE")
            load_result = loader.load_spare_parts(spare_parts_df)
            print_result(load_result, "Spare Parts Load")
            if not load_result.success:
                success = False

    # Print final statistics
    if not dry_run and loader:
        print_section("FINAL DATABASE STATISTICS")
        stats = loader.get_stats()
        for table, count in stats.items():
            print(f"    {table}: {count} records")

    # Summary
    print()
    print("=" * 70)
    print(f"  ETL PIPELINE {'COMPLETED' if success else 'COMPLETED WITH ERRORS'}")
    print(f"  Finished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    if dry_run:
        print("\n  [DRY RUN] No data was loaded to the database")

        # Save processed data to files for inspection
        output_dir = Path("etl_output")
        output_dir.mkdir(exist_ok=True)

        if plants_df is not None:
            plants_df.to_csv(output_dir / "plants_processed.csv", index=False)
            print(f"  Plants data saved to: {output_dir / 'plants_processed.csv'}")

        if spare_parts_df is not None and not spare_parts_df.empty:
            spare_parts_df.to_csv(output_dir / "spare_parts_processed.csv", index=False)
            print(f"  Spare parts data saved to: {output_dir / 'spare_parts_processed.csv'}")

    return success


def main():
    """Main entry point with argument parsing."""
    parser = argparse.ArgumentParser(
        description="Plant Management System ETL Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Full ETL run
    python -m etl.run_etl

    # Dry run (process but don't load)
    python -m etl.run_etl --dry-run

    # Clear existing data and reload
    python -m etl.run_etl --clear

    # Only process plants
    python -m etl.run_etl --plants-only

    # Only process spare parts
    python -m etl.run_etl --spare-parts-only
        """
    )

    parser.add_argument(
        "--clear",
        action="store_true",
        help="Clear existing data before loading"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Process data but don't load to database"
    )
    parser.add_argument(
        "--plants-only",
        action="store_true",
        help="Only process and load plants"
    )
    parser.add_argument(
        "--spare-parts-only",
        action="store_true",
        help="Only process and load spare parts"
    )

    args = parser.parse_args()

    success = run_etl(
        clear_data=args.clear,
        dry_run=args.dry_run,
        plants_only=args.plants_only,
        spare_parts_only=args.spare_parts_only
    )

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
