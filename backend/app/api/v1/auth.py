"""Authentication and user management endpoints."""

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Body, Query, Request
from pydantic import BaseModel, EmailStr, Field

from app.core.database import get_supabase_client, get_supabase_admin_client
from app.core.exceptions import AuthenticationError, ValidationError, NotFoundError
from app.core.security import CurrentUser, get_current_user, require_admin
from app.monitoring.logging import get_logger
from app.services.auth_service import auth_service

router = APIRouter()
logger = get_logger(__name__)


def get_client_ip(request: Request) -> str | None:
    """Extract client IP from request, handling proxies."""
    # Check X-Forwarded-For header (set by proxies/load balancers)
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # First IP in the list is the original client
        return forwarded.split(",")[0].strip()
    # Check X-Real-IP header
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip
    # Fall back to direct client
    if request.client:
        return request.client.host
    return None


def get_user_agent(request: Request) -> str | None:
    """Extract user agent from request."""
    return request.headers.get("user-agent")


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
async def login(
    credentials: LoginRequest,
    request: Request,
    background_tasks: BackgroundTasks,
) -> LoginResponse:
    """Authenticate user and return tokens.

    Rate limited: 5 failed attempts per email locks account for 15 minutes.
    Logging runs in background to minimize response time.

    Args:
        credentials: Email and password.
        request: FastAPI request object for IP/user-agent extraction.
        background_tasks: FastAPI background tasks for async logging.

    Returns:
        Access and refresh tokens with user info.
    """
    ip_address = get_client_ip(request)
    user_agent = get_user_agent(request)

    # Check rate limits BEFORE attempting authentication (1 DB call)
    auth_service.check_rate_limit(credentials.email, ip_address)

    try:
        client = get_supabase_client()

        # Authenticate with Supabase
        response = client.auth.sign_in_with_password({
            "email": credentials.email,
            "password": credentials.password,
        })

        if not response.session:
            # Log in background - don't slow the response
            background_tasks.add_task(
                auth_service.record_login,
                credentials.email, ip_address, False, "invalid_credentials",
                None, user_agent, {"reason": "invalid_credentials"}
            )
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
            background_tasks.add_task(
                auth_service.record_login,
                credentials.email, ip_address, False, "user_not_found",
                None, user_agent, {"reason": "user_not_in_system"}
            )
            raise AuthenticationError("User not found in system")

        if not user_data.data.get("is_active"):
            background_tasks.add_task(
                auth_service.record_login,
                credentials.email, ip_address, False, "account_deactivated",
                str(user.id), user_agent, {"reason": "account_deactivated"}
            )
            raise AuthenticationError("User account is deactivated")

        # Update last login
        client.table("users").update({
            "last_login_at": "now()"
        }).eq("id", user.id).execute()

        # Log success in background
        background_tasks.add_task(
            auth_service.record_login,
            credentials.email, ip_address, True, None,
            str(user.id), user_agent, {"role": user_data.data["role"]}
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
        # Log in background
        background_tasks.add_task(
            auth_service.record_login,
            credentials.email, ip_address, False, "system_error",
            None, user_agent, {}
        )
        logger.error("Login failed", error=str(e), email=credentials.email)
        raise AuthenticationError("Invalid credentials")


@router.post("/refresh", response_model=LoginResponse)
async def refresh_token(request_body: RefreshRequest, request: Request) -> LoginResponse:
    """Refresh access token using refresh token.

    Args:
        request_body: Refresh token.
        request: FastAPI request object.

    Returns:
        New access and refresh tokens.
    """
    ip_address = get_client_ip(request)
    user_agent = get_user_agent(request)

    try:
        client = get_supabase_client()

        response = client.auth.refresh_session(request_body.refresh_token)

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

        # Log token refresh
        auth_service.log_auth_event(
            "token_refreshed", user_data.data["email"], user_id=user.id,
            ip_address=ip_address, user_agent=user_agent
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
    request: Request,
) -> dict[str, bool]:
    """Logout current user and invalidate session.

    Args:
        current_user: The authenticated user.
        request: FastAPI request object.

    Returns:
        Logout confirmation.
    """
    ip_address = get_client_ip(request)
    user_agent = get_user_agent(request)

    try:
        client = get_supabase_client()
        client.auth.sign_out()

        # Log logout event
        auth_service.log_auth_event(
            "logout", current_user.email, user_id=current_user.id,
            ip_address=ip_address, user_agent=user_agent
        )

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
    request_body: UpdateProfileRequest,
    request: Request,
) -> dict[str, Any]:
    """Update current user's profile (name only).

    Users can update their own name but not their role.

    Args:
        current_user: The authenticated user.
        request_body: Profile fields to update.
        request: FastAPI request object.

    Returns:
        Updated profile.
    """
    ip_address = get_client_ip(request)
    client = get_supabase_admin_client()

    old_name = current_user.full_name

    result = (
        client.table("users")
        .update({
            "full_name": request_body.full_name,
            "updated_at": "now()",
        })
        .eq("id", current_user.id)
        .execute()
    )

    # Log profile update
    auth_service.log_auth_event(
        "user_updated", current_user.email, user_id=current_user.id,
        ip_address=ip_address,
        details={"field": "full_name", "old_value": old_name, "new_value": request_body.full_name, "self_update": True}
    )

    logger.info(
        "User updated profile",
        user_id=current_user.id,
        new_name=request_body.full_name,
    )

    return {
        "success": True,
        "data": {
            "id": current_user.id,
            "email": current_user.email,
            "full_name": request_body.full_name,
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
    request_body: ChangePasswordRequest,
    request: Request,
) -> dict[str, bool]:
    """Change user's password.

    Args:
        current_user: The authenticated user.
        request_body: Current and new passwords.
        request: FastAPI request object.

    Returns:
        Success confirmation.
    """
    ip_address = get_client_ip(request)
    user_agent = get_user_agent(request)

    try:
        client = get_supabase_client()

        # Update password via Supabase Auth
        client.auth.update_user({
            "password": request_body.new_password,
        })

        # Clear must_change_password flag
        client.table("users").update({
            "must_change_password": False,
            "updated_at": "now()",
        }).eq("id", current_user.id).execute()

        # Log password change
        auth_service.log_auth_event(
            "password_changed", current_user.email, user_id=current_user.id,
            ip_address=ip_address, user_agent=user_agent
        )

        logger.info(
            "User changed password",
            user_id=current_user.id,
        )

        return {"success": True}

    except Exception as e:
        logger.error("Password change failed", error=str(e), user_id=current_user.id)
        raise ValidationError(f"Password change failed: {str(e)}")


# ============================================================================
# Auth Events & Security Endpoints (Admin Only)
# ============================================================================


@router.get("/events")
async def get_auth_events(
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    user_id: UUID | None = None,
    email: str | None = None,
    event_type: str | None = Query(
        None,
        pattern="^(login_success|login_failed|logout|password_changed|password_reset|user_created|user_updated|user_deactivated|user_reactivated|token_refreshed|lockout_created|lockout_cleared)$"
    ),
    start_date: str | None = Query(None, description="ISO date string"),
    end_date: str | None = Query(None, description="ISO date string"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
) -> dict[str, Any]:
    """Get authentication events (audit log).

    Admin only. View all authentication-related events.

    Args:
        current_user: The authenticated admin user.
        user_id: Filter by user ID.
        email: Filter by email (partial match).
        event_type: Filter by event type.
        start_date: Filter events after this date.
        end_date: Filter events before this date.
        page: Page number.
        limit: Items per page.

    Returns:
        Paginated list of auth events.
    """
    result = auth_service.get_auth_events(
        user_id=str(user_id) if user_id else None,
        email=email,
        event_type=event_type,
        start_date=start_date,
        end_date=end_date,
        page=page,
        limit=limit
    )

    return {
        "success": True,
        "data": result["events"],
        "meta": {
            "page": result["page"],
            "limit": result["limit"],
            "total": result["total"],
            "total_pages": result["total_pages"],
        }
    }


@router.get("/login-attempts")
async def get_login_attempts(
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    email: str | None = None,
    ip_address: str | None = None,
    success: bool | None = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
) -> dict[str, Any]:
    """Get login attempts for rate limiting analysis.

    Admin only. View login attempt history.

    Args:
        current_user: The authenticated admin user.
        email: Filter by email (partial match).
        ip_address: Filter by IP address.
        success: Filter by success status.
        page: Page number.
        limit: Items per page.

    Returns:
        Paginated list of login attempts.
    """
    result = auth_service.get_login_attempts(
        email=email,
        ip_address=ip_address,
        success=success,
        page=page,
        limit=limit
    )

    return {
        "success": True,
        "data": result["attempts"],
        "meta": {
            "page": result["page"],
            "limit": result["limit"],
            "total": result["total"],
            "total_pages": result["total_pages"],
        }
    }


@router.get("/lockouts")
async def get_active_lockouts(
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Get currently active account lockouts.

    Admin only. View accounts that are currently locked.

    Args:
        current_user: The authenticated admin user.

    Returns:
        List of active lockouts.
    """
    lockouts = auth_service.get_active_lockouts()

    return {
        "success": True,
        "data": lockouts,
    }


@router.post("/lockouts/{lockout_id}/unlock")
async def unlock_account(
    lockout_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    request: Request,
) -> dict[str, Any]:
    """Manually unlock a locked account.

    Admin only.

    Args:
        lockout_id: The lockout record UUID.
        current_user: The authenticated admin user.
        request: FastAPI request object.

    Returns:
        Success confirmation.
    """
    ip_address = get_client_ip(request)

    success = auth_service.unlock_account(str(lockout_id), current_user.id)

    if success:
        auth_service.log_auth_event(
            "lockout_cleared", current_user.email, user_id=current_user.id,
            ip_address=ip_address,
            details={"lockout_id": str(lockout_id), "action": "manual_unlock"}
        )
        return {"success": True, "message": "Account unlocked successfully"}
    else:
        raise ValidationError("Failed to unlock account")


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
    request_body: CreateUserRequest,
    request: Request,
) -> dict[str, Any]:
    """Create a new user account (Admin only).

    The user will be required to change their password on first login.

    Args:
        current_user: The authenticated admin user.
        request_body: User details including email, temporary password, and role.
        request: FastAPI request object.

    Returns:
        Created user details (without password).
    """
    ip_address = get_client_ip(request)
    client = get_supabase_admin_client()

    # Check if user already exists
    existing = (
        client.table("users")
        .select("id")
        .eq("email", request_body.email)
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
            "email": request_body.email,
            "password": request_body.password,
            "email_confirm": True,  # Skip email confirmation
        })

        if not auth_response.user:
            raise ValidationError("Failed to create user in authentication system")

        user_id = auth_response.user.id

        # Create user record in our users table
        user_data = {
            "id": user_id,
            "email": request_body.email,
            "full_name": request_body.full_name,
            "role": request_body.role,
            "is_active": True,
            "must_change_password": False,  # Password set by admin is ready to use
        }

        result = (
            client.table("users")
            .insert(user_data)
            .execute()
        )

        # Log user creation
        auth_service.log_auth_event(
            "user_created", request_body.email, user_id=user_id,
            ip_address=ip_address,
            details={
                "role": request_body.role,
                "created_by": current_user.id,
                "created_by_email": current_user.email
            }
        )

        logger.info(
            "User created",
            created_user_id=user_id,
            created_email=request_body.email,
            created_role=request_body.role,
            created_by=current_user.id,
        )

        return {
            "success": True,
            "data": {
                "id": user_id,
                "email": request_body.email,
                "full_name": request_body.full_name,
                "role": request_body.role,
                "is_active": True,
            },
            "message": "User created successfully.",
        }

    except ValidationError:
        raise
    except Exception as e:
        logger.error("Failed to create user", error=str(e), email=request_body.email)
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
    request_body: UpdateUserRequest,
    request: Request,
) -> dict[str, Any]:
    """Update a user's details (Admin only).

    Args:
        user_id: The user's UUID.
        current_user: The authenticated admin user.
        request_body: Fields to update.
        request: FastAPI request object.

    Returns:
        Updated user details.
    """
    ip_address = get_client_ip(request)
    client = get_supabase_admin_client()

    # Check user exists and get current values
    existing = (
        client.table("users")
        .select("id, email, full_name, role, is_active")
        .eq("id", str(user_id))
        .single()
        .execute()
    )

    if not existing.data:
        raise NotFoundError("User", str(user_id))

    # Prevent admin from deactivating themselves
    if str(user_id) == current_user.id and request_body.is_active is False:
        raise ValidationError("You cannot deactivate your own account")

    # Build update data and track changes
    update_data = {}
    changes = {}

    if request_body.full_name is not None:
        update_data["full_name"] = request_body.full_name
        changes["full_name"] = {"old": existing.data["full_name"], "new": request_body.full_name}
    if request_body.role is not None:
        update_data["role"] = request_body.role
        changes["role"] = {"old": existing.data["role"], "new": request_body.role}
    if request_body.is_active is not None:
        update_data["is_active"] = request_body.is_active
        changes["is_active"] = {"old": existing.data["is_active"], "new": request_body.is_active}

    if not update_data:
        raise ValidationError("No fields to update")

    update_data["updated_at"] = "now()"

    result = (
        client.table("users")
        .update(update_data)
        .eq("id", str(user_id))
        .execute()
    )

    # Determine event type
    event_type = "user_updated"
    if request_body.is_active is False:
        event_type = "user_deactivated"
    elif request_body.is_active is True and not existing.data["is_active"]:
        event_type = "user_reactivated"

    # Log user update
    auth_service.log_auth_event(
        event_type, existing.data["email"], user_id=str(user_id),
        ip_address=ip_address,
        details={
            "changes": changes,
            "updated_by": current_user.id,
            "updated_by_email": current_user.email
        }
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
    request: Request,
    new_password: str = Body(..., min_length=12, embed=True),
) -> dict[str, Any]:
    """Reset a user's password (Admin only).

    Admin sets a new password that the user can use immediately.

    Args:
        user_id: The user's UUID.
        current_user: The authenticated admin user.
        request: FastAPI request object.
        new_password: The new password.

    Returns:
        Success confirmation.
    """
    ip_address = get_client_ip(request)
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

        # Log password reset
        auth_service.log_auth_event(
            "password_reset", existing.data["email"], user_id=str(user_id),
            ip_address=ip_address,
            details={
                "reset_by": current_user.id,
                "reset_by_email": current_user.email
            }
        )

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
    request: Request,
) -> dict[str, Any]:
    """Deactivate a user account (Admin only).

    This doesn't delete the user, just marks them as inactive.

    Args:
        user_id: The user's UUID.
        current_user: The authenticated admin user.
        request: FastAPI request object.

    Returns:
        Success confirmation.
    """
    ip_address = get_client_ip(request)
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

    # Log deactivation
    auth_service.log_auth_event(
        "user_deactivated", existing.data["email"], user_id=str(user_id),
        ip_address=ip_address,
        details={
            "deactivated_by": current_user.id,
            "deactivated_by_email": current_user.email
        }
    )

    logger.info(
        "User deactivated",
        deactivated_user_id=str(user_id),
        deactivated_by=current_user.id,
    )

    return {
        "success": True,
        "message": "User deactivated successfully",
    }
