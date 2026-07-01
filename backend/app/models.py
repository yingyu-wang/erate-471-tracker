"""SQLAlchemy ORM models for Form 471 applications, FRNs, and status history."""

import enum
from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ApplicationStatus(str, enum.Enum):
    """FCC Form 471 lifecycle states tracked by the application."""

    DRAFT = "draft"
    CERTIFIED = "certified"
    UNDER_REVIEW = "under_review"
    FCDL_APPROVED = "fcdl_approved"
    FCDL_DENIED = "fcdl_denied"
    CANCELLED = "cancelled"
    APPEALING = "appealing"


class FrnStatus(str, enum.Enum):
    """Funding Request Number (FRN) decision states."""

    PENDING = "pending"
    FUNDED = "funded"
    DENIED = "denied"
    CANCELLED = "cancelled"
    PARTIAL = "partial"


class Application(Base):
    """A single FCC Form 471 filing."""

    __tablename__ = "tracker_applications"
    __table_args__ = (UniqueConstraint("application_number", "funding_year", name="uq_tracker_app_number_year"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    application_number: Mapped[str] = mapped_column(String(32), index=True)
    ben: Mapped[str] = mapped_column(String(16), index=True)
    organization_name: Mapped[str] = mapped_column(String(255))
    entity_type: Mapped[str | None] = mapped_column(String(128))
    funding_year: Mapped[int] = mapped_column(index=True)
    status: Mapped[ApplicationStatus] = mapped_column(
        Enum(ApplicationStatus), default=ApplicationStatus.DRAFT, index=True
    )
    discount_rate: Mapped[float | None] = mapped_column(Numeric(5, 2))
    total_requested: Mapped[float | None] = mapped_column(Numeric(14, 2))
    contact_name: Mapped[str | None] = mapped_column(String(128))
    contact_email: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    certified_date: Mapped[date | None] = mapped_column(Date)
    usac_file_url: Mapped[str | None] = mapped_column(String(512))  # PDF link from USAC file_url field
    usac_source_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    frns: Mapped[list["Frn"]] = relationship(back_populates="application", cascade="all, delete-orphan")
    status_history: Mapped[list["StatusHistory"]] = relationship(
        back_populates="application", cascade="all, delete-orphan", order_by="StatusHistory.changed_at.desc()"
    )


class Frn(Base):
    """Funding Request Number linked to a Form 471 application."""

    __tablename__ = "tracker_frns"

    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("tracker_applications.id"), index=True)
    frn_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    service_type: Mapped[str] = mapped_column(String(128))
    status: Mapped[FrnStatus] = mapped_column(Enum(FrnStatus), default=FrnStatus.PENDING)
    requested_amount: Mapped[float | None] = mapped_column(Numeric(14, 2))
    approved_amount: Mapped[float | None] = mapped_column(Numeric(14, 2))
    usac_source_hash: Mapped[str | None] = mapped_column(String(64))

    application: Mapped["Application"] = relationship(back_populates="frns")


class StatusHistory(Base):
    """Audit log of application status transitions."""

    __tablename__ = "tracker_status_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("tracker_applications.id"), index=True)
    from_status: Mapped[ApplicationStatus | None] = mapped_column(Enum(ApplicationStatus))
    to_status: Mapped[ApplicationStatus] = mapped_column(Enum(ApplicationStatus))
    note: Mapped[str | None] = mapped_column(Text)
    changed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    application: Mapped["Application"] = relationship(back_populates="status_history")


class UsacSyncState(Base):
    """Single-row metadata for USAC Open Data import/sync."""

    __tablename__ = "usac_sync_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    state: Mapped[str] = mapped_column(String(2), default="CA")
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_sync_mode: Mapped[str | None] = mapped_column(String(20))
    basic_info_rows_updated_at: Mapped[int | None] = mapped_column(BigInteger)
    frn_status_rows_updated_at: Mapped[int | None] = mapped_column(BigInteger)
    applications_inserted: Mapped[int] = mapped_column(Integer, default=0)
    applications_updated: Mapped[int] = mapped_column(Integer, default=0)
    frns_inserted: Mapped[int] = mapped_column(Integer, default=0)
    frns_updated: Mapped[int] = mapped_column(Integer, default=0)
    skipped_reason: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())