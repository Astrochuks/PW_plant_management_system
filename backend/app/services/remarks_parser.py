"""AI-powered remarks parser using Google Gemini.

Extracts structured information from free-text plant remarks including:
- Plant status (working, standby, breakdown, faulty, etc.)
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

# Lazy import to avoid startup errors if API key not configured
_genai = None
_model = None


def _get_model():
    """Get or initialize the Gemini model."""
    global _genai, _model

    if _model is not None:
        return _model

    settings = get_settings()
    if not settings.gemini_api_key:
        logger.warning("Gemini API key not configured, using fallback parser")
        return None

    try:
        import google.generativeai as genai
        _genai = genai
        genai.configure(api_key=settings.gemini_api_key)
        _model = genai.GenerativeModel("gemini-2.5-flash")
        logger.info("Gemini model initialized successfully")
        return _model
    except Exception as e:
        logger.error("Failed to initialize Gemini model", error=str(e))
        return None


@dataclass
class ParsedRemarks:
    """Structured data extracted from plant remarks."""

    status: str  # Operational: working, standby, breakdown, off_hire, missing, in_transit, unverified
    condition: str  # Physical: good, faulty, needs_repair, scrap
    transfer_detected: bool
    transfer_direction: str | None  # inbound, outbound, or None
    transfer_location: str | None  # Location name extracted from remarks
    transfer_date: str | None  # Date if mentioned
    condition_notes: str | None  # Brief summary of issues
    confidence: float  # 0.0 to 1.0

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "status": self.status,
            "condition": self.condition,
            "transfer_detected": self.transfer_detected,
            "transfer_direction": self.transfer_direction,
            "transfer_location": self.transfer_location,
            "transfer_date": self.transfer_date,
            "condition_notes": self.condition_notes,
            "confidence": self.confidence,
        }


PARSE_PROMPT = """Analyze this plant/equipment remark from a weekly report and extract structured information.

Remark: "{remarks}"
Hours worked this week: {hours_worked}
Standby hours: {standby_hours}
Breakdown hours: {breakdown_hours}
Off hire flag: {off_hire}

Extract the following as JSON:
{{
  "status": "working|standby|breakdown|off_hire|in_transit|unverified",
  "condition": "good|faulty|needs_repair|scrap",
  "transfer_detected": true or false,
  "transfer_direction": "inbound" or "outbound" or null,
  "transfer_location": "location name" or null,
  "transfer_date": "date mentioned" or null,
  "condition_notes": "brief summary of issues" or null,
  "confidence": 0.0 to 1.0
}}

STATUS is the OPERATIONAL state (what is the plant doing):
- "working" = actively being used (has working hours)
- "standby" = available but not in use (only standby hours)
- "breakdown" = not operational due to mechanical failure
- "off_hire" = not available for use (contractually off hire)
- "in_transit" = being transferred to another location
- "unverified" = cannot determine from data

CONDITION is the PHYSICAL state (what shape is the plant in):
- "good" = no issues reported, operating normally
- "faulty" = has issues but may still be operational
- "needs_repair" = requires maintenance or repair
- "scrap" = beyond repair, write-off

Rules for STATUS:
1. If off_hire is true or "OFF HIRE" in remarks → "off_hire"
2. If "transferred" or "sent to" in remarks → "in_transit"
3. If breakdown_hours > hours_worked → "breakdown"
4. If hours_worked = 0 AND standby_hours > 0 → "standby"
5. If hours_worked > 0 → "working"
6. Default to "unverified" if unclear

Rules for CONDITION:
1. If "SCRAP" or "SCRAPPED" in remarks → "scrap"
2. If "problem" or "fault" or "issue" mentioned WITHOUT "(fixed)" → "faulty"
3. If "repair" or "maintenance" mentioned → "needs_repair"
4. If "problem (fixed)" or issue resolved → "good"
5. Default to "good" if no issues mentioned

IMPORTANT: A plant can be FAULTY but still WORKING (has issues but operational).
Example: "Engine problem but working" → status="working", condition="faulty"

