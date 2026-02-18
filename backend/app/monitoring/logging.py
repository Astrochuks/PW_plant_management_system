"""Structured logging configuration.

Uses structlog for structured JSON logging with context binding.
Logs are sent to both stdout and database (if enabled).
"""

import logging
import sys
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any

import structlog

from app.config import get_settings

# Context variables for request-scoped data
request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)
user_id_ctx: ContextVar[str | None] = ContextVar("user_id", default=None)
user_email_ctx: ContextVar[str | None] = ContextVar("user_email", default=None)


def add_request_context(
    logger: structlog.types.WrappedLogger,
    method_name: str,
    event_dict: dict[str, Any],
) -> dict[str, Any]:
    """Add request context to log entries."""
    request_id = request_id_ctx.get()
    if request_id:
        event_dict["request_id"] = request_id

    user_id = user_id_ctx.get()
    if user_id:
        event_dict["user_id"] = user_id

    user_email = user_email_ctx.get()
    if user_email:
        event_dict["user_email"] = user_email

    return event_dict


def add_timestamp(
    logger: structlog.types.WrappedLogger,
    method_name: str,
    event_dict: dict[str, Any],
) -> dict[str, Any]:
    """Add ISO timestamp to log entries."""
    event_dict["timestamp"] = datetime.now(timezone.utc).isoformat()
    return event_dict


def add_service_info(
    logger: structlog.types.WrappedLogger,
    method_name: str,
    event_dict: dict[str, Any],
) -> dict[str, Any]:
    """Add service information to log entries."""
    settings = get_settings()
    event_dict["service"] = "plant-management-api"
    event_dict["environment"] = settings.environment
    return event_dict


def setup_logging() -> None:
    """Configure structured logging for the application."""
    settings = get_settings()

    # Configure standard library logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, settings.log_level.upper()),
    )

    # Suppress verbose logging from third-party libraries
    noisy_loggers = [
        "httpx",
        "httpcore",
        "hpack",
        "h2",
        "h11",
        "urllib3",
        "asyncio",
        "watchfiles",
        "supabase",
        "realtime",
        "websockets",
        "gotrue",
    ]
    for logger_name in noisy_loggers:
        logging.getLogger(logger_name).setLevel(logging.WARNING)

    # Define structlog processors
    processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        add_timestamp,
        add_service_info,
        add_request_context,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.UnicodeDecoder(),
    ]

    # Add exception formatting
    if settings.is_development:
        processors.append(structlog.dev.ConsoleRenderer(colors=True))
    else:
        processors.extend([
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ])

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Get a logger instance.

    Args:
        name: Optional logger name (usually __name__ of the module).

    Returns:
        Configured structlog logger.
    """
    return structlog.get_logger(name)


class DatabaseLogHandler:
    """Handler to write logs to the database."""

    def __init__(self):
        self._buffer: list[dict[str, Any]] = []
        self._buffer_size = 100
        self._last_flush = datetime.now(timezone.utc)

    async def write(self, log_entry: dict[str, Any]) -> None:
        """Buffer a log entry for database insertion.

        Args:
            log_entry: The structured log entry.
        """
        self._buffer.append({
            "timestamp": log_entry.get("timestamp"),
            "level": log_entry.get("level", "INFO"),
            "message": log_entry.get("event", ""),
            "logger_name": log_entry.get("logger"),
            "request_id": log_entry.get("request_id"),
            "user_id": log_entry.get("user_id"),
            "context": {
                k: v
                for k, v in log_entry.items()
                if k not in ("timestamp", "level", "event", "logger", "request_id", "user_id")
            },
        })

        # Flush if buffer is full or 60 seconds have passed
        if (
            len(self._buffer) >= self._buffer_size
            or (datetime.now(timezone.utc) - self._last_flush).seconds > 60
        ):
            await self.flush()

    async def flush(self) -> None:
        """Flush buffered logs to the database."""
        if not self._buffer:
            return

        from app.core.pool import executemany
        import json

        try:
            await executemany(
                """INSERT INTO monitoring.app_logs
                       (timestamp, level, message, logger_name, request_id, user_id, context)
                   VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)""",
                [
                    (
                        entry.get("timestamp"),
                        entry.get("level", "INFO"),
                        entry.get("message", ""),
                        entry.get("logger_name"),
                        entry.get("request_id"),
                        entry.get("user_id"),
                        json.dumps(entry.get("context", {})),
                    )
                    for entry in self._buffer
                ],
            )
            self._buffer = []
            self._last_flush = datetime.now(timezone.utc)
        except Exception as e:
            # Don't fail if logging to DB fails - just print to stderr
            print(f"Failed to flush logs to database: {e}", file=sys.stderr)


# Singleton log handler
_db_log_handler: DatabaseLogHandler | None = None


def get_db_log_handler() -> DatabaseLogHandler:
    """Get the database log handler singleton."""
    global _db_log_handler
    if _db_log_handler is None:
        _db_log_handler = DatabaseLogHandler()
    return _db_log_handler
