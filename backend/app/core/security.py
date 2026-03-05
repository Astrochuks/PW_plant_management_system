"""Security utilities for authentication and authorization.

Optimized: local JWT verification + user cache reduces Supabase
requests from 3 per endpoint to 0 (cache hit) or 1 (cache miss).

Supabase signs user tokens with ES256 (JWKS). The public key is
fetched once on startup and cached. Falls back to Supabase Auth
API if local verification fails.
"""

import time
from threading import Lock
from typing import Annotated, Any

import jwt
from jwt import PyJWKClient
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.config import get_settings
from app.core.database import get_supabase_client
from app.core.exceptions import AuthenticationError, AuthorizationError
from app.core.pool import fetchrow
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
# JWT Verification — ES256 via JWKS (local, 0 network calls per request)
# =============================================================================

def _get_jwks_client() -> PyJWKClient:
    """Get or create the cached JWKS client singleton.

    PyJWKClient fetches the public key on first use and caches it
    (default lifespan = 300s). No network call on subsequent verifications.
    """
    if not hasattr(_get_jwks_client, "_instance"):
        settings = get_settings()
        jwks_url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
        _get_jwks_client._instance = PyJWKClient(
            jwks_url,
            cache_jwk_set=True,
            lifespan=600,
            headers={"apikey": settings.supabase_anon_key},
        )
        logger.info("JWKS client initialized", jwks_url=jwks_url)
    return _get_jwks_client._instance


def _verify_token_locally(token: str) -> dict:
    """Verify JWT signature locally using the JWKS public key (ES256).

    Returns the decoded payload with 'sub' (user_id), 'email', 'exp', etc.
    Raises jwt exceptions on invalid/expired tokens.
    """
    jwks_client = _get_jwks_client()
    signing_key = jwks_client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["ES256"],
        options={"verify_aud": False, "verify_iat": False},
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
    1. Try local ES256 verification via JWKS (0 network calls after key is cached)
    2. If local fails, fall back to Supabase Auth API (1 network call)
    3. Expired tokens are rejected immediately without a network call
    """
    try:
        payload = _verify_token_locally(token)
        return payload["sub"]
    except jwt.ExpiredSignatureError:
        raise AuthenticationError("Token has expired")
    except Exception as e:
        logger.debug("Local JWT verification failed, falling back to Supabase", error=str(e))

    return _verify_token_via_supabase(token)


# =============================================================================
# User Lookup — cached to avoid repeated DB calls
# =============================================================================

async def _get_user_data(user_id: str) -> dict:
    """Get user data from cache or database.

    Cache hit: 0 DB calls.
    Cache miss: 1 DB call, then cached for TTL.
    """
    cache = _get_user_cache()

    # Check cache first
    cached = cache.get(user_id)
    if cached is not None:
        return cached

    # Cache miss — fetch from database via asyncpg
    row = await fetchrow(
        "SELECT id, email, role, full_name, is_active, location_id FROM users WHERE id = $1::uuid",
        user_id,
    )

    if not row:
        raise AuthenticationError("User not found in system")

    # Cache the result
    cache.set(user_id, row)
    return row


# =============================================================================
# FastAPI Dependencies
# =============================================================================

class CurrentUser(BaseModel):
    """Represents the currently authenticated user."""

    id: str
    email: str
    role: str  # 'admin', 'management', or 'site_engineer'
    full_name: str | None = None
    is_active: bool = True
    location_id: str | None = None  # Only set for site_engineer role

    @property
    def is_admin(self) -> bool:
        """Check if user has admin role."""
        return self.role == "admin"

    @property
    def is_management(self) -> bool:
        """Check if user has management role."""
        return self.role == "management"

    @property
    def is_site_engineer(self) -> bool:
        """Check if user has site_engineer role."""
        return self.role == "site_engineer"


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
        user = await _get_user_data(user_id)

        if not user.get("is_active", False):
            raise AuthenticationError("User account is deactivated")

        # Store user in request state for logging middleware
        request.state.user_id = user["id"]
        request.state.user_email = user["email"]
        request.state.user_role = user["role"]

        location_id = user.get("location_id")
        return CurrentUser(
            id=user["id"],
            email=user["email"],
            role=user["role"],
            full_name=user.get("full_name"),
            is_active=user.get("is_active", True),
            location_id=str(location_id) if location_id else None,
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


async def require_site_engineer(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CurrentUser:
    """Require site_engineer role with an assigned location."""
    if not current_user.is_site_engineer:
        raise AuthorizationError("Site engineer access required")
    if not current_user.location_id:
        raise AuthorizationError("No site assigned to this engineer account")
    return current_user


async def validate_upload_token(
    token: str,
    upload_type: str,
) -> dict[str, Any]:
    """Validate an upload token for public file uploads."""
    try:
        row = await fetchrow(
            "SELECT * FROM validate_upload_token($1, $2)",
            token,
            upload_type,
        )

        if not row or not row.get("valid"):
            error_message = row.get("error_message", "Invalid token") if row else "Invalid token"
            raise AuthenticationError(error_message)

        return {
            "token_id": row.get("token_id"),
            "location_id": row.get("location_id"),
            "location_name": row.get("location_name"),
        }

    except AuthenticationError:
        raise
    except Exception as e:
        logger.error("Token validation failed", error=str(e))
        raise AuthenticationError("Token validation failed")
