"""Application configuration management.

Uses pydantic-settings for type-safe configuration with environment variable support.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Environment
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = False

    # API Settings
    api_title: str = "Plant Management API"
    api_version: str = "1.0.0"
    api_prefix: str = "/api/v1"

    # Supabase Configuration
    supabase_url: str = Field(..., description="Supabase project URL")
    supabase_anon_key: str = Field(..., description="Supabase anonymous/public key")
    supabase_service_role_key: str = Field(..., description="Supabase service role key")

    # CORS Settings
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:8000"]

    # Security
    trust_proxy: bool = False  # Only enable behind a known reverse proxy (nginx, cloudflare)
    supabase_jwt_secret: str | None = None  # From Supabase dashboard > Settings > API > JWT Secret
    user_cache_ttl_seconds: int = 300  # How long to cache user data (5 min default)

    # Rate Limiting
    rate_limit_requests: int = 100  # requests per minute
    rate_limit_upload: int = 10  # uploads per minute

    # File Upload Settings
    max_upload_size_mb: int = 10
    allowed_upload_extensions: list[str] = [".xlsx", ".xls", ".pdf", ".jpg", ".jpeg", ".png"]

    # Logging
    log_level: str = "INFO"
    log_to_database: bool = True
    log_sample_rate: float = 1.0  # 1.0 = log all requests, 0.1 = log 10%

    # Background Jobs
    job_max_retries: int = 3
    job_retry_delay_seconds: int = 5

    # Metrics
    metrics_enabled: bool = True
    metrics_flush_interval_seconds: int = 60

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: str | list[str]) -> list[str]:
        """Parse CORS origins from comma-separated string or list."""
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",")]
        return v

    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.environment == "production"

    @property
    def is_development(self) -> bool:
        """Check if running in development environment."""
        return self.environment == "development"

    @property
    def max_upload_size_bytes(self) -> int:
        """Get max upload size in bytes."""
        return self.max_upload_size_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance.

    Uses lru_cache to ensure settings are only loaded once.
    """
    return Settings()
