"""Pydantic request/response schemas for API validation and serialization."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import ApplicationStatus, FrnStatus


# --- FRN schemas ---


class FrnBase(BaseModel):
    frn_number: str = Field(..., max_length=32)
    service_type: str = Field(..., max_length=128)
    status: FrnStatus = FrnStatus.PENDING
    requested_amount: float | None = None
    approved_amount: float | None = None


class FrnCreate(FrnBase):
    pass


class FrnUpdate(BaseModel):
    """Partial update — only provided fields are changed."""

    frn_number: str | None = None
    service_type: str | None = None
    status: FrnStatus | None = None
    requested_amount: float | None = None
    approved_amount: float | None = None


class FrnRead(FrnBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    application_id: int


# --- Status history ---


class StatusHistoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    from_status: ApplicationStatus | None
    to_status: ApplicationStatus
    note: str | None
    changed_at: datetime


# --- Application schemas ---


class ApplicationBase(BaseModel):
    application_number: str = Field(..., max_length=32)
    ben: str = Field(..., max_length=16)
    organization_name: str = Field(..., max_length=255)
    funding_year: int = Field(..., ge=1997, le=2030)
    status: ApplicationStatus = ApplicationStatus.DRAFT
    discount_rate: float | None = Field(None, ge=0, le=90)
    total_requested: float | None = Field(None, ge=0)
    contact_name: str | None = None
    contact_email: EmailStr | None = None
    notes: str | None = None
    certified_date: date | None = None
    usac_file_url: str | None = None
    entity_type: str | None = None


class ApplicationCreate(ApplicationBase):
    frns: list[FrnCreate] = []


class ApplicationUpdate(BaseModel):
    """Partial update; status_note is recorded in status_history when status changes."""

    application_number: str | None = None
    ben: str | None = None
    organization_name: str | None = None
    funding_year: int | None = Field(None, ge=1997, le=2030)
    status: ApplicationStatus | None = None
    discount_rate: float | None = Field(None, ge=0, le=90)
    total_requested: float | None = Field(None, ge=0)
    contact_name: str | None = None
    contact_email: EmailStr | None = None
    notes: str | None = None
    certified_date: date | None = None
    status_note: str | None = None


class ApplicationRead(ApplicationBase):
    """Full application detail including nested FRNs and history."""

    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime
    frns: list[FrnRead] = []
    status_history: list[StatusHistoryRead] = []


class ApplicationSummary(BaseModel):
    """Lightweight row for list views (no nested relations)."""

    model_config = ConfigDict(from_attributes=True)
    id: int
    application_number: str
    ben: str
    organization_name: str
    funding_year: int
    status: ApplicationStatus
    discount_rate: float | None
    total_requested: float | None
    certified_date: date | None
    usac_file_url: str | None = None
    updated_at: datetime
    frn_count: int = 0


class DashboardStats(BaseModel):
    """Aggregated metrics for the dashboard page."""

    total_applications: int
    by_status: dict[str, int]
    total_requested: float
    total_funded: float
    funding_years: list[int]