"""File upload endpoints for weekly reports and purchase orders."""

from datetime import date
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Query, UploadFile

from app.config import get_settings
from app.core.database import get_supabase_admin_client
from app.core.exceptions import ValidationError, AuthenticationError, NotFoundError
from app.core.security import (
    CurrentUser,
    get_current_user,
    require_admin,
    validate_upload_token,
)
from app.models.upload import (
    UploadResponse,
    UploadStatus,
    UploadStatusResponse,
    WeeklyReportSubmission,
)
from app.monitoring.logging import get_logger
from app.workers.etl_worker import process_weekly_report, process_purchase_order

router = APIRouter()
logger = get_logger(__name__)


@router.post("/weekly-report", response_model=UploadResponse)
async def upload_weekly_report(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    token: str = Form(...),
    week_ending_date: date = Form(...),
    location_id: UUID | None = Form(None),
    submitter_name: str | None = Form(None),
    submitter_email: str | None = Form(None),
) -> UploadResponse:
    """Upload a weekly report Excel file.

    This is a public endpoint that uses token-based authentication.
    The file is validated, stored, and processed asynchronously.

    Args:
        background_tasks: FastAPI background tasks.
        file: The Excel file to upload.
        token: Upload token/passcode.
        week_ending_date: The week ending date for this report.
        location_id: Optional location ID (may be determined from token).
        submitter_name: Name of the person submitting.
        submitter_email: Email of the person submitting.

    Returns:
        Upload confirmation with job ID for status tracking.
    """
    settings = get_settings()

    # Validate token
    token_info = await validate_upload_token(token, "weekly_report")
    final_location_id = location_id or token_info.get("location_id")

    if not final_location_id:
        raise ValidationError(
            "Location is required",
            details=[{"field": "location_id", "message": "Location must be specified", "code": "REQUIRED"}],
        )

    # Validate file
    _validate_upload_file(file, settings)

    # Read file content
    file_content = await file.read()
    file_size = len(file_content)

    # Store file in Supabase Storage
    client = get_supabase_admin_client()
    storage_path = f"weekly-reports/{final_location_id}/{week_ending_date}/{file.filename}"

    try:
        client.storage.from_("reports").upload(
            storage_path,
            file_content,
            {"content-type": file.content_type or "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
        )
    except Exception as e:
        # File might already exist - try to update
        if "already exists" in str(e).lower():
            client.storage.from_("reports").update(storage_path, file_content)
        else:
            raise

    # Calculate week number and year
    import datetime
    week_info = week_ending_date.isocalendar()
    year = week_info.year
    week_number = week_info.week

    # Create submission record
    submission_data = {
        "year": year,
        "week_number": week_number,
        "week_ending_date": str(week_ending_date),
        "location_id": str(final_location_id),
        "submitted_by_name": submitter_name,
        "submitted_by_email": submitter_email,
        "upload_token_id": token_info.get("token_id"),
        "source_type": "upload",
        "source_file_path": storage_path,
        "source_file_name": file.filename,
        "source_file_size": file_size,
        "status": "pending",
    }

    # Use upsert in case a report for this week/location already exists
    result = (
        client.table("weekly_report_submissions")
        .upsert(submission_data, on_conflict="year,week_number,location_id")
        .execute()
    )

    job_id = result.data[0]["id"]

    logger.info(
        "Weekly report uploaded",
        job_id=job_id,
        file_name=file.filename,
        location_id=str(final_location_id),
        week_ending_date=str(week_ending_date),
    )

    # Queue background processing
    background_tasks.add_task(
        process_weekly_report,
        job_id=job_id,
        storage_path=storage_path,
        location_id=str(final_location_id),
    )

    return UploadResponse(
        success=True,
        job_id=job_id,
        status=UploadStatus.PENDING,
        message="File uploaded successfully. Processing started.",
        file_name=file.filename,
        file_size=file_size,
        location=token_info.get("location_name"),
        week_ending_date=week_ending_date,
    )


@router.post("/purchase-order", response_model=UploadResponse)
async def upload_purchase_order(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    token: str = Form(...),
    location_id: UUID | None = Form(None),
    po_number: str | None = Form(None),
    po_date: date | None = Form(None),
    submitter_name: str | None = Form(None),
    submitter_email: str | None = Form(None),
) -> UploadResponse:
    """Upload a purchase order Excel file.

    This is a public endpoint that uses token-based authentication.

    Args:
        background_tasks: FastAPI background tasks.
        file: The Excel file to upload.
        token: Upload token/passcode.
        location_id: Optional location ID.
        po_number: Purchase order number.
        po_date: Purchase order date.
        submitter_name: Name of the person submitting.
        submitter_email: Email of the person submitting.

    Returns:
        Upload confirmation with job ID.
    """
    settings = get_settings()

    # Validate token
    token_info = await validate_upload_token(token, "purchase_order")
    final_location_id = location_id or token_info.get("location_id")

    # Validate file
    _validate_upload_file(file, settings)

    # Read file content
    file_content = await file.read()
    file_size = len(file_content)

    # Store file
    client = get_supabase_admin_client()
    storage_path = f"purchase-orders/{final_location_id or 'general'}/{po_date or 'undated'}/{file.filename}"

    try:
        client.storage.from_("reports").upload(storage_path, file_content)
    except Exception as e:
        if "already exists" in str(e).lower():
            client.storage.from_("reports").update(storage_path, file_content)
        else:
            raise

    # Create submission record
    submission_data = {
        "po_number": po_number,
        "po_date": str(po_date) if po_date else None,
        "location_id": str(final_location_id) if final_location_id else None,
        "submitted_by_name": submitter_name,
        "submitted_by_email": submitter_email,
        "upload_token_id": token_info.get("token_id"),
        "source_type": "upload",
        "source_file_path": storage_path,
        "source_file_name": file.filename,
        "source_file_size": file_size,
        "status": "pending",
    }

    result = (
        client.table("purchase_order_submissions")
        .insert(submission_data)
        .execute()
    )

    job_id = result.data[0]["id"]

    logger.info(
        "Purchase order uploaded",
        job_id=job_id,
        file_name=file.filename,
        po_number=po_number,
    )

    # Queue background processing
    background_tasks.add_task(
        process_purchase_order,
        job_id=job_id,
        storage_path=storage_path,
    )

    return UploadResponse(
        success=True,
        job_id=job_id,
        status=UploadStatus.PENDING,
        message="File uploaded successfully. Processing started.",
        file_name=file.filename,
        file_size=file_size,
        location=token_info.get("location_name"),
    )


@router.get("/status/{job_id}", response_model=UploadStatusResponse)
async def get_upload_status(
    job_id: UUID,
    upload_type: str = Query("weekly_report", pattern="^(weekly_report|purchase_order)$"),
) -> UploadStatusResponse:
    """Get the status of an upload processing job.

    Args:
        job_id: The job/submission ID.
        upload_type: Type of upload to check.

    Returns:
        Current processing status and results.
    """
    client = get_supabase_admin_client()

    table = "weekly_report_submissions" if upload_type == "weekly_report" else "purchase_order_submissions"

    result = (
        client.table(table)
        .select("*")
        .eq("id", str(job_id))
        .single()
        .execute()
    )

    if not result.data:
        raise NotFoundError("Upload job", str(job_id))

    data = result.data

    return UploadStatusResponse(
        success=True,
        job_id=job_id,
        status=UploadStatus(data["status"]),
        file_name=data.get("source_file_name"),
        started_at=data.get("processing_started_at"),
        completed_at=data.get("processing_completed_at"),
        records_processed=data.get("plants_processed") or data.get("parts_processed"),
        records_created=data.get("plants_created") or data.get("parts_created"),
        records_updated=data.get("plants_updated"),
        errors=data.get("errors"),
        warnings=data.get("warnings"),
    )


@router.get("/submissions/weekly")
async def list_weekly_submissions(
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    year: int | None = None,
    week_number: int | None = None,
    location_id: UUID | None = None,
    status: str | None = Query(None, pattern="^(pending|processing|completed|failed|partial)$"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """List weekly report submissions with filters.

    Args:
        current_user: The authenticated admin user.
        year: Filter by year.
        week_number: Filter by week number.
        location_id: Filter by location.
        status: Filter by processing status.
        page: Page number.
        limit: Items per page.

    Returns:
        Paginated list of submissions.
    """
    client = get_supabase_admin_client()

    query = (
        client.table("weekly_report_submissions")
        .select("*, locations(name)", count="exact")
    )

    if year:
        query = query.eq("year", year)
    if week_number:
        query = query.eq("week_number", week_number)
    if location_id:
        query = query.eq("location_id", str(location_id))
    if status:
        query = query.eq("status", status)

    offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)
    query = query.order("submitted_at", desc=True)

    result = query.execute()
    total = result.count or 0

    # Transform data to include location name
    submissions = []
    for item in result.data:
        item["location_name"] = item.get("locations", {}).get("name") if item.get("locations") else None
        del item["locations"]
        submissions.append(item)

    return {
        "success": True,
        "data": submissions,
        "meta": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        },
    }


@router.post("/tokens/generate")
async def generate_upload_token(
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    name: str = Form(...),
    location_id: UUID | None = Form(None),
    upload_types: list[str] = Form(["weekly_report", "purchase_order"]),
    expires_in_days: int | None = Form(None),
) -> dict[str, Any]:
    """Generate a new upload token for site officers.

    Args:
        current_user: The authenticated admin user.
        name: Friendly name for the token.
        location_id: Optional location to restrict the token to.
        upload_types: Types of uploads allowed.
        expires_in_days: Days until token expires (None = never).

    Returns:
        Generated token details.
    """
    client = get_supabase_admin_client()

    result = client.rpc(
        "generate_upload_token",
        {
            "p_name": name,
            "p_location_id": str(location_id) if location_id else None,
            "p_upload_types": upload_types,
            "p_expires_in_days": expires_in_days,
            "p_created_by": current_user.id,
        },
    ).execute()

    logger.info(
        "Upload token generated",
        token_name=name,
        location_id=str(location_id) if location_id else None,
        user_id=current_user.id,
    )

    return {
        "success": True,
        "data": result.data[0],
    }


@router.get("/tokens")
async def list_upload_tokens(
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    active_only: bool = True,
) -> dict[str, Any]:
    """List all upload tokens.

    Args:
        current_user: The authenticated admin user.
        active_only: Only show active tokens.

    Returns:
        List of upload tokens.
    """
    client = get_supabase_admin_client()

    query = (
        client.table("upload_tokens")
        .select("*, locations(name)")
        .order("created_at", desc=True)
    )

    if active_only:
        query = query.eq("is_active", True)

    result = query.execute()

    # Transform data
    tokens = []
    for item in result.data:
        item["location_name"] = item.get("locations", {}).get("name") if item.get("locations") else None
        del item["locations"]
        # Don't expose the actual token in list view
        item["token"] = item["token"][:4] + "****"
        tokens.append(item)

    return {
        "success": True,
        "data": tokens,
    }


def _validate_upload_file(file: UploadFile, settings) -> None:
    """Validate uploaded file.

    Args:
        file: The uploaded file.
        settings: Application settings.

    Raises:
        ValidationError: If file is invalid.
    """
    if not file.filename:
        raise ValidationError("File name is required")

    # Check extension
    ext = "." + file.filename.split(".")[-1].lower() if "." in file.filename else ""
    if ext not in settings.allowed_upload_extensions:
        raise ValidationError(
            f"Invalid file type. Allowed: {', '.join(settings.allowed_upload_extensions)}",
            details=[{"field": "file", "message": "Invalid file type", "code": "INVALID_TYPE"}],
        )

    # Check content type
    valid_content_types = [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "application/octet-stream",  # Some browsers send this
    ]
    if file.content_type and file.content_type not in valid_content_types:
        logger.warning(
            "Unexpected content type",
            content_type=file.content_type,
            file_name=file.filename,
        )
