"""Custom exception classes for the application.

All exceptions inherit from AppException and include:
- Error code for machine-readable identification
- Human-readable message
- Optional details for debugging
- HTTP status code mapping
"""

from typing import Any


class AppException(Exception):
    """Base exception for all application errors."""

    def __init__(
        self,
        message: str,
        code: str = "INTERNAL_ERROR",
        status_code: int = 500,
        details: dict[str, Any] | list[dict[str, Any]] | None = None,
    ):
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details
        super().__init__(message)

    def to_dict(self) -> dict[str, Any]:
        """Convert exception to dictionary for API response."""
        result = {
            "code": self.code,
            "message": self.message,
        }
        if self.details:
            result["details"] = self.details
        return result


class ValidationError(AppException):
    """Raised when input validation fails."""

    def __init__(
        self,
        message: str = "Validation failed",
        details: list[dict[str, Any]] | None = None,
    ):
        super().__init__(
            message=message,
            code="VALIDATION_ERROR",
            status_code=422,
            details=details,
        )


class AuthenticationError(AppException):
    """Raised when authentication fails."""

    def __init__(self, message: str = "Authentication required"):
        super().__init__(
            message=message,
            code="AUTHENTICATION_ERROR",
            status_code=401,
        )


class AuthorizationError(AppException):
    """Raised when user lacks required permissions."""

    def __init__(self, message: str = "Permission denied"):
        super().__init__(
            message=message,
            code="AUTHORIZATION_ERROR",
            status_code=403,
        )


class NotFoundError(AppException):
    """Raised when a requested resource is not found."""

    def __init__(self, resource: str = "Resource", identifier: str | None = None):
        message = f"{resource} not found"
        if identifier:
            message = f"{resource} with ID '{identifier}' not found"
        super().__init__(
            message=message,
            code="NOT_FOUND",
            status_code=404,
        )


class ConflictError(AppException):
    """Raised when there's a conflict (e.g., duplicate entry)."""

    def __init__(self, message: str = "Resource already exists"):
        super().__init__(
            message=message,
            code="CONFLICT",
            status_code=409,
        )


class RateLimitError(AppException):
    """Raised when rate limit is exceeded."""

    def __init__(self, message: str = "Rate limit exceeded. Please try again later."):
        super().__init__(
            message=message,
            code="RATE_LIMIT_EXCEEDED",
            status_code=429,
        )


class ExternalServiceError(AppException):
    """Raised when an external service call fails."""

    def __init__(
        self,
        service: str,
        message: str = "External service error",
        retryable: bool = True,
    ):
        super().__init__(
            message=f"{service}: {message}",
            code="EXTERNAL_SERVICE_ERROR",
            status_code=502 if retryable else 500,
            details={"service": service, "retryable": retryable},
        )


class FileProcessingError(AppException):
    """Raised when file processing fails."""

    def __init__(
        self,
        message: str = "File processing failed",
        file_name: str | None = None,
        details: dict[str, Any] | None = None,
    ):
        error_details = details or {}
        if file_name:
            error_details["file_name"] = file_name
        super().__init__(
            message=message,
            code="FILE_PROCESSING_ERROR",
            status_code=422,
            details=error_details if error_details else None,
        )


class DatabaseError(AppException):
    """Raised when a database operation fails."""

    def __init__(
        self,
        message: str = "Database operation failed",
        operation: str | None = None,
        retryable: bool = True,
    ):
        super().__init__(
            message=message,
            code="DATABASE_ERROR",
            status_code=503 if retryable else 500,
            details={"operation": operation, "retryable": retryable} if operation else None,
        )
