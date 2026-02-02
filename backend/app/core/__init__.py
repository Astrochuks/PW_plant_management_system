"""Core infrastructure modules."""

from app.core.database import get_supabase_client, get_supabase_admin_client
from app.core.exceptions import (
    AppException,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ValidationError,
    ConflictError,
    ExternalServiceError,
    RateLimitError,
)
from app.core.security import (
    get_current_user,
    get_current_active_user,
    require_admin,
    require_management_or_admin,
)

__all__ = [
    # Database
    "get_supabase_client",
    "get_supabase_admin_client",
    # Exceptions
    "AppException",
    "AuthenticationError",
    "AuthorizationError",
    "NotFoundError",
    "ValidationError",
    "ConflictError",
    "ExternalServiceError",
    "RateLimitError",
    # Security
    "get_current_user",
    "get_current_active_user",
    "require_admin",
    "require_management_or_admin",
]
