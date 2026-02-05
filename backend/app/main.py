"""FastAPI application entry point.

This module initializes the FastAPI application with all middleware,
routes, and event handlers.
"""

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.openapi.utils import get_openapi

from app.config import get_settings
from app.core.exceptions import AppException
from app.monitoring.logging import setup_logging, get_logger
from app.monitoring.metrics import get_metrics_collector, start_metrics_flush_task
from app.monitoring.middleware import RequestLoggingMiddleware, AlertingMiddleware
from app.api.v1.router import api_router

# Initialize logging
setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan handler for startup and shutdown events."""
    settings = get_settings()

    # Startup
    logger.info(
        "Application starting",
        environment=settings.environment,
        debug=settings.debug,
    )

    # Start background tasks
    metrics_task = asyncio.create_task(start_metrics_flush_task())

    yield

    # Shutdown
    logger.info("Application shutting down")

    # Cancel background tasks
    metrics_task.cancel()
    try:
        await metrics_task
    except asyncio.CancelledError:
        pass

    # Flush remaining metrics
    await get_metrics_collector().flush()

    logger.info("Application shutdown complete")


def create_application() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title=settings.api_title,
        version=settings.api_version,
        description="Plant Management System API - Manage plants, spare parts, and reports",
        docs_url="/docs" if settings.is_development else None,
        redoc_url="/redoc" if settings.is_development else None,
        openapi_url="/openapi.json" if settings.is_development else None,
        lifespan=lifespan,
    )

    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept"],
    )

    # Add custom middleware (order matters - first added is outermost)
    app.add_middleware(AlertingMiddleware, error_threshold=10, window_seconds=60)
    app.add_middleware(RequestLoggingMiddleware)

    # Include API routes
    app.include_router(api_router, prefix=settings.api_prefix)

    # Exception handlers
    @app.exception_handler(AppException)
    async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
        """Handle application-specific exceptions."""
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "success": False,
                "error": {
                    **exc.to_dict(),
                    "request_id": getattr(request.state, "request_id", None),
                },
            },
        )

    @app.exception_handler(Exception)
    async def general_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        """Handle unexpected exceptions."""
        logger.exception(
            "Unhandled exception",
            error=str(exc),
            path=request.url.path,
        )

        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "An unexpected error occurred",
                    "request_id": getattr(request.state, "request_id", None),
                },
            },
        )

    # Health check endpoint at root
    @app.get("/", include_in_schema=False)
    async def root():
        """Root endpoint - redirects to health check."""
        return {"status": "ok", "service": "plant-management-api"}

    # Custom OpenAPI schema with Bearer token security
    def custom_openapi():
        if app.openapi_schema:
            return app.openapi_schema

        openapi_schema = get_openapi(
            title=settings.api_title,
            version=settings.api_version,
            description="Plant Management System API - Manage plants, spare parts, and reports",
            routes=app.routes,
        )

        # Add security scheme for Bearer token
        openapi_schema["components"]["securitySchemes"] = {
            "BearerAuth": {
                "type": "http",
                "scheme": "bearer",
                "bearerFormat": "JWT",
                "description": "Enter the access_token from /auth/login response",
            }
        }

        # Apply security to all endpoints except login, health, and public uploads
        public_paths = [
            "/api/v1/auth/login",
            "/api/v1/auth/refresh",
            "/api/v1/health",
            "/api/v1/health/ready",
            "/api/v1/health/live",
            "/api/v1/health/detailed",
            "/api/v1/uploads/weekly-report",
            "/api/v1/uploads/purchase-order",
            "/api/v1/uploads/status/{job_id}",
        ]

        for path, path_item in openapi_schema["paths"].items():
            if path not in public_paths:
                for method in path_item.values():
                    if isinstance(method, dict):
                        method["security"] = [{"BearerAuth": []}]

        app.openapi_schema = openapi_schema
        return app.openapi_schema

    app.openapi = custom_openapi

    return app


# Create application instance
app = create_application()


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.is_development,
        log_level=settings.log_level.lower(),
    )
