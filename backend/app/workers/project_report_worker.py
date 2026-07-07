"""Background worker for project weekly-report submissions (T2.15).

Flow: submission row (queued) → download from Storage → manifest check →
parse all 16 sheets → identity guard → persist in ONE transaction →
submission success/partial with per-sheet accounting. Any failure rolls
everything back and lands on the submission as a real error message —
never a silent 500.
"""

import io
import time
from typing import Any

import openpyxl

from app.core.database import get_supabase_admin_client  # Storage only
from app.core.pool import fetchrow, get_pool
from app.monitoring.logging import get_logger
from app.services.weekly_report_import import persist_weekly_report
from app.services.weekly_report_sheets import parse_workbook

logger = get_logger(__name__)


async def _set_status(submission_id: str, **fields: Any) -> None:
    sets = ", ".join(f"{k} = ${i + 2}" for i, k in enumerate(fields))
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            f"UPDATE project_report_submissions SET {sets}, updated_at = now() "
            f"WHERE id = $1::uuid",
            submission_id, *fields.values(),
        )


async def process_project_weekly_report(submission_id: str) -> None:
    """Entry point for BackgroundTasks. Owns all its error handling."""
    import json

    started = time.monotonic()
    try:
        sub = await fetchrow(
            """SELECT s.*, p.short_name, p.project_name
               FROM project_report_submissions s
               JOIN projects p ON p.id = s.project_id
               WHERE s.id = $1::uuid""",
            submission_id,
        )
        if sub is None:
            logger.error("Submission not found", submission_id=submission_id)
            return

        await _set_status(submission_id, status="parsing")

        # ── download ─────────────────────────────────────────────────────
        client = get_supabase_admin_client()
        file_bytes = client.storage.from_("reports").download(sub["file_path"])
        if not file_bytes:
            raise RuntimeError(f"Storage returned empty file for {sub['file_path']}")

        # ── parse ────────────────────────────────────────────────────────
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        parsed = parse_workbook(wb)

        warnings: list[str] = []

        # Identity guard: is this file really for the selected project?
        identity = parsed.get("identity") or {}
        wb_short = (identity.get("short_name") or "").strip().upper()
        sel_short = (sub["short_name"] or "").strip().upper()
        if wb_short and sel_short and wb_short != sel_short:
            warnings.append(
                f"IDENTITY MISMATCH: workbook says {wb_short!r} but you selected "
                f"{sel_short!r} — verify you uploaded the right file"
            )

        # ── persist (single transaction inside) ─────────────────────────
        pool = get_pool()
        async with pool.acquire() as conn:
            stats = await persist_weekly_report(
                conn,
                str(sub["project_id"]),
                sub["year"],
                sub["week_number"],
                parsed,
                str(sub["uploaded_by"]) if sub["uploaded_by"] else None,
            )
        warnings.extend(stats["warnings"])

        sheet_status = {
            name: s["status"] for name, s in parsed["sheets"].items()
        }
        failed_sheets = [n for n, st in sheet_status.items() if st == "failed"]
        missing = parsed["drift"]["missing"]
        status = "partial" if (failed_sheets or missing or
                               any("IDENTITY MISMATCH" in w for w in warnings)) \
            else "success"

        await _set_status(
            submission_id,
            status=status,
            week_ending_date=stats["week_ending_date"],
            weekly_report_id=stats["weekly_report_id"],
            sheets_processed=json.dumps(sheet_status),
            row_counts=json.dumps({
                **stats["row_counts"],
                "_fleet_resolved": stats["fleet_resolved"],
                "_fleet_unresolved": stats["fleet_unresolved"],
                "_warnings": warnings[:50],
            }),
            parse_duration_ms=int((time.monotonic() - started) * 1000),
            error_message=None,
        )
        logger.info(
            "Project weekly report processed",
            submission_id=submission_id, status=status,
            duration_ms=int((time.monotonic() - started) * 1000),
            warnings=len(warnings),
        )

    except Exception as exc:
        logger.error(
            "Project weekly report processing failed",
            submission_id=submission_id,
            error=f"{type(exc).__name__}: {exc}",
        )
        try:
            await _set_status(
                submission_id,
                status="failed",
                error_message=f"{type(exc).__name__}: {str(exc)[:800]}",
                parse_duration_ms=int((time.monotonic() - started) * 1000),
            )
        except Exception:
            logger.error("Could not even mark submission failed",
                         submission_id=submission_id)
