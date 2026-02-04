"""
Weekly Report ETL Pipeline (Optimized with Parallel Processing)
Processes weekly plant reports and updates the database.
"""

import re
import os
import time
from pathlib import Path
from datetime import datetime, date
from dataclasses import dataclass, field
from typing import Optional
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
import pandas as pd
from dateutil import parser as date_parser
from supabase import create_client, Client

from config import config

# Number of parallel workers for file processing (keep low to avoid connection errors)
MAX_WORKERS = 3


# ============================================================================
# Constants
# ============================================================================

BATCH_SIZE = 100  # Records per batch insert

# Status keywords for extraction from remarks
STATUS_KEYWORDS = {
    'working': ['working', 'operational', 'running', 'in use'],
    'standby': ['standby', 'stand by', 'standing by', 'idle', 'available'],
    'breakdown': ['breakdown', 'broke down', 'broken', 'not working', 'down', 'bd', 'b/d', 'for repairs', 'for repair'],
    'faulty': ['faulty', 'fault', 'defective', 'problem', 'issue', 'no engine', 'no compressor'],
    'scrap': ['scrap', 'scrapped', 'write off', 'written off', 'condemned'],
    'missing': ['missing', 'not seen', 'cannot locate', 'not found', 'not on site', 'not seen on site'],
    'stolen': ['stolen', 'theft'],
    'in_transit': ['transit', 'transferred', 'transfer to', 'moving to', 'in route'],
    'off_hire': ['off hired', 'off hire', 'offhired', 'off-hired', 'offhire'],
}

# Column name variations in Excel files
COLUMN_MAPPINGS = {
    'fleet_number': ['fleetnumber', 'fleet number', 'fleet no', 'fleet no.', 'fleetno', 'fleet . no.', 'fleet. no', 'fleet.no'],
    'description': ['fleetdescription', 'fleet description', 'description', 'plant description'],
    'hours_worked': ['hours worked', 'hoursworked', 'hrs worked', 'working hours'],
    'standby_hours': ['s/b hour', 's/b hours', 'standby hours', 'standby hour', 'sb hour', 's/b'],
    'breakdown_hours': ['b/d hour', 'b/d hours', 'breakdown hours', 'breakdown hour', 'bd hour', 'b/d'],
    'off_hire': ['off hire', 'offhire', 'off-hire'],
    'transfer_from': ['transf. from', 'transfer from', 'transf from', 'from', 'transferd from', 'transferred from'],
    'transfer_to': ['transf. to', 'transfer to', 'transf to', 'to', 'transfered to', 'transferred to'],
    'remarks': ['remark', 'remarks', 'comment', 'comments', 'note', 'notes'],
    'verification': ['physical plant', 'verification', 'physical plant verification', 'physical verification'],
}

# Invalid fleet numbers to skip (same as archive ETL)
INVALID_FLEET_NUMBERS = {
    "ATLASCOPCO", "ITELTOWER", "KACHER", "LUTIAN", "NOFLEET", "PWMINNING", "TRIMER",
    "FFF", "FF", "WPNOFLEET",
}


# ============================================================================
# Helper Functions
# ============================================================================

def normalize_fleet_number(value: str) -> Optional[str]:
    """Normalize fleet number: uppercase, remove spaces."""
    if pd.isna(value) or value is None:
        return None
    text = str(value).strip().upper().replace(' ', '')
    if not text or text in ('NAN', 'NONE', ''):
        return None
    return text


def normalize_text(value) -> Optional[str]:
    """Normalize text to uppercase, trimmed."""
    if pd.isna(value) or value is None:
        return None
    text = str(value).strip().upper()
    if text in ('', 'NAN', 'NONE'):
        return None
    return text


def parse_date(value) -> Optional[date]:
    """Parse date from various formats."""
    if pd.isna(value) or value is None:
        return None

    if isinstance(value, (datetime, date)):
        return value.date() if isinstance(value, datetime) else value

    text = str(value).strip()
    if not text or text.upper() in ('NAN', 'NONE', 'NAT'):
        return None

    # Remove extra spaces around delimiters (e.g., "25 /01/26" -> "25/01/26")
    text = re.sub(r'\s*([/-])\s*', r'\1', text)

    try:
        parsed = date_parser.parse(text, dayfirst=True)
        return parsed.date()
    except (ValueError, TypeError):
        return None


