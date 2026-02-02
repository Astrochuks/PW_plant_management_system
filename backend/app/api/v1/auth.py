"""Authentication and user management endpoints."""

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Body, Query
from pydantic import BaseModel, EmailStr, Field

from app.core.database import get_supabase_client, get_supabase_admin_client
from app.core.exceptions import AuthenticationError, ValidationError, NotFoundError
from app.core.security import CurrentUser, get_current_user, require_admin
from app.monitoring.logging import get_logger

router = APIRouter()
logger = get_logger(__name__)


class LoginRequest(BaseModel):
    """Login request body."""

    email: EmailStr
    password: str = Field(..., min_length=8)


class LoginResponse(BaseModel):
    """Login response body."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: dict[str, Any]


class RefreshRequest(BaseModel):
    """Token refresh request body."""

    refresh_token: str


@router.post("/login", response_model=LoginResponse)
async def login(credentials: LoginRequest) -> LoginResponse:
    """Authenticate user and return tokens.

    Args:
        credentials: Email and password.

    Returns:
        Access and refresh tokens with user info.
    """
    try:
        client = get_supabase_client()

        # Authenticate with Supabase
        response = client.auth.sign_in_with_password({
            "email": credentials.email,
            "password": credentials.password,
        })

        if not response.session:
            raise AuthenticationError("Invalid credentials")

        session = response.session
        user = response.user

        # Get user details from our users table
        user_data = (
            client.table("users")
            .select("id, email, role, full_name, is_active, must_change_password")
            .eq("id", user.id)
            .single()
            .execute()
        )

        if not user_data.data:
            raise AuthenticationError("User not found in system")

        if not user_data.data.get("is_active"):
            raise AuthenticationError("User account is deactivated")

        # Update last login
        client.table("users").update({
            "last_login_at": "now()"
        }).eq("id", user.id).execute()

        logger.info(
            "User logged in",
            user_id=user.id,
            email=user.email,
        )

        return LoginResponse(
            access_token=session.access_token,
            refresh_token=session.refresh_token,
            expires_in=session.expires_in or 3600,
            user={
                "id": user_data.data["id"],
                "email": user_data.data["email"],
                "role": user_data.data["role"],
                "full_name": user_data.data.get("full_name"),
                "must_change_password": user_data.data.get("must_change_password", False),
            },
        )

    except AuthenticationError:
        raise
    except Exception as e:
        logger.error("Login failed", error=str(e), email=credentials.email)
        raise AuthenticationError("Invalid credentials")


@router.post("/refresh", response_model=LoginResponse)
async def refresh_token(request: RefreshRequest) -> LoginResponse:
    """Refresh access token using refresh token.

    Args:
        request: Refresh token.

    Returns:
        New access and refresh tokens.
    """
    try:
        client = get_supabase_client()

        response = client.auth.refresh_session(request.refresh_token)

        if not response.session:
            raise AuthenticationError("Invalid refresh token")

        session = response.session
        user = response.user

        # Get user details
        user_data = (
            client.table("users")
            .select("id, email, role, full_name, is_active")
            .eq("id", user.id)
            .single()
            .execute()
        )

        if not user_data.data or not user_data.data.get("is_active"):
            raise AuthenticationError("User account is deactivated")

        return LoginResponse(
            access_token=session.access_token,
            refresh_token=session.refresh_token,
            expires_in=session.expires_in or 3600,
            user={
                "id": user_data.data["id"],
                "email": user_data.data["email"],
                "role": user_data.data["role"],
                "full_name": user_data.data.get("full_name"),
            },
        )

    except AuthenticationError:
        raise
    except Exception as e:
        logger.error("Token refresh failed", error=str(e))
        raise AuthenticationError("Invalid refresh token")


@router.post("/logout")
async def logout(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, bool]:
    """Logout current user and invalidate session.

    Args:
        current_user: The authenticated user.

    Returns:
        Logout confirmation.
    """
    try:
        client = get_supabase_client()
        client.auth.sign_out()

        logger.info(
            "User logged out",
            user_id=current_user.id,
            email=current_user.email,
        )

        return {"success": True}

    except Exception as e:
        logger.error("Logout failed", error=str(e), user_id=current_user.id)
        return {"success": False}


@router.get("/me")
async def get_current_user_info(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    """Get current user information.

    Args:
        current_user: The authenticated user.

    Returns:
        Current user details.
    """
    return {
        "success": True,
        "data": {
            "id": current_user.id,
            "email": current_user.email,
            "role": current_user.role,
            "full_name": current_user.full_name,
            "is_admin": current_user.is_admin,
        },
    }


class UpdateProfileRequest(BaseModel):
    """Request body for updating own profile."""

    full_name: str = Field(..., min_length=2, max_length=255)


@router.patch("/me")
async def update_my_profile(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    request: UpdateProfileRequest,
) -> dict[str, Any]:
    """Update current user's profile (name only).

    Users can update their own name but not their role.

    Args:
        current_user: The authenticated user.
        request: Profile fields to update.

    Returns:
        Updated profile.
    """
    client = get_supabase_admin_client()

    result = (
        client.table("users")
        .update({
            "full_name": request.full_name,
            "updated_at": "now()",
        })
        .eq("id", current_user.id)
        .execute()
    )

    logger.info(
        "User updated profile",
        user_id=current_user.id,
        new_name=request.full_name,
    )

    return {
        "success": True,
        "data": {
            "id": current_user.id,
            "email": current_user.email,
            "full_name": request.full_name,
            "role": current_user.role,
        },
    }


class ChangePasswordRequest(BaseModel):
    """Change password request body."""

    current_password: str
    new_password: str = Field(..., min_length=12)


@router.post("/change-password")
async def change_password(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    request: ChangePasswordRequest,
) -> dict[str, bool]:
    """Change user's password.

    Args:
        current_user: The authenticated user.
        request: Current and new passwords.

    Returns:
        Success confirmation.
    """
    try:
        client = get_supabase_client()

        # Update password via Supabase Auth
        client.auth.update_user({
            "password": request.new_password,
        })

        # Clear must_change_password flag
        client.table("users").update({
            "must_change_password": False,
            "updated_at": "now()",
        }).eq("id", current_user.id).execute()

        logger.info(
            "User changed password",
            user_id=current_user.id,
        )

        return {"success": True}

    except Exception as e:
        logger.error("Password change failed", error=str(e), user_id=current_user.id)
        raise ValidationError(f"Password change failed: {str(e)}")


# ============================================================================
# User Management Endpoints (Admin Only)
# ============================================================================


class CreateUserRequest(BaseModel):
    """Request body for creating a new user."""

    email: EmailStr
    password: str = Field(..., min_length=12, description="Temporary password")
    full_name: str = Field(..., min_length=2, max_length=255)
    role: Literal["admin", "management"] = "management"


class UpdateUserRequest(BaseModel):
    """Request body for updating a user."""

    full_name: str | None = None
    role: Literal["admin", "management"] | None = None
    is_active: bool | None = None


@router.post("/users", status_code=201)
async def create_user(
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    request: CreateUserRequest,
) -> dict[str, Any]:
    """Create a new user account (Admin only).

    The user will be required to change their password on first login.

    Args:
        current_user: The authenticated admin user.
        request: User details including email, temporary password, and role.

    Returns:
        Created user details (without password).
    """
    client = get_supabase_admin_client()

    # Check if user already exists
    existing = (
        client.table("users")
        .select("id")
        .eq("email", request.email)
        .execute()
    )

    if existing.data:
        raise ValidationError(
            "User with this email already exists",
            details=[{"field": "email", "message": "Already exists", "code": "DUPLICATE"}],
        )

    try:
        # Create user in Supabase Auth
        auth_response = client.auth.admin.create_user({
            "email": request.email,
            "password": request.password,
            "email_confirm": True,  # Skip email confirmation
        })

        if not auth_response.user:
            raise ValidationError("Failed to create user in authentication system")

        user_id = auth_response.user.id

        # Create user record in our users table
        user_data = {
            "id": user_id,
            "email": request.email,
            "full_name": request.full_name,
            "role": request.role,
            "is_active": True,
            "must_change_password": False,  # Password set by admin is ready to use
        }

        result = (
            client.table("users")
            .insert(user_data)
            .execute()
        )

        logger.info(
            "User created",
            created_user_id=user_id,
            created_email=request.email,
            created_role=request.role,
            created_by=current_user.id,
        )

        return {
            "success": True,
            "data": {
                "id": user_id,
                "email": request.email,
                "full_name": request.full_name,
                "role": request.role,
                "is_active": True,
            },
            "message": "User created successfully.",
        }

    except ValidationError:
        raise
    except Exception as e:
        logger.error("Failed to create user", error=str(e), email=request.email)
        raise ValidationError(f"Failed to create user: {str(e)}")


@router.get("/users")
async def list_users(
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    role: str | None = Query(None, pattern="^(admin|management)$"),
    is_active: bool | None = None,
) -> dict[str, Any]:
    """List all users (Admin only).

    Args:
        current_user: The authenticated admin user.
        role: Filter by role.
        is_active: Filter by active status.

    Returns:
        List of users.
    """
    client = get_supabase_admin_client()

    query = (
        client.table("users")
        .select("id, email, full_name, role, is_active, must_change_password, last_login_at, created_at")
        .order("created_at", desc=True)
    )

    if role:
        query = query.eq("role", role)

    if is_active is not None:
        query = query.eq("is_active", is_active)

    result = query.execute()

    return {
        "success": True,
        "data": result.data,
    }


@router.get("/users/{user_id}")
async def get_user(
    user_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Get a specific user by ID (Admin only).

    Args:
        user_id: The user's UUID.
        current_user: The authenticated admin user.

    Returns:
        User details.
    """
    client = get_supabase_admin_client()

    result = (
        client.table("users")
        .select("id, email, full_name, role, is_active, must_change_password, last_login_at, created_at, updated_at")
        .eq("id", str(user_id))
        .single()
        .execute()
    )

    if not result.data:
        raise NotFoundError("User", str(user_id))

    return {
        "success": True,
        "data": result.data,
    }


