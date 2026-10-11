"""Authentication and user management endpoints."""

import asyncio
import re
import time
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from pydantic import BaseModel, EmailStr, Field, field_validator

from app.config import get_settings
from app.core.database import get_supabase_admin_client, create_auth_client
from app.core.pool import fetch, fetchrow, fetchval, execute
from app.core.exceptions import AuthenticationError, ValidationError, NotFoundError
from app.core.security import CurrentUser, get_current_user, require_admin, invalidate_user_cache
from app.monitoring.logging import get_logger
from app.services.auth_service import auth_service


def validate_password_strength(password: str) -> str:
    """Validate password meets complexity requirements."""
    errors = []
    if len(password) < 6:
        errors.append("at least 6 characters")
    if not re.search(r"[A-Z]", password):
        errors.append("at least one uppercase letter")
    if not re.search(r"[a-z]", password):
        errors.append("at least one lowercase letter")
    if not re.search(r"\d", password):
        errors.append("at least one number")
    if errors:
        raise ValueError(f"Password must contain: {', '.join(errors)}")
    return password

router = APIRouter()
logger = get_logger(__name__)


def get_client_ip(request: Request) -> str | None:
    """Extract client IP from request.

    Only trusts proxy headers (X-Forwarded-For, X-Real-IP) when
    TRUST_PROXY is enabled in settings. Otherwise, uses the direct
    connection IP to prevent header spoofing attacks.
    """
    settings = get_settings()

    if settings.trust_proxy:
        # Behind a known reverse proxy — trust forwarded headers
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip

    # Direct connection IP (cannot be spoofed)
    if request.client:
        return request.client.host
    return None


def get_user_agent(request: Request) -> str | None:
    """Extract user agent from request."""
    return request.headers.get("user-agent")


