"""Fleet number parsing service.

Parses user input like "T468, 463, 466" into fleet records.
Handles abbreviated inputs, fleet types, workshop entries, and category entries.
"""

import re
from typing import Any

from app.core.pool import fetch, fetchrow
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


async def parse_fleet_input(raw_input: str) -> list[dict[str, Any]]:
    """
    Parse user input into fleet records.

    Handles:
    - Full fleet numbers: T468, WP10, AC5
    - Abbreviated inputs: T468, 463 → T468, T463 (inherits prefix)
    - Fleet types: TRUCKS, GENERATORS
    - Workshop entries: WORKSHOP, W/SHOP, WS
    - Category entries: LOW LOADER, VOLVO, CONSUMABLES, PRECAST, etc.

    Performance: uses at most TWO batched DB queries regardless of fleet count
    (one for plants lookup, one for prefix/fleet-type lookup) instead of one
    query per fleet. For a 5-fleet PO this cuts 10 sequential round-trips
    down to 2.

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
    # ── Pass 1: classify parts, collecting DB-lookup candidates ─────────
    # Each slot is either a fully-resolved dict (workshop/category/compound)
    # OR a dict flagged for DB resolution with the keys it needs.
    slots: list[dict[str, Any]] = []
    plant_fleet_numbers_needed: set[str] = set()   # full fleet numbers to look up
    prefixes_needed: set[str] = set()              # prefixes to look up (fallback when no plant match)
    fleet_type_names_needed: set[str] = set()      # free-text fleet type names

    last_prefix = None
    parts = [p.strip().upper() for p in raw_input.split(",") if p.strip()]

    for part in parts:
        # Workshop entries — no DB lookup needed
        if part in WORKSHOP_KEYWORDS:
            slots.append({
                "_resolved": True,
                "fleet_number_raw": part,
                "plant_id": None,
                "fleet_type": None,
                "is_workshop": True,
                "is_category": False,
                "category_name": None,
                "is_resolved": True,
            })
            continue

        # Category entries (LOW LOADER, VOLVO, CONSUMABLES, etc.) — no DB lookup
        category = _normalize_category(part)
        if category:
            slots.append({
                "_resolved": True,
                "fleet_number_raw": part,
                "plant_id": None,
                "fleet_type": None,
                "is_workshop": False,
                "is_category": True,
                "category_name": category,
                "is_resolved": True,
            })
            continue

        # Fleet number pattern: optional prefix + digits (T468, AC10, 463)
        match = re.match(r"^([A-Z]+)?(\d+)$", part)

        if match:
            prefix = match.group(1) or last_prefix
            number = match.group(2)

            if prefix:
                fleet_number = f"{prefix}{number}"
                last_prefix = prefix
                plant_fleet_numbers_needed.add(fleet_number)
                prefixes_needed.add(prefix)  # may be needed for fallback
                slots.append({
                    "_resolved": False,
                    "_type": "fleet_number",
                    "fleet_number_raw": part,
                    "_fleet_number": fleet_number,
                    "_prefix": prefix,
                })
            else:
                # Digits with no prefix available — permanently unresolved
                slots.append({
                    "_resolved": True,
                    "fleet_number_raw": part,
                    "plant_id": None,
                    "fleet_type": None,
                    "is_workshop": False,
                    "is_category": False,
                    "category_name": None,
                    "is_resolved": False,
                })
        else:
            # Not a standard fleet number — might be a fleet-type name like "TRUCKS"
            fleet_type_names_needed.add(part)
            slots.append({
                "_resolved": False,
                "_type": "fleet_type_name",
                "fleet_number_raw": part,
                "_name": part,
            })

    # ── Pass 2: run ONE batched query per lookup kind ──────────────────
    # plants_master lookup (batch)
    plant_map: dict[str, dict[str, Any]] = {}
    if plant_fleet_numbers_needed:
        plant_rows = await fetch(
            "SELECT id, fleet_number, fleet_type FROM plants_master WHERE fleet_number = ANY($1::text[])",
            list(plant_fleet_numbers_needed),
        )
        plant_map = {r["fleet_number"]: r for r in plant_rows}

    # prefix → fleet_type lookup (batch)
    prefix_map: dict[str, str] = {}
    if prefixes_needed:
        prefix_rows = await fetch(
            "SELECT prefix, fleet_type FROM fleet_number_prefixes WHERE prefix = ANY($1::text[])",
            list(prefixes_needed),
        )
        prefix_map = {r["prefix"]: r["fleet_type"] for r in prefix_rows}

    # fleet_type_name → canonical fleet_type (batch; uses ILIKE matching)
    # Single query loading all rows so we can match in-Python without N ILIKE calls.
    fleet_type_map: dict[str, str] = {}
    if fleet_type_names_needed:
        ft_rows = await fetch("SELECT DISTINCT fleet_type FROM fleet_number_prefixes")
        all_ftypes = [r["fleet_type"] for r in ft_rows if r["fleet_type"]]
        for name in fleet_type_names_needed:
            for ft in all_ftypes:
                if name.upper() in ft.upper():
                    fleet_type_map[name] = ft
                    break

    # ── Pass 3: assemble final results ─────────────────────────────────
    results: list[dict[str, Any]] = []
    for slot in slots:
        if slot.get("_resolved"):
            # Already a complete record
            slot.pop("_resolved", None)
            results.append(slot)
            continue

        if slot["_type"] == "fleet_number":
            fleet_number = slot["_fleet_number"]
            prefix = slot["_prefix"]
            plant = plant_map.get(fleet_number)
            if plant:
                results.append({
                    "fleet_number_raw": slot["fleet_number_raw"],
                    "fleet_number_normalized": fleet_number,  # "T463" even if user typed "463"
                    "plant_id": plant["id"],
                    "fleet_type": plant.get("fleet_type"),
                    "is_workshop": False,
                    "is_category": False,
                    "category_name": None,
                    "is_resolved": True,
                })
            else:
                results.append({
                    "fleet_number_raw": slot["fleet_number_raw"],
                    "fleet_number_normalized": fleet_number,
                    "plant_id": None,
                    "fleet_type": prefix_map.get(prefix, prefix),
                    "is_workshop": False,
                    "is_category": False,
                    "category_name": None,
                    "is_resolved": False,
                })
        elif slot["_type"] == "fleet_type_name":
            name = slot["_name"]
            matched = fleet_type_map.get(name)
            if matched:
                results.append({
                    "fleet_number_raw": slot["fleet_number_raw"],
                    "plant_id": None,
                    "fleet_type": matched,
                    "is_workshop": False,
                    "is_category": True,
                    "category_name": matched,
                    "is_resolved": True,
                })
            else:
                results.append({
                    "fleet_number_raw": slot["fleet_number_raw"],
                    "plant_id": None,
                    "fleet_type": None,
                    "is_workshop": False,
                    "is_category": True,
                    "category_name": name,
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


async def resolve_location_from_req_no(req_no: str | None) -> str | None:
    """
    Extract location from REQ NO like 'ABJ 340888' → ABUJA location_id.

    Args:
        req_no: The requisition number string.

    Returns:
        Location UUID if found, None otherwise.
    """
    if not req_no:
        return None

    # Extract prefix (letters before space or numbers)
    match = re.match(r"^([A-Z]+)", req_no.upper().strip())
    if not match:
        return None

    prefix = match.group(1)

    row = await fetchrow(
        "SELECT location_id FROM req_no_location_mapping WHERE prefix = $1",
        prefix,
    )

    if row:
        logger.debug(
            "Resolved REQ NO to location",
            req_no=req_no,
            prefix=prefix,
            location_id=row["location_id"],
        )
        return row["location_id"]

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


async def parse_multiple_req_nos(req_no_input: str) -> list[dict[str, Any]]:
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

        # Look up location mapping with JOIN
        mapping = await fetchrow(
            """SELECT m.location_id, l.name AS location_name
               FROM req_no_location_mapping m
               LEFT JOIN locations l ON l.id = m.location_id
               WHERE m.prefix = $1""",
            prefix,
        )

        if mapping:
            results.append({
                "req_no": part.upper(),
                "prefix": prefix,
                "location_id": mapping["location_id"],
                "location_name": mapping.get("location_name"),
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
