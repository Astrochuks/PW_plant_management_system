"""Common Pydantic models used across the application."""

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class PaginationParams(BaseModel):
    """Pagination parameters for list endpoints."""

    page: int = Field(default=1, ge=1, description="Page number (1-indexed)")
    limit: int = Field(default=20, ge=1, le=100, description="Items per page")

    @property
    def offset(self) -> int:
        """Calculate offset for database query."""
        return (self.page - 1) * self.limit


class PaginationMeta(BaseModel):
    """Pagination metadata for list responses."""

    page: int
    limit: int
    total: int
    total_pages: int
    has_more: bool

    @classmethod
    def from_params(cls, params: PaginationParams, total: int) -> "PaginationMeta":
        """Create pagination meta from params and total count."""
        total_pages = (total + params.limit - 1) // params.limit if total > 0 else 0
        return cls(
            page=params.page,
            limit=params.limit,
            total=total,
            total_pages=total_pages,
            has_more=params.page < total_pages,
        )


class SuccessResponse(BaseModel, Generic[T]):
    """Standard success response wrapper."""

    success: bool = True
    data: T
    meta: dict[str, Any] | None = None


class PaginatedResponse(BaseModel, Generic[T]):
    """Paginated list response wrapper."""

    success: bool = True
    data: list[T]
    meta: PaginationMeta


class ErrorDetail(BaseModel):
    """Individual error detail."""

    field: str | None = None
    message: str
    code: str


class ErrorResponse(BaseModel):
    """Standard error response wrapper."""

    success: bool = False
    error: dict[str, Any]


class IDResponse(BaseModel):
    """Response containing just an ID."""

    success: bool = True
    data: dict[str, str]  # {"id": "uuid"}


class MessageResponse(BaseModel):
    """Response containing just a message."""

    success: bool = True
    message: str
