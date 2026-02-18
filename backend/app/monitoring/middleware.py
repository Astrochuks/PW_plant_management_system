"""Request monitoring middleware.

Logs all requests and collects metrics for observability.
"""

import random
import time
import uuid
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings
from app.monitoring.logging import (
    get_logger,
    request_id_ctx,
    user_id_ctx,
    user_email_ctx,
)
from app.monitoring.metrics import get_metrics_collector

logger = get_logger(__name__)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware for logging requests and collecting metrics."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request with logging and metrics."""
        settings = get_settings()

        # Generate unique request ID
        request_id = str(uuid.uuid4())[:8]
        request_id_ctx.set(request_id)

        # Add request ID to response headers
        request.state.request_id = request_id

        # Start timing
        start_time = time.perf_counter()

        # Extract basic request info
        method = request.method
        path = request.url.path
        client_ip = request.client.host if request.client else "unknown"

        # Determine if we should log this request (sampling)
        should_log = random.random() < settings.log_sample_rate

        # Skip detailed logging for health checks
        is_health_check = path in ("/health", "/api/v1/health", "/")

        if should_log and not is_health_check:
            logger.info(
                "Request started",
                method=method,
                path=path,
                client_ip=client_ip,
                query_params=str(request.query_params) if request.query_params else None,
            )

        # Process request
        try:
            response = await call_next(request)
            status_code = response.status_code
            error = None
        except Exception as e:
            status_code = 500
            error = str(e)
            raise
        finally:
            # Calculate duration
            duration_ms = (time.perf_counter() - start_time) * 1000

            # Get user context if available
            user_id = getattr(request.state, "user_id", None)
            user_email = getattr(request.state, "user_email", None)

            if user_id:
                user_id_ctx.set(user_id)
            if user_email:
                user_email_ctx.set(user_email)

            # Collect metrics
            metrics = get_metrics_collector()

            # Request counter
            metrics.increment(
                "http_requests_total",
                labels={
                    "method": method,
                    "path": self._normalize_path(path),
                    "status": str(status_code),
                },
            )

            # Request duration histogram
            metrics.observe(
                "http_request_duration_ms",
                duration_ms,
                labels={
                    "method": method,
                    "path": self._normalize_path(path),
                },
            )

            # Log completion
            if should_log and not is_health_check:
                log_method = logger.error if status_code >= 500 else logger.info
                log_method(
                    "Request completed",
                    method=method,
                    path=path,
                    status_code=status_code,
                    duration_ms=round(duration_ms, 2),
                    user_id=user_id,
                    error=error,
                )

            # Clear context vars
            request_id_ctx.set(None)
            user_id_ctx.set(None)
            user_email_ctx.set(None)

        # Add request ID to response headers
        response.headers["X-Request-ID"] = request_id

        return response

    def _normalize_path(self, path: str) -> str:
        """Normalize path for metrics (replace IDs with placeholders).

        This prevents high-cardinality metrics from paths with UUIDs.
        """
        import re

        # Replace UUIDs with placeholder
        path = re.sub(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            "{id}",
            path,
            flags=re.IGNORECASE,
        )

        # Replace numeric IDs with placeholder
        path = re.sub(r"/\d+(?=/|$)", "/{id}", path)

        return path


class AlertingMiddleware(BaseHTTPMiddleware):
    """Middleware for detecting issues and creating alerts."""

    def __init__(self, app, error_threshold: int = 10, window_seconds: int = 60):
        super().__init__(app)
        self.error_threshold = error_threshold
        self.window_seconds = window_seconds
        self._error_timestamps: list[float] = []

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request and check for alert conditions."""
        try:
            response = await call_next(request)

            if response.status_code >= 500:
                await self._record_error()

            return response
        except Exception:
            await self._record_error()
            raise

    async def _record_error(self) -> None:
        """Record an error and check if alert threshold is exceeded."""
        current_time = time.time()
        self._error_timestamps.append(current_time)

        # Remove old timestamps outside the window
        cutoff = current_time - self.window_seconds
        self._error_timestamps = [t for t in self._error_timestamps if t > cutoff]

        # Check if threshold exceeded
        if len(self._error_timestamps) >= self.error_threshold:
            await self._create_alert()

    async def _create_alert(self) -> None:
        """Create an alert in the dashboard."""
        from app.core.pool import fetch, fetchval

        try:
            # Check if similar alert already exists (within last hour)
            existing = await fetch(
                """SELECT id FROM notifications
                   WHERE type = 'error' AND title = 'Error Rate Spike Detected'
                   AND created_at >= now() - interval '1 hour'""",
            )

            if existing:
                return  # Alert already exists

            # Get admin users to notify
            admins = await fetch(
                "SELECT id FROM users WHERE role = 'admin' AND is_active = true",
            )

            # Create notification for each admin
            message = f"More than {self.error_threshold} errors in the last {self.window_seconds} seconds"
            for admin in admins:
                await fetchval(
                    "SELECT create_notification($1, $2, $3, $4, $5, $6)",
                    admin["id"],
                    "error",
                    "Error Rate Spike Detected",
                    message,
                    "/dashboard/monitoring",
                    "View Details",
                )

            logger.warning(
                "Alert created: Error rate spike",
                error_count=len(self._error_timestamps),
                window_seconds=self.window_seconds,
            )

        except Exception as e:
            logger.error("Failed to create alert", error=str(e))