Rules for transfers:
- "received from X" or "from X" → inbound transfer
- "transferred to X" or "sent to X" → outbound transfer

Return ONLY valid JSON, no markdown formatting or code blocks."""


BATCH_PARSE_PROMPT = """Analyze these plant/equipment remarks from a weekly report and extract structured information for each.

{plants_text}

For EACH plant, extract:
{{
  "fleet_number": "the fleet number",
  "status": "working|standby|breakdown|off_hire|in_transit|unverified",
  "condition": "good|faulty|needs_repair|scrap",
  "transfer_detected": true or false,
  "transfer_direction": "inbound" or "outbound" or null,
  "transfer_location": "location name" or null,
  "transfer_date": "date mentioned" or null,
  "condition_notes": "brief summary of issues" or null,
  "confidence": 0.0 to 1.0
}}

STATUS is OPERATIONAL state (what is the plant doing):
- "working" = has working hours
- "standby" = only standby hours
- "breakdown" = breakdown hours > working hours
- "off_hire" = marked off hire
- "in_transit" = being transferred
- "unverified" = unclear

CONDITION is PHYSICAL state (what shape is it in):
- "good" = no issues
- "faulty" = has issues but may work
- "needs_repair" = requires maintenance
- "scrap" = beyond repair

IMPORTANT: A plant can be FAULTY but WORKING (issues but operational).

Rules for transfers:
- "received from X" or "from X" → inbound transfer
- "transferred to X" or "sent to X" → outbound transfer