@router.patch("/users/{user_id}")
async def update_user(
    user_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    request: UpdateUserRequest,
) -> dict[str, Any]:
    """Update a user's details (Admin only).

    Args:
        user_id: The user's UUID.
        current_user: The authenticated admin user.
        request: Fields to update.

    Returns:
        Updated user details.
    """
    client = get_supabase_admin_client()

    # Check user exists
    existing = (
        client.table("users")
        .select("id, email")
        .eq("id", str(user_id))
        .single()
        .execute()
    )

    if not existing.data:
        raise NotFoundError("User", str(user_id))

    # Prevent admin from deactivating themselves
    if str(user_id) == current_user.id and request.is_active is False:
        raise ValidationError("You cannot deactivate your own account")

    # Build update data
    update_data = {}
    if request.full_name is not None:
        update_data["full_name"] = request.full_name
    if request.role is not None:
        update_data["role"] = request.role
    if request.is_active is not None:
        update_data["is_active"] = request.is_active

    if not update_data:
        raise ValidationError("No fields to update")

    update_data["updated_at"] = "now()"

    result = (
        client.table("users")
        .update(update_data)
        .eq("id", str(user_id))
        .execute()
    )

    logger.info(
        "User updated",
        updated_user_id=str(user_id),
        updated_fields=list(update_data.keys()),
        updated_by=current_user.id,
    )

    return {
        "success": True,
        "data": result.data[0],
    }


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    new_password: str = Body(..., min_length=12, embed=True),
) -> dict[str, Any]:
    """Reset a user's password (Admin only).

    Admin sets a new password that the user can use immediately.

    Args:
        user_id: The user's UUID.
        current_user: The authenticated admin user.
        new_password: The new password.

    Returns:
        Success confirmation.
    """
    client = get_supabase_admin_client()

    # Check user exists
    existing = (
        client.table("users")
        .select("id, email")
        .eq("id", str(user_id))
        .single()
        .execute()
    )

    if not existing.data:
        raise NotFoundError("User", str(user_id))

    try:
        # Update password in Supabase Auth
        client.auth.admin.update_user_by_id(
            str(user_id),
            {"password": new_password},
        )

        # Update timestamp
        client.table("users").update({
            "updated_at": "now()",
        }).eq("id", str(user_id)).execute()

        logger.info(
            "User password reset",
            reset_user_id=str(user_id),
            reset_by=current_user.id,
        )

        return {
            "success": True,
            "message": "Password updated successfully.",
        }

    except Exception as e:
        logger.error("Password reset failed", error=str(e), user_id=str(user_id))
        raise ValidationError(f"Password reset failed: {str(e)}")


@router.delete("/users/{user_id}")
async def deactivate_user(
    user_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Deactivate a user account (Admin only).

    This doesn't delete the user, just marks them as inactive.

    Args:
        user_id: The user's UUID.
        current_user: The authenticated admin user.

    Returns:
        Success confirmation.
    """
    client = get_supabase_admin_client()

    # Prevent admin from deactivating themselves
    if str(user_id) == current_user.id:
        raise ValidationError("You cannot deactivate your own account")

    # Check user exists
    existing = (
        client.table("users")
        .select("id, email")
        .eq("id", str(user_id))
        .single()
        .execute()
    )

    if not existing.data:
        raise NotFoundError("User", str(user_id))

    # Deactivate user
    client.table("users").update({
        "is_active": False,
        "updated_at": "now()",
    }).eq("id", str(user_id)).execute()

    logger.info(
        "User deactivated",
        deactivated_user_id=str(user_id),
        deactivated_by=current_user.id,
    )

    return {
        "success": True,
        "message": "User deactivated successfully",
    }
