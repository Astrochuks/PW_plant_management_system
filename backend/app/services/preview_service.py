"""Preview service for weekly report uploads.

Provides keyword-based auto-detection with admin validation before saving.
Replaces AI-based approach with faster, more controllable system.
"""

import re
from dataclasses import dataclass
from typing import Any

import pandas as pd

from app.monitoring.logging import get_logger

logger = get_logger(__name__)


# Valid condition values
VALID_CONDITIONS = [
    "working",        # Working normally, in use (was "operational")
    "standby",        # Available but not currently in use
    "under_repair",   # Being repaired or maintained
    "breakdown",      # Not working due to fault/damage
    "faulty",         # Has a fault but still partially functional
    "scrap",          # Written off, decommissioned
    "missing",        # Cannot be found or verified
    "off_hire",       # Contractually not available
    "gpm_assessment", # Needs GPM assessment/review
    "unverified",     # Cannot determine from available data
]


@dataclass
class DetectedCondition:
    """Auto-detected condition from keywords and data."""

    condition: str  # One of VALID_CONDITIONS
    confidence: str  # "high", "medium", "low"
    reason: str  # Why this was detected (for admin review)


@dataclass
class DetectedTransfer:
    """Auto-detected transfer from remarks."""

    transfer_from: str | None  # Location name from remarks
    transfer_to: str | None  # Location name from remarks
    confidence: str  # "high", "medium", "low"