class LoginRequest(BaseModel):
    """Login request body."""

    email: EmailStr
    password: str = Field(..., min_length=1)


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

    t0 = time.perf_counter()

    # Run ALL THREE network calls in parallel:
    #   1. Rate-limit check (asyncpg → direct async)
    #   2. Supabase Auth sign-in (Auth API → sync, to_thread)
    #   3. Fetch user details by email (asyncpg → direct async)
    auth_client = create_auth_client()

    def _sign_in():
        return auth_client.auth.sign_in_with_password({
            "email": credentials.email,
            "password": credentials.password,
        })

    async def _fetch_user():
        return await fetchrow(
            "SELECT id, email, role, full_name, is_active, must_change_password, location_id FROM users WHERE email = $1",
            credentials.email,
        )

    rate_limit_result, sign_in_result, user_fetch_result = await asyncio.gather(
        auth_service.check_rate_limit(credentials.email, ip_address),
        asyncio.to_thread(_sign_in),
        _fetch_user(),
        return_exceptions=True,
    )

    t1 = time.perf_counter()
    logger.info("login_timing", step="parallel_all", duration_ms=round((t1 - t0) * 1000, 1))

    # Check rate limit first — if it raised, propagate
    if isinstance(rate_limit_result, Exception):
        raise rate_limit_result

    # Check sign-in result
    if isinstance(sign_in_result, Exception):
        background_tasks.add_task(
            auth_service.record_login,
            credentials.email, ip_address, False, "invalid_credentials",
            None, user_agent, {"reason": "invalid_credentials"}
        )
        raise AuthenticationError("Invalid credentials")

    response = sign_in_result

    try:
        if not response.session:
            background_tasks.add_task(
                auth_service.record_login,
                credentials.email, ip_address, False, "invalid_credentials",
                None, user_agent, {"reason": "invalid_credentials"}
            )
            raise AuthenticationError("Invalid credentials")

        session = response.session
        user = response.user

        # Use pre-fetched user data (already retrieved in parallel)
        if isinstance(user_fetch_result, Exception):
            # Fallback: fetch by ID if email fetch failed
            user_data = await fetchrow(
                "SELECT id, email, role, full_name, is_active, must_change_password, location_id FROM users WHERE id = $1::uuid",
                str(user.id),
            )
        else:
            user_data = user_fetch_result

        logger.info("login_timing", step="total", duration_ms=round((time.perf_counter() - t0) * 1000, 1))

        if not user_data:
            background_tasks.add_task(
                auth_service.record_login,
                credentials.email, ip_address, False, "user_not_found",
                None, user_agent, {"reason": "user_not_in_system"}
            )
            raise AuthenticationError("User not found in system")

        if not user_data.get("is_active"):
            background_tasks.add_task(
                auth_service.record_login,
                credentials.email, ip_address, False, "account_deactivated",
                str(user.id), user_agent, {"reason": "account_deactivated"}
            )
            raise AuthenticationError("User account is deactivated")

        # Update last login + log success in background (don't block response)
        async def _post_login(uid: str, email: str, ip: str | None, ua: str | None, role: str) -> None:
            try:
                await execute(
                    "UPDATE users SET last_login_at = now() WHERE id = $1::uuid",
                    uid,
                )
            except Exception:
                pass  # Non-critical
            await auth_service.record_login(email, ip, True, None, uid, ua, {"role": role})

        background_tasks.add_task(
            _post_login,
            str(user.id), credentials.email, ip_address, user_agent, user_data["role"]
        )

        loc_id = user_data.get("location_id")
        return LoginResponse(
            access_token=session.access_token,
            refresh_token=session.refresh_token,
            expires_in=session.expires_in or 3600,
            user={
                "id": user_data["id"],
                "email": user_data["email"],
                "role": user_data["role"],
                "full_name": user_data.get("full_name"),
                "must_change_password": user_data.get("must_change_password", False),
                "location_id": str(loc_id) if loc_id else None,
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
async def refresh_token(
    request_body: RefreshRequest,
    request: Request,
    background_tasks: BackgroundTasks,
) -> LoginResponse:
    """Refresh access token using refresh token.

    Args:
        request_body: Refresh token.
        request: FastAPI request object.
        background_tasks: FastAPI background tasks for async logging.

    Returns:
        New access and refresh tokens.
    """
    ip_address = get_client_ip(request)
    user_agent = get_user_agent(request)

    try:
        # Fresh client per refresh - prevents session race conditions
        auth_client = create_auth_client()

        # Supabase SDK is synchronous — run in thread to avoid blocking event loop
        def _refresh():
            return auth_client.auth.refresh_session(request_body.refresh_token)

        try:
            response = await asyncio.wait_for(asyncio.to_thread(_refresh), timeout=10.0)
        except asyncio.TimeoutError:
            raise AuthenticationError("Token refresh timed out")

        if not response.session:
            raise AuthenticationError("Invalid refresh token")

        session = response.session
        user = response.user

        # Get user details via asyncpg
        user_data = await fetchrow(
            "SELECT id, email, role, full_name, is_active, location_id FROM users WHERE id = $1::uuid",
            str(user.id),
        )

        if not user_data or not user_data.get("is_active"):
            raise AuthenticationError("User account is deactivated")

        # Log token refresh in background
        background_tasks.add_task(
            auth_service.log_auth_event,
            "token_refreshed", user_data["email"], user.id,
            ip_address, user_agent
        )

        ref_loc_id = user_data.get("location_id")
        return LoginResponse(
            access_token=session.access_token,
            refresh_token=session.refresh_token,
            expires_in=session.expires_in or 3600,
            user={
                "id": user_data["id"],
                "email": user_data["email"],
                "role": user_data["role"],
                "full_name": user_data.get("full_name"),
                "location_id": str(ref_loc_id) if ref_loc_id else None,
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
    background_tasks: BackgroundTasks,
) -> dict[str, bool]:
    """Logout current user and invalidate session.

    Responds instantly — session revocation and logging run in background.

    Args:
        current_user: The authenticated user.
        request: FastAPI request object.
        background_tasks: FastAPI background tasks.

    Returns:
        Logout confirmation.
    """
    ip_address = get_client_ip(request)
    user_agent = get_user_agent(request)

    # Run session revocation + logging in background so response is instant
    async def _background_logout(user_id: str, email: str, ip: str | None, ua: str | None) -> None:
        try:
            admin_client = get_supabase_admin_client()
            admin_client.auth.admin.sign_out(user_id)
        except Exception:
            # Sign-out failure is not critical — JWT expires naturally
            pass

        await auth_service.log_auth_event(
            "logout", email, user_id=user_id,
            ip_address=ip, user_agent=ua
        )

    background_tasks.add_task(
        _background_logout,
        current_user.id, current_user.email, ip_address, user_agent
    )

    logger.info(
        "User logged out",
        user_id=current_user.id,
        email=current_user.email,
    )

    return {"success": True}


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
    # Fetch extra fields from users table
    extra = await fetchrow(
        "SELECT created_at, last_login_at FROM users WHERE id = $1::uuid",
        current_user.id,
    )
    return {
        "success": True,
        "data": {
            "id": current_user.id,
            "email": current_user.email,
            "role": current_user.role,
            "full_name": current_user.full_name,
            "is_admin": current_user.is_admin,
            "created_at": extra["created_at"] if extra else None,
            "last_login_at": extra["last_login_at"] if extra else None,
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

    old_name = current_user.full_name

    await execute(
        "UPDATE users SET full_name = $1, updated_at = now() WHERE id = $2::uuid",
        request_body.full_name,
        current_user.id,
    )

    # Invalidate cache so next request picks up the new name
    invalidate_user_cache(current_user.id)

    # Log profile update
    await auth_service.log_auth_event(
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
    new_password: str = Field(..., min_length=6)

    @field_validator("new_password")
    @classmethod
    def check_password_strength(cls, v: str) -> str:
        return validate_password_strength(v)


@router.post("/change-password")
async def change_password(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    request_body: ChangePasswordRequest,
    request: Request,
    background_tasks: BackgroundTasks,
) -> dict[str, bool]:
    """Change user's password.

    Verifies current password before allowing the change.

    Args:
        current_user: The authenticated user.
        request_body: Current and new passwords.
        request: FastAPI request object.
        background_tasks: FastAPI background tasks for async logging.

    Returns:
        Success confirmation.
    """
    ip_address = get_client_ip(request)
    user_agent = get_user_agent(request)

    # Verify current password by attempting sign-in (fresh client)
    try:
        verify_client = create_auth_client()
        verify_client.auth.sign_in_with_password({
            "email": current_user.email,
            "password": request_body.current_password,
        })
    except Exception:
        raise AuthenticationError("Current password is incorrect")

    try:
        # Update password via admin API (no shared session needed)
        admin_client = get_supabase_admin_client()
        admin_client.auth.admin.update_user_by_id(
            current_user.id,
            {"password": request_body.new_password},
        )

        # Clear must_change_password flag via asyncpg
        await execute(
            "UPDATE users SET must_change_password = false, updated_at = now() WHERE id = $1::uuid",
            current_user.id,
        )

        # Log password change in background
        background_tasks.add_task(
            auth_service.log_auth_event,
            "password_changed", current_user.email, current_user.id,
            ip_address, user_agent
        )

        logger.info(
            "User changed password",
            user_id=current_user.id,
        )

        return {"success": True}

    except AuthenticationError:
        raise
    except Exception as e:
        logger.error("Password change failed", error=str(e), user_id=current_user.id)
        raise ValidationError("Password change failed")


@router.post("/skip-password-change")
async def skip_password_change(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, bool]:
    """Skip password change for now.

    Allows users to continue with their temporary password and change it later.
    Sets must_change_password to False so the password change dialog won't appear on next login.

    Args:
        current_user: The authenticated user.

    Returns:
        Success confirmation.
    """
    try:
        await execute(
            "UPDATE users SET must_change_password = false, updated_at = now() WHERE id = $1::uuid",
            current_user.id,
        )

        logger.info(
            "User skipped password change",
            user_id=current_user.id,
        )

        return {"success": True}

    except Exception as e:
        logger.error("Failed to skip password change", error=str(e), user_id=current_user.id)
        raise ValidationError("Failed to skip password change")


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
    result = await auth_service.get_auth_events(
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
    result = await auth_service.get_login_attempts(
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
    lockouts = await auth_service.get_active_lockouts()

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

    success = await auth_service.unlock_account(str(lockout_id), current_user.id)

    if success:
        await auth_service.log_auth_event(
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


# The roles an admin may assign. 'management' is retired (migration 029 —
# split into managing_director / general_project_manager); it is still a
# valid enum value in Postgres and still management-tier for permissions,
# but it can no longer be written.
# Roles v3 (migration 035): the four working seats. The parked MD/GPM
# values remain valid enum members for reading but cannot be assigned.
AssignableRole = Literal[
    "admin",
    "project_manager",
    "plant_officer",
    "site_engineer",
]


def resolve_project_scope(role: str, requested: str | None, project_ids: list | None) -> str:
    """PRD v2 §3.5. Site engineers are always 'assigned'; admins and plant
    officers are 'all' (the value is never consulted for them); a project
    manager chooses, and 'assigned' needs at least one project."""
    if role == "site_engineer":
        scope = "assigned"
    elif role == "project_manager":
        scope = requested or "all"
    else:
        scope = "all"
    if scope == "assigned" and role == "project_manager" and not project_ids:
        raise ValidationError("A project-scoped project manager needs at least one project")
    if scope == "all" and project_ids:
        raise ValidationError("Projects can only be assigned when the scope is 'assigned'")
    return scope


async def replace_assignments(user_id: str, project_ids: list, by: str) -> dict[str, list[str]]:
    """Make the live assignments equal `project_ids`: end the ones no longer
    listed (rows are never deleted), add the new ones. Returns what changed."""
    wanted = {str(pid) for pid in project_ids}
    live = {str(r["project_id"]) for r in await fetch(
        "SELECT project_id FROM user_project_assignments WHERE user_id = $1::uuid AND ended_at IS NULL",
        user_id)}
    ended = sorted(live - wanted); added = sorted(wanted - live)
    if ended:
        await execute(
            "UPDATE user_project_assignments SET ended_at = now() "
            "WHERE user_id = $1::uuid AND ended_at IS NULL AND project_id = ANY($2::uuid[])",
            user_id, ended)
    for pid in added:
        exists = await fetchrow(
            "SELECT id FROM user_project_assignments WHERE user_id = $1::uuid AND project_id = $2::uuid",
            user_id, pid)
        if exists:  # unique(user_id, project_id): revive the ended row
            await execute("UPDATE user_project_assignments SET ended_at = NULL, created_by = $2::uuid, created_at = now() WHERE id = $1::uuid",
                          str(exists["id"]), by)
        else:
            await execute(
                "INSERT INTO user_project_assignments (user_id, project_id, role_on_project, created_by) "
                "VALUES ($1::uuid, $2::uuid, 'member', $3::uuid)", user_id, pid, by)
    return {"ended": ended, "added": added}


_USER_PROJECTS_SQL = """COALESCE((
    SELECT json_agg(json_build_object('id', p.id, 'short_name', p.short_name,
                                      'project_name', p.project_name) ORDER BY p.short_name)
      FROM user_project_assignments a JOIN projects p ON p.id = a.project_id
     WHERE a.user_id = u.id AND a.ended_at IS NULL), '[]'::json) AS projects"""


class CreateUserRequest(BaseModel):
    """Request body for creating a new user."""

    email: EmailStr
    password: str = Field(..., min_length=6, description="Temporary password")
    full_name: str = Field(..., min_length=2, max_length=255)
    role: AssignableRole = "site_engineer"
    location_id: UUID | None = None  # legacy plant-site link; optional, site_engineer only
    # PRD v2 §3.5: which projects the user may see. Project managers choose
    # 'all' (General PM) or 'assigned'; site engineers are always 'assigned'.
    project_scope: Literal["all", "assigned"] | None = None
    project_ids: list[UUID] | None = None  # the assignments when scope = 'assigned'

    @field_validator("password")
    @classmethod
    def check_password_strength(cls, v: str) -> str:
        return validate_password_strength(v)


class UpdateUserRequest(BaseModel):
    """Request body for updating a user."""

    full_name: str | None = None
    role: AssignableRole | None = None
    is_active: bool | None = None
    location_id: UUID | None = None  # For assigning/changing site engineer location
    clear_location: bool = False  # Set True to explicitly unlink location
    project_scope: Literal["all", "assigned"] | None = None
    project_ids: list[UUID] | None = None  # replaces the live assignments when given


class ResetPasswordRequest(BaseModel):
    """Request body for admin password reset."""

    new_password: str = Field(..., min_length=6)

    @field_validator("new_password")
    @classmethod
    def check_password_strength(cls, v: str) -> str:
        return validate_password_strength(v)


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

    # Check if user already exists
    existing = await fetchrow(
        "SELECT id FROM users WHERE email = $1",
        request_body.email,
    )

    if existing:
        raise ValidationError(
            "User with this email already exists",
            details=[{"field": "email", "message": "Already exists", "code": "DUPLICATE"}],
        )

    # location_id is a legacy plant-site link. Roles v3: a site engineer is
    # scoped by project assignment (PRD v2 §3.5), so no location is required
    # and the one-engineer-per-location rule is gone. Still only meaningful
    # on a site engineer, and it must exist if given.
    if request_body.location_id is not None:
        if request_body.role != "site_engineer":
            raise ValidationError("location_id can only be set for site_engineer role")
        loc = await fetchrow(
            "SELECT id FROM locations WHERE id = $1::uuid",
            str(request_body.location_id),
        )
        if not loc:
            raise ValidationError("Location not found")

    project_scope = resolve_project_scope(
        request_body.role, request_body.project_scope, request_body.project_ids)
    if request_body.project_ids:
        known = await fetchval("SELECT count(*) FROM projects WHERE id = ANY($1::uuid[])",
                               [str(x) for x in request_body.project_ids])
        if known != len(set(request_body.project_ids)):
            raise ValidationError("One or more project ids do not exist")

    try:
        # Create user in Supabase Auth (stays as SDK)
        admin_client = get_supabase_admin_client()
        auth_response = admin_client.auth.admin.create_user({
            "email": request_body.email,
            "password": request_body.password,
            "email_confirm": True,  # Skip email confirmation
        })

        if not auth_response.user:
            raise ValidationError("Failed to create user in authentication system")

        user_id = auth_response.user.id

        # Create user record in our users table via asyncpg
        created = await fetchrow(
            """INSERT INTO users (id, email, full_name, role, is_active, must_change_password, location_id, project_scope)
               VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid, $8)
               RETURNING *""",
            str(user_id),
            request_body.email,
            request_body.full_name,
            request_body.role,
            True,
            False,  # Password set by admin is ready to use
            str(request_body.location_id) if request_body.location_id else None,
            project_scope,
        )
        assigned = await replace_assignments(
            str(user_id), request_body.project_ids or [], current_user.id)

        # Log user creation
        await auth_service.log_auth_event(
            "user_created", request_body.email, user_id=user_id,
            ip_address=ip_address,
            details={
                "role": request_body.role,
                "project_scope": project_scope,
                "projects": assigned["added"],
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
                "id": str(user_id),
                "email": request_body.email,
                "full_name": request_body.full_name,
                "role": request_body.role,
                "is_active": True,
                "location_id": str(request_body.location_id) if request_body.location_id else None,
                "project_scope": project_scope,
                "project_ids": assigned["added"],
            },
            "message": "User created successfully.",
        }

    except ValidationError:
        raise
    except Exception as e:
        logger.error("Failed to create user", error=str(e), email=request_body.email)
        raise ValidationError("Failed to create user")


@router.get("/users")
async def list_users(
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    role: str | None = Query(
        None,
        pattern="^(admin|project_manager|plant_officer|site_engineer"
                "|managing_director|general_project_manager|management)$",
    ),
    is_active: bool | None = None,
) -> dict[str, Any]:
    """List all users (Admin only)."""
    conditions: list[str] = []
    params: list[Any] = []

    if role:
        params.append(role)
        conditions.append(f"u.role = ${len(params)}")

    if is_active is not None:
        params.append(is_active)
        conditions.append(f"u.is_active = ${len(params)}")

    where = " AND ".join(conditions) if conditions else "TRUE"

    data = await fetch(
        f"""SELECT u.id, u.email, u.full_name, u.role, u.is_active,
                   u.must_change_password, u.last_login_at, u.created_at,
                   u.location_id, l.name AS location_name,
                   u.project_scope, {_USER_PROJECTS_SQL}
            FROM users u
            LEFT JOIN locations l ON l.id = u.location_id
            WHERE {where}
            ORDER BY u.created_at DESC""",
        *params,
    )

    return {
        "success": True,
        "data": data,
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
    row = await fetchrow(
        f"""SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.must_change_password,
                  u.last_login_at, u.created_at, u.updated_at,
                  u.location_id, l.name AS location_name,
                  u.project_scope, {_USER_PROJECTS_SQL}
           FROM users u
           LEFT JOIN locations l ON l.id = u.location_id
           WHERE u.id = $1::uuid""",
        str(user_id),
    )

    if not row:
        raise NotFoundError("User", str(user_id))

    return {
        "success": True,
        "data": row,
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

    # Check user exists and get current values
    existing = await fetchrow(
        "SELECT id, email, full_name, role, is_active, location_id, project_scope FROM users WHERE id = $1::uuid",
        str(user_id),
    )

    if not existing:
        raise NotFoundError("User", str(user_id))

    # Prevent admin from deactivating themselves
    if str(user_id) == current_user.id and request_body.is_active is False:
        raise ValidationError("You cannot deactivate your own account")

    # Build update data and track changes
    update_data: dict[str, Any] = {}
    changes: dict[str, dict] = {}

    if request_body.full_name is not None:
        update_data["full_name"] = request_body.full_name
        changes["full_name"] = {"old": existing["full_name"], "new": request_body.full_name}
    if request_body.role is not None:
        update_data["role"] = request_body.role
        changes["role"] = {"old": existing["role"], "new": request_body.role}
    if request_body.is_active is not None:
        update_data["is_active"] = request_body.is_active
        changes["is_active"] = {"old": existing["is_active"], "new": request_body.is_active}

    new_role = request_body.role or existing.get("role")
    # project scope (PRD v2 §3.5): resolved from the role whenever role, scope
    # or assignments are touched, so a role change can never leave a stale scope
    if (request_body.role is not None or request_body.project_scope is not None
            or request_body.project_ids is not None):
        live_ids = request_body.project_ids
        if live_ids is None:
            live_ids = [r["project_id"] for r in await fetch(
                "SELECT project_id FROM user_project_assignments WHERE user_id = $1::uuid AND ended_at IS NULL",
                str(user_id))]
        resolved = resolve_project_scope(
            new_role, request_body.project_scope or existing.get("project_scope"), live_ids)
        if resolved != existing.get("project_scope"):
            update_data["project_scope"] = resolved
            changes["project_scope"] = {"old": existing.get("project_scope"), "new": resolved}
        if resolved == "all" and request_body.project_ids is None and live_ids:
            request_body.project_ids = []  # scope widened: assignments end

    # Handle location_id update for site_engineer
    if request_body.clear_location:
        update_data["location_id"] = None
        changes["location_id"] = {"old": str(existing.get("location_id") or ""), "new": None}
    elif request_body.location_id is not None:
        if new_role != "site_engineer":
            raise ValidationError("location_id can only be set for site_engineer role")
        # roles v3: no one-engineer-per-location rule any more
        update_data["location_id"] = str(request_body.location_id)
        changes["location_id"] = {"old": str(existing.get("location_id") or ""), "new": str(request_body.location_id)}

    if not update_data and request_body.project_ids is None:
        raise ValidationError("No fields to update")

    # Build SET clause
    _UUID_UPDATE_FIELDS = {"location_id"}
    set_parts: list[str] = []
    params: list[Any] = []
    for key, val in update_data.items():
        params.append(val)
        if key in _UUID_UPDATE_FIELDS:
            set_parts.append(f"{key} = ${len(params)}::uuid")
        else:
            set_parts.append(f"{key} = ${len(params)}")
    set_parts.append("updated_at = now()")

    params.append(str(user_id))
    set_clause = ", ".join(set_parts)

    if update_data:
        updated = await fetchrow(
            f"UPDATE users SET {set_clause} WHERE id = ${len(params)}::uuid RETURNING *",
            *params,
        )
    else:  # assignments-only change: the users row itself is untouched
        updated = await fetchrow("SELECT * FROM users WHERE id = $1::uuid", str(user_id))

    if request_body.project_ids is not None:
        known = await fetchval("SELECT count(*) FROM projects WHERE id = ANY($1::uuid[])",
                               [str(x) for x in request_body.project_ids])
        if known != len(set(request_body.project_ids)):
            raise ValidationError("One or more project ids do not exist")
        moved = await replace_assignments(str(user_id), request_body.project_ids, current_user.id)
        if moved["added"] or moved["ended"]:
            changes["projects"] = moved

    # Invalidate cached user data so changes take effect immediately
    invalidate_user_cache(str(user_id))

    # Revoke sessions if user was deactivated (Auth SDK stays)
    if request_body.is_active is False:
        try:
            admin_client = get_supabase_admin_client()
            admin_client.auth.admin.sign_out(str(user_id))
        except Exception as e:
            logger.warning("Failed to revoke sessions on deactivation", error=str(e), user_id=str(user_id))

    # Determine event type
    event_type = "user_updated"
    if request_body.is_active is False:
        event_type = "user_deactivated"
    elif request_body.is_active is True and not existing["is_active"]:
        event_type = "user_reactivated"

    # Log user update
    await auth_service.log_auth_event(
        event_type, existing["email"], user_id=str(user_id),
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
        "data": updated,
    }


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    request_body: ResetPasswordRequest,
    request: Request,
) -> dict[str, Any]:
    """Reset a user's password (Admin only).

    Admin sets a new password that the user can use immediately.

    Args:
        user_id: The user's UUID.
        current_user: The authenticated admin user.
        request_body: New password.
        request: FastAPI request object.

    Returns:
        Success confirmation.
    """
    ip_address = get_client_ip(request)

    # Check user exists
    existing = await fetchrow(
        "SELECT id, email FROM users WHERE id = $1::uuid",
        str(user_id),
    )

    if not existing:
        raise NotFoundError("User", str(user_id))

    try:
        # Update password in Supabase Auth (stays as SDK)
        admin_client = get_supabase_admin_client()
        admin_client.auth.admin.update_user_by_id(
            str(user_id),
            {"password": request_body.new_password},
        )

        # Update timestamp via asyncpg
        await execute(
            "UPDATE users SET updated_at = now() WHERE id = $1::uuid",
            str(user_id),
        )

        # Log password reset
        await auth_service.log_auth_event(
            "password_reset", existing["email"], user_id=str(user_id),
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
        raise ValidationError("Password reset failed")


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

    # Prevent admin from deactivating themselves
    if str(user_id) == current_user.id:
        raise ValidationError("You cannot deactivate your own account")

    # Check user exists
    existing = await fetchrow(
        "SELECT id, email FROM users WHERE id = $1::uuid",
        str(user_id),
    )

    if not existing:
        raise NotFoundError("User", str(user_id))

    # Deactivate user via asyncpg
    await execute(
        "UPDATE users SET is_active = false, updated_at = now() WHERE id = $1::uuid",
        str(user_id),
    )

    # Invalidate cache + revoke sessions immediately (Auth SDK stays)
    invalidate_user_cache(str(user_id))
    try:
        admin_client = get_supabase_admin_client()
        admin_client.auth.admin.sign_out(str(user_id))
    except Exception as e:
        logger.warning("Failed to revoke sessions on deactivation", error=str(e), user_id=str(user_id))

    # Log deactivation
    await auth_service.log_auth_event(
        "user_deactivated", existing["email"], user_id=str(user_id),
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
