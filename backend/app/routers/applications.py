"""REST endpoints for Form 471 applications, FRNs, and dashboard stats."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Application, ApplicationStatus, Frn, StatusHistory
from app.schemas import (
    ApplicationCreate,
    ApplicationRead,
    ApplicationSummary,
    ApplicationUpdate,
    DashboardStats,
    FrnCreate,
    FrnRead,
    FrnUpdate,
)
from app.usac.client import fetch_latest_application_row
from app.usac.mappers import map_basic_info_row

router = APIRouter(prefix="/api/applications", tags=["applications"])
logger = logging.getLogger(__name__)


def _record_status_change(
    db: Session,
    application: Application,
    new_status: ApplicationStatus,
    note: str | None = None,
) -> None:
    """Append a history entry and update status; no-op if status is unchanged."""
    if application.status == new_status:
        return
    history = StatusHistory(
        application_id=application.id,
        from_status=application.status,
        to_status=new_status,
        note=note,
    )
    db.add(history)
    application.status = new_status


@router.get("/stats", response_model=DashboardStats)
def get_dashboard_stats(
    funding_year: int | None = None,
    db: Session = Depends(get_db),
):
    """Return portfolio totals; optionally scoped to a single funding year."""
    query = db.query(Application)
    if funding_year:
        query = query.filter(Application.funding_year == funding_year)

    applications = query.all()
    by_status: dict[str, int] = {s.value: 0 for s in ApplicationStatus}
    total_requested = 0.0
    years: set[int] = set()

    for app in applications:
        by_status[app.status.value] += 1
        if app.total_requested:
            total_requested += float(app.total_requested)
        years.add(app.funding_year)

    # Sum approved amounts for FRNs that received funding (full or partial)
    funded = (
        db.query(func.coalesce(func.sum(Frn.approved_amount), 0))
        .join(Application)
        .filter(Frn.status.in_(["funded", "partial"]))
    )
    if funding_year:
        funded = funded.filter(Application.funding_year == funding_year)
    total_funded = float(funded.scalar() or 0)

    return DashboardStats(
        total_applications=len(applications),
        by_status=by_status,
        total_requested=total_requested,
        total_funded=total_funded,
        funding_years=sorted(years, reverse=True),
    )


@router.get("", response_model=list[ApplicationSummary])
def list_applications(
    status: ApplicationStatus | None = None,
    funding_year: int | None = None,
    search: str | None = None,
    live_status_check: bool = Query(False, description="Refresh exact searched 471 status from USAC"),
    db: Session = Depends(get_db),
):
    """List applications with optional filters; search matches org name, app #, or BEN."""
    query = db.query(Application).options(joinedload(Application.frns))
    if status:
        query = query.filter(Application.status == status)
    if funding_year:
        query = query.filter(Application.funding_year == funding_year)
    if search:
        term = f"%{search}%"
        query = query.filter(
            (Application.organization_name.ilike(term))
            | (Application.application_number.ilike(term))
            | (Application.ben.ilike(term))
        )
    apps = query.order_by(Application.updated_at.desc()).all()

    # Optional live refresh: when searching an exact 471 application number, pull the
    # latest status from USAC and update local cache before returning results.
    if live_status_check and search:
        search_term = search.strip()
        exact_matches = [a for a in apps if a.application_number == search_term]
        for app in exact_matches:
            try:
                live_row = fetch_latest_application_row(
                    app.application_number,
                    state="CA",
                    funding_year=app.funding_year,
                )
                mapped = map_basic_info_row(live_row) if live_row else None
                if not mapped:
                    continue

                old_status = app.status
                for key, value in mapped.items():
                    if key == "application_number" or key == "funding_year":
                        continue
                    setattr(app, key, value)

                if app.status != old_status:
                    db.add(
                        StatusHistory(
                            application_id=app.id,
                            from_status=old_status,
                            to_status=app.status,
                            note="Live USAC status refresh from search",
                        )
                    )
            except Exception as exc:  # pragma: no cover - non-critical network path
                logger.warning("Live USAC refresh failed for %s: %s", app.application_number, exc)

        if exact_matches:
            db.commit()

    return [
        ApplicationSummary(
            id=a.id,
            application_number=a.application_number,
            ben=a.ben,
            organization_name=a.organization_name,
            funding_year=a.funding_year,
            status=a.status,
            discount_rate=float(a.discount_rate) if a.discount_rate else None,
            total_requested=float(a.total_requested) if a.total_requested else None,
            certified_date=a.certified_date,
            usac_file_url=a.usac_file_url,
            updated_at=a.updated_at,
            frn_count=len(a.frns),
        )
        for a in apps
    ]


@router.get("/{application_id}", response_model=ApplicationRead)
def get_application(application_id: int, db: Session = Depends(get_db)):
    """Fetch a single application with FRNs and status history."""
    app = (
        db.query(Application)
        .options(joinedload(Application.frns), joinedload(Application.status_history))
        .filter(Application.id == application_id)
        .first()
    )
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    return app


@router.post("", response_model=ApplicationRead, status_code=201)
def create_application(payload: ApplicationCreate, db: Session = Depends(get_db)):
    """Create a new Form 471 record with optional FRNs."""
    existing = (
        db.query(Application)
        .filter(
            Application.application_number == payload.application_number,
            Application.funding_year == payload.funding_year,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Application already exists for this funding year")

    data = payload.model_dump(exclude={"frns"})
    application = Application(**data)
    db.add(application)
    db.flush()  # assign id before creating child records

    _record_status_change(db, application, application.status, "Application created")

    for frn_data in payload.frns:
        db.add(Frn(application_id=application.id, **frn_data.model_dump()))

    db.commit()
    db.refresh(application)
    return get_application(application.id, db)


@router.patch("/{application_id}", response_model=ApplicationRead)
def update_application(
    application_id: int,
    payload: ApplicationUpdate,
    db: Session = Depends(get_db),
):
    """Partial update; status changes are logged to status_history."""
    app = db.query(Application).filter(Application.id == application_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    updates = payload.model_dump(exclude_unset=True, exclude={"status_note"})
    new_status = updates.pop("status", None)

    for key, value in updates.items():
        setattr(app, key, value)

    if new_status is not None:
        _record_status_change(db, app, new_status, payload.status_note)

    db.commit()
    return get_application(application_id, db)


@router.delete("/{application_id}", status_code=204)
def delete_application(application_id: int, db: Session = Depends(get_db)):
    """Delete application and cascade to FRNs and status history."""
    app = db.query(Application).filter(Application.id == application_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    db.delete(app)
    db.commit()


@router.post("/{application_id}/frns", response_model=FrnRead, status_code=201)
def add_frn(application_id: int, payload: FrnCreate, db: Session = Depends(get_db)):
    """Attach a new FRN to an existing application."""
    app = db.query(Application).filter(Application.id == application_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    existing = db.query(Frn).filter(Frn.frn_number == payload.frn_number).first()
    if existing:
        raise HTTPException(status_code=409, detail="FRN number already exists")
    frn = Frn(application_id=application_id, **payload.model_dump())
    db.add(frn)
    db.commit()
    db.refresh(frn)
    return frn


@router.patch("/frns/{frn_id}", response_model=FrnRead)
def update_frn(frn_id: int, payload: FrnUpdate, db: Session = Depends(get_db)):
    """Update an existing FRN (e.g. status or approved amount)."""
    frn = db.query(Frn).filter(Frn.id == frn_id).first()
    if not frn:
        raise HTTPException(status_code=404, detail="FRN not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(frn, key, value)
    db.commit()
    db.refresh(frn)
    return frn