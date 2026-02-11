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
    purchase_cost: float | None = Field(None, ge=0)
    serial_m: str | None = Field(None, max_length=100)
    serial_e: str | None = Field(None, max_length=100)
    remarks: str | None = None
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
    purchase_cost: float | None = None
    serial_m: str | None = None
    serial_e: str | None = None
    remarks: str | None = None
    current_location_id: UUID | None = None
    status: str | None = Field(
        None,
        pattern="^(working|standby|breakdown|faulty|scrap|missing|stolen|unverified|in_transit|off_hire)$",
    )
    physical_verification: bool | None = None


class Plant(PlantBase):
    """Full plant model with all fields."""

    id: UUID
    status: str
    physical_verification: bool
    created_at: datetime
    updated_at: datetime

    # Joined fields
    current_location: str | None = None
    state_id: UUID | None = None
    state: str | None = None
    state_code: str | None = None

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
    status: str | None = None
    physical_verification: bool | None = None
    current_location: str | None = None
    current_location_id: UUID | None = None
    state_id: UUID | None = None
    state: str | None = None
    state_code: str | None = None
    total_maintenance_cost: float = 0
    parts_replaced_count: int = 0
    last_maintenance_date: date | None = None

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
