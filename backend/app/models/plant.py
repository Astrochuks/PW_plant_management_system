"""Plant-related Pydantic models."""

from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class PlantBase(BaseModel):
    """Base plant model with common fields."""

    fleet_number: str = Field(..., min_length=1, max_length=50)
    description: str | None = Field(None, max_length=255)
    fleet_type: str | None = Field(None, max_length=100)
    make: str | None = Field(None, max_length=100)
    model: str | None = Field(None, max_length=100)
    chassis_number: str | None = Field(None, max_length=100)
    year_of_manufacture: int | None = Field(None, ge=1900, le=2100)
    manufacture_month: int | None = Field(None, ge=1, le=12, description="Month of manufacture (1-12)")
    manufacture_day: int | None = Field(None, ge=1, le=31, description="Day of manufacture (1-31)")
    purchase_year: int | None = Field(None, ge=1900, le=2100, description="Year the plant was purchased")
    purchase_month: int | None = Field(None, ge=1, le=12, description="Month the plant was purchased (1-12)")
    purchase_day: int | None = Field(None, ge=1, le=31, description="Day the plant was purchased (1-31)")
    purchase_cost: float | None = Field(None, ge=0)
    purchase_currency: str | None = Field("NGN", max_length=3, pattern="^(NGN|USD|EUR|GBP)$", description="Currency for purchase cost")
    capacity: str | None = Field(None, max_length=100, description="Capacity/rating of the plant (e.g., 10 tons, 500 litres)")
    engine_number: str | None = Field(None, max_length=100)
    serial_m: str | None = Field(None, max_length=100)
    serial_e: str | None = Field(None, max_length=100)
    remarks: str | None = None
    purchase_site: str | None = Field(None, max_length=255, description="Site/location where the plant was purchased")
    components: list[dict[str, str]] | None = Field(None, description="List of components, each with 'name' and optional 'model'")
    division: str | None = Field(None, max_length=20, pattern="^(mining|civil)$", description="Division: mining or civil (NULL = civil)")
    current_location_id: UUID | None = None

    @field_validator("fleet_number")
    @classmethod
    def normalize_fleet_number(cls, v: str) -> str:
        """Normalize fleet number to uppercase without extra spaces."""
        return " ".join(v.upper().split())


class PlantCreate(PlantBase):
    """Model for creating a new plant."""

    pass


class PlantUpdate(BaseModel):
    """Model for updating an existing plant."""

    description: str | None = None
    fleet_type: str | None = None
    make: str | None = None
    model: str | None = None
    chassis_number: str | None = None
    year_of_manufacture: int | None = None
    manufacture_month: int | None = Field(None, ge=1, le=12)
    manufacture_day: int | None = Field(None, ge=1, le=31)
    purchase_year: int | None = Field(None, ge=1900, le=2100, description="Year the plant was purchased")
    purchase_month: int | None = Field(None, ge=1, le=12, description="Month the plant was purchased (1-12)")
    purchase_day: int | None = Field(None, ge=1, le=31, description="Day the plant was purchased (1-31)")
    purchase_cost: float | None = None
    purchase_currency: str | None = Field(None, pattern="^(NGN|USD|EUR|GBP)$")
    capacity: str | None = None
    engine_number: str | None = None
    serial_m: str | None = None
    serial_e: str | None = None
    remarks: str | None = None
    purchase_site: str | None = None
    components: list[dict[str, str]] | None = None
    current_location_id: UUID | None = None
    division: str | None = Field(None, pattern="^(mining|civil)$", description="Division: mining or civil")
    condition: str | None = Field(
        None,
        pattern="^(working|standby|breakdown|scrap|missing|off_hire)$",
        description="Unified condition field for the plant",
    )
    physical_verification: bool | None = None


class Plant(PlantBase):
    """Full plant model with all fields."""

    id: UUID
    division: str | None = None
    condition: str  # Unified condition field
    physical_verification: bool
    created_at: datetime
    updated_at: datetime

    # Joined fields
    current_location: str | None = None
    state_id: UUID | None = None
    state: str | None = None
    state_code: str | None = None

    # Pending transfer info
    pending_transfer_id: UUID | None = None
    pending_transfer_to_location: str | None = None

    class Config:
        from_attributes = True


class PlantSummary(BaseModel):
    """Plant summary with maintenance stats from v_plants_summary view."""

    id: UUID
    fleet_number: str
    description: str | None = None
    fleet_type: str | None = None
    make: str | None = None
    model: str | None = None
    chassis_number: str | None = None
    year_of_manufacture: int | None = None
    manufacture_month: int | None = None
    manufacture_day: int | None = None
    purchase_year: int | None = None
    purchase_month: int | None = None
    purchase_day: int | None = None
    purchase_cost: float | None = None
    purchase_currency: str | None = "NGN"
    capacity: str | None = None
    engine_number: str | None = None
    serial_m: str | None = None
    serial_e: str | None = None
    purchase_site: str | None = None
    components: list[dict[str, str]] | None = None
    division: str | None = None
    condition: str | None = None  # Unified condition field
    physical_verification: bool | None = None
    current_location_id: UUID | None = None
    current_location: str | None = None
    state_id: UUID | None = None
    state: str | None = None
    state_code: str | None = None
    last_verified_date: date | None = None
    last_verified_year: int | None = None
    last_verified_week: int | None = None
    remarks: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    total_maintenance_cost: float = 0
    parts_replaced_count: int = 0
    last_maintenance_date: date | None = None
    shared_po_count: int = 0
    # Pending transfer info
    pending_transfer_to_id: UUID | None = None
    pending_transfer_to_location: str | None = None

    class Config:
        from_attributes = True


class PlantListResponse(BaseModel):
    """Response for plant list endpoint."""

    success: bool = True
    data: list[PlantSummary]
    meta: dict[str, Any]


class PlantTransferRequest(BaseModel):
    """Request to transfer a plant to a new location."""

    new_location_id: UUID
    transfer_reason: str | None = None


class PlantTransferResponse(BaseModel):
    """Response from plant transfer operation."""

    success: bool
    plant_id: UUID
    fleet_number: str
    from_location: str | None
    to_location: str
    transferred_at: datetime
