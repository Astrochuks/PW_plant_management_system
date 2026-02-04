"""Authentication service with rate limiting and audit logging."""

import ipaddress
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from app.core.database import get_supabase_admin_client
from app.core.exceptions import RateLimitError
from app.monitoring.logging import get_logger

logger = get_logger(__name__)


def validate_ip(ip: str | None) -> str | None:
    """Validate and return IP address, or None if invalid."""
    if not ip:
        return None
    try:
        # This will raise ValueError if invalid
        ipaddress.ip_address(ip)
        return ip
    except ValueError:
        return None

# Rate limiting configuration
MAX_FAILED_ATTEMPTS_PER_EMAIL = 5
MAX_FAILED_ATTEMPTS_PER_IP = 20
LOCKOUT_DURATION_MINUTES = 15
RATE_LIMIT_WINDOW_MINUTES = 15


class AuthService:
    """Service for authentication-related operations including rate limiting and audit logging."""

    def __init__(self):
        self._client = None

    @property
    def client(self):
        """Lazy load Supabase admin client."""
        if self._client is None:
            self._client = get_supabase_admin_client()
        return self._client

    # =========================================================================
    # Rate Limiting
    # =========================================================================

    def check_rate_limit(self, email: str, ip_address: str | None = None) -> None:
        """
        Check if login should be allowed based on rate limits.

        Args:
            email: The email attempting to login.
            ip_address: The IP address of the request.

        Raises:
            RateLimitError: If rate limit exceeded or account is locked.
        """
        # Validate IP address
        ip_address = validate_ip(ip_address)

        # Check if account is locked
        lockout = self._get_active_lockout(email, ip_address)
        if lockout:
            unlock_time = lockout.get("unlock_at")
            if unlock_time:
                # Parse the timestamp
                unlock_dt = datetime.fromisoformat(unlock_time.replace("Z", "+00:00"))
                minutes_remaining = int((unlock_dt - datetime.now(unlock_dt.tzinfo)).total_seconds() / 60)
                raise RateLimitError(
                    f"Account locked due to too many failed attempts. "
                    f"Try again in {max(1, minutes_remaining)} minutes."
                )

        # Check failed attempts count
        email_failures, ip_failures = self._count_failed_attempts(email, ip_address)

        if email_failures >= MAX_FAILED_ATTEMPTS_PER_EMAIL:
            # Create lockout
            self._create_lockout(email, ip_address, "too_many_attempts")
            raise RateLimitError(
                f"Too many failed login attempts. "
                f"Account locked for {LOCKOUT_DURATION_MINUTES} minutes."
            )

        if ip_address and ip_failures >= MAX_FAILED_ATTEMPTS_PER_IP:
            self._create_lockout(email, ip_address, "suspicious_ip")
            raise RateLimitError(
                f"Too many failed attempts from this IP. "
                f"Try again in {LOCKOUT_DURATION_MINUTES} minutes."
            )

    def _get_active_lockout(self, email: str, ip_address: str | None) -> dict | None:
        """Check for active lockout on email or IP."""
        try:
            result = self.client.rpc(
                "is_account_locked",
                {"p_email": email, "p_ip": ip_address}
            ).execute()

            if result.data and len(result.data) > 0:
                lockout = result.data[0]
                if lockout.get("is_locked"):
                    return lockout
            return None
        except Exception as e:
            logger.error("Failed to check lockout status", error=str(e))
            return None

    def _count_failed_attempts(self, email: str, ip_address: str | None) -> tuple[int, int]:
        """Count recent failed login attempts."""
        try:
            result = self.client.rpc(
                "count_failed_attempts",
                {
                    "p_email": email,
                    "p_ip": ip_address,
                    "p_window_minutes": RATE_LIMIT_WINDOW_MINUTES
                }
            ).execute()

            if result.data and len(result.data) > 0:
                data = result.data[0]
                return int(data.get("email_failures", 0)), int(data.get("ip_failures", 0))
            return 0, 0
        except Exception as e:
            logger.error("Failed to count failed attempts", error=str(e))
            return 0, 0

    def _create_lockout(self, email: str, ip_address: str | None, reason: str) -> None:
        """Create an account lockout."""
        try:
            self.client.rpc(
                "create_account_lockout",
                {
                    "p_email": email,
                    "p_ip": ip_address,
                    "p_duration_minutes": LOCKOUT_DURATION_MINUTES,
                    "p_reason": reason
                }
            ).execute()

            logger.warning(
                "Account locked",
                email=email,
                ip=ip_address,
                reason=reason,
                duration_minutes=LOCKOUT_DURATION_MINUTES
            )
        except Exception as e:
            logger.error("Failed to create lockout", error=str(e))

    def record_login_attempt(
        self,
        email: str,
        ip_address: str | None,
        success: bool,
        failure_reason: str | None = None
    ) -> None:
        """Record a login attempt for rate limiting."""
        try:
            # Validate IP address
            ip_address = validate_ip(ip_address)

            self.client.rpc(
                "record_login_attempt",
                {
                    "p_email": email,
                    "p_ip": ip_address,
                    "p_success": success,
                    "p_failure_reason": failure_reason
                }
            ).execute()
        except Exception as e:
            logger.error("Failed to record login attempt", error=str(e))

    # =========================================================================
    # Audit Logging
    # =========================================================================

    def log_auth_event(
        self,
        event_type: str,
        email: str,
        user_id: str | UUID | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
        details: dict[str, Any] | None = None
    ) -> None:
        """
        Log an authentication event to the audit trail.

        Event types:
        - login_success: Successful login
        - login_failed: Failed login attempt
        - logout: User logged out
        - password_changed: User changed their password
        - password_reset: Admin reset user's password
        - user_created: New user account created
        - user_updated: User details updated
        - user_deactivated: User account deactivated
        - user_reactivated: User account reactivated
        - token_refreshed: Access token refreshed
        - lockout_created: Account was locked
        - lockout_cleared: Account was unlocked
        """
        try:
            # Validate IP address
            ip_address = validate_ip(ip_address)

            self.client.rpc(
                "record_auth_event",
                {
                    "p_user_id": str(user_id) if user_id else None,
                    "p_email": email,
                    "p_event_type": event_type,
                    "p_ip_address": ip_address,
                    "p_user_agent": user_agent,
                    "p_details": details or {}
                }
            ).execute()

            logger.info(
                f"Auth event: {event_type}",
                email=email,
                user_id=str(user_id) if user_id else None,
                ip=ip_address
            )
        except Exception as e:
            logger.error(
                "Failed to log auth event",
                error=str(e),
                event_type=event_type,
                email=email
            )

    # =========================================================================
    # Admin Operations
    # =========================================================================

    def get_auth_events(
        self,
        user_id: str | None = None,
        email: str | None = None,
        event_type: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        page: int = 1,
        limit: int = 50
    ) -> dict[str, Any]:
        """
        Get auth events with filtering and pagination.

        Returns:
            Dict with events list, total count, and pagination info.
        """
        query = (
            self.client.table("auth_events")
            .select("*", count="exact")
            .order("created_at", desc=True)
        )

        if user_id:
            query = query.eq("user_id", user_id)
        if email:
            query = query.ilike("email", f"%{email}%")
        if event_type:
            query = query.eq("event_type", event_type)
        if start_date:
            query = query.gte("created_at", start_date)
        if end_date:
            query = query.lte("created_at", end_date)

        offset = (page - 1) * limit
        query = query.range(offset, offset + limit - 1)

        result = query.execute()
        total = result.count or 0

        return {
            "events": result.data,
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0
        }

    def get_login_attempts(
        self,
        email: str | None = None,
        ip_address: str | None = None,
        success: bool | None = None,
        page: int = 1,
        limit: int = 50
    ) -> dict[str, Any]:
        """Get login attempts with filtering and pagination."""
        query = (
            self.client.table("login_attempts")
            .select("*", count="exact")
            .order("created_at", desc=True)
        )

        if email:
            query = query.ilike("email", f"%{email}%")
        if ip_address:
            query = query.eq("ip_address", ip_address)
        if success is not None:
            query = query.eq("success", success)

        offset = (page - 1) * limit
        query = query.range(offset, offset + limit - 1)

        result = query.execute()
        total = result.count or 0

        return {
            "attempts": result.data,
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0
        }

    def get_active_lockouts(self) -> list[dict]:
        """Get all currently active lockouts."""
        result = (
            self.client.table("account_lockouts")
            .select("*")
            .gt("unlock_at", "now()")
            .is_("unlocked_at", "null")
            .order("locked_at", desc=True)
            .execute()
        )
        return result.data

    def unlock_account(
        self,
        lockout_id: str,
        admin_user_id: str
    ) -> bool:
        """Manually unlock an account."""
        try:
            self.client.table("account_lockouts").update({
                "unlocked_at": "now()",
                "unlocked_by": admin_user_id
            }).eq("id", lockout_id).execute()

            logger.info(
                "Account unlocked manually",
                lockout_id=lockout_id,
                unlocked_by=admin_user_id
            )
            return True
        except Exception as e:
            logger.error("Failed to unlock account", error=str(e))
            return False


# Singleton instance
auth_service = AuthService()
