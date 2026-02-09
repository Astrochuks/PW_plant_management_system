"""Fleet number parsing service.

Parses user input like "T468, 463, 466" into fleet records.
Handles abbreviated inputs, fleet types, workshop entries, and category entries.
"""

import re
from typing import Any

from app.core.database import get_supabase_admin_client
from app.monitoring.logging import get_logger

logger = get_logger(__name__)

# Known workshop/general entries
WORKSHOP_KEYWORDS = {"WORKSHOP", "W/SHOP", "WS", "GENERAL", "SITE", "OFFICE"}

# Known category entries (not specific plants, but categories of equipment/costs)
CATEGORY_KEYWORDS = {
    "LOW LOADER": "LOW LOADER",
    "LOWLOADER": "LOW LOADER",
    "VOLVO": "VOLVO TRUCKS",
    "VOLVO+": "VOLVO TRUCKS",
    "PRECAST": "PRECAST",
    "CONSUMABLES": "CONSUMABLES",
    "CONSUMABLE": "CONSUMABLES",
    "SPARE PARTS": "SPARE PARTS",
    "SPARES": "SPARE PARTS",
    "TYRES": "TYRES",
    "TYRE": "TYRES",
    "TIRES": "TYRES",
    "BATTERIES": "BATTERIES",
    "BATTERY": "BATTERIES",
    "LUBRICANTS": "LUBRICANTS",
    "OIL": "LUBRICANTS",
    "OILS": "LUBRICANTS",
    "FUEL": "FUEL",
    "DIESEL": "FUEL",
    "PETROL": "FUEL",
    "D6": "BULLDOZER D6",
    "D7": "BULLDOZER D7",
    "D8": "BULLDOZER D8",
    "CAT": "CATERPILLAR",
    "CATERPILLAR": "CATERPILLAR",
    "OTHERS": "OTHERS",
    "MISCELLANEOUS": "MISCELLANEOUS",
    "MISC": "MISCELLANEOUS",
}


def _normalize_category(text: str) -> str | None:
    """Check if text matches a known category and return normalized name."""
    text_upper = text.upper().strip()

    # Direct match
    if text_upper in CATEGORY_KEYWORDS:
        return CATEGORY_KEYWORDS[text_upper]

    # Check for patterns like "D6+ OTHERS ZAMFARA" → "BULLDOZER D6 + OTHERS"
    for keyword, normalized in CATEGORY_KEYWORDS.items():
        if keyword in text_upper:
            return normalized

    # Check for compound entries like "VOLVO+." or "D6+ OTHERS"
    if "+" in text_upper or "&" in text_upper:
        # It's a compound entry, treat as category
        return text_upper.replace("+", " + ").replace(".", "").strip()

    return None


def parse_fleet_input(raw_input: str) -> list[dict[str, Any]]:
    """
    Parse user input into fleet records.

    Handles:
    - Full fleet numbers: T468, WP10, AC5
    - Abbreviated inputs: T468, 463 → T468, T463 (inherits prefix)
    - Fleet types: TRUCKS, GENERATORS
    - Workshop entries: WORKSHOP, W/SHOP, WS
    - Category entries: LOW LOADER, VOLVO, CONSUMABLES, PRECAST, etc.

    Args:
        raw_input: Comma-separated fleet numbers/types.

    Returns:
        List of dicts with:
        - fleet_number_raw: original input piece
        - plant_id: UUID if matched, None otherwise
        - fleet_type: if matched to fleet type only
        - is_workshop: True if "WORKSHOP" etc.
        - is_category: True if category entry (not a specific plant)
        - category_name: Normalized category name if is_category
        - is_resolved: True if plant_id was matched
    """
    client = get_supabase_admin_client()
    results = []
    last_prefix = None

    # Split by comma and clean
    parts = [p.strip().upper() for p in raw_input.split(",") if p.strip()]

    for part in parts:
        # Check for workshop entries
        if part in WORKSHOP_KEYWORDS:
            results.append({
                "fleet_number_raw": part,
                "plant_id": None,
                "fleet_type": None,
                "is_workshop": True,
                "is_category": False,
                "category_name": None,
                "is_resolved": True,
            })
            continue

        # Check for category entries (LOW LOADER, VOLVO, CONSUMABLES, etc.)
        category = _normalize_category(part)
        if category:
            results.append({
                "fleet_number_raw": part,
                "plant_id": None,
                "fleet_type": None,
                "is_workshop": False,
                "is_category": True,
                "category_name": category,
                "is_resolved": True,  # Resolved as a category
            })
            continue

        # Try to extract prefix and number (e.g., T468, AC10)
        match = re.match(r"^([A-Z]+)?(\d+)$", part)

        if match:
            prefix = match.group(1) or last_prefix
            number = match.group(2)

            if prefix:
                fleet_number = f"{prefix}{number}"
                last_prefix = prefix

                # Try to find plant by fleet number
                plant = (
                    client.table("plants_master")
                    .select("id, fleet_type")
                    .eq("fleet_number", fleet_number)
                    .execute()
                )

                if plant.data:
                    results.append({
                        "fleet_number_raw": part,
                        "plant_id": plant.data[0]["id"],
                        "fleet_type": plant.data[0].get("fleet_type"),
                        "is_workshop": False,
                        "is_category": False,
                        "category_name": None,
                        "is_resolved": True,
                    })
                else:
                    # Check if prefix maps to a fleet type
                    fleet_type_match = (
                        client.table("fleet_number_prefixes")
                        .select("fleet_type")
                        .eq("prefix", prefix)
                        .execute()
                    )
                    results.append({
                        "fleet_number_raw": part,
                        "plant_id": None,
                        "fleet_type": fleet_type_match.data[0]["fleet_type"]
                        if fleet_type_match.data
                        else prefix,
                        "is_workshop": False,
                        "is_category": False,
                        "category_name": None,
                        "is_resolved": False,
                    })
            else:
                # No prefix found - just a number, unresolved
                results.append({
                    "fleet_number_raw": part,
                    "plant_id": None,
                    "fleet_type": None,
                    "is_workshop": False,
                    "is_category": False,
                    "category_name": None,
                    "is_resolved": False,
                })
        else:
            # Not a standard fleet number pattern
            # Check if it's a fleet type name like "TRUCKS" or "GENERATORS"
            fleet_type_match = (
                client.table("fleet_number_prefixes")
                .select("fleet_type")
                .ilike("fleet_type", f"%{part}%")
                .execute()
            )

            if fleet_type_match.data:
                # Matched a fleet type
                results.append({
                    "fleet_number_raw": part,
                    "plant_id": None,
                    "fleet_type": fleet_type_match.data[0]["fleet_type"],
                    "is_workshop": False,
                    "is_category": True,  # Fleet type without number = category
                    "category_name": fleet_type_match.data[0]["fleet_type"],
                    "is_resolved": True,
                })
            else:
                # Unknown entry - treat as category
                results.append({
                    "fleet_number_raw": part,
                    "plant_id": None,
                    "fleet_type": None,
                    "is_workshop": False,
                    "is_category": True,
                    "category_name": part,  # Use raw input as category name
                    "is_resolved": True,
                })

    logger.debug(
        "Parsed fleet input",
        raw_input=raw_input,
        results_count=len(results),
        resolved_count=sum(1 for r in results if r["is_resolved"]),
        plant_count=sum(1 for r in results if r["plant_id"]),
        category_count=sum(1 for r in results if r["is_category"]),
        workshop_count=sum(1 for r in results if r["is_workshop"]),
    )

    return results


