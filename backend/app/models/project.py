"""Project-related Pydantic models."""

from datetime import date
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class ProjectCreate(BaseModel):
    """Model for creating a new project."""

    project_name: str = Field(..., min_length=1, max_length=500)
    short_name: str | None = Field(None, max_length=100)
    client: str = Field(..., min_length=1, max_length=255)
    state_id: UUID | None = None

    original_contract_sum: float | None = Field(None, ge=0)
    variation_sum: float | None = Field(None, ge=0)
    current_contract_sum: float | None = Field(None, ge=0)
    contract_sum_raw: str | None = None

    has_award_letter: bool = False
    award_date: date | None = None
    award_date_raw: str | None = None
    commencement_date: date | None = None
    commencement_date_raw: str | None = None

    original_duration_months: int | None = Field(None, ge=0)
    original_completion_date: date | None = None
    extension_of_time_months: int | None = Field(None, ge=0)
    revised_completion_date: date | None = None

    substantial_completion_cert: str | None = Field(None, max_length=50)
    substantial_completion_date: date | None = None
    substantial_completion_date_raw: str | None = None
    final_completion_cert: str | None = Field(None, max_length=50)
    final_completion_date: date | None = None
    final_completion_date_raw: str | None = None
    maintenance_cert: str | None = Field(None, max_length=50)
    maintenance_cert_date: date | None = None
    maintenance_cert_date_raw: str | None = None

    retention_application_date: date | None = None
    retention_application_date_raw: str | None = None
    retention_paid: str | None = Field(None, max_length=10)
    retention_amount_paid: float | None = Field(None, ge=0)

    works_vetted_certified: float | None = Field(None, ge=0)
    payment_received: float | None = Field(None, ge=0)
    outstanding_payment: float | None = None
    cost_to_date: float | None = Field(None, ge=0)
    revenue_to_date: float | None = Field(None, ge=0)

    status: str = Field(
        "active",
        pattern=r"^(active|completed|on_hold|cancelled|retention_period)$",
    )
    is_legacy: bool = False
    notes: str | None = None

    @field_validator("client")
    @classmethod
    def normalize_client(cls, v: str) -> str:
        return v.strip().upper()


class ProjectUpdate(BaseModel):
    """Model for updating a project. All fields optional."""

    project_name: str | None = Field(None, min_length=1, max_length=500)
    short_name: str | None = Field(None, max_length=100)
    client: str | None = Field(None, min_length=1, max_length=255)
    state_id: UUID | None = None

    original_contract_sum: float | None = None
    variation_sum: float | None = None
    current_contract_sum: float | None = None
    contract_sum_raw: str | None = None

    has_award_letter: bool | None = None
    award_date: date | None = None
    commencement_date: date | None = None

    original_duration_months: int | None = None
    original_completion_date: date | None = None
    extension_of_time_months: int | None = None
    revised_completion_date: date | None = None

    substantial_completion_cert: str | None = None
    substantial_completion_date: date | None = None
    final_completion_cert: str | None = None
    final_completion_date: date | None = None
    maintenance_cert: str | None = None
    maintenance_cert_date: date | None = None

    retention_application_date: date | None = None
    retention_paid: str | None = None
    retention_amount_paid: float | None = None

    works_vetted_certified: float | None = None
    payment_received: float | None = None
    outstanding_payment: float | None = None
    cost_to_date: float | None = None
    revenue_to_date: float | None = None

    status: str | None = Field(
        None,
        pattern=r"^(active|completed|on_hold|cancelled|retention_period)$",
    )
    is_legacy: bool | None = None
    notes: str | None = None

    @field_validator("client")
    @classmethod
    def normalize_client(cls, v: str | None) -> str | None:
        if v is not None:
            return v.strip().upper()
        return v
