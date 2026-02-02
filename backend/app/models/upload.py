"""Upload-related Pydantic models."""

from datetime import date, datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class UploadType(str, Enum):
    """Types of file uploads."""

    WEEKLY_REPORT = "weekly_report"
    PURCHASE_ORDER = "purchase_order"


class UploadStatus(str, Enum):
    """Upload processing status."""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"


class UploadTokenValidation(BaseModel):
    """Result of upload token validation."""

    is_valid: bool
    token_id: UUID | None = None
    location_id: UUID | None = None
    location_name: str | None = None
    error_message: str | None = None


class WeeklyReportUploadRequest(BaseModel):
    """Request body for weekly report upload."""

    token: str = Field(..., min_length=6, max_length=64)
    location_id: UUID | None = None
    week_ending_date: date
    submitter_name: str | None = Field(None, max_length=255)
    submitter_email: str | None = Field(None, max_length=255)


class PurchaseOrderUploadRequest(BaseModel):
    """Request body for purchase order upload."""

    token: str = Field(..., min_length=6, max_length=64)
    location_id: UUID | None = None
    po_number: str | None = Field(None, max_length=100)
    po_date: date | None = None
    submitter_name: str | None = Field(None, max_length=255)
    submitter_email: str | None = Field(None, max_length=255)


class UploadResponse(BaseModel):
    """Response after file upload."""

    success: bool
    job_id: UUID
    status: UploadStatus
    message: str
    file_name: str
    file_size: int
    location: str | None = None
    week_ending_date: date | None = None


class UploadStatusResponse(BaseModel):
    """Response for upload status check."""

    success: bool
    job_id: UUID
    status: UploadStatus
    file_name: str | None

    # Progress info
    started_at: datetime | None
    completed_at: datetime | None

    # Results (when completed)
    records_processed: int | None = None
    records_created: int | None = None
    records_updated: int | None = None

    # Errors (when failed or partial)
    errors: list[dict[str, Any]] | None = None
    warnings: list[dict[str, Any]] | None = None


class WeeklyReportSubmission(BaseModel):
    """Weekly report submission record."""

    id: UUID
    year: int
    week_number: int
    week_ending_date: date
    location_id: UUID
    location_name: str | None = None

    # Submission info
    submitted_at: datetime | None
    submitted_by_name: str | None
    submitted_by_email: str | None
    source_type: str
    source_file_name: str | None

    # Processing status
    status: UploadStatus
    processing_started_at: datetime | None
    processing_completed_at: datetime | None

    # Results
    plants_processed: int
    plants_created: int
    plants_updated: int
    errors: list[dict[str, Any]] | None
    warnings: list[dict[str, Any]] | None

    class Config:
        from_attributes = True


class SubmissionListResponse(BaseModel):
    """Response for submission list endpoint."""

    success: bool = True
    data: list[WeeklyReportSubmission]
    meta: dict[str, Any]