def calculate_week_number(d: date) -> tuple[int, int]:
    """Calculate ISO week number from date. Returns (year, week)."""
    iso_cal = d.isocalendar()
    return iso_cal[0], iso_cal[1]


def parse_hours(value) -> Optional[float]:
    """Parse hours from various formats."""
    if pd.isna(value) or value is None:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def parse_verification(value) -> bool:
    """Parse physical verification status.

    Handles various formats:
    - P, O (P = verified, O = not)
    - ✓, ✔ (checkmarks = verified)
    - ✗, ✕, × (X marks = not verified)
    - Yes/No, True/False
    """
    if pd.isna(value) or value is None:
        return False
    text = str(value).strip()
    # Check for checkmark symbols (verified)
    if any(c in text for c in ('✓', '✔', '☑', '✅')):
        return True
    # Check for X symbols (not verified)
    if any(c in text for c in ('✗', '✕', '×', '☒', '❌')):
        return False
    # Standard text checks
    text_upper = text.upper()
    return text_upper in ('P', 'YES', 'Y', 'TRUE', '1')


def extract_status_from_remarks(remarks: str, transfer_to: str = None) -> tuple[str, str]:
    """Extract status from remarks using keyword matching."""
    if not remarks and not transfer_to:
        return 'unverified', 'No remarks provided'

    text = (remarks or '').upper()

    if transfer_to and str(transfer_to).strip():
        return 'in_transit', f'Transfer to {transfer_to}'

    for status, keywords in STATUS_KEYWORDS.items():
        for keyword in keywords:
            if keyword.upper() in text:
                return status, f'Keyword "{keyword}" found in remarks'

    if remarks:
        return 'working', 'Has remarks but no status keywords - assuming working'

    return 'unverified', 'No remarks provided'


def extract_prefix(fleet_number: str) -> Optional[str]:
    """Extract letter prefix from fleet number."""
    if not fleet_number:
        return None
    match = re.match(r'^([A-Z]+)', fleet_number.upper())
    return match.group(1) if match else None


def find_column(df_columns: list, target: str) -> Optional[str]:
    """Find column name matching target, handling variations."""
    variations = COLUMN_MAPPINGS.get(target, [target])
    df_cols_upper = {c.upper().strip(): c for c in df_columns}

    for var in variations:
        var_upper = var.upper()
        if var_upper in df_cols_upper:
            return df_cols_upper[var_upper]
        for col_upper, col_orig in df_cols_upper.items():
            if var_upper in col_upper:
                return col_orig
    return None


# ============================================================================
# Metadata Extraction
# ============================================================================

@dataclass
class ReportMetadata:
    """Metadata extracted from report header."""
    location: str
    week_ending_date: date
    year: int
    week_number: int
    header_row: int
    source_file: str


