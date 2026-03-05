"""File upload endpoints for weekly reports and purchase orders."""

import json
from datetime import date, datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Query, Request, UploadFile

from app.api.v1.auth import get_client_ip
from app.config import get_settings
from app.core.database import get_supabase_admin_client  # Storage only
from app.core.exceptions import ValidationError, AuthenticationError, NotFoundError
from app.core.pool import fetch, fetchrow, fetchval, execute
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
from app.workers.etl_worker import process_weekly_report, process_purchase_order, save_confirmed_weekly_report, cleanup_submission_data
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

    # Create submission record (upsert in case a report for this week/location already exists)
    row = await fetchrow(
        """INSERT INTO weekly_report_submissions
               (year, week_number, week_ending_date, location_id,
                submitted_by_name, submitted_by_email, upload_token_id,
                source_type, source_file_path, source_file_name, source_file_size, status)
           VALUES ($1, $2, $3, $4::uuid, $5, $6, $7, 'upload', $8, $9, $10, 'pending')
           ON CONFLICT (year, week_number, location_id) DO UPDATE SET
               week_ending_date = EXCLUDED.week_ending_date,
               submitted_by_name = EXCLUDED.submitted_by_name,
               submitted_by_email = EXCLUDED.submitted_by_email,
               upload_token_id = EXCLUDED.upload_token_id,
               source_file_path = EXCLUDED.source_file_path,
               source_file_name = EXCLUDED.source_file_name,
               source_file_size = EXCLUDED.source_file_size,
               status = 'pending'
           RETURNING id""",
        year, week_number, week_ending_date, str(final_location_id),
        submitter_name, submitter_email, token_info.get("token_id"),
        storage_path, file.filename, file_size,
    )

    job_id = str(row["id"])

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
    row = await fetchrow(
        """INSERT INTO purchase_order_submissions
               (po_number, po_date, location_id,
                submitted_by_name, submitted_by_email, upload_token_id,
                source_type, source_file_path, source_file_name, source_file_size, status)
           VALUES ($1, $2, $3::uuid, $4, $5, $6, 'upload', $7, $8, $9, 'pending')
           RETURNING id""",
        po_number,
        str(po_date) if po_date else None,
        str(final_location_id) if final_location_id else None,
        submitter_name, submitter_email, token_info.get("token_id"),
        storage_path, file.filename, file_size,
    )

    job_id = str(row["id"])

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
    table = "weekly_report_submissions" if upload_type == "weekly_report" else "purchase_order_submissions"

    data = await fetchrow(
        f"SELECT * FROM {table} WHERE id = $1::uuid",
        str(job_id),
    )

    if not data:
        raise NotFoundError("Upload job", str(job_id))

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
    # Build dynamic WHERE clause
    conditions: list[str] = []
    params: list[Any] = []

    if year:
        params.append(year)
        conditions.append(f"wrs.year = ${len(params)}")
    if week_number:
        params.append(week_number)
        conditions.append(f"wrs.week_number = ${len(params)}")
    if location_id:
        params.append(str(location_id))
        conditions.append(f"wrs.location_id = ${len(params)}::uuid")
    if status:
        params.append(status)
        conditions.append(f"wrs.status = ${len(params)}")

    where = " AND ".join(conditions) if conditions else "TRUE"
    offset = (page - 1) * limit

    # Single query: data + count in one round-trip
    params.append(limit)
    params.append(offset)
    rows = await fetch(
        f"""SELECT wrs.*, l.name AS location_name, count(*) OVER() AS _total_count
            FROM weekly_report_submissions wrs
            LEFT JOIN locations l ON l.id = wrs.location_id
            WHERE {where}
            ORDER BY wrs.submitted_at DESC
            LIMIT ${len(params) - 1} OFFSET ${len(params)}""",
        *params,
    )

    total = rows[0].pop("_total_count", 0) if rows else 0
    for row in rows[1:]:
        row.pop("_total_count", None)

    # Transform data to include metadata
    submissions = []
    for item in rows:

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
    # Get submission with location name
    submission = await fetchrow(
        """SELECT wrs.*, l.name AS location_name
           FROM weekly_report_submissions wrs
           LEFT JOIN locations l ON l.id = wrs.location_id
           WHERE wrs.id = $1::uuid""",
        str(submission_id),
    )

    if not submission:
        raise NotFoundError("Weekly report submission", str(submission_id))

    # Get plant weekly records for this submission with plant details
    records = await fetch(
        """SELECT pwr.*, pm.fleet_number, pm.fleet_type, pm.description
           FROM plant_weekly_records pwr
           LEFT JOIN plants_master pm ON pm.id = pwr.plant_id
           WHERE pwr.submission_id = $1::uuid
           ORDER BY pm.fleet_number""",
        str(submission_id),
    )

    plant_records = list(records)

    # Generate file download URL if file exists
    file_url = None
    if submission.get("source_file_path"):
        try:
            storage_client = get_supabase_admin_client()
            signed_url = storage_client.storage.from_("reports").create_signed_url(
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
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
):
    """Download the file for a weekly report submission.

    For Excel-uploaded submissions: redirects to the original file in Storage.
    For form-submitted reports: generates and returns a styled Excel file.
    """
    from fastapi.responses import RedirectResponse

    row = await fetchrow(
        "SELECT * FROM weekly_report_submissions WHERE id = $1::uuid",
        str(submission_id),
    )

    if not row:
        raise NotFoundError("Weekly report submission", str(submission_id))

    file_path = row.get("source_file_path")

    if file_path:
        # Original Excel file — redirect to Supabase Storage signed URL
        try:
            storage_client = get_supabase_admin_client()
            signed_url = storage_client.storage.from_("reports").create_signed_url(
                file_path,
                expires_in=300,
            )
            download_url = signed_url.get("signedURL")
            if not download_url:
                raise ValidationError("Could not generate download URL")
            return RedirectResponse(url=download_url)
        except Exception as e:
            logger.error("Failed to generate download URL", error=str(e))
            raise ValidationError(f"Could not download file: {str(e)}")
    else:
        # Form-submitted report — generate styled Excel on the fly
        from app.api.v1.site_report import _build_submission_excel
        return await _build_submission_excel(dict(row))


