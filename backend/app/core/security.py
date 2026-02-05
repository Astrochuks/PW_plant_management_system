"""Security utilities for authentication and authorization.

Optimized: local JWT verification + user cache reduces Supabase
requests from 3 per endpoint to 0 (cache hit) or 1 (cache miss).

If SUPABASE_JWT_SECRET is not set, falls back to Supabase Auth
verification (slower, 1 extra request per call).
"""

import time
from threading import Lock
from typing import Annotated, Any

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.config import get_settings
from app.core.database import get_supabase_client, get_supabase_admin_client
from app.core.exceptions import AuthenticationError, AuthorizationError
from app.monitoring.logging import get_logger

logger = get_logger(__name__)

# HTTPBearer integrates with Swagger's Authorize button —
# no more separate "authorization" parameter on each endpoint
bearer_scheme = HTTPBearer()


# =============================================================================
# User Cache — eliminates repeated DB lookups for the same user
# =============================================================================

class UserCache:
    """Thread-safe in-memory cache for user data with TTL expiry."""

    def __init__(self, ttl_seconds: int = 300):
        self._cache: dict[str, dict] = {}
        self._lock = Lock()
        self.ttl = ttl_seconds

    def get(self, user_id: str) -> dict | None:
        """Get cached user data, or None if expired/missing."""
        with self._lock:
            entry = self._cache.get(user_id)
            if entry and (time.time() - entry["ts"]) < self.ttl:
                return entry["data"]
            if entry:
                del self._cache[user_id]
            return None

    def set(self, user_id: str, data: dict) -> None:
        """Cache user data with current timestamp."""
        with self._lock:
            self._cache[user_id] = {"data": data, "ts": time.time()}

    def invalidate(self, user_id: str) -> None:
        """Remove a specific user from cache (call on update/deactivation)."""
        with self._lock:
            self._cache.pop(user_id, None)

    def clear(self) -> None:
        """Clear all cached data."""
        with self._lock:
            self._cache.clear()


def _get_user_cache() -> UserCache:
    """Get or create the user cache singleton."""
    if not hasattr(_get_user_cache, "_instance"):
        settings = get_settings()
        _get_user_cache._instance = UserCache(ttl_seconds=settings.user_cache_ttl_seconds)
    return _get_user_cache._instance


def invalidate_user_cache(user_id: str) -> None:
    """Public function to invalidate a user's cache entry.

    Call this when a user is updated, deactivated, or has their role changed.
    """
    _get_user_cache().invalidate(user_id)


# =============================================================================
# JWT Verification — local when possible, Supabase fallback otherwise
# =============================================================================

def _verify_token_locally(token: str) -> dict:
    """Verify JWT signature locally using the Supabase JWT secret.

    Returns the decoded payload with 'sub' (user_id), 'email', 'exp', etc.
    Raises jwt exceptions on invalid/expired tokens.
    """
    settings = get_settings()
    return jwt.decode(
        token,
        settings.supabase_jwt_secret,
        algorithms=["HS256"],
        audience="authenticated",
    )


def _verify_token_via_supabase(token: str) -> str:
    """Verify token by calling Supabase Auth API (fallback, 1 network call).

    Returns the user_id from the verified token.
    """
    try:
        client = get_supabase_client()
        user_response = client.auth.get_user(token)

        if not user_response or not user_response.user:
            raise AuthenticationError("Invalid or expired token")

        return str(user_response.user.id)
    except AuthenticationError:
        raise
    except Exception:
        raise AuthenticationError("Invalid or expired token")


def _verify_token(token: str) -> str:
    """Verify a JWT token and return the user_id.

    Strategy:
    1. Try local HS256 verification (0 network calls) if JWT secret is configured
    2. If local fails (e.g., token signed with ES256), fall back to Supabase API
    3. Expired tokens are rejected immediately without a network call
    """
    settings = get_settings()

    if settings.supabase_jwt_secret:
        try:
            payload = _verify_token_locally(token)
            return payload["sub"]
        except jwt.ExpiredSignatureError:
            # Definitely expired — no need to call Supabase
            raise AuthenticationError("Token has expired")
        except jwt.InvalidTokenError:
            # Token may be signed with a different algorithm (e.g., ES256)
            # Fall back to Supabase verification
            logger.debug("Local JWT verification failed, falling back to Supabase")

    return _verify_token_via_supabase(token)