Return ONLY a JSON array with one object per plant. No markdown or explanation."""


def fallback_parse(
    remarks: str | None,
    hours_worked: float,
    standby_hours: float,
    breakdown_hours: float,
    off_hire: bool,
) -> ParsedRemarks:
    """Simple fallback parser using keyword detection.

    Used when Gemini API is unavailable or fails.
    """
    remarks_upper = (remarks or "").upper().strip()

    # Default values
    status = "working"
    condition = "good"
    transfer_detected = False
    transfer_direction = None
    transfer_location = None
    condition_notes = None

    # Determine CONDITION first (physical state)
    if "SCRAP" in remarks_upper:
        condition = "scrap"
    elif any(kw in remarks_upper for kw in ["PROBLEM", "FAULT", "ISSUE", "DEFECT", "DAMAGE"]):
        if "(FIXED)" in remarks_upper or "(REPAIRED)" in remarks_upper or "FIXED" in remarks_upper:
            condition = "good"
            condition_notes = "Issue was fixed"
        else:
            condition = "faulty"
            condition_notes = "Has reported issue"
    elif any(kw in remarks_upper for kw in ["REPAIR", "MAINTENANCE", "SERVICE"]):
        condition = "needs_repair"
        condition_notes = "Requires maintenance"

    # Determine STATUS (operational state)
    if off_hire or "OFF HIRE" in remarks_upper or "OFFHIRE" in remarks_upper:
        status = "off_hire"
    elif any(kw in remarks_upper for kw in ["TRANSFERRED TO", "SENT TO", "MOVED TO", "GOING TO"]):
        status = "in_transit"
        transfer_detected = True
        transfer_direction = "outbound"
        # Try to extract location
        for pattern in [r"TRANSFERRED TO\s+(\w+)", r"SENT TO\s+(\w+)", r"MOVED TO\s+(\w+)"]:
            match = re.search(pattern, remarks_upper)
            if match:
                transfer_location = match.group(1)
                break
    elif any(kw in remarks_upper for kw in ["RECEIVED FROM", "FROM ", "ARRIVED FROM"]):
        transfer_detected = True
        transfer_direction = "inbound"
        for pattern in [r"RECEIVED FROM\s+(\w+)", r"FROM\s+(\w+)", r"ARRIVED FROM\s+(\w+)"]:
            match = re.search(pattern, remarks_upper)
            if match:
                transfer_location = match.group(1)
                break
        # Inbound transfer - derive status from hours
        if hours_worked > 0:
            status = "working"
        elif standby_hours > 0:
            status = "standby"
    # Derive status from hours
    elif breakdown_hours > hours_worked and breakdown_hours > 0:
        status = "breakdown"
    elif hours_worked == 0 and standby_hours > 0:
        status = "standby"
    elif hours_worked > 0:
        status = "working"
    elif condition == "scrap":
        # Scrap plants are typically not operational
        status = "breakdown"
    else:
        status = "unverified"

    return ParsedRemarks(
        status=status,
        condition=condition,
        transfer_detected=transfer_detected,
        transfer_direction=transfer_direction,
        transfer_location=transfer_location,
        transfer_date=None,
        condition_notes=condition_notes,
        confidence=0.5,  # Lower confidence for fallback
    )


async def parse_remarks(
    remarks: str | None,
    hours_worked: float = 0,
    standby_hours: float = 0,
    breakdown_hours: float = 0,
    off_hire: bool = False,
) -> ParsedRemarks:
    """Parse a single plant's remarks using AI.

    Args:
        remarks: The free-text remarks from the report.
        hours_worked: Hours worked this week.
        standby_hours: Standby hours this week.
        breakdown_hours: Breakdown hours this week.
        off_hire: Whether the plant is marked off hire.

    Returns:
        ParsedRemarks with extracted information.
    """
    model = _get_model()

    if model is None:
        return fallback_parse(remarks, hours_worked, standby_hours, breakdown_hours, off_hire)

    try:
        prompt = PARSE_PROMPT.format(
            remarks=remarks or "",
            hours_worked=hours_worked,
            standby_hours=standby_hours,
            breakdown_hours=breakdown_hours,
            off_hire=off_hire,
        )

        response = await model.generate_content_async(prompt)
        result_text = response.text.strip()

        # Clean up response (remove markdown if present)
        if result_text.startswith("```"):
            result_text = re.sub(r"^```(?:json)?\n?", "", result_text)
            result_text = re.sub(r"\n?```$", "", result_text)

        data = json.loads(result_text)

        return ParsedRemarks(
            status=data.get("status", "working"),
            condition=data.get("condition", "good"),
            transfer_detected=data.get("transfer_detected", False),
            transfer_direction=data.get("transfer_direction"),
            transfer_location=data.get("transfer_location"),
            transfer_date=data.get("transfer_date"),
            condition_notes=data.get("condition_notes"),
            confidence=float(data.get("confidence", 0.8)),
        )

    except Exception as e:
        logger.warning(
            "AI parsing failed, using fallback",
            error=str(e),
            remarks=remarks[:100] if remarks else None,
        )
        return fallback_parse(remarks, hours_worked, standby_hours, breakdown_hours, off_hire)


async def parse_remarks_batch(plants_data: list[dict]) -> dict[str, ParsedRemarks]:
    """Parse multiple plants' remarks in a single API call for efficiency.

    Args:
        plants_data: List of dicts with keys:
            - fleet_number: str
            - remarks: str | None
            - hours_worked: float
            - standby_hours: float
            - breakdown_hours: float
            - off_hire: bool

    Returns:
        Dict mapping fleet_number to ParsedRemarks.
    """
    if not plants_data:
        return {}

    model = _get_model()

    # If no model, use fallback for all
    if model is None:
        results = {}
        for plant in plants_data:
            results[plant["fleet_number"]] = fallback_parse(
                plant.get("remarks"),
                plant.get("hours_worked", 0),
                plant.get("standby_hours", 0),
                plant.get("breakdown_hours", 0),
                plant.get("off_hire", False),
            )
        return results

    try:
        # Build batch prompt
        plants_text = ""
        for i, plant in enumerate(plants_data, 1):
            plants_text += f"""
Plant {i}:
  Fleet Number: {plant["fleet_number"]}
  Remarks: {plant.get("remarks") or "(no remarks)"}
  Hours worked: {plant.get("hours_worked", 0)}
  Standby hours: {plant.get("standby_hours", 0)}
  Breakdown hours: {plant.get("breakdown_hours", 0)}
  Off hire: {plant.get("off_hire", False)}