@router.delete("/submissions/weekly/{submission_id}")
async def delete_weekly_submission(
    submission_id: UUID,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict:
    """Delete a weekly report submission and its plant records (admin only).

    Also attempts to remove the source file from Storage if present.
    Note: plant conditions already applied to plants_master are NOT reversed.
    """
    row = await fetchrow(
        "SELECT id, source_file_path, source_file_name FROM weekly_report_submissions WHERE id = $1::uuid",
        str(submission_id),
    )
    if not row:
        raise NotFoundError("Weekly report submission", str(submission_id))

    # Delete plant_weekly_records first (no CASCADE)
    deleted_records = await fetchval(
        "WITH d AS (DELETE FROM plant_weekly_records WHERE submission_id = $1::uuid RETURNING id) SELECT count(*) FROM d",
        str(submission_id),
    )

    # Delete the submission
    await execute(
        "DELETE FROM weekly_report_submissions WHERE id = $1::uuid",
        str(submission_id),
    )

    # Best-effort: remove source file from Storage
    file_path = row.get("source_file_path")
    if file_path:
        try:
            storage_client = get_supabase_admin_client()
            storage_client.storage.from_("reports").remove([file_path])
        except Exception as e:
            logger.warning("Could not delete submission file from Storage", path=file_path, error=str(e))

    logger.info(
        "Admin deleted weekly submission",
        submission_id=str(submission_id),
        deleted_records=deleted_records,
        admin_id=current_user.id,
    )

    return {
        "success": True,
        "message": f"Submission deleted ({deleted_records} plant records removed)",
    }


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
    token_data = await fetchrow(
        "SELECT * FROM generate_upload_token($1, $2, $3, $4, $5)",
        name,
        str(location_id) if location_id else None,
        upload_types,
        expires_in_days,
        current_user.id,
    )

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
    active_filter = " AND ut.is_active = true" if active_only else ""
    rows = await fetch(
        f"""SELECT ut.*, l.name AS location_name
            FROM upload_tokens ut
            LEFT JOIN locations l ON l.id = ut.location_id
            WHERE TRUE{active_filter}
            ORDER BY ut.created_at DESC""",
    )

    # Transform data
    tokens = []
    for item in rows:
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

    # Extract preview (now async)
    preview = await extract_weekly_report_preview(file_content)

    # Get list of all locations for frontend dropdown
    locations_rows = await fetch("SELECT id, name FROM locations ORDER BY name")

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
        "available_locations": [{"id": loc["id"], "name": loc["name"]} for loc in locations_rows],
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
        # Extract metadata from file (now async)
        extracted = await extract_and_resolve_metadata(file_content)
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
        loc_row = await fetchrow(
            "SELECT name FROM locations WHERE id = $1::uuid",
            str(final_location_id),
        )
        location_name = loc_row["name"] if loc_row else "Unknown"

    # Store file in Supabase Storage
    storage_client = get_supabase_admin_client()
    storage_path = f"weekly-reports/{final_location_id}/{final_week_ending_date}/{file.filename}"

    try:
        storage_client.storage.from_("reports").upload(
            storage_path,
            file_content,
            {"content-type": file.content_type or "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
        )
    except Exception as e:
        if "already exists" in str(e).lower():
            storage_client.storage.from_("reports").update(storage_path, file_content)
        else:
            raise

    # Calculate week number and year
    week_info = final_week_ending_date.isocalendar()
    year = week_info.year
    week_number = week_info.week

    # Create submission record (upsert)
    row = await fetchrow(
        """INSERT INTO weekly_report_submissions
               (year, week_number, week_ending_date, location_id,
                submitted_by_name, submitted_by_email,
                source_type, source_file_path, source_file_name, source_file_size, status)
           VALUES ($1, $2, $3, $4::uuid, $5, $6, 'upload', $7, $8, $9, 'pending')
           ON CONFLICT (year, week_number, location_id) DO UPDATE SET
               week_ending_date = EXCLUDED.week_ending_date,
               submitted_by_name = EXCLUDED.submitted_by_name,
               submitted_by_email = EXCLUDED.submitted_by_email,
               source_file_path = EXCLUDED.source_file_path,
               source_file_name = EXCLUDED.source_file_name,
               source_file_size = EXCLUDED.source_file_size,
               status = 'pending'
           RETURNING id""",
        year, week_number, final_week_ending_date, str(final_location_id),
        current_user.full_name, current_user.email,
        storage_path, file.filename, file_size,
    )

    job_id = str(row["id"])

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

    # Validate file
    _validate_upload_file(file, settings)

    # Read file content
    file_content = await file.read()
    file_size = len(file_content)

    # Store file (Storage SDK)
    storage_client = get_supabase_admin_client()
    storage_path = f"purchase-orders/{location_id or 'general'}/{po_date or 'undated'}/{file.filename}"

    try:
        storage_client.storage.from_("reports").upload(storage_path, file_content)
    except Exception as e:
        if "already exists" in str(e).lower():
            storage_client.storage.from_("reports").update(storage_path, file_content)
        else:
            raise

    # Create submission record
    row = await fetchrow(
        """INSERT INTO purchase_order_submissions
               (po_number, po_date, location_id,
                submitted_by_name, submitted_by_email,
                source_type, source_file_path, source_file_name, source_file_size, status)
           VALUES ($1, $2, $3::uuid, $4, $5, 'upload', $6, $7, $8, 'pending')
           RETURNING id""",
        po_number,
        str(po_date) if po_date else None,
        str(location_id) if location_id else None,
        current_user.full_name, current_user.email,
        storage_path, file.filename, file_size,
    )

    job_id = str(row["id"])

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


@router.post("/admin/preview-weekly-report")
async def preview_weekly_report(
    request: Request,
    file: UploadFile = File(...),
    location_id: UUID = Form(...),
    week_ending_date: date = Form(...),
    current_user: CurrentUser = Depends(require_admin),
) -> dict[str, Any]:
    """Preview a weekly report before saving.

    Loads all plants, detects conditions using keywords, detects transfers,
    identifies missing/new plants. Returns data for admin validation.
    Does NOT save to database - that happens in confirm endpoint.

    Args:
        request: FastAPI request.
        file: The Excel file to preview.
        location_id: Location UUID.
        week_ending_date: Week ending date.
        current_user: Authenticated admin user.

    Returns:
        Preview data with auto-detected conditions and transfers.
    """
    import io
    import pandas as pd
    from app.services.preview_service import (
        detect_condition_from_keywords,
        detect_transfers_from_remarks,
        match_location_to_id,
        parse_hours,
        parse_off_hire,
    )
    from app.workers.etl_worker import (
        normalize_fleet_number,
        derive_physical_verification,
        find_header_row,
        WEEKLY_COLUMN_MAP,
        map_columns,
    )

    settings = get_settings()

    # Validate file
    _validate_upload_file(file, settings)

    # Read file content
    file_content = await file.read()

    # Calculate week info
    week_info = week_ending_date.isocalendar()
    year = week_info.year
    week_number = week_info.week

    logger.info(
        "Previewing weekly report",
        location_id=str(location_id),
        week=week_number,
        year=year,
        user_id=current_user.id,
    )

    # Parse Excel file
    df_raw = pd.read_excel(io.BytesIO(file_content), sheet_name=0, header=None)

    # Auto-detect header row
    header_row = find_header_row(file_content)
    logger.info("Detected header row", header_row=header_row)
    df = pd.read_excel(io.BytesIO(file_content), sheet_name=0, header=header_row)
    df = map_columns(df, WEEKLY_COLUMN_MAP)

    if "fleet_number" not in df.columns:
        raise ValidationError("No fleet_number column found in file")

    # Get all locations for dropdown
    available_locations = await fetch("SELECT id, name FROM locations")

    # Get location aliases for transfer matching
    alias_rows = await fetch(
        """SELECT la.alias, la.location_id, l.name AS location_name
           FROM location_aliases la
           LEFT JOIN locations l ON l.id = la.location_id""",
    )
    location_aliases = {}
    for alias_row in alias_rows:
        if alias_row.get("location_name"):
            location_aliases[alias_row["alias"]] = alias_row["location_name"]

    # Get current location name
    current_location = next((loc for loc in available_locations if loc["id"] == str(location_id)), None)
    current_location_name = current_location["name"] if current_location else "Unknown"

    # Get most recent week's data at this location to detect missing/new plants
    # (not just week N-1, to handle gaps in uploads)
    prev_week_rows = await fetch(
        """SELECT pwr.plant_id, pwr.year, pwr.week_number, pm.fleet_number
           FROM plant_weekly_records pwr
           LEFT JOIN plants_master pm ON pm.id = pwr.plant_id
           WHERE pwr.location_id = $1::uuid
           ORDER BY pwr.year DESC, pwr.week_number DESC
           LIMIT 1000""",
        str(location_id),
    )

    # Find the most recent week that is before the current upload
    last_known_week = None
    last_known_year = None
    prev_week_fleet_numbers = set()

    for record in prev_week_rows:
        rec_year = record.get("year", 0)
        rec_week = record.get("week_number", 0)

        # Skip records from current or future weeks
        if (rec_year, rec_week) >= (year, week_number):
            continue

        # First record we find is the most recent previous week (results are ordered desc)
        if last_known_week is None:
            last_known_year = rec_year
            last_known_week = rec_week

        # Only include records from that same week
        if (rec_year, rec_week) == (last_known_year, last_known_week):
            if record.get("fleet_number"):
                prev_week_fleet_numbers.add(record["fleet_number"])
        else:
            break  # We've passed the most recent week, stop

    logger.info(
        "Previous week data for new/missing detection",
        last_known_year=last_known_year,
        last_known_week=last_known_week,
        prev_fleet_count=len(prev_week_fleet_numbers),
    )

    # Pre-load existing plant data for previous location lookup
    # Collect all fleet numbers first, then batch query
    all_fleet_numbers_in_file = set()
    for idx, row in df.iterrows():
        fn = normalize_fleet_number(row.get("fleet_number"))
        if fn:
            all_fleet_numbers_in_file.add(fn)

    # Batch lookup existing plants with their current locations (single query with ANY)
    existing_plants_map = {}  # fleet_number -> {current_location_id, current_location_name}
    if all_fleet_numbers_in_file:
        existing_rows = await fetch(
            "SELECT fleet_number, current_location_id FROM plants_master WHERE fleet_number = ANY($1::text[])",
            list(all_fleet_numbers_in_file),
        )
        for p in existing_rows:
            loc_id = p.get("current_location_id")
            loc_name = None
            if loc_id:
                loc = next((l for l in available_locations if str(l["id"]) == str(loc_id)), None)
                loc_name = loc["name"] if loc else None
            existing_plants_map[p["fleet_number"]] = {
                "current_location_id": str(loc_id) if loc_id else None,
                "current_location_name": loc_name,
            }

    # Process each row in file
    preview_plants = []
    current_week_fleet_numbers = set()

    for idx, row in df.iterrows():
        fleet_num = normalize_fleet_number(row.get("fleet_number"))
        if not fleet_num:
            continue

        current_week_fleet_numbers.add(fleet_num)

        # Extract all data
        physical_verification = derive_physical_verification(
            row.get("physical_verification"),
            row.get("remarks"),
        )

        hours_worked = parse_hours(row.get("hours_worked"))
        standby_hours = parse_hours(row.get("standby_hours"))
        breakdown_hours = parse_hours(row.get("breakdown_hours"))
        off_hire = parse_off_hire(row.get("off_hire"))

        remarks = None
        if pd.notna(row.get("remarks")):
            remarks = str(row.get("remarks")).strip() or None

        description = None
        if pd.notna(row.get("description")):
            description = str(row.get("description")).strip() or None

        # Read dedicated transfer columns
        transfer_from_raw = None
        if pd.notna(row.get("transfer_from")):
            transfer_from_raw = str(row.get("transfer_from")).strip() or None

        transfer_to_raw = None
        if pd.notna(row.get("transfer_to")):
            transfer_to_raw = str(row.get("transfer_to")).strip() or None

        # Auto-detect condition using keywords
        detected_condition = detect_condition_from_keywords(
            remarks=remarks,
            hours_worked=hours_worked,
            standby_hours=standby_hours,
            breakdown_hours=breakdown_hours,
            off_hire=off_hire,
            physical_verification=physical_verification,
        )

        # Auto-detect transfers from remarks
        detected_transfer = detect_transfers_from_remarks(remarks)

        # Override with dedicated column values if present (they take priority)
        if transfer_from_raw and not detected_transfer.transfer_from:
            detected_transfer.transfer_from = transfer_from_raw.upper()

        if transfer_to_raw and not detected_transfer.transfer_to:
            detected_transfer.transfer_to = transfer_to_raw.upper()

        # Match transfer locations to IDs
        transfer_from_id = None
        transfer_from_name = None
        if detected_transfer.transfer_from:
            transfer_from_id, transfer_from_name = match_location_to_id(
                detected_transfer.transfer_from,
                available_locations,
                location_aliases,
            )

        transfer_to_id = None
        transfer_to_name = None
        if detected_transfer.transfer_to:
            transfer_to_id, transfer_to_name = match_location_to_id(
                detected_transfer.transfer_to,
                available_locations,
                location_aliases,
            )

        # Check if new plant (not in previous week at this location)
        is_new = fleet_num not in prev_week_fleet_numbers

        # Look up previous location for new plants
        previous_location_id = None
        previous_location_name = None
        if is_new and fleet_num in existing_plants_map:
            prev_loc = existing_plants_map[fleet_num]
            # Only show previous location if it's different from current upload location
            if prev_loc["current_location_id"] and prev_loc["current_location_id"] != str(location_id):
                previous_location_id = prev_loc["current_location_id"]
                previous_location_name = prev_loc["current_location_name"]

        plant_preview = {
            "fleet_number": fleet_num,
            "description": description,
            "remarks": remarks,
            "hours_worked": hours_worked,
            "standby_hours": standby_hours,
            "breakdown_hours": breakdown_hours,
            "off_hire": off_hire,
            "physical_verification": physical_verification,

            # Auto-detected (editable by admin)
            "detected_condition": detected_condition.condition,
            "condition_confidence": detected_condition.confidence,
            "condition_reason": detected_condition.reason,

            # Auto-detected transfers (editable by admin)
            "detected_transfer_from_id": transfer_from_id,
            "detected_transfer_from_name": transfer_from_name,
            "detected_transfer_to_id": transfer_to_id,
            "detected_transfer_to_name": transfer_to_name,

            # Raw transfer column values (for display)
            "transfer_from_raw": transfer_from_raw,
            "transfer_to_raw": transfer_to_raw,

            # Status flags
            "is_new": is_new,
            "was_in_previous_week": not is_new,
            "previous_location_id": previous_location_id,
            "previous_location_name": previous_location_name,
        }

        preview_plants.append(plant_preview)

    # Find missing plants (in prev week but not in current)
    missing_fleet_numbers = prev_week_fleet_numbers - current_week_fleet_numbers
    missing_plants = []

    if missing_fleet_numbers:
        # Batch lookup missing plant details (no N+1)
        missing_plant_rows = await fetch(
            "SELECT id, fleet_number, description, condition FROM plants_master WHERE fleet_number = ANY($1::text[])",
            list(missing_fleet_numbers),
        )
        for p in missing_plant_rows:
            missing_plants.append({
                "fleet_number": p["fleet_number"],
                "description": p.get("description"),
                "last_seen_week": last_known_week,
                "last_seen_year": last_known_year,
                "last_location_id": str(location_id),
                "last_location_name": current_location_name,
                "last_condition": p.get("condition"),
            })

    # Calculate summary stats
    condition_counts = {}
    confidence_counts = {"high": 0, "medium": 0, "low": 0}

    for plant in preview_plants:
        condition = plant["detected_condition"]
        condition_counts[condition] = condition_counts.get(condition, 0) + 1

        confidence = plant["condition_confidence"]
        confidence_counts[confidence] = confidence_counts.get(confidence, 0) + 1

    logger.info(
        "Preview generated",
        total_plants=len(preview_plants),
        missing_plants=len(missing_plants),
        new_plants=len([p for p in preview_plants if p["is_new"]]),
        low_confidence=confidence_counts["low"],
        user_id=current_user.id,
    )

    return {
        "success": True,
        "preview_id": f"{location_id}_{year}_{week_number}",  # For reference in confirm
        "location": {
            "id": str(location_id),
            "name": current_location_name,
        },
        "week": {
            "year": year,
            "week_number": week_number,
            "week_ending_date": str(week_ending_date),
        },
        "available_locations": available_locations,
        "condition_options": [
            "working",
            "standby",
            "under_repair",
            "breakdown",
            "faulty",
            "off_hire",
            "scrap",
            "missing",
            "gpm_assessment",
            "unverified",
        ],
        "plants": preview_plants,
        "missing_plants": missing_plants,
        "summary": {
            "total_in_file": len(preview_plants),
            "missing_from_previous": len(missing_plants),
            "new_this_week": len([p for p in preview_plants if p["is_new"]]),
            "high_confidence": confidence_counts["high"],
            "medium_confidence": confidence_counts["medium"],
            "low_confidence": confidence_counts["low"],
            "condition_breakdown": condition_counts,
        },
    }


@router.post("/admin/confirm-weekly-report")
async def confirm_weekly_report(
    request: Request,
    background_tasks: BackgroundTasks,
    location_id: UUID = Form(...),
    year: int = Form(...),
    week_number: int = Form(...),
    week_ending_date: date = Form(...),
    plants_json: str = Form(...),  # JSON string of validated plants
    missing_plants_json: str | None = Form(None),  # JSON string of missing plant actions
    file: UploadFile | None = File(None),  # Original Excel file for storage
    current_user: CurrentUser = Depends(require_admin),
) -> dict[str, Any]:
    """Confirm and save validated weekly report data.

    After admin validates/corrects the preview data, this endpoint
    saves everything to the database.

    Args:
        request: FastAPI request.
        background_tasks: FastAPI background tasks.
        location_id: Location UUID.
        year: Year.
        week_number: Week number.
        week_ending_date: Week ending date.
        plants_json: JSON string of validated plants data.
        missing_plants_json: JSON string of missing plants actions (optional).
        file: Original Excel file to store (optional).
        current_user: Authenticated admin user.

    Returns:
        Success response with created/updated counts.
    """
    # Parse JSON data
    try:
        validated_plants = json.loads(plants_json)
        missing_plants_actions = json.loads(missing_plants_json) if missing_plants_json else None
    except json.JSONDecodeError as e:
        raise ValidationError(f"Invalid JSON data: {str(e)}")

    if not validated_plants:
        raise ValidationError("No plants data provided")

    # Upload file to storage if provided
    source_file_path = None
    source_file_name = None
    source_file_size = None
    if file and file.filename:
        file_content = await file.read()
        source_file_name = file.filename
        source_file_size = len(file_content)
        storage_path = f"weekly-reports/{location_id}/{week_ending_date}/{file.filename}"
        try:
            storage_client = get_supabase_admin_client()
            storage_client.storage.from_("reports").upload(
                storage_path,
                file_content,
                file_options={"upsert": "true"},
            )
            source_file_path = storage_path
        except Exception as e:
            logger.warning("Failed to upload file to storage", error=repr(e))

    logger.info(
        "Confirming weekly report",
        location_id=str(location_id),
        week=week_number,
        year=year,
        total_plants=len(validated_plants),
        user_id=current_user.id,
    )

    # Check for existing submission
    existing_rows = await fetch(
        """SELECT id, status FROM weekly_report_submissions
           WHERE year = $1 AND week_number = $2 AND location_id = $3::uuid""",
        year, week_number, str(location_id),
    )

    if existing_rows:
        submission_id = str(existing_rows[0]["id"])
        # Clean up existing data for reprocessing (already migrated to asyncpg)
        await cleanup_submission_data(submission_id)
        # Update submission metadata for the re-upload
        await execute(
            """UPDATE weekly_report_submissions SET
                   submitted_by_name = $2, submitted_by_email = $3,
                   submitted_at = now(), status = 'pending',
                   week_ending_date = $4,
                   source_file_path = COALESCE($5, source_file_path),
                   source_file_name = COALESCE($6, source_file_name),
                   source_file_size = COALESCE($7, source_file_size),
                   plants_processed = 0, plants_created = 0, plants_updated = 0
               WHERE id = $1::uuid""",
            submission_id, current_user.full_name, current_user.email,
            week_ending_date, source_file_path, source_file_name, source_file_size,
        )
        logger.info("Reprocessing existing submission", submission_id=submission_id)
    else:
        # Create new submission
        row = await fetchrow(
            """INSERT INTO weekly_report_submissions
                   (year, week_number, week_ending_date, location_id,
                    submitted_by_name, submitted_by_email, source_type, status,
                    source_file_path, source_file_name, source_file_size)
               VALUES ($1, $2, $3, $4::uuid, $5, $6, 'admin_validated', 'pending',
                    $7, $8, $9)
               RETURNING id""",
            year, week_number, week_ending_date, str(location_id),
            current_user.full_name, current_user.email,
            source_file_path, source_file_name, source_file_size,
        )

        submission_id = str(row["id"])
        logger.info("Created new submission", submission_id=submission_id)

    # Save confirmed data (runs in background)
    background_tasks.add_task(
        save_confirmed_weekly_report,
        submission_id=submission_id,
        location_id=str(location_id),
        year=year,
        week_number=week_number,
        week_ending_date=week_ending_date,
        validated_plants=validated_plants,
        missing_plants_actions=missing_plants_actions,
    )

    # Log audit
    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="confirm_upload",
        table_name="weekly_report_submissions",
        record_id=submission_id,
        new_values={
            "location_id": str(location_id),
            "week_ending_date": str(week_ending_date),
            "total_plants": len(validated_plants),
            "source": "admin_validated",
        },
        ip_address=get_client_ip(request),
        description=f"Admin confirmed weekly report for week {week_number}/{year}",
    )

    return {
        "success": True,
        "submission_id": submission_id,
        "message": f"Processing {len(validated_plants)} plants for week {week_number}/{year}",
        "plants_count": len(validated_plants),
    }
