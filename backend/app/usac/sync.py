"""USAC sync interval checks and preloaded database restore."""

import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.database import engine
from app.models import Application, UsacSyncState

PRELOADED_DUMP = Path(os.getenv("PRELOADED_DUMP_PATH", "/app/db/preloaded.sql"))
SYNC_MIN_INTERVAL_HOURS = float(os.getenv("USAC_SYNC_MIN_INTERVAL_HOURS", "24"))
MIN_IMPORTED_APPS = int(os.getenv("USAC_MIN_IMPORTED_APPS", "1000"))


def hours_since_sync(sync: UsacSyncState | None) -> float | None:
    if not sync or not sync.last_sync_at:
        return None
    now = datetime.now(timezone.utc)
    last = sync.last_sync_at
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    age = now - last
    return age.total_seconds() / 3600


def should_skip_import(db: Session, *, force: bool = False) -> tuple[bool, str | None]:
    if force:
        return False, None
    count = db.query(Application).count()
    sync = db.query(UsacSyncState).filter(UsacSyncState.id == 1).first()
    hours = hours_since_sync(sync)
    if count >= MIN_IMPORTED_APPS and hours is not None and hours < SYNC_MIN_INTERVAL_HOURS:
        return True, f"last sync {hours:.1f}h ago (< {SYNC_MIN_INTERVAL_HOURS}h)"
    return False, None


def record_preloaded_sync(db: Session, state: str = "CA") -> None:
    sync = db.query(UsacSyncState).filter(UsacSyncState.id == 1).first()
    if not sync:
        sync = UsacSyncState(id=1)
        db.add(sync)
    sync.state = state
    sync.last_sync_at = datetime.now(timezone.utc).replace(tzinfo=None)
    sync.last_sync_mode = "preloaded"
    sync.skipped_reason = "preloaded_dump"
    db.commit()


def _parse_db_url(url: str) -> dict[str, str]:
    parsed = urlparse(url)
    return {
        "host": parsed.hostname or "localhost",
        "port": str(parsed.port or 5432),
        "user": parsed.username or "",
        "password": parsed.password or "",
        "database": parsed.path.lstrip("/"),
    }


def restore_preloaded_dump(database_url: str, log=print) -> bool:
    if not PRELOADED_DUMP.exists():
        log(f"No preloaded dump at {PRELOADED_DUMP}")
        return False

    size_mb = PRELOADED_DUMP.stat().st_size / (1024 * 1024)
    log(f"Restoring preloaded CA data from {PRELOADED_DUMP} ({size_mb:.1f} MB)…")

    db = _parse_db_url(database_url)
    env = {**os.environ, "PGPASSWORD": db["password"]}
    result = subprocess.run(
        [
            "psql",
            "-h", db["host"],
            "-p", db["port"],
            "-U", db["user"],
            "-d", db["database"],
            "-v", "ON_ERROR_STOP=1",
            "-q",
            "-f", str(PRELOADED_DUMP),
        ],
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        log(f"psql restore failed: {result.stderr[:500]}")
        return False
    log("Preloaded dump restored.")
    return True


def ensure_schema(db: Session) -> None:
    """Apply lightweight migrations for columns added after initial MVP."""
    statements = [
        "ALTER TABLE tracker_applications ADD COLUMN IF NOT EXISTS usac_file_url VARCHAR(512)",
        "ALTER TABLE tracker_applications ADD COLUMN IF NOT EXISTS entity_type VARCHAR(128)",
        "ALTER TABLE tracker_applications ADD COLUMN IF NOT EXISTS usac_source_hash VARCHAR(64)",
        "ALTER TABLE tracker_frns ADD COLUMN IF NOT EXISTS usac_source_hash VARCHAR(64)",
        "CREATE TABLE IF NOT EXISTS usac_sync_state ("
        "  id INTEGER PRIMARY KEY DEFAULT 1,"
        "  state VARCHAR(2) DEFAULT 'CA',"
        "  last_sync_at TIMESTAMP,"
        "  last_sync_mode VARCHAR(20),"
        "  basic_info_rows_updated_at BIGINT,"
        "  frn_status_rows_updated_at BIGINT,"
        "  applications_inserted INTEGER DEFAULT 0,"
        "  applications_updated INTEGER DEFAULT 0,"
        "  frns_inserted INTEGER DEFAULT 0,"
        "  frns_updated INTEGER DEFAULT 0,"
        "  skipped_reason TEXT,"
        "  updated_at TIMESTAMP DEFAULT NOW()"
        ")",
        "ALTER TABLE tracker_applications DROP CONSTRAINT IF EXISTS tracker_applications_application_number_key",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_tracker_app_number_year "
        "ON tracker_applications (application_number, funding_year)",
    ]
    for stmt in statements:
        db.execute(text(stmt))
    db.commit()


def wait_for_db(max_attempts: int = 30) -> None:
    for _ in range(max_attempts):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return
        except OperationalError:
            time.sleep(1)
    raise RuntimeError("Database not available")