"""

        prompt = BATCH_PARSE_PROMPT.format(plants_text=plants_text)

        response = await model.generate_content_async(prompt)
        result_text = response.text.strip()

        # Clean up response
        if result_text.startswith("```"):
            result_text = re.sub(r"^```(?:json)?\n?", "", result_text)
            result_text = re.sub(r"\n?```$", "", result_text)

        data_list = json.loads(result_text)

        results = {}
        for data in data_list:
            fleet_number = data.get("fleet_number", "").upper()
            if fleet_number:
                results[fleet_number] = ParsedRemarks(
                    status=data.get("status", "working"),
                    condition=data.get("condition", "good"),
                    transfer_detected=data.get("transfer_detected", False),
                    transfer_direction=data.get("transfer_direction"),
                    transfer_location=data.get("transfer_location"),
                    transfer_date=data.get("transfer_date"),
                    condition_notes=data.get("condition_notes"),
                    confidence=float(data.get("confidence", 0.8)),
                )

        # Fill in any missing with fallback
        for plant in plants_data:
            fn = plant["fleet_number"].upper()
            if fn not in results:
                results[fn] = fallback_parse(
                    plant.get("remarks"),
                    plant.get("hours_worked", 0),
                    plant.get("standby_hours", 0),
                    plant.get("breakdown_hours", 0),
                    plant.get("off_hire", False),
                )

        logger.info(
            "Batch parsed remarks",
            total=len(plants_data),
            ai_parsed=len([r for r in results.values() if r.confidence > 0.5]),
        )

        return results

    except Exception as e:
        logger.warning("Batch AI parsing failed, using fallback for all", error=str(e))
        results = {}
        for plant in plants_data:
            results[plant["fleet_number"]] = fallback_parse(
                plant.get("remarks"),
                plant.get("hours_worked", 0),
                plant.get("standby_hours", 0),
                plant.get("breakdown_hours", 0),
                plant.get("off_hire", False),
            )
        return results


def derive_status_and_condition(
    parsed: ParsedRemarks,
    hours_worked: float,
    standby_hours: float,
    breakdown_hours: float,
    off_hire: bool,
    physical_verification: bool | None = None,
) -> tuple[str, str]:
    """Derive final plant status and condition combining AI parsing with hours data.

    This provides a second layer of validation on top of AI parsing.

    Args:
        parsed: AI-parsed remarks result.
        hours_worked: Hours worked this week.
        standby_hours: Standby hours this week.
        breakdown_hours: Breakdown hours this week.
        off_hire: Whether marked off hire.
        physical_verification: Physical verification status.

    Returns:
        Tuple of (status, condition).
    """
    # Start with AI-derived condition
    condition = parsed.condition

    # Derive STATUS (operational state)
    if off_hire:
        status = "off_hire"
    elif parsed.transfer_direction == "outbound":
        status = "in_transit"
    elif breakdown_hours > hours_worked and breakdown_hours > 0:
        status = "breakdown"
    elif hours_worked == 0 and standby_hours > 0:
        status = "standby"
    elif hours_worked > 0:
        status = "working"
    elif condition == "scrap":
        # Scrap plants are typically not operational
        status = "breakdown"
    else:
        status = parsed.status if parsed.status in ("working", "standby", "breakdown", "off_hire", "in_transit") else "unverified"

    return status, condition


def derive_status_from_data(
    parsed: ParsedRemarks,
    hours_worked: float,
    standby_hours: float,
    breakdown_hours: float,
    off_hire: bool,
    physical_verification: bool | None = None,
) -> str:
    """Derive final plant status combining AI parsing with hours data.

    DEPRECATED: Use derive_status_and_condition instead for both fields.
    This is kept for backwards compatibility.

    Args:
        parsed: AI-parsed remarks result.
        hours_worked: Hours worked this week.
        standby_hours: Standby hours this week.
        breakdown_hours: Breakdown hours this week.
        off_hire: Whether marked off hire.
        physical_verification: Physical verification status.

    Returns:
        Final status string.
    """
    status, _ = derive_status_and_condition(
        parsed, hours_worked, standby_hours, breakdown_hours, off_hire, physical_verification
    )
    return status
