"""File upload endpoints for weekly reports and purchase orders."""

from datetime import date
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Query, Request, UploadFile

from app.api.v1.auth import get_client_ip
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
from app.services.audit_service import audit_service
from app.workers.etl_worker import process_weekly_report, process_purchase_order
from app.services.file_metadata_extractor import extract_and_resolve_metadata, extract_weekly_report_preview

router = APIRouter()
logger = get_logger(__name__)


@router.post("/weekly-report", response_model=UploadResponse)
async def upload_weekly_report(
    request: Request,
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

    background_tasks.add_task(
        audit_service.log,
        user_id=token_info.get("token_id", "token_upload"),
        user_email=submitter_email or "token_upload",
        action="upload",
        table_name="weekly_report_submissions",
        record_id=job_id,
        new_values={
            "file_name": file.filename,
            "file_size": file_size,
            "location_id": str(final_location_id),
            "week_ending_date": str(week_ending_date),
            "submitter_name": submitter_name,
        },
        ip_address=get_client_ip(request),
        description=f"Uploaded weekly report for {token_info.get('location_name', 'unknown')} week ending {week_ending_date}",
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
    request: Request,
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

    background_tasks.add_task(
        audit_service.log,
        user_id=token_info.get("token_id", "token_upload"),
        user_email=submitter_email or "token_upload",
        action="upload",
        table_name="purchase_order_submissions",
        record_id=job_id,
        new_values={
            "file_name": file.filename,
            "file_size": file_size,
            "po_number": po_number,
            "po_date": str(po_date) if po_date else None,
            "submitter_name": submitter_name,
        },
        ip_address=get_client_ip(request),
        description=f"Uploaded purchase order {po_number or file.filename}",
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

    # Transform data to include location name and metadata
    submissions = []
    for item in result.data:
        item["location_name"] = item.get("locations", {}).get("name") if item.get("locations") else None
        item.pop("locations", None)

        # Add computed metadata
        file_size = item.get("source_file_size")
        if file_size:
            if file_size >= 1024 * 1024:
                item["file_size_formatted"] = f"{file_size / (1024 * 1024):.2f} MB"
            elif file_size >= 1024:
                item["file_size_formatted"] = f"{file_size / 1024:.1f} KB"
            else:
                item["file_size_formatted"] = f"{file_size} bytes"

        # Calculate processing duration
        started = item.get("processing_started_at")
        completed = item.get("processing_completed_at")
        if started and completed:
            from datetime import datetime
            try:
                start_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
                end_dt = datetime.fromisoformat(completed.replace("Z", "+00:00"))
                duration = (end_dt - start_dt).total_seconds()
                item["processing_duration_seconds"] = round(duration, 2)
            except Exception:
                pass

        submissions.append(item)

    # Calculate summary counts
    status_counts = {}
    total_plants_processed = 0
    total_plants_created = 0
    total_plants_updated = 0

    for item in submissions:
        status = item.get("status", "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
        total_plants_processed += item.get("plants_processed") or 0
        total_plants_created += item.get("plants_created") or 0
        total_plants_updated += item.get("plants_updated") or 0

    return {
        "success": True,
        "data": submissions,
        "meta": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
            "counts": {
                "by_status": status_counts,
                "total_plants_processed": total_plants_processed,
                "total_plants_created": total_plants_created,
                "total_plants_updated": total_plants_updated,
            },
        },
    }


@router.get("/submissions/weekly/{submission_id}")
async def get_weekly_submission(
    submission_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Get a single weekly report submission with full details.

    Args:
        submission_id: The submission ID.
        current_user: The authenticated admin user.

    Returns:
        Full submission details including plant records.
    """
    client = get_supabase_admin_client()

    # Get submission with location
    submission_result = (
        client.table("weekly_report_submissions")
        .select("*, locations(name)")
        .eq("id", str(submission_id))
        .single()
        .execute()
    )

    if not submission_result.data:
        raise NotFoundError("Weekly report submission", str(submission_id))

    submission = submission_result.data
    submission["location_name"] = submission.get("locations", {}).get("name") if submission.get("locations") else None
    submission.pop("locations", None)

    # Get plant weekly records for this submission
    records_result = (
        client.table("plant_weekly_records")
        .select("*, plants_master(fleet_number, fleet_type, description)")
        .eq("submission_id", str(submission_id))
        .order("plants_master(fleet_number)")
        .execute()
    )

    # Transform plant records
    plant_records = []
    for record in records_result.data:
        plant_info = record.pop("plants_master", {}) or {}
        plant_records.append({
            **record,
            "fleet_number": plant_info.get("fleet_number"),
            "fleet_type": plant_info.get("fleet_type"),
            "description": plant_info.get("description"),
        })

    # Generate file download URL if file exists
    file_url = None
    if submission.get("source_file_path"):
        try:
            # Create a signed URL valid for 1 hour
            signed_url = client.storage.from_("reports").create_signed_url(
                submission["source_file_path"],
                expires_in=3600,  # 1 hour
            )
            file_url = signed_url.get("signedURL")
        except Exception as e:
            logger.warning("Could not generate signed URL", error=str(e))

    # Calculate metadata
    file_size = submission.get("source_file_size", 0)
    if file_size >= 1024 * 1024:
        file_size_formatted = f"{file_size / (1024 * 1024):.2f} MB"
    elif file_size >= 1024:
        file_size_formatted = f"{file_size / 1024:.2f} KB"
    else:
        file_size_formatted = f"{file_size} bytes"

    # Calculate processing duration
    processing_duration = None
    if submission.get("processing_started_at") and submission.get("processing_completed_at"):
        from datetime import datetime
        try:
            started = datetime.fromisoformat(submission["processing_started_at"].replace("Z", "+00:00"))
            completed = datetime.fromisoformat(submission["processing_completed_at"].replace("Z", "+00:00"))
            duration_seconds = (completed - started).total_seconds()
            processing_duration = f"{duration_seconds:.2f}s"
        except Exception:
            pass

    # Determine file type for frontend viewing
    file_name = submission.get("source_file_name", "")
    file_extension = file_name.split(".")[-1].lower() if "." in file_name else ""
    file_type_map = {
        "xlsx": "excel",
        "xls": "excel",
        "pdf": "pdf",
        "png": "image",
        "jpg": "image",
        "jpeg": "image",
    }
    file_type = file_type_map.get(file_extension, "unknown")

    return {
        "success": True,
        "data": {
            "submission": submission,
            "plant_records": plant_records,
            "file_url": file_url,
        },
        "meta": {
            "total_records": len(plant_records),
            "file_size_formatted": file_size_formatted,
            "file_type": file_type,
            "file_extension": file_extension,
            "can_preview_in_browser": file_type in ("pdf", "image"),
            "processing_duration": processing_duration,
            "week_label": f"Week {submission.get('week_number', '?')}, {submission.get('year', '?')}",
        },
    }


@router.get("/submissions/weekly/{submission_id}/file")
async def download_weekly_submission_file(
    submission_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
):
    """Download the uploaded file for a weekly report submission.

    Args:
        submission_id: The submission ID.
        current_user: The authenticated admin user.

    Returns:
        Redirect to signed download URL.
    """
    from fastapi.responses import RedirectResponse

    client = get_supabase_admin_client()

    # Get submission to find file path
    submission_result = (
        client.table("weekly_report_submissions")
        .select("source_file_path, source_file_name")
        .eq("id", str(submission_id))
        .single()
        .execute()
    )

    if not submission_result.data:
        raise NotFoundError("Weekly report submission", str(submission_id))

    file_path = submission_result.data.get("source_file_path")
    if not file_path:
        raise NotFoundError("File for submission", str(submission_id))

    # Create signed URL for download
    try:
        signed_url = client.storage.from_("reports").create_signed_url(
            file_path,
            expires_in=300,  # 5 minutes
        )
        download_url = signed_url.get("signedURL")
        if not download_url:
            raise ValidationError("Could not generate download URL")

        return RedirectResponse(url=download_url)
    except Exception as e:
        logger.error("Failed to generate download URL", error=str(e))
        raise ValidationError(f"Could not download file: {str(e)}")


@router.post("/tokens/generate")
async def generate_upload_token(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    name: str = Form(...),
    location_id: UUID | None = Form(None),
    upload_types: list[str] = Form(["weekly_report", "purchase_order"]),
    expires_in_days: int | None = Form(None),
) -> dict[str, Any]:
    """Generate a new upload token for site officers.

    Args:
        request: The HTTP request.
        background_tasks: Background task runner.
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

    token_data = result.data[0]

    logger.info(
        "Upload token generated",
        token_name=name,
        location_id=str(location_id) if location_id else None,
        user_id=current_user.id,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="create",
        table_name="upload_tokens",
        record_id=token_data.get("id"),
        new_values={
            "name": name,
            "location_id": str(location_id) if location_id else None,
            "upload_types": upload_types,
            "expires_in_days": expires_in_days,
        },
        ip_address=get_client_ip(request),
        description=f"Generated upload token '{name}'",
    )

    return {
        "success": True,
        "data": token_data,
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
        item.pop("locations", None)
        # Don't expose the actual token in list view
        raw_token = item.get("token", "")
        item["token"] = (raw_token[:4] + "****") if raw_token and len(raw_token) >= 4 else "****"
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
        "application/pdf",
        "image/jpeg",
        "image/png",
        "application/octet-stream",  # Some browsers send this
    ]
    if file.content_type and file.content_type not in valid_content_types:
        logger.warning(
            "Unexpected content type",
            content_type=file.content_type,
            file_name=file.filename,
        )


# ============== Admin Upload Endpoints (JWT Auth) ==============


@router.post("/admin/weekly-report/preview")
async def preview_weekly_report(
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """Preview a weekly report before uploading.

    This endpoint extracts metadata and provides a preview of the data
    for validation before committing the upload.

    Args:
        current_user: The authenticated admin user.
        file: The Excel file to preview.

    Returns:
        Preview data including:
        - Extracted metadata (location, week ending date)
        - First 10 plant records
        - Total plant count
        - Any validation warnings
    """
    settings = get_settings()

    # Validate file type
    _validate_upload_file(file, settings)

    # Read file content
    file_content = await file.read()

    # Extract preview
    preview = extract_weekly_report_preview(file_content)

    # Get list of all locations for frontend dropdown
    client = get_supabase_admin_client()
    locations_result = client.table("locations").select("id, name").order("name").execute()

    return {
        "success": True,
        "file_name": file.filename,
        "file_size": len(file_content),
        "metadata": {
            "location_id": preview["metadata"].get("location_id"),
            "location_name": preview["metadata"].get("location_name"),
            "week_ending_date": str(preview["metadata"].get("week_ending_date")) if preview["metadata"].get("week_ending_date") else None,
            "extraction_warnings": preview["metadata"].get("extraction_warnings", []),
        },
        "data_preview": {
            "total_plants": preview["total_plants"],
            "columns_found": preview["columns_found"],
            "plants": preview["plants_preview"],
        },
        "validation_warnings": preview["validation_warnings"],
        "available_locations": [{"id": loc["id"], "name": loc["name"]} for loc in locations_result.data],
    }


@router.post("/admin/weekly-report", response_model=UploadResponse)
async def admin_upload_weekly_report(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    file: UploadFile = File(...),
    week_ending_date: date | None = Form(None),
    location_id: UUID | None = Form(None),
) -> UploadResponse:
    """Upload a weekly report as admin (JWT authentication).

    This endpoint is for admin users to upload reports directly
    without needing an upload token.

    If week_ending_date and location_id are not provided, they will be
    automatically extracted from the Excel file header.

    Args:
        request: The HTTP request.
        background_tasks: FastAPI background tasks.
        current_user: The authenticated admin user.
        file: The Excel file to upload.
        week_ending_date: Optional - auto-detected from file if not provided.
        location_id: Optional - auto-detected from file if not provided.

    Returns:
        Upload confirmation with job ID for status tracking.
    """
    settings = get_settings()
    client = get_supabase_admin_client()

    # Validate file
    _validate_upload_file(file, settings)

    # Read file content
    file_content = await file.read()
    file_size = len(file_content)

    # Auto-extract metadata if not provided
    final_location_id = location_id
    final_week_ending_date = week_ending_date
    location_name = None
    extraction_warnings = []

    if not location_id or not week_ending_date:
        # Extract metadata from file
        extracted = extract_and_resolve_metadata(file_content)
        extraction_warnings = extracted.get("extraction_warnings", [])

        if not location_id:
            if extracted["location_id"]:
                final_location_id = UUID(extracted["location_id"])
                location_name = extracted["location_name"]
            else:
                raise ValidationError(
                    "Could not auto-detect location from file. Please provide location_id.",
                    details=[
                        {"field": "location_id", "message": msg, "code": "EXTRACTION_FAILED"}
                        for msg in extraction_warnings if "location" in msg.lower()
                    ],
                )

        if not week_ending_date:
            if extracted["week_ending_date"]:
                final_week_ending_date = extracted["week_ending_date"]
            else:
                raise ValidationError(
                    "Could not auto-detect week ending date from file. Please provide week_ending_date.",
                    details=[
                        {"field": "week_ending_date", "message": msg, "code": "EXTRACTION_FAILED"}
                        for msg in extraction_warnings if "date" in msg.lower()
                    ],
                )

    # Get location name if not already set
    if not location_name:
        location_result = (
            client.table("locations")
            .select("name")
            .eq("id", str(final_location_id))
            .single()
            .execute()
        )
        location_name = location_result.data.get("name") if location_result.data else "Unknown"

    # Store file in Supabase Storage
    storage_path = f"weekly-reports/{final_location_id}/{final_week_ending_date}/{file.filename}"

    try:
        client.storage.from_("reports").upload(
            storage_path,
            file_content,
            {"content-type": file.content_type or "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
        )
    except Exception as e:
        if "already exists" in str(e).lower():
            client.storage.from_("reports").update(storage_path, file_content)
        else:
            raise

    # Calculate week number and year
    week_info = final_week_ending_date.isocalendar()
    year = week_info.year
    week_number = week_info.week

    # Create submission record
    submission_data = {
        "year": year,
        "week_number": week_number,
        "week_ending_date": str(final_week_ending_date),
        "location_id": str(final_location_id),
        "submitted_by_name": current_user.full_name,
        "submitted_by_email": current_user.email,
        "source_type": "upload",
        "source_file_path": storage_path,
        "source_file_name": file.filename,
        "source_file_size": file_size,
        "status": "pending",
    }

    result = (
        client.table("weekly_report_submissions")
        .upsert(submission_data, on_conflict="year,week_number,location_id")
        .execute()
    )

    job_id = result.data[0]["id"]

    # Build message with auto-detection info
    message = "File uploaded successfully. Processing started."
    if extraction_warnings:
        message += f" (Auto-detected: location={location_name}, week_ending={final_week_ending_date})"

    logger.info(
        "Weekly report uploaded by admin",
        job_id=job_id,
        file_name=file.filename,
        location_id=str(final_location_id),
        location_name=location_name,
        week_ending_date=str(final_week_ending_date),
        auto_detected=bool(not location_id or not week_ending_date),
        user_id=current_user.id,
    )

    # Queue background processing
    background_tasks.add_task(
        process_weekly_report,
        job_id=job_id,
        storage_path=storage_path,
        location_id=str(final_location_id),
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="upload",
        table_name="weekly_report_submissions",
        record_id=job_id,
        new_values={
            "file_name": file.filename,
            "file_size": file_size,
            "location_id": str(final_location_id),
            "week_ending_date": str(final_week_ending_date),
            "auto_detected": bool(not location_id or not week_ending_date),
        },
        ip_address=get_client_ip(request),
        description=f"Admin uploaded weekly report for {location_name} week ending {final_week_ending_date}",
    )

    return UploadResponse(
        success=True,
        job_id=job_id,
        status=UploadStatus.PENDING,
        message=message,
        file_name=file.filename,
        file_size=file_size,
        location=location_name,
        week_ending_date=final_week_ending_date,
    )


@router.post("/admin/purchase-order", response_model=UploadResponse)
async def admin_upload_purchase_order(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    file: UploadFile = File(...),
    location_id: UUID | None = Form(None),
    po_number: str | None = Form(None),
    po_date: date | None = Form(None),
) -> UploadResponse:
    """Upload a purchase order document as admin (JWT authentication).

    This endpoint is for admin users to upload PO documents directly.
    Supports Excel, PDF, and image files.

    Args:
        request: The HTTP request.
        background_tasks: FastAPI background tasks.
        current_user: The authenticated admin user.
        file: The document to upload.
        location_id: Optional location ID.
        po_number: Purchase order number.
        po_date: Purchase order date.

    Returns:
        Upload confirmation with job ID.
    """
    settings = get_settings()
    client = get_supabase_admin_client()

    # Validate file
    _validate_upload_file(file, settings)

    # Read file content
    file_content = await file.read()
    file_size = len(file_content)

    # Store file
    storage_path = f"purchase-orders/{location_id or 'general'}/{po_date or 'undated'}/{file.filename}"

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
        "location_id": str(location_id) if location_id else None,
        "submitted_by_name": current_user.full_name,
        "submitted_by_email": current_user.email,
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
        "Purchase order uploaded by admin",
        job_id=job_id,
        file_name=file.filename,
        po_number=po_number,
        user_id=current_user.id,
    )

    # Queue background processing
    background_tasks.add_task(
        process_purchase_order,
        job_id=job_id,
        storage_path=storage_path,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="upload",
        table_name="purchase_order_submissions",
        record_id=job_id,
        new_values={
            "file_name": file.filename,
            "file_size": file_size,
            "po_number": po_number,
            "po_date": str(po_date) if po_date else None,
        },
        ip_address=get_client_ip(request),
        description=f"Admin uploaded purchase order {po_number or file.filename}",
    )

    return UploadResponse(
        success=True,
        job_id=job_id,
        status=UploadStatus.PENDING,
        message="File uploaded successfully. Processing started.",
        file_name=file.filename,
        file_size=file_size,
    )