# =============================================================================
# User Lookup — cached to avoid repeated DB calls
# =============================================================================

def _get_user_data(user_id: str) -> dict:
    """Get user data from cache or database.

    Cache hit: 0 DB calls.
    Cache miss: 1 DB call, then cached for TTL.
    """
    cache = _get_user_cache()

    # Check cache first
    cached = cache.get(user_id)
    if cached is not None:
        return cached

    # Cache miss — fetch from database
    admin_client = get_supabase_admin_client()
    result = (
        admin_client.table("users")
        .select("id, email, role, full_name, is_active")
        .eq("id", user_id)
        .single()
        .execute()
    )

    if not result.data:
        raise AuthenticationError("User not found in system")

    # Cache the result
    cache.set(user_id, result.data)
    return result.data


# =============================================================================
# FastAPI Dependencies
# =============================================================================

class CurrentUser(BaseModel):
    """Represents the currently authenticated user."""

    id: str
    email: str
    role: str  # 'admin' or 'management'
    full_name: str | None = None
    is_active: bool = True

    @property
    def is_admin(self) -> bool:
        """Check if user has admin role."""
        return self.role == "admin"

    @property
    def is_management(self) -> bool:
        """Check if user has management role."""
        return self.role == "management"


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> CurrentUser:
    """Extract and validate the current user from the request.

    Optimized flow:
    1. Verify JWT (locally if secret configured, else via Supabase)
    2. Look up user data (from cache if available, else from DB)

    Cache hit + local JWT: 0 Supabase requests (instant)
    Cache miss + local JWT: 1 DB request
    Cache hit + Supabase JWT: 1 Auth request
    Cache miss + Supabase JWT: 1 Auth + 1 DB request
    """
    token = credentials.credentials

    try:
        # Step 1: Verify token and get user_id
        user_id = _verify_token(token)

        # Step 2: Get user data (cached or from DB)
        user = _get_user_data(user_id)

        if not user.get("is_active", False):
            raise AuthenticationError("User account is deactivated")

        # Store user in request state for logging middleware
        request.state.user_id = user["id"]
        request.state.user_email = user["email"]
        request.state.user_role = user["role"]

        return CurrentUser(
            id=user["id"],
            email=user["email"],
            role=user["role"],
            full_name=user.get("full_name"),
            is_active=user.get("is_active", True),
        )

    except AuthenticationError:
        raise
    except Exception as e:
        logger.error("Authentication failed", error=str(e))
        raise AuthenticationError("Authentication failed")


async def get_current_active_user(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CurrentUser:
    """Ensure the current user is active."""
    if not current_user.is_active:
        raise AuthenticationError("User account is deactivated")
    return current_user


def require_admin(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CurrentUser:
    """Require admin role for access."""
    if not current_user.is_admin:
        raise AuthorizationError("Admin access required")
    return current_user


def require_management_or_admin(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CurrentUser:
    """Require management or admin role for access."""
    if not (current_user.is_admin or current_user.is_management):
        raise AuthorizationError("Management or admin access required")
    return current_user


async def validate_upload_token(
    token: str,
    upload_type: str,
) -> dict[str, Any]:
    """Validate an upload token for public file uploads."""
    from app.core.database import get_supabase_admin_client

    try:
        client = get_supabase_admin_client()
        result = client.rpc(
            "validate_upload_token",
            {"p_token": token, "p_upload_type": upload_type},
        ).execute()

        if not result.data or not result.data[0].get("valid"):
            error_message = (
                result.data[0].get("error_message", "Invalid token")
                if result.data
                else "Invalid token"
            )
            raise AuthenticationError(error_message)

        return {
            "token_id": result.data[0].get("token_id"),
            "location_id": result.data[0].get("location_id"),
            "location_name": result.data[0].get("location_name"),
        }

    except AuthenticationError:
        raise
    except Exception as e:
        logger.error("Token validation failed", error=str(e))
        raise AuthenticationError("Token validation failed")