def detect_condition_from_keywords(
    remarks: str | None,
    hours_worked: float,
    standby_hours: float,
    breakdown_hours: float,
    off_hire: bool,
    physical_verification: bool,
) -> DetectedCondition:
    """Detect plant condition using keywords and data.

    Fast, deterministic detection that gives admin a good starting point.
    Admin can override via dropdown if needed.

    Args:
        remarks: Free-text remarks from Excel.
        hours_worked: Hours worked this week.
        standby_hours: Standby hours this week.
        breakdown_hours: Breakdown hours this week.
        off_hire: Whether marked off hire (from column).
        physical_verification: Whether plant was physically verified.

    Returns:
        DetectedCondition with condition, confidence, and reason.
    """
    # 1. OFF HIRE column = highest confidence
    if off_hire:
        return DetectedCondition(
            condition="off_hire",
            confidence="high",
            reason="Off hire column is checked"
        )

    # 2. Not physically verified
    if not physical_verification:
        return DetectedCondition(
            condition="unverified",
            confidence="high",
            reason="Not physically verified"
        )

    # 3. Check remarks for clear keywords
    if remarks:
        r = remarks.upper()

        # SCRAP - very clear
        if any(kw in r for kw in ["SCRAP", "SCRAP YARD", "WRITE OFF", "CONDEMNED", "DECOMMISSION"]):
            return DetectedCondition(
                condition="scrap",
                confidence="high",
                reason=f"Keyword detected: {remarks[:50]}"
            )

        # MISSING - very clear
        if any(kw in r for kw in ["MISSING", "NOT SEEN", "NOT FOUND", "STOLEN", "CANNOT LOCATE"]):
            return DetectedCondition(
                condition="missing",
                confidence="high",
                reason=f"Keyword detected: {remarks[:50]}"
            )

        # BREAKDOWN - missing parts or fire damage
        breakdown_keywords = [
            "NO ENGINE", "NO COMPRESSOR", "NO COIL", "NO PUMP", "NO BATTERY",
            "ENGINE REMOVED", "COMPRESSOR REMOVED", "REMOVED ENGINE",
            "BURNED", "FIRE", "BURNT", "GUTTED",
            "ENGINE BLOCK", "CRACKED ENGINE", "SEIZED",
            "NO TYRE", "NO TYRES", "NO TRACK", "NO BUCKET"
        ]
        if any(kw in r for kw in breakdown_keywords):
            return DetectedCondition(
                condition="breakdown",
                confidence="high",
                reason=f"Missing parts/damage: {remarks[:50]}"
            )

        # UNDER REPAIR - active repair work
        repair_keywords = [
            "SENT FOR REBORE", "FOR REBORE", "SENT FOR REPAIRS", "FOR REPAIRS",
            "STRIP IN PROGRESS", "STRIPPING", "WORKING ON",
            "UNDER REPAIR", "UNDER MAINTENANCE", "BEING REPAIRED",
            "AWAITING PARTS", "WAITING FOR PARTS", "PARTS ORDERED"
        ]
        if any(kw in r for kw in repair_keywords):
            return DetectedCondition(
                condition="under_repair",
                confidence="high",
                reason=f"Repair work: {remarks[:50]}"
            )

        # FAULTY - has a fault but still partially functional
        faulty_keywords = [
            "FAULTY", "FAULT", "DEFECTIVE", "DEFECT", "MALFUNCTIONING",
            "NOT WORKING PROPERLY", "INTERMITTENT", "ERRATIC"
        ]
        if any(kw in r for kw in faulty_keywords):
            return DetectedCondition(
                condition="faulty",
                confidence="high",
                reason=f"Keyword detected: {remarks[:50]}"
            )

        # WORKING - actively in use
        working_keywords = [
            "WORKING", "IN USE", "RUNNING", "OPERATING", "ACTIVE"
        ]
        if any(kw in r for kw in working_keywords):
            return DetectedCondition(
                condition="working",
                confidence="high",
                reason=f"Keyword detected: {remarks[:50]}"
            )

        # STANDBY - idle/available
        standby_keywords = [
            "STANDBY", "STAND BY", "STAND-BY",
            "IDLE", "AVAILABLE", "PARKED",
            "BEHIND PLANT", "PLANT WORKSHOP", "IN WORKSHOP", "AT WORKSHOP"
        ]
        if any(kw in r for kw in standby_keywords):
            # Check if there's also a problem mentioned
            if any(kw in r for kw in ["NO ENGINE", "NO COMPRESSOR", "REMOVED", "BURNED"]):
                return DetectedCondition(
                    condition="breakdown",
                    confidence="high",
                    reason=f"In workshop with issues: {remarks[:50]}"
                )
            return DetectedCondition(
                condition="standby",
                confidence="high",
                reason=f"Keyword detected: {remarks[:50]}"
            )

        # GPM ASSESSMENT
        if "GPM" in r or ("REQUIRE" in r and "ASSESSMENT" in r):
            return DetectedCondition(
                condition="gpm_assessment",
                confidence="high",
                reason=f"Keyword detected: {remarks[:50]}"
            )

        # Check for "FIXED" or "REPAIRED" - means now working
        if any(kw in r for kw in ["FIXED", "REPAIRED", "COMPLETED"]):
            return DetectedCondition(
                condition="working",
                confidence="high",
                reason=f"Repair completed: {remarks[:50]}"
            )

    # 4. Use hours data (medium confidence - should verify)
    if breakdown_hours > hours_worked and breakdown_hours > 0:
        return DetectedCondition(
            condition="breakdown",
            confidence="medium",
            reason=f"Breakdown hours ({breakdown_hours}) > working hours ({hours_worked})"
        )
    elif hours_worked > 0:
        return DetectedCondition(
            condition="working",
            confidence="medium",
            reason=f"Has working hours: {hours_worked}"
        )
    elif standby_hours > 0:
        return DetectedCondition(
            condition="standby",
            confidence="medium",
            reason=f"Has standby hours: {standby_hours}"
        )

    # 5. Default - low confidence, admin should check
    if remarks and remarks.strip():
        return DetectedCondition(
            condition="standby",
            confidence="low",
            reason="No clear keywords, defaulting to standby"
        )
    else:
        return DetectedCondition(
            condition="standby",
            confidence="low",
            reason="No remarks or hours data"
        )