def extract_metadata(file_path: Path) -> Optional[ReportMetadata]:
    """Extract metadata from Excel file header rows."""
    df = pd.read_excel(file_path, header=None, nrows=10)

    location = None
    week_ending_date = None
    header_row = None

    for i in range(min(10, len(df))):
        row = df.iloc[i]
        row_str = ' '.join([str(c) for c in row.values if pd.notna(c)])
        row_upper = row_str.upper()

        if 'SITE LOCATION' in row_upper or 'LOCATION' in row_upper:
            for j, cell in enumerate(row):
                cell_str = str(cell).strip() if pd.notna(cell) else ''
                if cell_str and len(cell_str) > 2:
                    if 'LOCATION' not in cell_str.upper() and 'P.W' not in cell_str.upper() and 'PW ' not in cell_str.upper():
                        if 'WEEKLY' not in cell_str.upper() and 'PLANT' not in cell_str.upper():
                            location = cell_str.upper().strip()
                            location = re.sub(r'^[\s\-_]+|[\s\-_]+$', '', location)
                            if location:
                                break

        if ('WEEK' in row_upper and 'ENDING' in row_upper) or 'DATE' in row_upper:
            # First try parsing each cell directly
            for j, cell in enumerate(row):
                parsed = parse_date(cell)
                if parsed:
                    week_ending_date = parsed
                    break

            # If no date found, try extracting date pattern from text cells
            if not week_ending_date:
                for j, cell in enumerate(row):
                    if pd.notna(cell):
                        cell_str = str(cell)
                        # Look for date patterns in text (DD/MM/YY, DD-MM-YY, DD/MM/YYYY)
                        # Handle optional spaces around delimiters (e.g., "25 /01/26")
                        date_match = re.search(r'(\d{1,2}\s*[/-]\s*\d{1,2}\s*[/-]\s*\d{2,4})', cell_str)
                        if date_match:
                            parsed = parse_date(date_match.group(1))
                            if parsed:
                                week_ending_date = parsed
                                break
                        # Look for DD-Mon-YYYY pattern
                        date_match = re.search(r'(\d{1,2}[/-][A-Za-z]{3}[/-]\d{2,4})', cell_str)
                        if date_match:
                            parsed = parse_date(date_match.group(1))
                            if parsed:
                                week_ending_date = parsed
                                break

        # Check for header row - look for fleet number column variations
        if any(x in row_upper for x in ['FLEETNUMBER', 'FLEET NUMBER', 'FLEET NO', 'FLEET . NO', 'FLEET.NO']):
            header_row = i
            break
        # Alternative: look for S/NO column which is always present in headers
        if 'S/NO' in row_upper and ('DESCRIPTION' in row_upper or 'HOURS' in row_upper):
            header_row = i
            break

    if not week_ending_date:
        for i in range(min(5, len(df))):
            for j in range(len(df.columns)):
                cell = df.iloc[i, j]
                parsed = parse_date(cell)
                if parsed and parsed.year >= 2020:
                    week_ending_date = parsed
                    break
            if week_ending_date:
                break

    if not location:
        location = file_path.stem.upper()
        location = re.sub(r'\s*WEEK\s*\d+.*$', '', location, flags=re.IGNORECASE).strip()

    if not week_ending_date:
        print(f"  WARNING: Could not extract date from {file_path.name}")
        return None

    if header_row is None:
        header_row = 3

    year, week_number = calculate_week_number(week_ending_date)

    return ReportMetadata(
        location=location,
        week_ending_date=week_ending_date,
        year=year,
        week_number=week_number,
        header_row=header_row,
        source_file=file_path.name,
    )


# ============================================================================
# ETL Pipeline (Batch Optimized)
# ============================================================================

@dataclass
class WeeklyETLStats:
    """Statistics from the ETL run."""
    files_processed: int = 0
    plants_processed: int = 0
    plants_created: int = 0
    plants_updated: int = 0
    plants_migrated_from_archive: int = 0
    snapshots_saved: int = 0
    location_changes: int = 0
    locations_created: int = 0
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)


