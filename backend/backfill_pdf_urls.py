"""Backfill usac_file_url from USAC Original form records."""

import sys

from app.database import SessionLocal
from app.models import Application
from app.usac.importer import _load_pdf_urls


def main() -> None:
    db = SessionLocal()
    try:
        pdf_urls = _load_pdf_urls("CA")
        updated = 0
        apps = db.query(Application).filter(Application.usac_file_url.is_(None)).all()
        for app in apps:
            url = pdf_urls.get((app.application_number, app.funding_year))
            if url:
                app.usac_file_url = url
                updated += 1
        db.commit()
        print(f"Backfilled {updated} PDF URLs.")
    finally:
        db.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Backfill failed: {exc}", file=sys.stderr)
        sys.exit(1)