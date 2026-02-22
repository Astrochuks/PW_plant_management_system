"""AI-powered remarks parser using Google Gemini.

Extracts structured information from free-text plant remarks including:
- Plant condition (operational, standby, breakdown, etc.)
- Transfer information (inbound/outbound, location)
- Condition notes
"""

import json
import re
from dataclasses import dataclass
from typing import Any

from app.config import get_settings
from app.monitoring.logging import get_logger

logger = get_logger(__name__)

# Lazy imports to avoid startup errors if API keys not configured
_openai_client = None
_gemini_model = None

# Commented out Gemini - kept for future fallback if needed
# _genai = None
# _model = None


def _get_openai_client():
    """Get or initialize the OpenAI client."""
    global _openai_client

    if _openai_client is not None:
        return _openai_client

    settings = get_settings()
    if not settings.openai_api_key:
        logger.warning("OpenAI API key not configured")
        return None

    try:
        from openai import OpenAI
        _openai_client = OpenAI(api_key=settings.openai_api_key)
        logger.info("OpenAI client initialized successfully")
        return _openai_client
    except Exception as e:
        logger.error("Failed to initialize OpenAI client", error=str(e))
        return None


def _get_gemini_model():
    """Get or initialize the Gemini model (fallback, commented out).

    Kept for future use if OpenAI quota is exceeded.
    """
    global _gemini_model

    if _gemini_model is not None:
        return _gemini_model

    settings = get_settings()
    if not settings.gemini_api_key:
        logger.debug("Gemini API key not configured")
        return None

    try:
        # Commented out Gemini initialization
        # import google.generativeai as genai
        # genai.configure(api_key=settings.gemini_api_key)
        # _gemini_model = genai.GenerativeModel("gemini-2.0-flash")
        # logger.info("Gemini model initialized successfully")
        # return _gemini_model
        logger.info("Gemini is disabled (kept for future fallback)")
        return None
    except Exception as e:
        logger.error("Failed to initialize Gemini model", error=str(e))
        return None


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
class ParsedRemarks:
    """Structured data extracted from plant remarks."""

    condition: str  # One of VALID_CONDITIONS
    transfer_detected: bool
    transfer_direction: str | None  # inbound, outbound, or None
    transfer_location: str | None  # Location name extracted from remarks
    transfer_date: str | None  # Date if mentioned
    condition_notes: str | None  # Brief summary of issues
    confidence: float  # 0.0 to 1.0

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "condition": self.condition,
            "transfer_detected": self.transfer_detected,
            "transfer_direction": self.transfer_direction,
            "transfer_location": self.transfer_location,
            "transfer_date": self.transfer_date,
            "condition_notes": self.condition_notes,
            "confidence": self.confidence,
        }


PARSE_PROMPT = """You are analyzing plant/equipment remarks from a weekly report.

Plant: {fleet_number}
Remarks: "{remarks}"
Hours worked: {hours_worked}
Standby hours: {standby_hours}
Breakdown hours: {breakdown_hours}
Off hire (from column): {off_hire}
Transfer from (column): {transfer_from}
Transfer to (column): {transfer_to}

Based on ALL the information above, determine:

1. CONDITION - The current state of this plant:
   - "operational" - Working normally, in use
   - "standby" - Available but idle, in workshop without issues, parked
   - "under_repair" - Being repaired, sent for rebore, strip in progress, awaiting parts
   - "breakdown" - Missing parts (no engine, no compressor), fire/burned, engine removed
   - "scrap" - Written off, decommissioned
   - "missing" - Cannot be found or verified
   - "off_hire" - Contractually not available
   - "gpm_assessment" - Needs GPM assessment/review
   - "unverified" - Cannot determine, "for checking", just "from X" with no other info

2. TRANSFER - Only track OUTBOUND transfers (going TO another location)
   - ONLY set transfer_detected=true if plant is being sent TO another location
   - "FROM X" in remarks does NOT count as a transfer - the plant is already here
   - transfer_to column indicates outbound transfer
   - Ignore transfer_from column for transfer detection

3. CONDITION NOTES - Brief summary of any issues or context

CONDITION EXAMPLES:
- "no engine and no compressor" → breakdown (missing parts)
- "engine block sent for rebore" → under_repair (active repair)
- "behind plant workshop" or "in workshop" (no issue mentioned) → standby
- "engine removed workshop" → breakdown (engine removed = missing part)
- "burned/fire" → breakdown
- "stand by (from bauchi)" → standby (the "from" is just origin info)
- "from bauchi" (nothing else) → unverified (no status info)
- "for checking" or "to be verified" → unverified
- "require gpm assessment" → gpm_assessment

IMPORTANT:
- The off_hire COLUMN takes precedence - if true, condition is "off_hire"
- "FROM X" in remarks just tells us where plant came from, NOT a transfer to track
- Only transfer_to column or "transferred to X" in remarks = outbound transfer
- If hours_worked > 0, plant is at least operational enough to work
- "problem (fixed)" means it WAS broken but is now operational

Return JSON:
{{
  "condition": "one of the values above",
  "transfer_detected": true or false,
  "transfer_direction": "outbound" or null,
  "transfer_location": "destination location name" or null,
  "condition_notes": "brief summary" or null,
  "confidence": 0.0 to 1.0
}}

Return ONLY valid JSON, no markdown formatting or code blocks."""


