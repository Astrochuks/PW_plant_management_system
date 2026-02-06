"""Fleet number parsing service.

Parses user input like "T468, 463, 466" into fleet records.
Handles abbreviated inputs, fleet types, and workshop entries.
"""

import re
from typing import Any

from app.core.database import get_supabase_admin_client
from app.monitoring.logging import get_logger

logger = get_logger(__name__)


def parse_fleet_input(raw_input: str) -> list[dict[str, Any]]:
    """
    Parse user input into fleet records.

    Handles:
    - Full fleet numbers: T468, WP10, AC5
    - Abbreviated inputs: T468, 463 → T468, T463 (inherits prefix)
    - Fleet types: TRUCKS, GENERATORS
    - Workshop entries: WORKSHOP, W/SHOP, WS

    Args:
        raw_input: Comma-separated fleet numbers/types.

    Returns:
        List of dicts with:
        - fleet_number_raw: original input piece
        - plant_id: UUID if matched, None otherwise
        - fleet_type: if matched to fleet type only
        - is_workshop: True if "WORKSHOP" etc.
        - is_resolved: True if plant_id was matched
    """
    client = get_supabase_admin_client()
    results = []
    last_prefix = None

    # Split by comma and clean
    parts = [p.strip().upper() for p in raw_input.split(",") if p.strip()]

    for part in parts:
        # Check for workshop
        if part in ("WORKSHOP", "W/SHOP", "WS", "GENERAL", "SITE"):
            results.append({
                "fleet_number_raw": part,
                "plant_id": None,
                "fleet_type": None,
                "is_workshop": True,
                "is_resolved": True,
            })
            continue

        # Try to extract prefix and number
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
                        "is_resolved": False,
                    })
            else:
                # No prefix found - just a number
                results.append({
                    "fleet_number_raw": part,
                    "plant_id": None,
                    "fleet_type": None,
                    "is_workshop": False,
                    "is_resolved": False,
                })
        else:
            # Might be a fleet type name like "TRUCKS"
            fleet_type_match = (
                client.table("fleet_number_prefixes")
                .select("fleet_type")
                .ilike("fleet_type", f"%{part}%")
                .execute()
            )
            results.append({
                "fleet_number_raw": part,
                "plant_id": None,
                "fleet_type": fleet_type_match.data[0]["fleet_type"]
                if fleet_type_match.data
                else part,
                "is_workshop": False,
                "is_resolved": False,
            })

    logger.debug(
        "Parsed fleet input",
        raw_input=raw_input,
        results_count=len(results),
        resolved_count=sum(1 for r in results if r["is_resolved"]),
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

    Args:
        fleet_associations: List of fleet association dicts.

    Returns:
        'direct' if single resolved plant and no workshop,
        'shared' otherwise.
    """
    resolved_plants = [f for f in fleet_associations if f.get("plant_id")]
    has_workshop = any(f.get("is_workshop") for f in fleet_associations)

    if len(resolved_plants) == 1 and not has_workshop:
        return "direct"
    return "shared"
