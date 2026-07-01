"""USAC sync status endpoint."""

from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Application, UsacSyncState
from app.usac.sync import SYNC_MIN_INTERVAL_HOURS, hours_since_sync

router = APIRouter(prefix="/api/sync", tags=["sync"])


class SyncStatusRead(BaseModel):
    state: str | None
    last_sync_at: datetime | None
    last_sync_mode: str | None
    hours_since_sync: float | None
    skip_import_until_hours: float
    total_applications: int
    skipped_reason: str | None


@router.get("/status", response_model=SyncStatusRead)
def get_sync_status(db: Session = Depends(get_db)):
    sync = db.query(UsacSyncState).filter(UsacSyncState.id == 1).first()
    count = db.query(Application).count()
    return SyncStatusRead(
        state=sync.state if sync else None,
        last_sync_at=sync.last_sync_at if sync else None,
        last_sync_mode=sync.last_sync_mode if sync else None,
        hours_since_sync=hours_since_sync(sync),
        skip_import_until_hours=SYNC_MIN_INTERVAL_HOURS,
        total_applications=count,
        skipped_reason=sync.skipped_reason if sync else None,
    )