"""Project management endpoints.

CRUD operations for the projects registry + Award Letters Excel import.
All mutations are admin-only. All reads are available to any authenticated user.
"""

from datetime import date
from typing import Annotated, Any
from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
)

from app.api.v1.auth import get_client_ip
from app.core.exceptions import NotFoundError, ValidationError
from app.core.pool import fetch, fetchrow, fetchval, execute, get_pool
from app.core.security import (
    CurrentUser,
    get_current_user,
    require_admin,
)
from app.models.project import ProjectCreate, ProjectUpdate
from app.monitoring.logging import get_logger
from app.services.audit_service import audit_service

router = APIRouter()
logger = get_logger(__name__)

_ALLOWED_SORT_COLUMNS = {
    "project_name",
    "client",
    "state_name",
    "status",
    "original_contract_sum",
    "current_contract_sum",
    "award_date",
    "created_at",
    "updated_at",
}

# Fields that require ::uuid cast in parameterized queries
_UUID_FIELDS = {"state_id", "created_by", "updated_by", "import_batch_id"}


# ============================================================================
# Non-parametric routes (must come before /{project_id})
# ============================================================================


@router.get("/stats")
async def get_project_stats(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    """Dashboard summary: counts by status, total contract value, top clients."""
    stats_row = await fetchrow(
        """SELECT
               count(*)::int AS total,
               count(*) FILTER (WHERE status = 'active')::int AS active,
               count(*) FILTER (WHERE status = 'completed')::int AS completed,
               count(*) FILTER (WHERE status = 'on_hold')::int AS on_hold,
               count(*) FILTER (WHERE status = 'retention_period')::int AS retention_period,
               count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
               count(*) FILTER (WHERE is_legacy)::int AS legacy,
               count(*) FILTER (WHERE NOT is_legacy)::int AS non_legacy,
               COALESCE(SUM(current_contract_sum), 0)::float AS total_contract_value,
               count(DISTINCT client)::int AS total_clients
           FROM projects"""
    )

    top_clients = await fetch(
        """SELECT client,
                  count(*)::int AS project_count,
                  COALESCE(SUM(current_contract_sum), 0)::float AS total_value
           FROM projects
           GROUP BY client
           ORDER BY project_count DESC
           LIMIT 10"""
    )

    return {
        "success": True,
        "data": {
            "totals": stats_row,
            "top_clients": top_clients,
        },
    }


@router.get("/clients")
async def list_clients(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    """List distinct client names for filter dropdowns."""
    rows = await fetch(
        "SELECT DISTINCT client FROM projects ORDER BY client"
    )
    return {
        "success": True,
        "data": [r["client"] for r in rows],
    }


@router.post("/import/award-letters")
async def import_award_letters(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """Import projects from an Award Letters Excel workbook.

    Parses all sheets (each sheet = one client/state).
    Batch-inserts all parsed projects in a single transaction.
    """
    from app.services.award_letters_parser import parse_award_letters_excel

    if not file.filename:
        raise ValidationError("File name is required")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ("xlsx", "xls"):
        raise ValidationError("Only .xlsx and .xls files are accepted")

    file_content = await file.read()
    if len(file_content) > 10 * 1024 * 1024:
        raise ValidationError("File too large (max 10MB)")

    parsed = parse_award_letters_excel(file_content)

    if not parsed["projects"]:
        return {
            "success": False,
            "error": "No projects found in the uploaded file",
            "data": {
                "errors": parsed["errors"][:20],
                "warnings": parsed["warnings"][:20],
            },
        }

    # Resolve state_id from sheet names
    states = await fetch(
        "SELECT id, name, UPPER(TRIM(name)) AS name_upper FROM states"
    )
    state_map = {s["name_upper"]: s["id"] for s in states}

    # Enrich projects with state_id and user refs
    for proj in parsed["projects"]:
        sheet_upper = (proj.get("source_sheet") or "").upper().strip()
        state_id = state_map.get(sheet_upper)
        if state_id:
            proj["state_id"] = str(state_id)
        proj["created_by"] = current_user.id
        proj["updated_by"] = current_user.id
        proj["is_legacy"] = True

    # Batch insert using executemany — single round-trip per batch
    pool = get_pool()
    created_count = 0
    insert_errors: list[dict[str, Any]] = []

    # Collect all unique columns across all projects
    all_cols: set[str] = set()
    for proj in parsed["projects"]:
        all_cols.update(proj.keys())
    col_list = sorted(all_cols)

    # Build a single parameterized INSERT template
    placeholders = []
    for i, col in enumerate(col_list):
        if col in _UUID_FIELDS:
            placeholders.append(f"${i + 1}::uuid")
        elif col == "has_award_letter":
            placeholders.append(f"${i + 1}::boolean")
        else:
            placeholders.append(f"${i + 1}")

    sql = (
        f"INSERT INTO projects ({', '.join(col_list)}) "
        f"VALUES ({', '.join(placeholders)})"
    )

    async with pool.acquire() as conn:
        async with conn.transaction():
            # executemany sends all rows in a single protocol-level batch
            args_list = []
            for proj in parsed["projects"]:
                args_list.append(
                    [proj.get(col) for col in col_list]
                )

            try:
                await conn.executemany(sql, args_list)
                created_count = len(args_list)
            except Exception as e:
                # If batch fails, fall back to row-by-row to identify bad rows
                created_count = 0
                for proj_args, proj in zip(args_list, parsed["projects"]):
                    try:
                        await conn.execute(sql, *proj_args)
                        created_count += 1
                    except Exception as row_err:
                        insert_errors.append({
                            "project_name": proj.get("project_name"),
                            "sheet": proj.get("source_sheet"),
                            "error": str(row_err),
                        })

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="import",
        table_name="projects",
        record_id=parsed["import_batch_id"],
        new_values={
            "file_name": file.filename,
            "sheets_processed": parsed["sheets_processed"],
            "total_parsed": len(parsed["projects"]),
            "created": created_count,
            "errors": len(insert_errors),
        },
        ip_address=get_client_ip(request),
        description=f"Imported {created_count} projects from Award Letters Excel",
    )

    return {
        "success": True,
        "data": {
            "import_batch_id": parsed["import_batch_id"],
            "sheets_processed": parsed["sheets_processed"],
            "total_parsed": len(parsed["projects"]),
            "created": created_count,
            "errors": insert_errors[:20],
            "warnings": parsed["warnings"][:20],
            "parse_errors": parsed["errors"][:20],
        },
    }


@router.get("/linkable")
async def list_linkable_projects(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    """List non-legacy projects that don't yet have a linked location."""
    rows = await fetch(
        """SELECT p.id, p.project_name, p.client, p.status
           FROM projects p
           WHERE NOT p.is_legacy
             AND NOT EXISTS (
                 SELECT 1 FROM locations l WHERE l.project_id = p.id
             )
           ORDER BY p.project_name"""
    )
    return {"success": True, "data": rows}


# ============================================================================
# Standard CRUD
# ============================================================================


@router.get("")
async def list_projects(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str | None = None,
    client: str | None = Query(None),
    state_id: UUID | None = None,
    status: str | None = Query(
        None, pattern=r"^(active|completed|on_hold|cancelled|retention_period)$"
    ),
    is_legacy: bool | None = Query(None, description="Filter by legacy status"),
    sort_by: str = Query("created_at"),
    sort_order: str = Query("desc", pattern=r"^(asc|desc)$"),
) -> dict[str, Any]:
    """List projects with filtering, search, and pagination.

    Single query with count(*) OVER() for pagination — no N+1.
    """
    conds: list[str] = []
    params: list[Any] = []

    if search:
        params.append(f"%{search}%")
        n = len(params)
        conds.append(
            f"(v.project_name ILIKE ${n} OR v.client ILIKE ${n} "
            f"OR v.short_name ILIKE ${n})"
        )
    if client:
        params.append(client.upper())
        conds.append(f"v.client = ${len(params)}")
    if state_id:
        params.append(str(state_id))
        conds.append(f"v.state_id = ${len(params)}::uuid")
    if status:
        params.append(status)
        conds.append(f"v.status = ${len(params)}")
    if is_legacy is not None:
        params.append(is_legacy)
        conds.append(f"v.is_legacy = ${len(params)}::boolean")

    where = " AND ".join(conds) if conds else "TRUE"
    safe_sort = sort_by if sort_by in _ALLOWED_SORT_COLUMNS else "created_at"
    safe_order = "DESC" if sort_order == "desc" else "ASC"

    offset = (page - 1) * limit
    params.append(limit)
    params.append(offset)

    rows = await fetch(
        f"""SELECT v.*, count(*) OVER() AS _total_count
            FROM v_projects_summary v
            WHERE {where}
            ORDER BY v.{safe_sort} {safe_order} NULLS LAST
            LIMIT ${len(params) - 1} OFFSET ${len(params)}""",
        *params,
    )

    total = rows[0].pop("_total_count", 0) if rows else 0
    for r in rows[1:]:
        r.pop("_total_count", None)

    return {
        "success": True,
        "data": rows,
        "meta": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
            "has_more": page * limit < total,
        },
    }


@router.get("/{project_id}")
async def get_project(
    project_id: UUID,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    """Get a single project by ID."""
    row = await fetchrow(
        """SELECT v.*
           FROM v_projects_summary v
           WHERE v.id = $1::uuid""",
        str(project_id),
    )
    if not row:
        raise NotFoundError("Project", str(project_id))
    return {"success": True, "data": row}


@router.get("/{project_id}/milestones")
async def get_project_milestones(
    project_id: UUID,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, Any]:
    """Get project milestone timeline data."""
    row = await fetchrow(
        "SELECT * FROM projects WHERE id = $1::uuid", str(project_id)
    )
    if not row:
        raise NotFoundError("Project", str(project_id))

    today = date.today()
    milestone_defs = [
        ("award_date", "Award Date"),
        ("commencement_date", "Commencement"),
        ("original_completion_date", "Original Completion"),
        ("revised_completion_date", "Revised Completion"),
        ("substantial_completion_date", "Substantial Completion"),
        ("final_completion_date", "Final Completion"),
        ("maintenance_cert_date", "Maintenance Certificate"),
        ("retention_application_date", "Retention Application"),
    ]

    milestones = []
    for field, label in milestone_defs:
        val = row.get(field)
        if val is None:
            milestones.append({"key": field, "label": label, "date": None, "status": "not_set"})
        else:
            status = "completed" if val <= today else "upcoming"
            milestones.append({
                "key": field, "label": label,
                "date": val.isoformat(), "status": status,
            })

    orig = row.get("original_duration_months")
    ext = row.get("extension_of_time_months")
    duration = {
        "original_months": orig,
        "extension_months": ext,
        "total_months": (orig or 0) + (ext or 0) if orig else None,
    }

    return {"success": True, "data": {"milestones": milestones, "duration": duration}}


@router.post("", status_code=201)
async def create_project(
    project: ProjectCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Create a new project (admin only)."""
    data = project.model_dump(exclude_none=True, mode="json")
    data["created_by"] = current_user.id
    data["updated_by"] = current_user.id

    cols = list(data.keys())
    vals = list(data.values())
    placeholders = []
    for i, col in enumerate(cols):
        if col in _UUID_FIELDS:
            placeholders.append(f"${i + 1}::uuid")
        else:
            placeholders.append(f"${i + 1}")

    created = await fetchrow(
        f"INSERT INTO projects ({', '.join(cols)}) "
        f"VALUES ({', '.join(placeholders)}) RETURNING *",
        *vals,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="create",
        table_name="projects",
        record_id=str(created["id"]),
        new_values=data,
        ip_address=get_client_ip(request),
        description=f"Created project: {project.project_name}",
    )

    return {"success": True, "data": created}


@router.patch("/{project_id}")
async def update_project(
    project_id: UUID,
    project: ProjectUpdate,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Update an existing project (admin only)."""
    update_data = project.model_dump(exclude_none=True, mode="json")
    if not update_data:
        raise ValidationError("No fields to update")

    existing = await fetchrow(
        "SELECT * FROM projects WHERE id = $1::uuid", str(project_id)
    )
    if not existing:
        raise NotFoundError("Project", str(project_id))

    old_values = {k: existing.get(k) for k in update_data if k in existing}
    update_data["updated_by"] = current_user.id

    set_parts: list[str] = []
    params: list[Any] = []
    for key, val in update_data.items():
        params.append(val)
        if key in _UUID_FIELDS:
            set_parts.append(f"{key} = ${len(params)}::uuid")
        else:
            set_parts.append(f"{key} = ${len(params)}")

    params.append(str(project_id))
    updated = await fetchrow(
        f"""UPDATE projects SET {', '.join(set_parts)}
            WHERE id = ${len(params)}::uuid RETURNING *""",
        *params,
    )

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="update",
        table_name="projects",
        record_id=str(project_id),
        old_values=old_values,
        new_values=update_data,
        ip_address=get_client_ip(request),
        description=f"Updated project: {existing.get('project_name')}",
    )

    return {"success": True, "data": updated}


@router.delete("/{project_id}")
async def delete_project(
    project_id: UUID,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: Annotated[CurrentUser, Depends(require_admin)],
) -> dict[str, Any]:
    """Delete a project (admin only)."""
    existing = await fetchrow(
        "SELECT id, project_name FROM projects WHERE id = $1::uuid",
        str(project_id),
    )
    if not existing:
        raise NotFoundError("Project", str(project_id))

    await execute("DELETE FROM projects WHERE id = $1::uuid", str(project_id))

    background_tasks.add_task(
        audit_service.log,
        user_id=current_user.id,
        user_email=current_user.email,
        action="delete",
        table_name="projects",
        record_id=str(project_id),
        old_values=existing,
        ip_address=get_client_ip(request),
        description=f"Deleted project: {existing.get('project_name')}",
    )

    return {"success": True, "message": "Project deleted successfully"}
