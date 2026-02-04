"""
Plant Management System - ETL Pipeline

A production-ready ETL pipeline for extracting plant data from Excel files,
transforming/cleaning it, and loading into Supabase.
"""

__version__ = "1.0.0"

from .config import ETLConfig, config
from .pipeline import ETLPipeline, run_pipeline, PipelineResult
from .extractors import (
    ExtractedPlant,
    ExtractedSparePart,
    ExtractionResult,
    WeeklyReportExtractor,
    LegacyPlantExtractor,
    SparePartsExtractor,
)
from .validators import PlantValidator, SparePartValidator, ValidationResult
from .loaders import SupabaseLoader, LoadResult

__all__ = [
    # Config
    "ETLConfig",
    "config",
    # Pipeline
    "ETLPipeline",
    "run_pipeline",
    "PipelineResult",
    # Extractors
    "ExtractedPlant",
    "ExtractedSparePart",
    "ExtractionResult",
    "WeeklyReportExtractor",
    "LegacyPlantExtractor",
    "SparePartsExtractor",
    # Validators
    "PlantValidator",
    "SparePartValidator",
    "ValidationResult",
    # Loaders
    "SupabaseLoader",
    "LoadResult",
]
