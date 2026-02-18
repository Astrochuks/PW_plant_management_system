"""Audit logging service for CRUD operations.

Provides a simple interface to log all data modifications across the system.
Logs are written to the audit_logs table via asyncpg (bypasses RLS).

Usage:
    from app.services.audit_service import audit_service

    # In a BackgroundTask:
    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="update",
        table_name="plants_master",
        record_id=str(plant_id),
        old_values={"status": "IDLE"},
        new_values={"status": "WORKING"},
        ip_address=ip_address,
        description="Updated plant T385 status from IDLE to WORKING",
    )
"""

import json
from typing import Any

from app.core.pool import fetch, fetchval, execute
from app.monitoring.logging import get_logger
from app.services.auth_service import validate_ip

logger = get_logger(__name__)


class AuditService:
    """Service for logging CRUD audit events."""

    async def log(
        self,
        user_id: str,
        user_email: str,
        action: str,
        table_name: str,
        record_id: str | None = None,
        old_values: dict[str, Any] | None = None,
        new_values: dict[str, Any] | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
        description: str | None = None,
    ) -> None:
        """Write an audit log entry.

        Should be called from a BackgroundTask to avoid slowing responses.
        Failures are logged but never raise — audit should not break operations.
        """
        try:
            ip_address = validate_ip(ip_address)

            await execute(
                """INSERT INTO audit_logs
                       (user_id, user_email, action, table_name, record_id,
                        old_values, new_values, ip_address, user_agent, description)
                   VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)""",
                user_id,
                user_email,
                action,
                table_name,
                record_id,
                json.dumps(old_values) if old_values else None,
                json.dumps(new_values) if new_values else None,
                ip_address,
                user_agent,
                description,
            )

        except Exception as e:
            logger.error(
                "Failed to write audit log",
                error=str(e),
                action=action,
                table_name=table_name,
                record_id=record_id,
            )

    async def get_logs(
        self,
        table_name: str | None = None,
        record_id: str | None = None,
        action: str | None = None,
        user_id: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        page: int = 1,
        limit: int = 50,
    ) -> dict[str, Any]:
        """Query audit logs with filtering and pagination."""
        conditions: list[str] = []
        params: list[Any] = []

        if table_name:
            params.append(table_name)
            conditions.append(f"table_name = ${len(params)}")
        if record_id:
            params.append(record_id)
            conditions.append(f"record_id = ${len(params)}")
        if action:
            params.append(action)
            conditions.append(f"action = ${len(params)}")
        if user_id:
            params.append(user_id)
            conditions.append(f"user_id = ${len(params)}")
        if start_date:
            params.append(start_date)
            conditions.append(f"created_at >= ${len(params)}::timestamptz")
        if end_date:
            params.append(end_date)
            conditions.append(f"created_at <= ${len(params)}::timestamptz")

        where = " AND ".join(conditions) if conditions else "TRUE"
        offset = (page - 1) * limit

        total = await fetchval(
            f"SELECT count(*) FROM audit_logs WHERE {where}",
            *params,
        ) or 0

        params.append(limit)
        params.append(offset)
        rows = await fetch(
            f"""SELECT * FROM audit_logs
                WHERE {where}
                ORDER BY created_at DESC
                LIMIT ${len(params) - 1} OFFSET ${len(params)}""",
            *params,
        )

        return {
            "logs": rows,
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        }

    async def get_record_history(
        self,
        table_name: str,
        record_id: str,
    ) -> list[dict]:
        """Get full audit history for a specific record."""
        rows = await fetch(
            """SELECT * FROM audit_logs
               WHERE table_name = $1 AND record_id = $2
               ORDER BY created_at DESC""",
            table_name,
            record_id,
        )
        return rows


# Singleton instance
audit_service = AuditService()
