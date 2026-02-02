"""Security utilities for authentication and authorization.

Integrates with Supabase Auth for JWT-based authentication.
"""

from typing import Annotated, Any

from fastapi import Depends, Header, Request
from pydantic import BaseModel

from app.config import get_settings
from app.core.database import get_supabase_client
from app.core.exceptions import AuthenticationError, AuthorizationError


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
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    """Extract and validate the current user from the request.

    Args:
        request: The incoming request.
        authorization: The Authorization header (Bearer token).

    Returns:
        CurrentUser object with user details.

    Raises:
        AuthenticationError: If no valid token is provided or user not found.
    """
    if not authorization:
        raise AuthenticationError("Authorization header required")

    # Extract token from "Bearer <token>" format
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise AuthenticationError("Invalid authorization header format")

    token = parts[1]

    try:
        # Verify token with Supabase
        client = get_supabase_client()
        user_response = client.auth.get_user(token)

        if not user_response or not user_response.user:
            raise AuthenticationError("Invalid or expired token")

        supabase_user = user_response.user

        # Get user details from our users table
        admin_client = client  # Use same client to get user info
        user_data = (
            admin_client.table("users")
            .select("id, email, role, full_name, is_active")
            .eq("id", supabase_user.id)
            .single()
            .execute()
        )

        if not user_data.data:
            raise AuthenticationError("User not found in system")

        user = user_data.data

        if not user.get("is_active", False):
            raise AuthenticationError("User account is deactivated")

        # Store user in request state for logging
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
        raise AuthenticationError(f"Authentication failed: {str(e)}")


async def get_current_active_user(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CurrentUser:
    """Ensure the current user is active.

    This is a convenience dependency that chains get_current_user.
    """
    if not current_user.is_active:
        raise AuthenticationError("User account is deactivated")
    return current_user


def require_admin(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CurrentUser:
    """Require admin role for access.

    Args:
        current_user: The authenticated user.

    Returns:
        CurrentUser if admin.

    Raises:
        AuthorizationError: If user is not an admin.
    """
    if not current_user.is_admin:
        raise AuthorizationError("Admin access required")
    return current_user


def require_management_or_admin(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CurrentUser:
    """Require management or admin role for access.

    Args:
        current_user: The authenticated user.

    Returns:
        CurrentUser if management or admin.

    Raises:
        AuthorizationError: If user doesn't have required role.
    """
    if not (current_user.is_admin or current_user.is_management):
        raise AuthorizationError("Management or admin access required")
    return current_user


async def validate_upload_token(
    token: str,
    upload_type: str,
) -> dict[str, Any]:
    """Validate an upload token for public file uploads.

    Args:
        token: The upload token/passcode.
        upload_type: Type of upload ('weekly_report' or 'purchase_order').

    Returns:
        Token details including location_id if valid.

    Raises:
        AuthenticationError: If token is invalid.
    """
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
        raise AuthenticationError(f"Token validation failed: {str(e)}")
