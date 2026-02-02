"""Plant-related Pydantic models."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class PlantBase(BaseModel):
    """Base plant model with common fields."""

    fleet_number: str = Field(..., min_length=1, max_length=50)
    description: str | None = Field(None, max_length=255)
    fleet_type_id: UUID | None = None
    make: str | None = Field(None, max_length=100)
    model: str | None = Field(None, max_length=100)
    chassis_number: str | None = Field(None, max_length=100)
    year_of_manufacture: int | None = Field(None, ge=1900, le=2100)
    purchase_cost: float | None = Field(None, ge=0)
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
    fleet_type_id: UUID | None = None
    make: str | None = None
    model: str | None = None
    chassis_number: str | None = None
    year_of_manufacture: int | None = None
    purchase_cost: float | None = None
    remarks: str | None = None
    current_location_id: UUID | None = None
    status: str | None = Field(None, pattern="^(active|archived|disposed)$")
    physical_verification: bool | None = None


class Plant(PlantBase):
    """Full plant model with all fields."""

    id: UUID
    status: str
    physical_verification: bool
    created_at: datetime
    updated_at: datetime

    # Joined fields
    fleet_type: str | None = None
    current_location: str | None = None

    class Config:
        from_attributes = True


class PlantSummary(BaseModel):
    """Plant summary with maintenance stats."""

    id: UUID
    fleet_number: str
    description: str | None
    fleet_type: str | None
    make: str | None
    model: str | None
    status: str
    physical_verification: bool
    current_location: str | None
    total_maintenance_cost: float
    parts_replaced_count: int
    last_maintenance_date: datetime | None

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
