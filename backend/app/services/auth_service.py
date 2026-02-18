"""Authentication service with rate limiting and audit logging.

Optimized: uses combined RPC calls and background logging to minimize
login response time (~560ms vs ~1200ms before optimization).
"""

import ipaddress
import json
from datetime import datetime
from typing import Any
from uuid import UUID

from app.core.pool import fetch, fetchrow, fetchval, execute
from app.core.exceptions import RateLimitError
from app.monitoring.logging import get_logger

logger = get_logger(__name__)


def validate_ip(ip: str | None) -> str | None:
    """Validate and return IP address, or None if invalid."""
    if not ip:
        return None
    try:
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

    # =========================================================================
    # Rate Limiting (single RPC call - optimized)
    # =========================================================================

    async def check_rate_limit(self, email: str, ip_address: str | None = None) -> None:
        """
        Check if login should be allowed. Single DB call.

        Raises:
            RateLimitError: If account is locked or too many failed attempts.
        """
        ip_address = validate_ip(ip_address)

        try:
            rows = await fetch(
                "SELECT * FROM check_rate_limit($1, $2, $3, $4, $5)",
                email,
                ip_address,
                MAX_FAILED_ATTEMPTS_PER_EMAIL,
                MAX_FAILED_ATTEMPTS_PER_IP,
                RATE_LIMIT_WINDOW_MINUTES,
            )

            if not rows:
                return  # No data = allow login

            data = rows[0]

            # Account is actively locked
            if data.get("is_locked"):
                unlock_time = data.get("unlock_at")
                if unlock_time:
                    # asyncpg may return datetime object or string
                    if isinstance(unlock_time, str):
                        unlock_dt = datetime.fromisoformat(unlock_time.replace("Z", "+00:00"))
                    else:
                        unlock_dt = unlock_time
                    minutes_remaining = int((unlock_dt - datetime.now(unlock_dt.tzinfo)).total_seconds() / 60)
                    raise RateLimitError(
                        f"Account locked due to too many failed attempts. "
                        f"Try again in {max(1, minutes_remaining)} minutes."
                    )

            # Too many email failures - create lockout
            email_failures = int(data.get("email_failures", 0))
            if email_failures >= MAX_FAILED_ATTEMPTS_PER_EMAIL:
                await self._create_lockout(email, ip_address, "too_many_attempts")
                raise RateLimitError(
                    f"Too many failed login attempts. "
                    f"Account locked for {LOCKOUT_DURATION_MINUTES} minutes."
                )

            # Too many IP failures
            ip_failures = int(data.get("ip_failures", 0))
            if ip_address and ip_failures >= MAX_FAILED_ATTEMPTS_PER_IP:
                await self._create_lockout(email, ip_address, "suspicious_ip")
                raise RateLimitError(
                    f"Too many failed attempts from this IP. "
                    f"Try again in {LOCKOUT_DURATION_MINUTES} minutes."
                )

        except RateLimitError:
            raise
        except Exception as e:
            # Rate limit check failure should NOT block login
            logger.error("Rate limit check failed (allowing login)", error=str(e))

    async def _create_lockout(self, email: str, ip_address: str | None, reason: str) -> None:
        """Create an account lockout."""
        try:
            await fetchval(
                "SELECT create_account_lockout($1, $2, $3, $4)",
                email,
                ip_address,
                LOCKOUT_DURATION_MINUTES,
                reason,
            )

            logger.warning(
                "Account locked",
                email=email,
                ip=ip_address,
                reason=reason,
                duration_minutes=LOCKOUT_DURATION_MINUTES
            )
        except Exception as e:
            logger.error("Failed to create lockout", error=str(e))

    # =========================================================================
    # Login Logging (combined RPC - runs in background)
    # =========================================================================

    async def record_login(
        self,
        email: str,
        ip_address: str | None,
        success: bool,
        failure_reason: str | None = None,
        user_id: str | UUID | None = None,
        user_agent: str | None = None,
        details: dict[str, Any] | None = None
    ) -> None:
        """
        Record login attempt AND auth event in a single DB call.
        Should be called from a background task so it doesn't slow the response.
        """
        try:
            ip_address = validate_ip(ip_address)

            await fetchval(
                "SELECT record_login_and_event($1, $2, $3, $4, $5, $6, $7::jsonb)",
                email,
                ip_address,
                success,
                failure_reason,
                str(user_id) if user_id else None,
                user_agent,
                json.dumps(details or {}),
            )
        except Exception as e:
            logger.error("Failed to record login", error=str(e), email=email)

    # =========================================================================
    # Audit Logging (for non-login events)
    # =========================================================================

    async def log_auth_event(
        self,
        event_type: str,
        email: str,
        user_id: str | UUID | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
        details: dict[str, Any] | None = None
    ) -> None:
        """Log an authentication event to the audit trail."""
        try:
            ip_address = validate_ip(ip_address)

            await fetchval(
                "SELECT record_auth_event($1, $2, $3, $4, $5, $6::jsonb)",
                str(user_id) if user_id else None,
                email,
                event_type,
                ip_address,
                user_agent,
                json.dumps(details or {}),
            )

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

    async def get_auth_events(
        self,
        user_id: str | None = None,
        email: str | None = None,
        event_type: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        page: int = 1,
        limit: int = 50
    ) -> dict[str, Any]:
        """Get auth events with filtering and pagination."""
        conditions: list[str] = []
        params: list[Any] = []

        if user_id:
            params.append(user_id)
            conditions.append(f"user_id = ${len(params)}")
        if email:
            params.append(f"%{email}%")
            conditions.append(f"email ILIKE ${len(params)}")
        if event_type:
            params.append(event_type)
            conditions.append(f"event_type = ${len(params)}")
        if start_date:
            params.append(start_date)
            conditions.append(f"created_at >= ${len(params)}::timestamptz")
        if end_date:
            params.append(end_date)
            conditions.append(f"created_at <= ${len(params)}::timestamptz")

        where = " AND ".join(conditions) if conditions else "TRUE"
        offset = (page - 1) * limit

        total = await fetchval(
            f"SELECT count(*) FROM auth_events WHERE {where}",
            *params,
        ) or 0

        params.append(limit)
        params.append(offset)
        rows = await fetch(
            f"""SELECT * FROM auth_events
                WHERE {where}
                ORDER BY created_at DESC
                LIMIT ${len(params) - 1} OFFSET ${len(params)}""",
            *params,
        )

        return {
            "events": rows,
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0
        }

    async def get_login_attempts(
        self,
        email: str | None = None,
        ip_address: str | None = None,
        success: bool | None = None,
        page: int = 1,
        limit: int = 50
    ) -> dict[str, Any]:
        """Get login attempts with filtering and pagination."""
        conditions: list[str] = []
        params: list[Any] = []

        if email:
            params.append(f"%{email}%")
            conditions.append(f"email ILIKE ${len(params)}")
        if ip_address:
            params.append(ip_address)
            conditions.append(f"ip_address = ${len(params)}")
        if success is not None:
            params.append(success)
            conditions.append(f"success = ${len(params)}")

        where = " AND ".join(conditions) if conditions else "TRUE"
        offset = (page - 1) * limit

        total = await fetchval(
            f"SELECT count(*) FROM login_attempts WHERE {where}",
            *params,
        ) or 0

        params.append(limit)
        params.append(offset)
        rows = await fetch(
            f"""SELECT * FROM login_attempts
                WHERE {where}
                ORDER BY created_at DESC
                LIMIT ${len(params) - 1} OFFSET ${len(params)}""",
            *params,
        )

        return {
            "attempts": rows,
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0
        }

    async def get_active_lockouts(self) -> list[dict]:
        """Get all currently active lockouts."""
        rows = await fetch(
            """SELECT * FROM account_lockouts
               WHERE unlock_at > now() AND unlocked_at IS NULL
               ORDER BY locked_at DESC"""
        )
        return rows

    async def unlock_account(
        self,
        lockout_id: str,
        admin_user_id: str
    ) -> bool:
        """Manually unlock an account."""
        try:
            await execute(
                """UPDATE account_lockouts
                   SET unlocked_at = now(), unlocked_by = $2
                   WHERE id = $1::uuid""",
                lockout_id,
                admin_user_id,
            )

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