class WeeklyReportETL:
    """ETL pipeline for processing weekly reports (batch optimized)."""

    def __init__(self, supabase: Client, parallel: bool = True):
        self.supabase = supabase
        self.stats = WeeklyETLStats()
        self.locations_cache: dict[str, str] = {}
        self.prefix_cache: dict[str, str] = {}
        self.plants_master_cache: dict[str, dict] = {}
        self.archived_plants_cache: dict[str, dict] = {}
        self.parallel = parallel

        # Thread locks for concurrent access (database handles its own concurrency)
        self._cache_lock = Lock()
        self._stats_lock = Lock()

    def run(self, reports_dir: Path) -> WeeklyETLStats:
        """Process all weekly reports in directory."""
        print(f"\n{'='*60}", flush=True)
        print(f"WEEKLY REPORT ETL PIPELINE ({'PARALLEL' if self.parallel else 'SEQUENTIAL'})", flush=True)
        print(f"{'='*60}", flush=True)
        print(f"Source: {reports_dir}", flush=True)

        start_time = time.time()
        self._load_caches()

        files = list(reports_dir.glob("*.xlsx"))
        print(f"\nFound {len(files)} report files")

        if self.parallel:
            self._process_parallel(files)
        else:
            self._process_sequential(files)

        elapsed = time.time() - start_time
        self._print_summary(elapsed)
        return self.stats

    def _process_sequential(self, files: list):
        """Process files one at a time."""
        for file_path in sorted(files):
            try:
                self._process_file(file_path)
                with self._stats_lock:
                    self.stats.files_processed += 1
            except Exception as e:
                with self._stats_lock:
                    self.stats.errors.append(f"{file_path.name}: {str(e)}")
                print(f"  ERROR: {e}")

    def _process_parallel(self, files: list):
        """Process files in parallel using thread pool."""
        print(f"Processing with {MAX_WORKERS} parallel workers...")

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            future_to_file = {executor.submit(self._process_file_safe, f): f for f in files}

            for future in as_completed(future_to_file):
                file_path = future_to_file[future]
                try:
                    future.result()
                    with self._stats_lock:
                        self.stats.files_processed += 1
                except Exception as e:
                    with self._stats_lock:
                        self.stats.errors.append(f"{file_path.name}: {str(e)}")
                    print(f"  ERROR [{file_path.name}]: {e}", flush=True)

    def _process_file_safe(self, file_path: Path):
        """Thread-safe wrapper for file processing."""
        try:
            self._process_file(file_path)
        except Exception as e:
            raise Exception(f"Failed to process {file_path.name}: {e}")

    def _load_caches(self):
        """Load all lookup data into memory."""
        print("\nLoading caches...")

        # Locations
        result = self.supabase.table("locations").select("id, name").execute()
        for loc in result.data:
            self.locations_cache[loc['name'].upper()] = loc['id']
        print(f"  Locations: {len(self.locations_cache)}")

        # Prefixes
        result = self.supabase.table("fleet_number_prefixes").select("prefix, fleet_type").execute()
        for p in result.data:
            self.prefix_cache[p['prefix']] = p['fleet_type']
        print(f"  Prefixes: {len(self.prefix_cache)}")

        # Plants master
        result = self.supabase.table("plants_master").select("*").execute()
        for plant in result.data:
            self.plants_master_cache[plant['fleet_number']] = plant
        print(f"  Plants master: {len(self.plants_master_cache)}")

        # Archived plants
        result = self.supabase.table("archived_plants").select("*").execute()
        for plant in result.data:
            self.archived_plants_cache[plant['fleet_number']] = plant
        print(f"  Archived plants: {len(self.archived_plants_cache)}")

    def _create_submission(self, file_path: Path, metadata: 'ReportMetadata', location_id: str) -> Optional[str]:
        """Create a weekly report submission record. Returns submission_id."""
        try:
            result = self.supabase.table("weekly_report_submissions").upsert({
                'year': metadata.year,
                'week_number': metadata.week_number,
                'week_ending_date': metadata.week_ending_date.isoformat(),
                'location_id': location_id,
                'source_type': 'etl',
                'source_file_name': file_path.name,
                'status': 'processing',
                'processing_started_at': datetime.now().isoformat(),
            }, on_conflict="year,week_number,location_id").execute()
            return result.data[0]['id'] if result.data else None
        except Exception as e:
            # Table might not have the unique constraint, try insert
            try:
                result = self.supabase.table("weekly_report_submissions").insert({
                    'year': metadata.year,
                    'week_number': metadata.week_number,
                    'week_ending_date': metadata.week_ending_date.isoformat(),
                    'location_id': location_id,
                    'source_type': 'etl',
                    'source_file_name': file_path.name,
                    'status': 'processing',
                    'processing_started_at': datetime.now().isoformat(),
                }).execute()
                return result.data[0]['id'] if result.data else None
            except:
                return None

    def _update_submission(self, submission_id: str, plants_processed: int, plants_created: int,
                           plants_updated: int, status: str = 'completed', errors: list = None):
        """Update submission record with results."""
        if not submission_id:
            return
        try:
            self.supabase.table("weekly_report_submissions").update({
                'status': status,
                'plants_processed': plants_processed,
                'plants_created': plants_created,
                'plants_updated': plants_updated,
                'processing_completed_at': datetime.now().isoformat(),
                'errors': errors or [],
            }).eq('id', submission_id).execute()
        except Exception as e:
            pass  # Ignore submission update errors

    def _process_file(self, file_path: Path):
        """Process a single weekly report file with batch operations."""
        print(f"\n[{file_path.name}]", flush=True)

        metadata = extract_metadata(file_path)
        if not metadata:
            self.stats.errors.append(f"{file_path.name}: Could not extract metadata")
            return

        print(f"  Location: {metadata.location}")
        print(f"  Week ending: {metadata.week_ending_date} (Week {metadata.week_number}, {metadata.year})")

        location_id = self._get_or_create_location(metadata.location)

        # Create submission record
        submission_id = self._create_submission(file_path, metadata, location_id)

        df = pd.read_excel(file_path, header=metadata.header_row)
        df.columns = [str(c).strip() for c in df.columns]

        # Find columns
        fleet_col = find_column(df.columns, 'fleet_number')
        desc_col = find_column(df.columns, 'description')
        hours_col = find_column(df.columns, 'hours_worked')
        standby_col = find_column(df.columns, 'standby_hours')
        breakdown_col = find_column(df.columns, 'breakdown_hours')
        offhire_col = find_column(df.columns, 'off_hire')
        from_col = find_column(df.columns, 'transfer_from')
        to_col = find_column(df.columns, 'transfer_to')
        remarks_col = find_column(df.columns, 'remarks')
        verify_col = find_column(df.columns, 'verification')

        if not fleet_col:
            self.stats.errors.append(f"{file_path.name}: Could not find fleet_number column")
            return

        # Collect all plant data first
        plants_to_create = []
        plants_to_update = []
        plants_to_migrate = []
        weekly_records = []
        location_history = []

        for _, row in df.iterrows():
            fleet_number = normalize_fleet_number(row.get(fleet_col))
            if not fleet_number:
                continue

            # Skip invalid fleet numbers
            if fleet_number in INVALID_FLEET_NUMBERS:
                continue

            # Skip compound references (e.g., FBT18>T526) and serial number patterns
            if '>' in fleet_number or fleet_number.startswith('BKD'):
                continue

            plant_data = {
                'fleet_number': fleet_number,
                'description': normalize_text(row.get(desc_col)) if desc_col else None,
                'hours_worked': parse_hours(row.get(hours_col)) if hours_col else None,
                'standby_hours': parse_hours(row.get(standby_col)) if standby_col else None,
                'breakdown_hours': parse_hours(row.get(breakdown_col)) if breakdown_col else None,
                'off_hire': bool(row.get(offhire_col)) if offhire_col else False,
                'transfer_from': normalize_text(row.get(from_col)) if from_col else None,
                'transfer_to': normalize_text(row.get(to_col)) if to_col else None,
                'remarks': normalize_text(row.get(remarks_col)) if remarks_col else None,
                'physical_verification': parse_verification(row.get(verify_col)) if verify_col else False,
            }

            status, status_remarks = extract_status_from_remarks(
                plant_data['remarks'], plant_data['transfer_to']
            )

            # Check where plant exists
            master_plant = self.plants_master_cache.get(fleet_number)
            archived_plant = self.archived_plants_cache.get(fleet_number)

            if master_plant:
                # Update existing
                plants_to_update.append({
                    'plant': master_plant,
                    'data': plant_data,
                    'status': status,
                    'status_remarks': status_remarks,
                    'location_id': location_id,
                    'metadata': metadata,
                })
            elif archived_plant:
                # Migrate from archive
                plants_to_migrate.append({
                    'archived': archived_plant,
                    'data': plant_data,
                    'status': status,
                    'status_remarks': status_remarks,
                    'location_id': location_id,
                    'metadata': metadata,
                })
            else:
                # Create new
                plants_to_create.append({
                    'data': plant_data,
                    'status': status,
                    'status_remarks': status_remarks,
                    'location_id': location_id,
                    'metadata': metadata,
                })

        # Batch process
        self._batch_create_plants(plants_to_create)
        self._batch_migrate_plants(plants_to_migrate)
        self._batch_update_plants(plants_to_update)

        # Now save weekly records for all plants
        self._batch_save_weekly_records(
            plants_to_create + plants_to_migrate + plants_to_update,
            metadata, location_id, submission_id
        )

        total = len(plants_to_create) + len(plants_to_migrate) + len(plants_to_update)
        print(f"  Processed {total} plants (new: {len(plants_to_create)}, migrated: {len(plants_to_migrate)}, updated: {len(plants_to_update)})")
        with self._stats_lock:
            self.stats.plants_processed += total

        # Update submission record with results
        self._update_submission(
            submission_id,
            plants_processed=total,
            plants_created=len(plants_to_create) + len(plants_to_migrate),
            plants_updated=len(plants_to_update),
            status='completed'
        )

    def _get_or_create_location(self, name: str) -> str:
        """Get location ID, creating if necessary. Thread-safe."""
        name_upper = name.upper()

        # First check cache without lock (fast path)
        if name_upper in self.locations_cache:
            return self.locations_cache[name_upper]

        # Need to create - use lock to prevent race conditions
        with self._cache_lock:
            # Double-check after acquiring lock
            if name_upper in self.locations_cache:
                return self.locations_cache[name_upper]

            try:
                result = self.supabase.table("locations").insert({"name": name_upper}).execute()
                location_id = result.data[0]['id']
                self.locations_cache[name_upper] = location_id
                self.stats.locations_created += 1
                print(f"  Created new location: {name_upper}", flush=True)
            except Exception as e:
                # Location might have been created by another thread, try to fetch it
                result = self.supabase.table("locations").select("id").eq("name", name_upper).execute()
                if result.data:
                    location_id = result.data[0]['id']
                    self.locations_cache[name_upper] = location_id
                else:
                    raise e

            return location_id

    def _get_fleet_type(self, fleet_number: str) -> Optional[str]:
        """Get fleet type from prefix lookup."""
        prefix = extract_prefix(fleet_number)
        return self.prefix_cache.get(prefix) if prefix else None

    def _batch_create_plants(self, plants: list):
        """Batch create new plants."""
        if not plants:
            return

        records = []
        for p in plants:
            data = p['data']
            records.append({
                'fleet_number': data['fleet_number'],
                'description': data['description'],
                'fleet_type': self._get_fleet_type(data['fleet_number']),
                'current_location_id': p['location_id'],
                'status': p['status'],
                'status_remarks': p['status_remarks'],
                'physical_verification': data['physical_verification'],
                'last_verified_date': p['metadata'].week_ending_date.isoformat(),
                'last_verified_year': p['metadata'].year,
                'last_verified_week': p['metadata'].week_number,
                'remarks': data['remarks'],
            })

        # Deduplicate records by fleet_number (keep last occurrence)
        seen = {}
        for idx, record in enumerate(records):
            seen[record['fleet_number']] = (idx, record)
        deduped_records = [v[1] for v in sorted(seen.values(), key=lambda x: x[0])]

        # Batch insert with upsert to handle duplicates gracefully
        for i in range(0, len(deduped_records), BATCH_SIZE):
            batch = deduped_records[i:i + BATCH_SIZE]
            try:
                result = self.supabase.table("plants_master").upsert(
                        batch, on_conflict="fleet_number"
                    ).execute()
                # Update cache and add location history for new plants
                for plant in result.data:
                    with self._cache_lock:
                        is_new = plant['fleet_number'] not in self.plants_master_cache
                        self.plants_master_cache[plant['fleet_number']] = plant
                    if is_new:
                        self._add_location_history(plant['id'], plant['current_location_id'],
                                                   plants[0]['metadata'].week_ending_date)
                        with self._stats_lock:
                            self.stats.plants_created += 1
            except Exception as e:
                with self._stats_lock:
                    self.stats.errors.append(f"Batch create error: {e}")

    def _batch_migrate_plants(self, plants: list):
        """Batch migrate plants from archive to master."""
        if not plants:
            return

        records = []
        fleet_numbers_to_delete = []

        for p in plants:
            archived = p['archived']
            data = p['data']
            fleet_numbers_to_delete.append(archived['fleet_number'])

            records.append({
                'fleet_number': archived['fleet_number'],
                'description': data['description'] or archived.get('description'),
                'fleet_type': archived.get('fleet_type') or self._get_fleet_type(archived['fleet_number']),
                'make': archived.get('make'),
                'model': archived.get('model'),
                'chassis_number': archived.get('chassis_number'),
                'year_of_manufacture': archived.get('year_of_manufacture'),
                'purchase_cost': float(archived['purchase_cost']) if archived.get('purchase_cost') else None,
                'serial_m': archived.get('serial_m'),
                'serial_e': archived.get('serial_e'),
                'current_location_id': p['location_id'],
                'status': p['status'],
                'status_remarks': p['status_remarks'],
                'physical_verification': data['physical_verification'],
                'last_verified_date': p['metadata'].week_ending_date.isoformat(),
                'last_verified_year': p['metadata'].year,
                'last_verified_week': p['metadata'].week_number,
                'remarks': data['remarks'],
            })

        # Deduplicate records by fleet_number (keep last occurrence)
        seen = {}
        for idx, record in enumerate(records):
            seen[record['fleet_number']] = (idx, record)
        deduped_records = [v[1] for v in sorted(seen.values(), key=lambda x: x[0])]
        deduped_fleet_numbers = [r['fleet_number'] for r in deduped_records]

        # Batch upsert to master (handles duplicates gracefully)
        for i in range(0, len(deduped_records), BATCH_SIZE):
            batch = deduped_records[i:i + BATCH_SIZE]
            batch_fleet_numbers = deduped_fleet_numbers[i:i + BATCH_SIZE]
            try:
                result = self.supabase.table("plants_master").upsert(
                        batch, on_conflict="fleet_number"
                    ).execute()
                migrated_count = 0
                for plant in result.data:
                    with self._cache_lock:
                        is_new = plant['fleet_number'] not in self.plants_master_cache
                        self.plants_master_cache[plant['fleet_number']] = plant
                        self.archived_plants_cache.pop(plant['fleet_number'], None)
                    if is_new:
                        self._add_location_history(plant['id'], plant['current_location_id'],
                                                   plants[0]['metadata'].week_ending_date)
                        migrated_count += 1

                # Delete from archive
                self.supabase.table("archived_plants").delete().in_("fleet_number", batch_fleet_numbers).execute()
                with self._stats_lock:
                    self.stats.plants_migrated_from_archive += migrated_count
            except Exception as e:
                with self._stats_lock:
                    self.stats.errors.append(f"Batch migrate error: {e}")

    def _batch_update_plants(self, plants: list):
        """Batch update existing plants."""
        if not plants:
            return

        for p in plants:
            master_plant = p['plant']
            data = p['data']
            metadata = p['metadata']

            # Check if report is newer
            last_verified = master_plant.get('last_verified_date')
            if last_verified:
                last_date = datetime.fromisoformat(last_verified).date() if isinstance(last_verified, str) else last_verified
                if metadata.week_ending_date < last_date:
                    continue  # Skip - this report is older

            # Check for location change
            old_location_id = master_plant.get('current_location_id')
            location_changed = old_location_id != p['location_id']

            updates = {
                'current_location_id': p['location_id'],
                'status': p['status'],
                'status_remarks': p['status_remarks'],
                'physical_verification': data['physical_verification'],
                'last_verified_date': metadata.week_ending_date.isoformat(),
                'last_verified_year': metadata.year,
                'last_verified_week': metadata.week_number,
                'remarks': data['remarks'],
                'updated_at': datetime.now().isoformat(),
            }

            if data['description'] and not master_plant.get('description'):
                updates['description'] = data['description']

            try:
                self.supabase.table("plants_master").update(updates).eq("id", master_plant['id']).execute()
                with self._cache_lock:
                    self.plants_master_cache[master_plant['fleet_number']].update(updates)

                if location_changed:
                    if old_location_id:
                        # Only close previous location if end_date would be valid (>= start_date)
                        existing = self.supabase.table("plant_location_history").select("start_date").eq(
                            "plant_id", master_plant['id']
                        ).is_("end_date", "null").execute()
                        if existing.data:
                            start_date_str = existing.data[0].get('start_date')
                            if start_date_str:
                                start_date = datetime.fromisoformat(start_date_str.replace('Z', '+00:00')).date()
                                if metadata.week_ending_date >= start_date:
                                    self.supabase.table("plant_location_history").update({
                                        'end_date': metadata.week_ending_date.isoformat()
                                    }).eq("plant_id", master_plant['id']).is_("end_date", "null").execute()
                    self._add_location_history(master_plant['id'], p['location_id'], metadata.week_ending_date)
                    with self._stats_lock:
                        self.stats.location_changes += 1

                with self._stats_lock:
                    self.stats.plants_updated += 1
            except Exception as e:
                with self._stats_lock:
                    self.stats.errors.append(f"Update error for {master_plant['fleet_number']}: {e}")

    def _add_location_history(self, plant_id: str, location_id: str, start_date: date):
        """Add location history record. Prevents duplicates by checking existing open record."""
        try:
            # Check if there's already an open record for this plant
            existing = self.supabase.table("plant_location_history").select(
                "id, location_id"
            ).eq("plant_id", plant_id).is_("end_date", "null").execute()

            if existing.data:
                # Already has an open record
                existing_location = existing.data[0]['location_id']
                if existing_location == location_id:
                    # Same location - no need to add another record
                    return
                else:
                    # Different location - close the old one first
                    self.supabase.table("plant_location_history").update({
                        'end_date': start_date.isoformat()
                    }).eq("id", existing.data[0]['id']).execute()

            # Add new location history record
            self.supabase.table("plant_location_history").insert({
                'plant_id': plant_id,
                'location_id': location_id,
                'start_date': start_date.isoformat(),
            }).execute()
        except Exception as e:
            pass  # Ignore errors

    def _batch_save_weekly_records(self, all_plants: list, metadata: ReportMetadata, location_id: str, submission_id: str = None):
        """Batch save weekly snapshots."""
        records = []

        for p in all_plants:
            data = p['data']
            fleet_number = data['fleet_number']
            master_plant = self.plants_master_cache.get(fleet_number)

            if not master_plant:
                continue

            record = {
                'plant_id': master_plant['id'],
                'location_id': location_id,
                'year': metadata.year,
                'week_number': metadata.week_number,
                'week_ending_date': metadata.week_ending_date.isoformat(),
                'physical_verification': data['physical_verification'],
                'remarks': data['remarks'],
                'raw_remarks': data['remarks'],
                'hours_worked': data['hours_worked'] or 0,
                'standby_hours': data['standby_hours'] or 0,
                'breakdown_hours': data['breakdown_hours'] or 0,
                'off_hire': data['off_hire'],
                'transfer_from': data['transfer_from'],
                'transfer_to': data['transfer_to'],
            }
            if submission_id:
                record['submission_id'] = submission_id
            records.append(record)

        # Batch upsert to handle existing records
        for i in range(0, len(records), BATCH_SIZE):
            batch = records[i:i + BATCH_SIZE]
            try:
                # Use upsert with the unique constraint columns
                self.supabase.table("plant_weekly_records").upsert(
                    batch, on_conflict="plant_id,year,week_number"
                ).execute()
                with self._stats_lock:
                    self.stats.snapshots_saved += len(batch)
            except Exception as e:
                # If batch fails, try one by one
                for record in batch:
                    try:
                        self.supabase.table("plant_weekly_records").upsert(
                            record, on_conflict="plant_id,year,week_number"
                        ).execute()
                        with self._stats_lock:
                            self.stats.snapshots_saved += 1
                    except:
                        pass  # Skip errors

    def _print_summary(self, elapsed: float = 0):
        """Print ETL summary."""
        print(f"\n{'='*60}")
        print("SUMMARY")
        print(f"{'='*60}")
        print(f"Files processed:           {self.stats.files_processed}")
        print(f"Plants processed:          {self.stats.plants_processed}")
        print(f"Plants created (new):      {self.stats.plants_created}")
        print(f"Plants updated:            {self.stats.plants_updated}")
        print(f"Migrated from archive:     {self.stats.plants_migrated_from_archive}")
        print(f"Weekly snapshots saved:    {self.stats.snapshots_saved}")
        print(f"Location changes:          {self.stats.location_changes}")
        print(f"New locations created:     {self.stats.locations_created}")
        if elapsed > 0:
            print(f"Time elapsed:              {elapsed:.1f}s")

        if self.stats.errors:
            print(f"\nErrors ({len(self.stats.errors)}):")
            for err in self.stats.errors[:10]:
                print(f"  - {err}")


# ============================================================================
# Main
# ============================================================================

def main():
    """Run the weekly report ETL pipeline."""
    errors = config.validate()
    if errors:
        print("Configuration errors:")
        for e in errors:
            print(f"  - {e}")
        return

    supabase = create_client(config.supabase_url, config.supabase_key)

    etl = WeeklyReportETL(supabase)
    stats = etl.run(config.weekly_reports_dir)

    print("\nDone!")


if __name__ == "__main__":
    main()