BATCH_PARSE_PROMPT = """You are analyzing plant/equipment remarks from a weekly report.

{plants_text}

For EACH plant, determine:

1. CONDITION - The current state:
   - "operational" - Working normally, in use
   - "standby" - Available but idle, in workshop without issues, parked
   - "under_repair" - Being repaired, sent for rebore, strip in progress, awaiting parts
   - "breakdown" - Missing parts (no engine, no compressor), fire/burned, engine removed
   - "scrap" - Written off, decommissioned
   - "missing" - Cannot be found or verified
   - "off_hire" - Contractually not available
   - "gpm_assessment" - Needs GPM assessment/review
   - "unverified" - Cannot determine, "for checking", just "from X" with no other info

2. TRANSFER - Only track OUTBOUND transfers
   - ONLY set transfer_detected=true if plant is being sent TO another location
   - "FROM X" does NOT count as transfer - plant is already at current location
   - Ignore transfer_from column

3. CONDITION NOTES - Brief summary of issues

CONDITION EXAMPLES:
- "no engine and no compressor" → breakdown
- "engine block sent for rebore" → under_repair
- "behind plant workshop" (no issue) → standby
- "engine removed workshop" → breakdown
- "burned/fire" → breakdown
- "stand by (from bauchi)" → standby
- "from bauchi" (nothing else) → unverified
- "for checking" → unverified
- "require gpm assessment" → gpm_assessment

IMPORTANT:
- off_hire COLUMN = true means condition is "off_hire"
- "FROM X" is just origin info, NOT a transfer to track
- Only "transferred to X" or transfer_to column = outbound transfer
- hours_worked > 0 means plant is operational enough to work
- "problem (fixed)" = operational

Return a JSON array:
[
  {{
    "fleet_number": "the fleet number",
    "condition": "one of the values above",
    "transfer_detected": true or false,
    "transfer_direction": "outbound" or null,
    "transfer_location": "destination location" or null,
    "condition_notes": "brief summary" or null,
    "confidence": 0.0 to 1.0
  }},
  ...
]

Return ONLY valid JSON array, no markdown or explanation."""


