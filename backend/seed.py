"""
Seed sample E-Rate 471 applications for MVP demo.

Run standalone: python seed.py
Also invoked automatically by the Docker CMD before uvicorn starts.
"""

import time
from datetime import date

from sqlalchemy.exc import OperationalError

from app.database import Base, SessionLocal, engine
from app.models import Application, ApplicationStatus, Frn, FrnStatus, StatusHistory

# Representative sample data covering common Form 471 workflow states
SAMPLES = [
    {
        "application_number": "471-2025-001234",
        "ben": "16012345",
        "organization_name": "Lincoln Unified School District",
        "funding_year": 2025,
        "status": ApplicationStatus.UNDER_REVIEW,
        "discount_rate": 80.0,
        "total_requested": 245000.00,
        "contact_name": "Maria Chen",
        "contact_email": "mchen@lincolnusd.edu",
        "certified_date": date(2025, 3, 15),
        "notes": "Category 1 — fiber WAN upgrade",
        "frns": [
            {"frn_number": "250012345", "service_type": "Data Transmission", "status": FrnStatus.PENDING, "requested_amount": 180000},
            {"frn_number": "250012346", "service_type": "Internet Access", "status": FrnStatus.PENDING, "requested_amount": 65000},
        ],
    },
    {
        "application_number": "471-2025-005678",
        "ben": "16098765",
        "organization_name": "Riverside Public Library Consortium",
        "funding_year": 2025,
        "status": ApplicationStatus.FCDL_APPROVED,
        "discount_rate": 90.0,
        "total_requested": 42000.00,
        "contact_name": "James Ortiz",
        "contact_email": "jortiz@riversidelib.org",
        "certified_date": date(2025, 2, 28),
        "frns": [
            {"frn_number": "250045678", "service_type": "Internet Access", "status": FrnStatus.FUNDED, "requested_amount": 42000, "approved_amount": 42000},
        ],
    },
    {
        "application_number": "471-2024-009999",
        "ben": "16055555",
        "organization_name": "Oak Valley Charter Academy",
        "funding_year": 2024,
        "status": ApplicationStatus.FCDL_DENIED,
        "discount_rate": 70.0,
        "total_requested": 89000.00,
        "contact_name": "Priya Patel",
        "contact_email": "ppatel@oakvalley.edu",
        "certified_date": date(2024, 4, 10),
        "notes": "Denied — ineligible equipment listed on FRN",
        "frns": [
            {"frn_number": "240099999", "service_type": "Internal Connections", "status": FrnStatus.DENIED, "requested_amount": 89000},
        ],
    },
    {
        "application_number": "471-2025-002100",
        "ben": "16077777",
        "organization_name": "Summit County Schools",
        "funding_year": 2025,
        "status": ApplicationStatus.CERTIFIED,
        "discount_rate": 85.0,
        "total_requested": 156000.00,
        "contact_name": "David Kim",
        "contact_email": "dkim@summitcounty.edu",
        "certified_date": date(2025, 4, 1),
        "frns": [
            {"frn_number": "250021001", "service_type": "Managed Internal Broadband", "status": FrnStatus.PENDING, "requested_amount": 156000},
        ],
    },
    {
        "application_number": "471-2025-003300",
        "ben": "16033333",
        "organization_name": "Greenfield Community College",
        "funding_year": 2025,
        "status": ApplicationStatus.DRAFT,
        "discount_rate": 50.0,
        "total_requested": 312000.00,
        "contact_name": "Angela Brooks",
        "contact_email": "abrooks@greenfieldcc.edu",
        "notes": "Draft — awaiting board approval before certification",
        "frns": [],
    },
]


def seed():
    # Retry while Postgres is still starting (Docker healthcheck may lag)
    for attempt in range(30):
        try:
            Base.metadata.create_all(bind=engine)
            break
        except OperationalError:
            time.sleep(1)
    else:
        raise RuntimeError("Could not connect to database")

    db = SessionLocal()
    try:
        if db.query(Application).count() > 0:
            print("Database already has data — skipping seed.")
            return

        for sample in SAMPLES:
            frns = sample.pop("frns")
            app = Application(**sample)
            db.add(app)
            db.flush()
            db.add(
                StatusHistory(
                    application_id=app.id,
                    from_status=None,
                    to_status=app.status,
                    note="Initial import",
                )
            )
            for frn_data in frns:
                db.add(Frn(application_id=app.id, **frn_data))

        db.commit()
        print(f"Seeded {len(SAMPLES)} sample applications.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()