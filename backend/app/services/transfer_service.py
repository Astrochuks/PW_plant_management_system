"""Service for tracking plant transfers between locations.

Handles:
- Creating transfer records when transfers are detected in remarks
- Confirming pending transfers when plants appear at destination
- Resolving location names to location IDs using aliases
- Updating plant current_location based on transfers
"""

from datetime import date, datetime
from typing import Any
from uuid import UUID

from app.core.database import get_supabase_admin_client
from app.monitoring.logging import get_logger
from app.services.remarks_parser import ParsedRemarks

logger = get_logger(__name__)


class TransferService:
    """Service for managing plant transfers."""

    def __init__(self):
        self.client = get_supabase_admin_client()

    def resolve_location(self, location_name: str) -> dict[str, Any] | None:
        """Resolve a location name or alias to a location record.

        Args:
            location_name: The location name or alias to look up.

        Returns:
            Dict with 'id' and 'name' or None if not found.
        """
        if not location_name:
            return None

        name_upper = location_name.upper().strip()

        # Try alias lookup first (includes exact names)
        result = (
            self.client.table("location_aliases")
            .select("location_id, locations(id, name)")
            .eq("alias_normalized", name_upper)
            .execute()
        )

        if result.data and result.data[0].get("locations"):
            loc = result.data[0]["locations"]
            return {"id": loc["id"], "name": loc["name"]}

        # Try partial match on aliases
        result = (
            self.client.table("location_aliases")
            .select("location_id, locations(id, name)")
            .ilike("alias_normalized", f"%{name_upper}%")
            .execute()
        )

        if result.data and result.data[0].get("locations"):
            loc = result.data[0]["locations"]
            return {"id": loc["id"], "name": loc["name"]}

        # Try direct location name match
        result = (
            self.client.table("locations")
            .select("id, name")
            .ilike("name", f"%{name_upper}%")
            .execute()
        )

        if result.data:
            return result.data[0]

        logger.warning("Could not resolve location", location_name=location_name)
        return None

    def create_outbound_transfer(
        self,
        plant_id: str | UUID,
        from_location_id: str | UUID,
        to_location_raw: str,
        source_submission_id: str | UUID,
        source_remarks: str | None,
        transfer_date: date | None = None,
        confidence: float = 1.0,
    ) -> dict[str, Any] | None:
        """Create a pending outbound transfer record.

        Args:
            plant_id: The plant being transferred.
            from_location_id: Current location (source).
            to_location_raw: Destination location from remarks.
            source_submission_id: The submission that detected this transfer.
            source_remarks: The original remarks text.
            transfer_date: Date of transfer if known.
            confidence: AI confidence score.

        Returns:
            The created transfer record or None on failure (or if duplicate exists).
        """
        # Resolve destination location
        to_location = self.resolve_location(to_location_raw)
        to_location_id = to_location["id"] if to_location else None

        try:
            # Check if a similar transfer already exists (pending or confirmed)
            # to avoid duplicates on re-upload
            existing_query = (
                self.client.table("plant_transfers")
                .select("id, status")
                .eq("plant_id", str(plant_id))
                .eq("from_location_id", str(from_location_id))
                .eq("direction", "outbound")
                .in_("status", ["pending", "confirmed"])
            )
            if to_location_id:
                existing_query = existing_query.eq("to_location_id", to_location_id)

            existing = existing_query.execute()

            if existing.data:
                logger.debug(
                    "Outbound transfer already exists, skipping",
                    plant_id=str(plant_id),
                    existing_transfer_id=existing.data[0]["id"],
                )
                return existing.data[0]  # Return existing instead of creating duplicate

            result = (
                self.client.table("plant_transfers")
                .insert({
                    "plant_id": str(plant_id),
                    "from_location_id": str(from_location_id),
                    "to_location_id": to_location_id,
                    "from_location_raw": None,
                    "to_location_raw": to_location_raw,
                    "transfer_date": transfer_date.isoformat() if transfer_date else None,
                    "direction": "outbound",
                    "status": "pending",
                    "source_submission_id": str(source_submission_id),
                    "source_remarks": source_remarks,
                    "parsed_confidence": confidence,
                })
                .execute()
            )

            if result.data:
                transfer = result.data[0]
                logger.info(
                    "Created outbound transfer",
                    transfer_id=transfer["id"],
                    plant_id=str(plant_id),
                    to_location=to_location_raw,
                )

                # Update plant with pending transfer ONLY - don't change location or condition
                # Per the plan: location stays at source until confirmed at destination
                # The pending_transfer_id tracks where the plant is going
                self.client.table("plants_master").update({
                    "pending_transfer_id": transfer["id"],
                }).eq("id", str(plant_id)).execute()

                return transfer

        except Exception as e:
            logger.error(
                "Failed to create outbound transfer",
                error=str(e),
                plant_id=str(plant_id),
            )

        return None

    def create_inbound_transfer(
        self,
        plant_id: str | UUID,
        to_location_id: str | UUID,
        from_location_raw: str,
        source_submission_id: str | UUID,
        source_remarks: str | None,
        transfer_date: date | None = None,
        confidence: float = 1.0,
    ) -> dict[str, Any] | None:
        """Create a confirmed inbound transfer record.

        Inbound transfers are immediately confirmed since the plant
        is present in the destination's report.

        Args:
            plant_id: The plant that was received.
            to_location_id: Current location (destination).
            from_location_raw: Source location from remarks.
            source_submission_id: The submission that detected this transfer.
            source_remarks: The original remarks text.
            transfer_date: Date of transfer if known.
            confidence: AI confidence score.

        Returns:
            The created transfer record or None on failure (or if duplicate exists).
        """
        # Resolve source location
        from_location = self.resolve_location(from_location_raw)
        from_location_id = from_location["id"] if from_location else None

        try:
            # Check if a similar inbound transfer already exists (confirmed)
            # to avoid duplicates on re-upload
            existing_query = (
                self.client.table("plant_transfers")
                .select("id, status")
                .eq("plant_id", str(plant_id))
                .eq("to_location_id", str(to_location_id))
                .eq("direction", "inbound")
                .eq("status", "confirmed")
            )
            if from_location_id:
                existing_query = existing_query.eq("from_location_id", from_location_id)

            existing = existing_query.execute()

            if existing.data:
                logger.debug(
                    "Inbound transfer already exists, skipping",
                    plant_id=str(plant_id),
                    existing_transfer_id=existing.data[0]["id"],
                )
                return existing.data[0]  # Return existing instead of creating duplicate

            result = (
                self.client.table("plant_transfers")
                .insert({
                    "plant_id": str(plant_id),
                    "from_location_id": from_location_id,
                    "to_location_id": str(to_location_id),
                    "from_location_raw": from_location_raw,
                    "to_location_raw": None,
                    "transfer_date": transfer_date.isoformat() if transfer_date else None,
                    "direction": "inbound",
                    "status": "confirmed",
                    "confirmed_at": datetime.utcnow().isoformat(),
                    "confirmed_by_submission_id": str(source_submission_id),
                    "source_submission_id": str(source_submission_id),
                    "source_remarks": source_remarks,
                    "parsed_confidence": confidence,
                })
                .execute()
            )

            if result.data:
                transfer = result.data[0]
                logger.info(
                    "Created inbound transfer",
                    transfer_id=transfer["id"],
                    plant_id=str(plant_id),
                    from_location=from_location_raw,
                )
                return transfer

        except Exception as e:
            logger.error(
                "Failed to create inbound transfer",
                error=str(e),
                plant_id=str(plant_id),
            )

        return None

    def check_and_confirm_pending_transfers(
        self,
        plant_ids: list[str],
        location_id: str | UUID,
        submission_id: str | UUID,
    ) -> list[dict[str, Any]]:
        """Check if any plants in the report have pending transfers to this location.

        When a plant appears in a location's report and has a pending
        outbound transfer to that location, we confirm the transfer.

        Args:
            plant_ids: List of plant IDs in this report.
            location_id: The location of this report.
            submission_id: The submission that confirms these transfers.

        Returns:
            List of confirmed transfer records.
        """
        if not plant_ids:
            return []

        confirmed = []

        try:
            # Find pending transfers for these plants going to this location
            # Batch the query to avoid URL length limits with many plant IDs
            all_transfers = []
            batch_size = 50
            for i in range(0, len(plant_ids), batch_size):
                batch_ids = plant_ids[i:i + batch_size]
                result = (
                    self.client.table("plant_transfers")
                    .select("*")
                    .in_("plant_id", batch_ids)
                    .eq("to_location_id", str(location_id))
                    .eq("status", "pending")
                    .execute()
                )
                all_transfers.extend(result.data or [])

            for transfer in all_transfers:
                # Confirm the transfer
                update_result = (
                    self.client.table("plant_transfers")
                    .update({
                        "status": "confirmed",
                        "confirmed_at": datetime.utcnow().isoformat(),
                        "confirmed_by_submission_id": str(submission_id),
                    })
                    .eq("id", transfer["id"])
                    .execute()
                )

                if update_result.data:
                    confirmed.append(update_result.data[0])

                    # Clear pending transfer from plant
                    self.client.table("plants_master").update({
                        "pending_transfer_id": None,
                        "current_location_id": str(location_id),
                    }).eq("id", transfer["plant_id"]).execute()

                    logger.info(
                        "Confirmed pending transfer",
                        transfer_id=transfer["id"],
                        plant_id=transfer["plant_id"],
                    )

        except Exception as e:
            logger.error(
                "Failed to check pending transfers",
                error=str(e),
                location_id=str(location_id),
            )

        return confirmed

    def get_pending_transfers(
        self,
        location_id: str | UUID | None = None,
        plant_id: str | UUID | None = None,
    ) -> list[dict[str, Any]]:
        """Get pending transfers, optionally filtered by location or plant.

        Args:
            location_id: Filter by source or destination location.
            plant_id: Filter by specific plant.

        Returns:
            List of pending transfer records with enriched data.
        """
        try:
            query = (
                self.client.table("plant_transfers")
                .select("*")
                .eq("status", "pending")
                .order("created_at", desc=True)
            )

            if plant_id:
                query = query.eq("plant_id", str(plant_id))

            result = query.execute()
            transfers = result.data or []

            # Enrich with plant and location data
            enriched = []
            for transfer in transfers:
                # Get plant info
                plant = None
                if transfer.get("plant_id"):
                    plant_result = self.client.table("plants_master").select("id, fleet_number, description").eq("id", transfer["plant_id"]).execute()
                    plant = plant_result.data[0] if plant_result.data else None

                # Get location names
                from_loc = None
                to_loc = None
                if transfer.get("from_location_id"):
                    loc_result = self.client.table("locations").select("id, name").eq("id", transfer["from_location_id"]).execute()
                    from_loc = loc_result.data[0] if loc_result.data else None
                if transfer.get("to_location_id"):
                    loc_result = self.client.table("locations").select("id, name").eq("id", transfer["to_location_id"]).execute()
                    to_loc = loc_result.data[0] if loc_result.data else None

                enriched.append({
                    **transfer,
                    "plant": plant,
                    "from_location": from_loc,
                    "to_location": to_loc,
                })

            return enriched

        except Exception as e:
            logger.error("Failed to get pending transfers", error=str(e))
            return []

    def get_plant_transfers(
        self,
        plant_id: str | UUID,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """Get transfer history for a specific plant.

        Args:
            plant_id: The plant ID.
            limit: Maximum number of records to return.

        Returns:
            List of transfer records, newest first.
        """
        try:
            result = (
                self.client.table("plant_transfers")
                .select("*")
                .eq("plant_id", str(plant_id))
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )

            transfers = result.data or []

            # Enrich with location data
            enriched = []
            for transfer in transfers:
                from_loc = None
                to_loc = None
                if transfer.get("from_location_id"):
                    loc_result = self.client.table("locations").select("id, name").eq("id", transfer["from_location_id"]).execute()
                    from_loc = loc_result.data[0] if loc_result.data else None
                if transfer.get("to_location_id"):
                    loc_result = self.client.table("locations").select("id, name").eq("id", transfer["to_location_id"]).execute()
                    to_loc = loc_result.data[0] if loc_result.data else None

                enriched.append({
                    **transfer,
                    "from_location": from_loc,
                    "to_location": to_loc,
                })

            return enriched

        except Exception as e:
            logger.error("Failed to get plant transfers", error=str(e))
            return []

    def cancel_transfer(
        self,
        transfer_id: str | UUID,
        reason: str | None = None,
    ) -> dict[str, Any] | None:
        """Cancel a pending transfer.

        Args:
            transfer_id: The transfer to cancel.
            reason: Optional reason for cancellation.

        Returns:
            Updated transfer record or None on failure.
        """
        try:
            result = (
                self.client.table("plant_transfers")
                .update({
                    "status": "cancelled",
                    "source_remarks": reason,
                })
                .eq("id", str(transfer_id))
                .eq("status", "pending")  # Only cancel pending transfers
                .execute()
            )

            if result.data:
                transfer = result.data[0]

                # Clear pending transfer from plant
                self.client.table("plants_master").update({
                    "pending_transfer_id": None,
                }).eq("pending_transfer_id", str(transfer_id)).execute()

                logger.info("Cancelled transfer", transfer_id=str(transfer_id))
                return transfer

        except Exception as e:
            logger.error(
                "Failed to cancel transfer",
                error=str(e),
                transfer_id=str(transfer_id),
            )

        return None

    def process_transfer_from_parsed(
        self,
        plant_id: str | UUID,
        current_location_id: str | UUID,
        parsed: ParsedRemarks,
        submission_id: str | UUID,
        remarks: str | None,
    ) -> dict[str, Any] | None:
        """Process a transfer based on parsed remarks.

        Args:
            plant_id: The plant ID.
            current_location_id: Current location from the report.
            parsed: Parsed remarks data.
            submission_id: The source submission.
            remarks: Original remarks text.

        Returns:
            Created transfer record or None.
        """
        if not parsed.transfer_detected:
            return None

        if parsed.transfer_direction == "outbound" and parsed.transfer_location:
            return self.create_outbound_transfer(
                plant_id=plant_id,
                from_location_id=current_location_id,
                to_location_raw=parsed.transfer_location,
                source_submission_id=submission_id,
                source_remarks=remarks,
                confidence=parsed.confidence,
            )

        elif parsed.transfer_direction == "inbound" and parsed.transfer_location:
            return self.create_inbound_transfer(
                plant_id=plant_id,
                to_location_id=current_location_id,
                from_location_raw=parsed.transfer_location,
                source_submission_id=submission_id,
                source_remarks=remarks,
                confidence=parsed.confidence,
            )

        return None


# Singleton instance
_transfer_service: TransferService | None = None


def get_transfer_service() -> TransferService:
    """Get the transfer service singleton."""
    global _transfer_service
    if _transfer_service is None:
        _transfer_service = TransferService()
    return _transfer_service