def fallback_parse(
    remarks: str | None,
    hours_worked: float,
    standby_hours: float,
    breakdown_hours: float,
    off_hire: bool,
    transfer_from: str | None = None,
    transfer_to: str | None = None,
) -> ParsedRemarks:
    """Smart fallback parser using pattern detection.

    Used when Gemini API is unavailable or fails.
    Patterns based on actual plant management terminology.
    """
    remarks_upper = (remarks or "").upper().strip()
    # Normalize: remove extra spaces
    remarks_normalized = " ".join(remarks_upper.split())

    # Default values
    transfer_detected = False
    transfer_direction = None
    transfer_location = None
    condition_notes = None

    # 0. Empty remarks → missing (no site engineer comment = not verified)
    if not remarks_normalized and not off_hire and hours_worked == 0 and standby_hours == 0 and breakdown_hours == 0:
        return ParsedRemarks(
            condition="missing",
            transfer_detected=False,
            transfer_direction=None,
            transfer_location=None,
            transfer_date=None,
            condition_notes="No remarks or usage data",
            confidence=0.7,
        )

    condition = "unverified"

    # 1. OFF HIRE COLUMN takes precedence
    if off_hire:
        return ParsedRemarks(
            condition="off_hire",
            transfer_detected=False,
            transfer_direction=None,
            transfer_location=None,
            transfer_date=None,
            condition_notes="Off hire flag set",
            confidence=0.9,
        )

    # 2. Only track OUTBOUND transfers (transfer_to column)
    # Inbound transfers (transfer_from) just mean plant is at current location
    if transfer_to:
        transfer_detected = True
        transfer_direction = "outbound"
        transfer_location = transfer_to

    # 3. Determine CONDITION from remarks - ORDER MATTERS (most specific first)

    # Check for "TO BE VERIFIED" or "FOR CHECKING" first
    if "TO BE VERIFIED" in remarks_normalized or "FOR CHECKING" in remarks_normalized:
        condition = "unverified"
        condition_notes = "Awaiting verification"

    # GPM Assessment
    elif "GPM" in remarks_normalized or "REQUIRE" in remarks_normalized and "ASSESSMENT" in remarks_normalized:
        condition = "gpm_assessment"
        condition_notes = "Requires GPM assessment"

    # SCRAP / decommissioned
    elif any(kw in remarks_normalized for kw in ["SCRAP", "WRITE OFF", "DECOMMISSION", "CONDEMNED"]):
        condition = "scrap"
        condition_notes = "Plant scrapped/decommissioned"

    # MISSING / not seen
    elif any(kw in remarks_normalized for kw in ["MISSING", "NOT SEEN", "NOT FOUND", "CANNOT LOCATE"]):
        condition = "missing"
        condition_notes = "Plant not found/verified"

    # OFF HIRE in remarks
    elif "OFF HIRE" in remarks_normalized or "OFFHIRE" in remarks_normalized:
        condition = "off_hire"
        condition_notes = "Off hire mentioned in remarks"

    # BREAKDOWN patterns - missing parts, burned, fire, removed parts
    elif any(kw in remarks_normalized for kw in [
        "NO ENGINE", "NO COMPRESSOR", "NO COIL", "NO PUMP", "NO BATTERY",
        "ENGINE REMOVED", "COMPRESSOR REMOVED", "REMOVED",
        "BURNED", "FIRE", "BURNT", "GUTTED",
        "ENGINE BLOCK", "CRACKED", "SEIZED",
        "NO TYRE", "NO TRACK", "NO BUCKET",
    ]):
        condition = "breakdown"
        condition_notes = "Missing parts or fire damage"

    # WORKING / operational patterns - explicitly operating
    elif (
        remarks_normalized == "WORKING"
        or any(kw in remarks_normalized for kw in [
            "WORKING ON THE SITE", "WORKING ON SITE", "WORKING IN THE YARD",
            "WORKING IN YARD", "WORKING ON THE PROJECT", "WORKING ON PROJECT",
            "IN OPERATION", "OPERATIONAL", "IN USE",
        ])
    ):
        condition = "working"
        condition_notes = "Plant operational"

    # UNDER REPAIR patterns - active repair work
    elif any(kw in remarks_normalized for kw in [
        "SENT FOR", "FOR REBORE", "FOR REPAIRS", "FOR REPAIR",
        "STRIP", "STRIPPING", "IN PROGRESS", "WORKING ON IT",
        "WORKING ON THE ENGINE", "WORKING ON THE PUMP",
        "UNDER REPAIR", "UNDER MAINTENANCE", "BEING REPAIRED",
        "AWAITING PARTS", "WAITING FOR PARTS", "PARTS ORDERED",
    ]):
        condition = "under_repair"
        condition_notes = "Under repair/maintenance"

    # STANDBY patterns - in workshop/location without issues
    elif any(kw in remarks_normalized for kw in [
        "PLANT WORKSHOP", "BEHIND WORKSHOP", "IN WORKSHOP", "AT WORKSHOP",
        "BEHIND PLANT", "STAND BY", "STANDBY", "ON STANDBY",
        "IDLE", "AVAILABLE", "PARKED",
    ]):
        # Check if there's also an issue mentioned - if so, it's breakdown
        issue_keywords = ["NO ENGINE", "NO COMPRESSOR", "REMOVED", "BURNED", "FAULT", "BROKEN"]
        has_issue = any(kw in remarks_normalized for kw in issue_keywords)
        if has_issue:
            condition = "breakdown"
            condition_notes = "In workshop with issues"
        else:
            condition = "standby"
            condition_notes = "Available/on standby"

    # Repair completed
    elif any(kw in remarks_normalized for kw in ["(FIXED)", "(COMPLETED)", "(REPAIRED)", "FIXED", "REPAIRED"]):
        condition = "working"
        condition_notes = "Repair completed"

    # Generic problem/fault keywords
    elif any(kw in remarks_normalized for kw in ["PROBLEM", "FAULT", "BROKEN", "DEFECT", "DAMAGE", "ISSUE", "FAULTY"]):
        if hours_worked > 0:
            condition = "working"
            condition_notes = "Has issue but operational"
        else:
            condition = "breakdown"
            condition_notes = "Has reported issue"

    # "FROM (location)" with no other context = unverified
    elif re.match(r"^FROM\s+\w+$", remarks_normalized) or re.match(r"^FROM\s+\w+\s+\w+$", remarks_normalized):
        # Just "FROM BAUCHI" or "FROM FOKE QUARRY" with nothing else
        condition = "unverified"
        condition_notes = "Transferred in, status unknown"

    # No clear keywords - derive from hours
    else:
        if breakdown_hours > hours_worked and breakdown_hours > 0:
            condition = "breakdown"
            condition_notes = "Breakdown hours exceed working hours"
        elif hours_worked > 0:
            condition = "working"
            condition_notes = None
        elif standby_hours > 0:
            condition = "standby"
            condition_notes = "On standby"
        else:
            condition = "unverified"
            condition_notes = "No clear data available"

    # Check for OUTBOUND transfers in remarks if not in columns
    # We only track outbound (going TO), not inbound (coming FROM)
    if not transfer_detected:
        if any(kw in remarks_normalized for kw in ["TRANSFERRED TO", "SENT TO", "MOVED TO", "GOING TO", "TO BE TRANSFERRED TO"]):
            transfer_detected = True
            transfer_direction = "outbound"
            for pattern in [r"TRANSFERRED TO\s+(\w+)", r"SENT TO\s+(\w+)", r"MOVED TO\s+(\w+)", r"GOING TO\s+(\w+)"]:
                match = re.search(pattern, remarks_normalized)
                if match:
                    transfer_location = match.group(1)
                    break

    return ParsedRemarks(
        condition=condition,
        transfer_detected=transfer_detected,
        transfer_direction=transfer_direction,
        transfer_location=transfer_location,
        transfer_date=None,
        condition_notes=condition_notes,
        confidence=0.6,  # Slightly higher confidence with improved patterns
    )


