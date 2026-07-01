"""Full USAC Open Data import for California Form 471 records."""

from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Application, Frn, StatusHistory, UsacSyncState
from app.usac.client import build_where, fetch_dataset_versions, iterate_dataset
from app.usac.mappers import map_basic_info_row, map_frn_row, parse_funding_year

IMPORT_STATE = "CA"
FORM_VERSION = "Current"


def _load_pdf_urls(state: str, log=print) -> dict[tuple[str, int], str]:
    """Original-form rows carry file_url; Current rows usually do not."""
    log("Loading Form 471 PDF URLs from Original records…")
    where = build_where(state=state, form_version="Original")
    urls: dict[tuple[str, int], str] = {}
    for batch in iterate_dataset("basic_info", where=where, order="application_number", page_size=10000):
        for row in batch:
            url = (row.get("file_url") or "").strip()
            if not url:
                continue
            app_number = (row.get("application_number") or "").strip()
            funding_year = parse_funding_year(row.get("funding_year"))
            if app_number and funding_year is not None:
                urls[(app_number, funding_year)] = url
    log(f"  found {len(urls)} PDF URLs")
    return urls


def _upsert_applications(
    db: Session, rows: list[dict], pdf_urls: dict[tuple[str, int], str] | None = None
) -> tuple[int, int]:
    inserted = updated = 0
    for mapped in rows:
        if not mapped:
            continue
        if pdf_urls and not mapped.get("usac_file_url"):
            mapped["usac_file_url"] = pdf_urls.get(
                (mapped["application_number"], mapped["funding_year"])
            )
        existing = (
            db.query(Application)
            .filter(
                Application.application_number == mapped["application_number"],
                Application.funding_year == mapped["funding_year"],
            )
            .first()
        )
        if existing:
            if existing.usac_source_hash == mapped["usac_source_hash"]:
                continue
            old_status = existing.status
            for key, value in mapped.items():
                if key != "status":
                    setattr(existing, key, value)
            if existing.status != old_status:
                db.add(
                    StatusHistory(
                        application_id=existing.id,
                        from_status=old_status,
                        to_status=existing.status,
                        note="USAC sync update",
                    )
                )
            updated += 1
        else:
            app = Application(**mapped)
            db.add(app)
            db.flush()
            db.add(
                StatusHistory(
                    application_id=app.id,
                    from_status=None,
                    to_status=app.status,
                    note="USAC import",
                )
            )
            inserted += 1
    return inserted, updated


def _app_id_lookup(db: Session) -> dict[tuple[str, int], int]:
    rows = db.query(Application.application_number, Application.funding_year, Application.id).all()
    return {(r[0], r[1]): r[2] for r in rows}


def _upsert_frns(db: Session, rows: list[dict], app_ids: dict[tuple[str, int], int]) -> tuple[int, int]:
    inserted = updated = 0
    for mapped in rows:
        if not mapped:
            continue
        app_id = app_ids.get((mapped["application_number"], mapped["funding_year"]))
        if not app_id:
            continue
        existing = db.query(Frn).filter(Frn.frn_number == mapped["frn_number"]).first()
        frn_data = {k: v for k, v in mapped.items() if k not in ("application_number", "funding_year")}
        frn_data["application_id"] = app_id
        if existing:
            if existing.usac_source_hash == mapped["usac_source_hash"]:
                continue
            for key, value in frn_data.items():
                setattr(existing, key, value)
            updated += 1
        else:
            db.add(Frn(**frn_data))
            inserted += 1
    return inserted, updated


def run_full_import(db: Session, *, state: str = IMPORT_STATE, log=print) -> dict:
    """Import all Current-form California applications and FRNs from USAC."""
    log(f"Fetching USAC dataset versions for {state}…")
    versions = fetch_dataset_versions()

    app_where = build_where(state=state, form_version=FORM_VERSION)
    frn_where = build_where(billed_entity_state=state, form_version=FORM_VERSION)

    pdf_urls = _load_pdf_urls(state, log)

    log("Importing Form 471 basic info (Current)…")
    app_inserted = app_updated = 0
    page = 0
    for batch in iterate_dataset("basic_info", where=app_where, order="application_number"):
        page += 1
        mapped = [map_basic_info_row(r) for r in batch]
        ins, upd = _upsert_applications(db, mapped, pdf_urls)
        app_inserted += ins
        app_updated += upd
        db.commit()
        log(f"  basic info page {page}: +{ins} new, {upd} updated")

    log("Importing FRN status (Current)…")
    app_ids = _app_id_lookup(db)
    frn_inserted = frn_updated = 0
    page = 0
    for batch in iterate_dataset("frn_status", where=frn_where, order="funding_request_number"):
        page += 1
        mapped = [map_frn_row(r) for r in batch]
        ins, upd = _upsert_frns(db, mapped, app_ids)
        frn_inserted += ins
        frn_updated += upd
        db.commit()
        if page % 5 == 0:
            app_ids = _app_id_lookup(db)
        log(f"  FRN page {page}: +{ins} new, {upd} updated")

    total_apps = db.query(func.count(Application.id)).scalar() or 0
    total_frns = db.query(func.count(Frn.id)).scalar() or 0

    sync = db.query(UsacSyncState).filter(UsacSyncState.id == 1).first()
    if not sync:
        sync = UsacSyncState(id=1)
        db.add(sync)
    sync.state = state
    sync.last_sync_at = datetime.now(timezone.utc).replace(tzinfo=None)
    sync.last_sync_mode = "full"
    sync.basic_info_rows_updated_at = versions.get("basic_info_rows_updated_at")
    sync.frn_status_rows_updated_at = versions.get("frn_status_rows_updated_at")
    sync.applications_inserted = app_inserted
    sync.applications_updated = app_updated
    sync.frns_inserted = frn_inserted
    sync.frns_updated = frn_updated
    sync.skipped_reason = None
    db.commit()

    summary = {
        "mode": "full",
        "state": state,
        "applications_inserted": app_inserted,
        "applications_updated": app_updated,
        "frns_inserted": frn_inserted,
        "frns_updated": frn_updated,
        "total_applications": total_apps,
        "total_frns": total_frns,
    }
    log(f"USAC import complete: {total_apps} applications, {total_frns} FRNs.")
    return summary