"""Audit logging service for CRUD operations.

Provides a simple interface to log all data modifications across the system.
Logs are written to the audit_logs table via the admin client (bypasses RLS).

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

from typing import Any

from app.core.database import get_supabase_admin_client
from app.monitoring.logging import get_logger
from app.services.auth_service import validate_ip

logger = get_logger(__name__)


class AuditService:
    """Service for logging CRUD audit events."""

    def __init__(self):
        self._client = None

    @property
    def client(self):
        """Lazy load Supabase admin client."""
        if self._client is None:
            self._client = get_supabase_admin_client()
        return self._client

    def log(
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

            self.client.table("audit_logs").insert({
                "user_id": user_id,
                "user_email": user_email,
                "action": action,
                "table_name": table_name,
                "record_id": record_id,
                "old_values": old_values,
                "new_values": new_values,
                "ip_address": ip_address,
                "user_agent": user_agent,
                "description": description,
            }).execute()

        except Exception as e:
            logger.error(
                "Failed to write audit log",
                error=str(e),
                action=action,
                table_name=table_name,
                record_id=record_id,
            )

    def get_logs(
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
        query = (
            self.client.table("audit_logs")
            .select("*", count="exact")
            .order("created_at", desc=True)
        )

        if table_name:
            query = query.eq("table_name", table_name)
        if record_id:
            query = query.eq("record_id", record_id)
        if action:
            query = query.eq("action", action)
        if user_id:
            query = query.eq("user_id", user_id)
        if start_date:
            query = query.gte("created_at", start_date)
        if end_date:
            query = query.lte("created_at", end_date)

        offset = (page - 1) * limit
        query = query.range(offset, offset + limit - 1)

        result = query.execute()
        total = result.count or 0

        return {
            "logs": result.data,
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        }

    def get_record_history(
        self,
        table_name: str,
        record_id: str,
    ) -> list[dict]:
        """Get full audit history for a specific record."""
        result = (
            self.client.table("audit_logs")
            .select("*")
            .eq("table_name", table_name)
            .eq("record_id", record_id)
            .order("created_at", desc=True)
            .execute()
        )
        return result.data


# Singleton instance
audit_service = AuditService()