async def parse_remarks(
    remarks: str | None,
    hours_worked: float = 0,
    standby_hours: float = 0,
    breakdown_hours: float = 0,
    off_hire: bool = False,
    transfer_from: str | None = None,
    transfer_to: str | None = None,
    fleet_number: str = "",
) -> ParsedRemarks:
    """Parse a single plant's remarks using keyword pattern matching.

    Args:
        remarks: The free-text remarks from the report.
        hours_worked: Hours worked this week.
        standby_hours: Standby hours this week.
        breakdown_hours: Breakdown hours this week.
        off_hire: Whether the plant is marked off hire (from column).
        transfer_from: Transfer from column value.
        transfer_to: Transfer to column value.
        fleet_number: The fleet number for context.

    Returns:
        ParsedRemarks with extracted information.
    """
    return fallback_parse(
        remarks, hours_worked, standby_hours, breakdown_hours,
        off_hire, transfer_from, transfer_to
    )


async def parse_remarks_batch(plants_data: list[dict]) -> dict[str, ParsedRemarks]:
    """Parse multiple plants' remarks using keyword pattern matching.

    Args:
        plants_data: List of dicts with keys:
            - fleet_number: str
            - remarks: str | None
            - hours_worked: float
            - standby_hours: float
            - breakdown_hours: float
            - off_hire: bool
            - transfer_from: str | None (optional)
            - transfer_to: str | None (optional)

    Returns:
        Dict mapping fleet_number to ParsedRemarks.
    """
    if not plants_data:
        return {}

    results = {}
    for plant in plants_data:
        fn = plant["fleet_number"].upper().replace(" ", "")
        results[fn] = fallback_parse(
            plant.get("remarks"),
            plant.get("hours_worked", 0),
            plant.get("standby_hours", 0),
            plant.get("breakdown_hours", 0),
            plant.get("off_hire", False),
            plant.get("transfer_from"),
            plant.get("transfer_to"),
        )

    logger.info(
        "Batch parsed remarks (keyword)",
        total=len(plants_data),
        results_count=len(results),
    )

    return results


