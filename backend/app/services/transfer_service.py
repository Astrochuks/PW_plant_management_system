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

from app.core.pool import fetch, fetchrow, fetchval, execute
from app.monitoring.logging import get_logger
from app.services.remarks_parser import ParsedRemarks

logger = get_logger(__name__)


class TransferService:
    """Service for managing plant transfers."""

    async def resolve_location(self, location_name: str) -> dict[str, Any] | None:
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
        row = await fetchrow(
            """SELECT l.id, l.name
               FROM location_aliases la
               JOIN locations l ON l.id = la.location_id
               WHERE la.alias_normalized = $1""",
            name_upper,
        )
        if row:
            return row

        # Try partial match on aliases
        row = await fetchrow(
            """SELECT l.id, l.name
               FROM location_aliases la
               JOIN locations l ON l.id = la.location_id
               WHERE la.alias_normalized ILIKE $1
               LIMIT 1""",
            f"%{name_upper}%",
        )
        if row:
            return row

        # Try direct location name match
        row = await fetchrow(
            "SELECT id, name FROM locations WHERE name ILIKE $1 LIMIT 1",
            f"%{name_upper}%",
        )
        if row:
            return row

        logger.warning("Could not resolve location", location_name=location_name)
        return None

    async def create_outbound_transfer(
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
        to_location = await self.resolve_location(to_location_raw)
        to_location_id = to_location["id"] if to_location else None

        try:
            # Check if a similar transfer already exists (pending or confirmed)
            existing_params: list[Any] = [str(plant_id), str(from_location_id)]
            existing_cond = ""
            if to_location_id:
                existing_params.append(str(to_location_id))
                existing_cond = f" AND to_location_id = ${len(existing_params)}::uuid"

            existing = await fetch(
                f"""SELECT id, status FROM plant_transfers
                    WHERE plant_id = $1::uuid
                      AND from_location_id = $2::uuid
                      AND direction = 'outbound'
                      AND status IN ('pending', 'confirmed')
                      {existing_cond}""",
                *existing_params,
            )

            if existing:
                logger.debug(
                    "Outbound transfer already exists, skipping",
                    plant_id=str(plant_id),
                    existing_transfer_id=existing[0]["id"],
                )
                return existing[0]

            transfer = await fetchrow(
                """INSERT INTO plant_transfers
                       (plant_id, from_location_id, to_location_id,
                        from_location_raw, to_location_raw,
                        transfer_date, direction, status,
                        source_submission_id, source_remarks, parsed_confidence)
                   VALUES ($1::uuid, $2::uuid, $3::uuid,
                           NULL, $4,
                           $5, 'outbound', 'pending',
                           $6::uuid, $7, $8)
                   RETURNING *""",
                str(plant_id),
                str(from_location_id),
                str(to_location_id) if to_location_id else None,
                to_location_raw,
                transfer_date if transfer_date else None,
                str(source_submission_id),
                source_remarks,
                confidence,
            )

            if transfer:
                logger.info(
                    "Created outbound transfer",
                    transfer_id=transfer["id"],
                    plant_id=str(plant_id),
                    to_location=to_location_raw,
                )

                # Update plant with pending transfer ONLY - don't change location or condition
                await execute(
                    "UPDATE plants_master SET pending_transfer_id = $1::uuid WHERE id = $2::uuid",
                    str(transfer["id"]),
                    str(plant_id),
                )

                return transfer

        except Exception as e:
            logger.error(
                "Failed to create outbound transfer",
                error=str(e),
                plant_id=str(plant_id),
            )

        return None

    async def create_inbound_transfer(
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
        from_location = await self.resolve_location(from_location_raw)
        from_location_id = from_location["id"] if from_location else None

        try:
            # Check if a similar inbound transfer already exists
            existing_params: list[Any] = [str(plant_id), str(to_location_id)]
            existing_cond = ""
            if from_location_id:
                existing_params.append(str(from_location_id))
                existing_cond = f" AND from_location_id = ${len(existing_params)}::uuid"

            existing = await fetch(
                f"""SELECT id, status FROM plant_transfers
                    WHERE plant_id = $1::uuid
                      AND to_location_id = $2::uuid
                      AND direction = 'inbound'
                      AND status = 'confirmed'
                      {existing_cond}""",
                *existing_params,
            )

            if existing:
                logger.debug(
                    "Inbound transfer already exists, skipping",
                    plant_id=str(plant_id),
                    existing_transfer_id=existing[0]["id"],
                )
                return existing[0]

            transfer = await fetchrow(
                """INSERT INTO plant_transfers
                       (plant_id, from_location_id, to_location_id,
                        from_location_raw, to_location_raw,
                        transfer_date, direction, status,
                        confirmed_at, confirmed_by_submission_id,
                        source_submission_id, source_remarks, parsed_confidence)
                   VALUES ($1::uuid, $2::uuid, $3::uuid,
                           $4, NULL,
                           $5, 'inbound', 'confirmed',
                           now(), $6::uuid,
                           $6::uuid, $7, $8)
                   RETURNING *""",
                str(plant_id),
                str(from_location_id) if from_location_id else None,
                str(to_location_id),
                from_location_raw,
                transfer_date if transfer_date else None,
                str(source_submission_id),
                source_remarks,
                confidence,
            )

            if transfer:
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

    async def check_and_confirm_pending_transfers(
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
            # Build IN clause for plant_ids
            placeholders = ", ".join(f"${i + 3}::uuid" for i in range(len(plant_ids)))
            params: list[Any] = [str(location_id), str(submission_id)] + plant_ids

            all_transfers = await fetch(
                f"""SELECT * FROM plant_transfers
                    WHERE plant_id IN ({placeholders})
                      AND to_location_id = $1::uuid
                      AND status = 'pending'""",
                *params,
            )

            for transfer in all_transfers:
                # Confirm the transfer
                updated = await fetchrow(
                    """UPDATE plant_transfers
                       SET status = 'confirmed',
                           confirmed_at = now(),
                           confirmed_by_submission_id = $2::uuid
                       WHERE id = $1::uuid
                       RETURNING *""",
                    str(transfer["id"]),
                    str(submission_id),
                )

                if updated:
                    confirmed.append(updated)

                    # Clear pending transfer from plant and update location
                    await execute(
                        """UPDATE plants_master
                           SET pending_transfer_id = NULL,
                               current_location_id = $1::uuid
                           WHERE id = $2::uuid""",
                        str(location_id),
                        str(transfer["plant_id"]),
                    )

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

    async def get_pending_transfers(
        self,
        location_id: str | UUID | None = None,
        plant_id: str | UUID | None = None,
    ) -> list[dict[str, Any]]:
        """Get pending transfers with enriched data via JOINs (no N+1).

        Args:
            location_id: Filter by source or destination location.
            plant_id: Filter by specific plant.

        Returns:
            List of pending transfer records with plant and location data.
        """
        try:
            conds = ["t.status = 'pending'"]
            params: list[Any] = []

            if plant_id:
                params.append(str(plant_id))
                conds.append(f"t.plant_id = ${len(params)}::uuid")

            where = " AND ".join(conds)

            rows = await fetch(
                f"""SELECT t.*,
                           json_build_object('id', pm.id, 'fleet_number', pm.fleet_number, 'description', pm.description) AS plant,
                           CASE WHEN fl.id IS NOT NULL
                                THEN json_build_object('id', fl.id, 'name', fl.name)
                                ELSE NULL END AS from_location,
                           CASE WHEN tl.id IS NOT NULL
                                THEN json_build_object('id', tl.id, 'name', tl.name)
                                ELSE NULL END AS to_location
                    FROM plant_transfers t
                    LEFT JOIN plants_master pm ON pm.id = t.plant_id
                    LEFT JOIN locations fl ON fl.id = t.from_location_id
                    LEFT JOIN locations tl ON tl.id = t.to_location_id
                    WHERE {where}
                    ORDER BY t.created_at DESC""",
                *params,
            )

            return rows

        except Exception as e:
            logger.error("Failed to get pending transfers", error=str(e))
            return []

    async def get_plant_transfers(
        self,
        plant_id: str | UUID,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """Get transfer history for a specific plant via JOINs (no N+1).

        Args:
            plant_id: The plant ID.
            limit: Maximum number of records to return.

        Returns:
            List of transfer records, newest first.
        """
        try:
            rows = await fetch(
                """SELECT t.*,
                          CASE WHEN fl.id IS NOT NULL
                               THEN json_build_object('id', fl.id, 'name', fl.name)
                               ELSE NULL END AS from_location,
                          CASE WHEN tl.id IS NOT NULL
                               THEN json_build_object('id', tl.id, 'name', tl.name)
                               ELSE NULL END AS to_location
                   FROM plant_transfers t
                   LEFT JOIN locations fl ON fl.id = t.from_location_id
                   LEFT JOIN locations tl ON tl.id = t.to_location_id
                   WHERE t.plant_id = $1::uuid
                   ORDER BY t.created_at DESC
                   LIMIT $2""",
                str(plant_id),
                limit,
            )

            return rows

        except Exception as e:
            logger.error("Failed to get plant transfers", error=str(e))
            return []

    async def cancel_transfer(
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
            transfer = await fetchrow(
                """UPDATE plant_transfers
                   SET status = 'cancelled', source_remarks = COALESCE($2, source_remarks)
                   WHERE id = $1::uuid AND status = 'pending'
                   RETURNING *""",
                str(transfer_id),
                reason,
            )

            if transfer:
                # Clear pending transfer from plant
                await execute(
                    "UPDATE plants_master SET pending_transfer_id = NULL WHERE pending_transfer_id = $1::uuid",
                    str(transfer_id),
                )

                logger.info("Cancelled transfer", transfer_id=str(transfer_id))
                return transfer

        except Exception as e:
            logger.error(
                "Failed to cancel transfer",
                error=str(e),
                transfer_id=str(transfer_id),
            )

        return None

    async def process_transfer_from_parsed(
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
            return await self.create_outbound_transfer(
                plant_id=plant_id,
                from_location_id=current_location_id,
                to_location_raw=parsed.transfer_location,
                source_submission_id=submission_id,
                source_remarks=remarks,
                confidence=parsed.confidence,
            )

        elif parsed.transfer_direction == "inbound" and parsed.transfer_location:
            return await self.create_inbound_transfer(
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