def detect_transfers_from_remarks(remarks: str | None) -> DetectedTransfer:
    """Detect transfer information from remarks.

    Patterns detected:
    - "transferred to X", "sent to X", "moved to X" → transfer_to
    - "from X", "received from X" → transfer_from
    - "on the way to X" → transfer_to
    - "on the way from X" → transfer_from

    Args:
        remarks: Free-text remarks from Excel.

    Returns:
        DetectedTransfer with from/to location names and confidence.
    """
    transfer = DetectedTransfer(
        transfer_from=None,
        transfer_to=None,
        confidence="high"
    )

    if not remarks:
        return transfer

    r = remarks.upper()

    # OUTBOUND: "TRANSFERRED TO X", "SENT TO X", "ON THE WAY TO X"
    outbound_patterns = [
        r"TRANSFERRED TO\s+([A-Z\s\-]+?)(?:\s|$|,|\.|;)",
        r"SENT TO\s+([A-Z\s\-]+?)(?:\s|$|,|\.|;)",
        r"MOVED TO\s+([A-Z\s\-]+?)(?:\s|$|,|\.|;)",
        r"GOING TO\s+([A-Z\s\-]+?)(?:\s|$|,|\.|;)",
        r"ON THE WAY TO\s+([A-Z\s\-]+?)(?:\s|$|,|\.|;)",
        r"ON WAY TO\s+([A-Z\s\-]+?)(?:\s|$|,|\.|;)",
    ]

    for pattern in outbound_patterns:
        match = re.search(pattern, r)
        if match:
            location = match.group(1).strip()
            # Clean up location name
            location = location.rstrip(",.:;")
            if location and len(location) > 2:
                transfer.transfer_to = location
                break

    # INBOUND: "FROM X", "RECEIVED FROM X", "ON THE WAY FROM X"
    inbound_patterns = [
        r"RECEIVED FROM\s+([A-Z\s\-]+?)(?:\s|$|,|\.|;)",
        r"FROM\s+([A-Z\s\-]+?)(?:\s|$|,|\.|;)",
        r"ON THE WAY FROM\s+([A-Z\s\-]+?)(?:\s|$|,|\.|;)",
        r"ON WAY FROM\s+([A-Z\s\-]+?)(?:\s|$|,|\.|;)",
    ]

    for pattern in inbound_patterns:
        match = re.search(pattern, r)
        if match:
            location = match.group(1).strip()
            # Clean up location name
            location = location.rstrip(",.:;")
            if location and len(location) > 2:
                transfer.transfer_from = location
                break

    return transfer


def normalize_location_name(location_name: str) -> str:
    """Normalize location name for matching.

    Handles variations like:
    - "KADUNA" vs "KADUNA SITE"
    - "FOKE" vs "ABEOKUTA-SHAGAMU QUARRY"
    - Extra spaces, punctuation
    """
    if not location_name:
        return ""

    # Remove extra whitespace and punctuation
    normalized = " ".join(location_name.strip().upper().split())
    normalized = normalized.replace("-", " ").replace("_", " ")

    # Common variations
    normalized = normalized.replace(" SITE", "").replace(" QUARRY", "")

    return normalized


def match_location_to_id(
    location_name: str | None,
    available_locations: list[dict[str, Any]],
    location_aliases: dict[str, str],
) -> tuple[str | None, str | None]:
    """Match detected location name to actual location ID.

    Args:
        location_name: Detected location name from remarks.
        available_locations: List of {id, name} dicts.
        location_aliases: Dict of alias -> canonical name.

    Returns:
        Tuple of (location_id, matched_name) or (None, None) if no match.
    """
    if not location_name:
        return None, None

    # Normalize for matching
    normalized = normalize_location_name(location_name)

    # 1. Check exact match
    for loc in available_locations:
        if normalize_location_name(loc["name"]) == normalized:
            return loc["id"], loc["name"]

    # 2. Check aliases
    for alias, canonical in location_aliases.items():
        if normalize_location_name(alias) == normalized:
            # Find location with canonical name
            for loc in available_locations:
                if normalize_location_name(loc["name"]) == normalize_location_name(canonical):
                    return loc["id"], loc["name"]

    # 3. Check partial match (location name starts with detected name)
    for loc in available_locations:
        loc_normalized = normalize_location_name(loc["name"])
        if loc_normalized.startswith(normalized) or normalized.startswith(loc_normalized):
            return loc["id"], loc["name"]

    # No match found
    return None, None


def parse_hours(value: Any) -> float:
    """Parse hours value from Excel, handling various formats."""
    if pd.isna(value):
        return 0.0

    try:
        if isinstance(value, (int, float)):
            return max(0.0, float(value))

        # Handle string values
        s = str(value).strip().lower()
        # Remove common suffixes
        s = s.replace("hrs", "").replace("hr", "").replace("h", "").strip()

        if not s or s in ("nan", "none", "-", "n/a"):
            return 0.0

        return max(0.0, float(s))
    except (ValueError, TypeError):
        return 0.0


def parse_off_hire(value: Any) -> bool:
    """Parse off hire value from Excel."""
    if pd.isna(value):
        return False

    if isinstance(value, bool):
        return value

    s = str(value).strip().lower()

    # Common True values
    if s in ("true", "yes", "1", "y", "x", "✓", "✔", "checked"):
        return True

    return False