def derive_condition(
    parsed: ParsedRemarks,
    hours_worked: float,
    standby_hours: float,
    breakdown_hours: float,
    off_hire: bool,
    physical_verification: bool | None = None,
) -> str:
    """Derive final plant condition combining AI parsing with explicit data.

    This provides a second layer of validation on top of AI parsing.

    Args:
        parsed: AI-parsed remarks result.
        hours_worked: Hours worked this week.
        standby_hours: Standby hours this week.
        breakdown_hours: Breakdown hours this week.
        off_hire: Whether marked off hire (from column).
        physical_verification: Physical verification status.

    Returns:
        Final condition string.
    """
    # 1. OFF HIRE COLUMN takes absolute precedence
    if off_hire:
        return "off_hire"

    # 2. If AI has high confidence, trust it
    if parsed.confidence >= 0.7:
        return parsed.condition

    # 3. Fallback to hours-based derivation
    if breakdown_hours > hours_worked and breakdown_hours > 0:
        return "breakdown"
    elif hours_worked > 0:
        return "operational"
    elif standby_hours > 0:
        return "standby"

    # 4. Use AI result even with lower confidence
    if parsed.condition and parsed.condition in VALID_CONDITIONS:
        return parsed.condition

    return "unverified"


# Backwards compatibility - deprecated functions
def derive_status_and_condition(
    parsed: ParsedRemarks,
    hours_worked: float,
    standby_hours: float,
    breakdown_hours: float,
    off_hire: bool,
    physical_verification: bool | None = None,
) -> tuple[str, str]:
    """DEPRECATED: Use derive_condition instead.

    Returns tuple of (status, condition) for backwards compatibility.
    Now both values are the same since we unified them.
    """
    condition = derive_condition(
        parsed, hours_worked, standby_hours, breakdown_hours, off_hire, physical_verification
    )
    # Map condition to old status values for backwards compatibility
    status_map = {
        "operational": "working",
        "standby": "standby",
        "breakdown": "breakdown",
        "under_repair": "breakdown",
        "scrap": "breakdown",
        "missing": "missing",
        "off_hire": "off_hire",
        "gpm_assessment": "unverified",
        "unverified": "unverified",
    }
    status = status_map.get(condition, "unverified")
    return status, condition


def derive_status_from_data(
    parsed: ParsedRemarks,
    hours_worked: float,
    standby_hours: float,
    breakdown_hours: float,
    off_hire: bool,
    physical_verification: bool | None = None,
) -> str:
    """DEPRECATED: Use derive_condition instead."""
    status, _ = derive_status_and_condition(
        parsed, hours_worked, standby_hours, breakdown_hours, off_hire, physical_verification
    )
    return status
