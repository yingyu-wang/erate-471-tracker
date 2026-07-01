"""
Startup USAC import orchestration.

- Last sync < 24h with enough data → skip Open Data import
- Empty/small DB + preloaded.sql exists → restore dump
- Otherwise → full California import from USAC Open Data API
"""

import os
import sys

from app.database import Base, SessionLocal, engine
from app.import_state import set_importing, set_import_error
from app.models import Application
from app.usac.importer import run_full_import
from app.usac.sync import (
    MIN_IMPORTED_APPS,
    ensure_schema,
    record_preloaded_sync,
    restore_preloaded_dump,
    should_skip_import,
    wait_for_db,
)

IMPORT_STATE = os.getenv("USAC_IMPORT_STATE", "CA")
AUTO_IMPORT = os.getenv("AUTO_IMPORT_USAC", "true").lower() != "false"
FORCE_IMPORT = os.getenv("FORCE_USAC_IMPORT", "false").lower() == "true"
DATABASE_URL = os.getenv("DATABASE_URL", "")


def main() -> None:
    wait_for_db()
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        ensure_schema(db)

        if not AUTO_IMPORT:
            print("AUTO_IMPORT_USAC=false — skipping USAC import.")
            set_importing(False)
            return

        skip, reason = should_skip_import(db, force=FORCE_IMPORT)
        if skip:
            count = db.query(Application).count()
            print(f"USAC sync skipped ({reason}). Using {count} local applications.")
            set_importing(False)
            return

        count = db.query(Application).count()
        if count < MIN_IMPORTED_APPS and not FORCE_IMPORT:
            if DATABASE_URL and restore_preloaded_dump(DATABASE_URL):
                record_preloaded_sync(db, IMPORT_STATE)
                count = db.query(Application).count()
                if count >= MIN_IMPORTED_APPS:
                    print(f"Restored {count} applications from preloaded dump — skipping API import.")
                    set_importing(False)
                    return

        print(f"Starting full USAC Open Data import for {IMPORT_STATE}…")
        print("This may take several minutes on first run.")
        summary = run_full_import(db, state=IMPORT_STATE)
        print(f"Import summary: {summary}")
        set_importing(False)
    except Exception as exc:
        error_msg = f"USAC import error: {exc}"
        print(error_msg, file=sys.stderr)
        set_import_error(error_msg)
        set_importing(False)
        # Attempt to continue if DB already has data
        try:
            if db.query(Application).count() >= MIN_IMPORTED_APPS:
                print("Continuing with existing database records.")
                return
        finally:
            pass
        raise
    finally:
        db.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"USAC import failed: {exc}", file=sys.stderr)
        # Allow API to start if DB already has imported data
        db = SessionLocal()
        try:
            if db.query(Application).count() >= MIN_IMPORTED_APPS:
                print("Continuing startup with existing database records.")
                sys.exit(0)
        finally:
            db.close()
        sys.exit(1)