def resolve_location_from_req_no(req_no: str | None) -> str | None:
    """
    Extract location from REQ NO like 'ABJ 340888' → ABUJA location_id.

    Args:
        req_no: The requisition number string.

    Returns:
        Location UUID if found, None otherwise.
    """
    if not req_no:
        return None

    client = get_supabase_admin_client()

    # Extract prefix (letters before space or numbers)
    match = re.match(r"^([A-Z]+)", req_no.upper().strip())
    if not match:
        return None

    prefix = match.group(1)

    # Look up mapping
    result = (
        client.table("req_no_location_mapping")
        .select("location_id")
        .eq("prefix", prefix)
        .execute()
    )

    if result.data:
        logger.debug(
            "Resolved REQ NO to location",
            req_no=req_no,
            prefix=prefix,
            location_id=result.data[0]["location_id"],
        )
        return result.data[0]["location_id"]

    return None


def get_cost_classification(fleet_associations: list[dict]) -> str:
    """
    Determine if a PO should be classified as 'direct' or 'shared'.

    Classification:
    - 'direct': Single resolved plant, no workshop, no categories
    - 'shared': Multiple plants, or has workshop, or has categories

    Args:
        fleet_associations: List of fleet association dicts.

    Returns:
        'direct' if single resolved plant only, 'shared' otherwise.
    """
    resolved_plants = [f for f in fleet_associations if f.get("plant_id")]
    has_workshop = any(f.get("is_workshop") for f in fleet_associations)
    has_category = any(f.get("is_category") for f in fleet_associations)

    if len(resolved_plants) == 1 and not has_workshop and not has_category:
        return "direct"
    return "shared"


def parse_multiple_req_nos(req_no_input: str) -> list[dict[str, Any]]:
    """
    Parse multiple REQ NOs from input like "KWOI 2345, ABJ 2340".

    Args:
        req_no_input: Raw REQ NO input string.

    Returns:
        List of dicts with:
        - req_no: The full REQ NO string
        - prefix: Extracted prefix (e.g., "KWO", "ABJ")
        - location_id: Resolved location UUID or None
        - location_name: Location name if resolved
    """
    if not req_no_input:
        return []

    client = get_supabase_admin_client()
    results = []

    # Split by comma
    parts = [p.strip() for p in req_no_input.split(",") if p.strip()]

    for part in parts:
        # Extract prefix (letters at start)
        match = re.match(r"^([A-Z]+)", part.upper().strip())
        if not match:
            results.append({
                "req_no": part,
                "prefix": None,
                "location_id": None,
                "location_name": None,
            })
            continue

        prefix = match.group(1)

        # Look up location mapping
        mapping = (
            client.table("req_no_location_mapping")
            .select("location_id, locations(name)")
            .eq("prefix", prefix)
            .execute()
        )

        if mapping.data:
            loc = mapping.data[0]
            results.append({
                "req_no": part.upper(),
                "prefix": prefix,
                "location_id": loc["location_id"],
                "location_name": loc.get("locations", {}).get("name") if loc.get("locations") else None,
            })
        else:
            results.append({
                "req_no": part.upper(),
                "prefix": prefix,
                "location_id": None,
                "location_name": None,
            })

    logger.debug(
        "Parsed REQ NOs",
        input=req_no_input,
        count=len(results),
        resolved=sum(1 for r in results if r["location_id"]),
    )

    return results
