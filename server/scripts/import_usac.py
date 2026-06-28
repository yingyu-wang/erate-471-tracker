#!/usr/bin/env python3
"""
Python port of the USAC Open Data importer for the E-Rate 471 Tracker.

Uses the official `sodapy` Socrata SDK instead of raw HTTP + custom pagination.

This can be used as a drop-in replacement / alternative for:
- npm run import:usac
- The web UI "Import CA Data" button (when USE_PYTHON_USAC_IMPORT=true)

It replicates the full logic:
- Config resolution (env vars + CLI args)
- Incremental vs full, year window
- Current + (optional) Original/Pending passes
- Dataset version change detection (usac_sync_state)
- Row hashing for change detection / unchanged counts
- Upserts with proper COALESCE for dates, status_history inserts
- FCDL date backfill
- Same output summary format + --json for Node integration

Usage:
  pip install -r server/scripts/requirements-usac-import.txt
  DATABASE_URL=... python server/scripts/import_usac.py --help
  DATABASE_URL=... python server/scripts/import_usac.py --year-min 2025

  # Force full
  ... --full

  # For Node route to call it
  ... --json
"""

import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

# --- Optional dotenv ---
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# --- Dependencies (install via requirements-usac-import.txt) ---
try:
    import psycopg
except ImportError:
    print("ERROR: psycopg not installed. Run: pip install -r server/scripts/requirements-usac-import.txt", file=sys.stderr)
    sys.exit(1)

try:
    from sodapy import Socrata
except ImportError:
    print("ERROR: sodapy not installed. Run: pip install -r server/scripts/requirements-usac-import.txt", file=sys.stderr)
    sys.exit(1)


# =============================================================================
# Port of server/lib/usac-client.js  (using sodapy instead of raw fetch)
# =============================================================================
DATASETS = {
    "basicInfo": "9s6i-myen",
    "frnStatus": "qdmp-ygft",
}


def escape_soql(value: Any) -> str:
    if value is None:
        return ""
    return str(value).replace("'", "''")


def build_where(filters: Dict[str, Any]) -> Optional[str]:
    clauses: List[str] = []
    if filters.get("state"):
        clauses.append(f"org_state='{escape_soql(filters['state'])}'")
    if filters.get("billedEntityState"):
        clauses.append(f"state='{escape_soql(filters['billedEntityState'])}'")
    if filters.get("formVersion"):
        clauses.append(f"form_version='{escape_soql(filters['formVersion'])}'")
    if filters.get("applicationStatus"):
        clauses.append(f"form_471_status_name='{escape_soql(filters['applicationStatus'])}'")
    if filters.get("frnStatus"):
        clauses.append(f"form_471_frn_status_name='{escape_soql(filters['frnStatus'])}'")
    if filters.get("fundingYearMin"):
        clauses.append(f"funding_year >= '{escape_soql(filters['fundingYearMin'])}'")
    if filters.get("fundingYearMax"):
        clauses.append(f"funding_year <= '{escape_soql(filters['fundingYearMax'])}'")
    return " AND ".join(clauses) if clauses else None


def get_socrata_client() -> Socrata:
    domain = os.getenv("USAC_API_BASE", "https://opendata.usac.org").replace("https://", "").replace("http://", "").rstrip("/")
    return Socrata(domain, None, timeout=120)


def fetch_dataset_versions() -> Dict[str, Optional[int]]:
    with get_socrata_client() as client:
        basic = client.get_metadata(DATASETS["basicInfo"]) or {}
        frn = client.get_metadata(DATASETS["frnStatus"]) or {}
    return {
        "basicInfoRowsUpdatedAt": basic.get("rowsUpdatedAt"),
        "frnStatusRowsUpdatedAt": frn.get("rowsUpdatedAt"),
    }


def iterate_basic_info_pages(config: Dict[str, Any], filters: Dict[str, Any], on_page: Optional[callable] = None) -> Iterable[List[Dict[str, Any]]]:
    where = build_where({
        "state": config["state"],
        "formVersion": filters.get("formVersion"),
        "applicationStatus": filters.get("applicationStatus"),
        "fundingYearMin": config.get("fundingYearMin"),
        "fundingYearMax": config.get("fundingYearMax"),
    })
    page_size = config.get("pageSize", 50000)
    with get_socrata_client() as client:
        # Use get_all for clean full iteration (sodapy handles paging)
        # We simulate page callbacks for logging parity
        count = 0
        batch: List[Dict[str, Any]] = []
        for row in client.get_all(DATASETS["basicInfo"], where=where, order="application_number"):
            batch.append(row)
            count += 1
            if len(batch) >= page_size:
                if on_page:
                    on_page({"offset": count - len(batch), "count": len(batch)})
                yield batch
                batch = []
        if batch:
            if on_page:
                on_page({"offset": count - len(batch), "count": len(batch)})
            yield batch


def iterate_frn_pages(config: Dict[str, Any], filters: Dict[str, Any], on_page: Optional[callable] = None) -> Iterable[List[Dict[str, Any]]]:
    where = build_where({
        "billedEntityState": config["state"],
        "formVersion": filters.get("formVersion"),
        "frnStatus": filters.get("frnStatus"),
        "fundingYearMin": config.get("fundingYearMin"),
        "fundingYearMax": config.get("fundingYearMax"),
    })
    page_size = config.get("pageSize", 50000)
    with get_socrata_client() as client:
        count = 0
        batch: List[Dict[str, Any]] = []
        for row in client.get_all(DATASETS["frnStatus"], where=where, order="funding_request_number"):
            batch.append(row)
            count += 1
            if len(batch) >= page_size:
                if on_page:
                    on_page({"offset": count - len(batch), "count": len(batch)})
                yield batch
                batch = []
        if batch:
            if on_page:
                on_page({"offset": count - len(batch), "count": len(batch)})
            yield batch


# =============================================================================
# Port of server/lib/usac-hash.js
# =============================================================================
APPLICATION_SOURCE_FIELDS = [
    "application_number", "funding_year", "epc_organization_id", "fcc_registration_number",
    "organization_name", "organization_entity_type_name", "form_471_status_name",
    "certified_datetime", "cnct_first_name", "cnct_last_name", "cnct_email", "cnct_phone", "nickname",
]

FRN_SOURCE_FIELDS = [
    "application_number", "funding_year", "funding_request_number", "ben",
    "organization_name", "organization_entity_type_name", "form_471_service_type_name",
    "spin_name", "total_pre_discount_costs", "dis_pct", "form_471_frn_status_name",
    "service_start_date", "last_date_to_invoice", "funding_commitment_request",
    "total_authorized_disbursement", "spac_filed", "f486_case_status", "form_486_no",
    "fcdl_letter_date", "nickname", "cnct_email",
]


def _stable_stringify(value: Any) -> str:
    if value is None or value == "":
        return ""
    if not isinstance(value, (dict, list)):
        return str(value)
    if isinstance(value, list):
        return "[" + ",".join(_stable_stringify(v) for v in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value.keys())
        return "{" + ",".join(f"{k}:{_stable_stringify(value[k])}" for k in keys) + "}"
    return str(value)


def _hash_fields(fields: Dict[str, Any]) -> str:
    s = _stable_stringify(fields)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def hash_application_row(row: Dict[str, Any]) -> str:
    picked = {name: row.get(name) for name in APPLICATION_SOURCE_FIELDS}
    return _hash_fields(picked)


def hash_frn_row(row: Dict[str, Any]) -> str:
    picked = {name: row.get(name) for name in FRN_SOURCE_FIELDS}
    return _hash_fields(picked)


# =============================================================================
# Port of server/lib/usac-mappers.js (adapted to current mappers)
# =============================================================================
APPLICATION_STATUS_MAP = {
    "Certified": "certified",
    "Committed": "fcdl_issued",
    "Pending": "under_review",
    "Denied": "denied",
    "Cancelled": "cancelled",
}

FRN_STATUS_MAP = {
    "Funded": "committed",
    "Pending": "pending",
    "Denied": "denied",
    "Cancelled": "cancelled",
    "As yet unfunded": "pending",
}

FORM_486_STATUS_MAP = {
    "Approved": "approved",
    "Not Filed": "not_filed",
    "Not Filed Yet": "not_filed",
    "Pending": "pending",
    "Denied": "denied",
}

C2_SERVICE_TYPES = {
    "Internal Connections",
    "Managed Internal Broadband Services",
    "Basic Maintenance of Internal Connections",
}


def _parse_funding_year(value: Any) -> Optional[int]:
    try:
        y = int(value)
        return y if 1997 <= y <= 2100 else None
    except Exception:
        return None


def _parse_date(value: Any) -> Optional[str]:
    if not value:
        return None
    s = str(value)
    return s[:10] if len(s) >= 10 else None


def _parse_number(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except Exception:
        return None


def _parse_discount(value: Any) -> Optional[float]:
    num = _parse_number(value)
    if num is None:
        return None
    return num * 100 if num <= 1 else num


def map_application_status(status_name: Optional[str]) -> str:
    if not status_name:
        return "under_review"
    return APPLICATION_STATUS_MAP.get(status_name, "under_review")


def map_frn_status(status_name: Optional[str]) -> str:
    if not status_name:
        return "pending"
    return FRN_STATUS_MAP.get(status_name, "pending")


def map_form_486_status(status_name: Optional[str]) -> str:
    if not status_name:
        return "not_filed"
    return FORM_486_STATUS_MAP.get(status_name, "pending")


def map_pia_status(frn: Dict[str, Any]) -> str:
    if frn.get("form_471_frn_status_name") == "Funded":
        return "complete"
    if frn.get("spac_filed") == "Yes":
        return "in_progress"
    return "not_started"


def map_category(service_type: Optional[str]) -> int:
    return 2 if service_type in C2_SERVICE_TYPES else 1


def map_basic_info_to_application(row: Dict[str, Any]) -> Dict[str, Any]:
    contact_name = " ".join(filter(None, [row.get("cnct_first_name"), row.get("cnct_last_name")])).strip() or None
    return {
        "application_number": (row.get("application_number") or "").strip() or None,
        "funding_year": _parse_funding_year(row.get("funding_year")),
        "ben": (row.get("epc_organization_id") or row.get("fcc_registration_number") or "").strip() or None,
        "entity_name": (row.get("organization_name") or "").strip() or None,
        "entity_type": (row.get("organization_entity_type_name") or "School District").strip(),
        "application_status": map_application_status(row.get("form_471_status_name")),
        "certified_date": _parse_date(row.get("certified_datetime")),
        "fcdl_date": None,
        "contact_name": contact_name,
        "contact_email": (row.get("cnct_email") or "").strip() or None,
        "contact_phone": (row.get("cnct_phone") or "").strip() or None,
        "notes": f"USAC nickname: {row.get('nickname')}" if row.get("nickname") else "Imported from USAC Open Data",
    }


def map_frn_row_to_application_fallback(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "application_number": (row.get("application_number") or "").strip() or None,
        "funding_year": _parse_funding_year(row.get("funding_year")),
        "ben": (row.get("ben") or "").strip() or None,
        "entity_name": (row.get("organization_name") or "").strip() or None,
        "entity_type": (row.get("organization_entity_type_name") or "School District").strip(),
        "application_status": "fcdl_issued" if row.get("fcdl_letter_date") else "certified",
        "certified_date": None,
        "fcdl_date": _parse_date(row.get("fcdl_letter_date")),
        "contact_name": None,
        "contact_email": (row.get("cnct_email") or "").strip() or None,
        "contact_phone": None,
        "notes": f"USAC nickname: {row.get('nickname')}" if row.get("nickname") else "Imported from USAC Open Data (FRN record)",
    }


def map_frn_row_to_frn(row: Dict[str, Any], application_id: str) -> Dict[str, Any]:
    service_type = (row.get("form_471_service_type_name") or "Unknown").strip()
    return {
        "application_id": application_id,
        "frn_number": (row.get("funding_request_number") or "").strip() or None,
        "category": map_category(service_type),
        "service_type": service_type,
        "function_type": service_type or None,
        "spin": None,
        "service_provider_name": (row.get("spin_name") or "").strip() or None,
        "pre_discount_amount": _parse_number(row.get("total_pre_discount_costs")) or 0,
        "discount_percentage": _parse_discount(row.get("dis_pct")),
        "frn_status": map_frn_status(row.get("form_471_frn_status_name")),
        "service_start_date": _parse_date(row.get("service_start_date")),
        "invoicing_deadline": _parse_date(row.get("last_date_to_invoice")),
        "committed_amount": _parse_number(row.get("funding_commitment_request")) or 0,
        "disbursed_amount": _parse_number(row.get("total_authorized_disbursement")) or 0,
        "pia_status": map_pia_status(row),
        "form_486_status": map_form_486_status(row.get("f486_case_status") or row.get("form_486_no")),
        "form_473_status": "filed" if row.get("form_486_no") else "not_filed",
        "notes": f"USAC nickname: {row.get('nickname')}" if row.get("nickname") else "Imported from USAC Open Data",
        "fcdl_date": _parse_date(row.get("fcdl_letter_date")),
    }


# =============================================================================
# Port of server/lib/usac-sync-state.js + helpers
# =============================================================================
def get_sync_state(conn: psycopg.Connection) -> Optional[Dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM usac_sync_state WHERE id = 1")
        row = cur.fetchone()
        if not row:
            return None
        colnames = [d[0] for d in cur.description]
        rec = dict(zip(colnames, row))
        if rec.get("basic_info_rows_updated_at") is not None:
            rec["basic_info_rows_updated_at"] = int(rec["basic_info_rows_updated_at"])
        if rec.get("frn_status_rows_updated_at") is not None:
            rec["frn_status_rows_updated_at"] = int(rec["frn_status_rows_updated_at"])
        return rec


def save_sync_state(conn: psycopg.Connection, *, state: str, mode: str, versions: Optional[Dict], applications: Dict, frns: Dict, skipped_reason: Optional[str] = None):
    sql = """
    INSERT INTO usac_sync_state (
      id, state, last_sync_at, last_sync_mode,
      basic_info_rows_updated_at, frn_status_rows_updated_at,
      applications_inserted, applications_updated, applications_unchanged,
      frns_inserted, frns_updated, frns_unchanged,
      skipped_reason, updated_at
    ) VALUES (
      1, %s, NOW(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      state = EXCLUDED.state,
      last_sync_at = EXCLUDED.last_sync_at,
      last_sync_mode = EXCLUDED.last_sync_mode,
      basic_info_rows_updated_at = EXCLUDED.basic_info_rows_updated_at,
      frn_status_rows_updated_at = EXCLUDED.frn_status_rows_updated_at,
      applications_inserted = EXCLUDED.applications_inserted,
      applications_updated = EXCLUDED.applications_updated,
      applications_unchanged = EXCLUDED.applications_unchanged,
      frns_inserted = EXCLUDED.frns_inserted,
      frns_updated = EXCLUDED.frns_updated,
      frns_unchanged = EXCLUDED.frns_unchanged,
      skipped_reason = EXCLUDED.skipped_reason,
      updated_at = NOW()
    """
    with conn.cursor() as cur:
        cur.execute(sql, [
            state, mode,
            versions.get("basicInfoRowsUpdatedAt") if versions else None,
            versions.get("frnStatusRowsUpdatedAt") if versions else None,
            applications.get("inserted", 0),
            applications.get("updated", 0),
            applications.get("unchanged", 0),
            frns.get("inserted", 0),
            frns.get("updated", 0),
            frns.get("unchanged", 0),
            skipped_reason,
        ])


# =============================================================================
# Core import logic (port of server/lib/usac-import.js)
# =============================================================================
def app_key(app_number: Optional[str], funding_year: Optional[int]) -> str:
    return f"{app_number or ''}|{funding_year or ''}"


def resolve_sync_mode(options: Dict[str, Any]) -> str:
    raw = options.get("syncMode") or os.getenv("USAC_SYNC_MODE") or "auto"
    if raw in ("full", "incremental", "skip"):
        return raw
    return "auto"


def resolve_incremental_year_min(config: Dict[str, Any], sync_mode: str, options: Dict[str, Any]) -> Optional[str]:
    if options.get("fundingYearMin") or os.getenv("USAC_IMPORT_FUNDING_YEAR_MIN"):
        return config.get("fundingYearMin")
    if sync_mode != "incremental":
        return config.get("fundingYearMin")
    window = int(options.get("syncYearWindow") or os.getenv("USAC_SYNC_YEAR_WINDOW") or 2)
    current = datetime.now().year
    return str(current - window + 1)


def resolve_config(options: Dict[str, Any]) -> Dict[str, Any]:
    sync_mode = resolve_sync_mode(options)
    funding_year_min = options.get("fundingYearMin") or os.getenv("USAC_IMPORT_FUNDING_YEAR_MIN")

    cfg = {
        "baseUrl": os.getenv("USAC_API_BASE", "https://opendata.usac.org"),
        "state": options.get("state") or os.getenv("USAC_IMPORT_STATE") or "CA",
        "pageSize": int(options.get("pageSize") or os.getenv("USAC_IMPORT_PAGE_SIZE") or 50000),
        "fundingYearMin": funding_year_min,
        "fundingYearMax": options.get("fundingYearMax") or os.getenv("USAC_IMPORT_FUNDING_YEAR_MAX"),
        "includePending": (options.get("includePending") is not False) and (os.getenv("USAC_IMPORT_INCLUDE_PENDING", "true").lower() != "false"),
        "batchSize": int(options.get("batchSize") or 200),
        "syncMode": sync_mode,
        "checkDatasets": (options.get("checkDatasets") is not False) and (os.getenv("USAC_SYNC_CHECK_DATASETS", "true").lower() != "false"),
        "log": options.get("log") or print,
    }
    cfg["fundingYearMin"] = resolve_incremental_year_min(cfg, sync_mode, options)
    return cfg


# SQL using %s for psycopg
APPLICATION_UPSERT = """
  INSERT INTO applications (
    application_number, funding_year, ben, entity_name, entity_type,
    application_status, certified_date, fcdl_date,
    contact_name, contact_email, contact_phone, notes, usac_source_hash
  ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
  ON CONFLICT (application_number, funding_year) DO UPDATE SET
    ben = EXCLUDED.ben, entity_name = EXCLUDED.entity_name, entity_type = EXCLUDED.entity_type,
    application_status = EXCLUDED.application_status,
    certified_date = COALESCE(EXCLUDED.certified_date, applications.certified_date),
    fcdl_date = COALESCE(EXCLUDED.fcdl_date, applications.fcdl_date),
    contact_name = COALESCE(EXCLUDED.contact_name, applications.contact_name),
    contact_email = COALESCE(EXCLUDED.contact_email, applications.contact_email),
    contact_phone = COALESCE(EXCLUDED.contact_phone, applications.contact_phone),
    notes = EXCLUDED.notes, usac_source_hash = EXCLUDED.usac_source_hash, updated_at = NOW()
  RETURNING id, (xmax = 0) AS inserted
"""

FRN_UPSERT = """
  INSERT INTO frns (
    application_id, frn_number, category, service_type, function_type,
    spin, service_provider_name, pre_discount_amount, discount_percentage,
    frn_status, service_start_date, invoicing_deadline,
    committed_amount, disbursed_amount, pia_status, form_486_status, form_473_status, notes,
    usac_source_hash
  ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
  ON CONFLICT (frn_number) DO UPDATE SET
    application_id = EXCLUDED.application_id, category = EXCLUDED.category,
    service_type = EXCLUDED.service_type, function_type = EXCLUDED.function_type,
    service_provider_name = EXCLUDED.service_provider_name,
    pre_discount_amount = EXCLUDED.pre_discount_amount, discount_percentage = EXCLUDED.discount_percentage,
    frn_status = EXCLUDED.frn_status,
    service_start_date = COALESCE(EXCLUDED.service_start_date, frns.service_start_date),
    invoicing_deadline = COALESCE(EXCLUDED.invoicing_deadline, frns.invoicing_deadline),
    committed_amount = EXCLUDED.committed_amount, disbursed_amount = EXCLUDED.disbursed_amount,
    pia_status = EXCLUDED.pia_status, form_486_status = EXCLUDED.form_486_status,
    form_473_status = EXCLUDED.form_473_status, notes = EXCLUDED.notes,
    usac_source_hash = EXCLUDED.usac_source_hash, updated_at = NOW()
  RETURNING id, (xmax = 0) AS inserted
"""

APPLICATION_INSERT_ONLY = """
  INSERT INTO applications (
    application_number, funding_year, ben, entity_name, entity_type,
    application_status, certified_date, fcdl_date,
    contact_name, contact_email, contact_phone, notes, usac_source_hash
  ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
  ON CONFLICT (application_number, funding_year) DO NOTHING
  RETURNING id, true AS inserted
"""

FRN_INSERT_ONLY = """
  INSERT INTO frns (
    application_id, frn_number, category, service_type, function_type,
    spin, service_provider_name, pre_discount_amount, discount_percentage,
    frn_status, service_start_date, invoicing_deadline,
    committed_amount, disbursed_amount, pia_status, form_486_status, form_473_status, notes,
    usac_source_hash
  ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
  ON CONFLICT (frn_number) DO NOTHING
  RETURNING id, true AS inserted
"""


def upsert_application(cur: psycopg.Cursor, app: Dict[str, Any], *, insert_only: bool = False, source_hash: Optional[str] = None) -> Dict[str, Any]:
    if not app.get("application_number") or not app.get("funding_year") or not app.get("ben") or not app.get("entity_name"):
        return {"skipped": True}

    values = [
        app.get("application_number"), app.get("funding_year"), app.get("ben"), app.get("entity_name"), app.get("entity_type"),
        app.get("application_status"), app.get("certified_date"), app.get("fcdl_date"),
        app.get("contact_name"), app.get("contact_email"), app.get("contact_phone"), app.get("notes"), source_hash,
    ]
    sql = APPLICATION_INSERT_ONLY if insert_only else APPLICATION_UPSERT
    cur.execute(sql, values)
    row = cur.fetchone()
    if not row:
        cur.execute(
            "SELECT id FROM applications WHERE application_number = %s AND funding_year = %s",
            [app.get("application_number"), app.get("funding_year")]
        )
        existing = cur.fetchone()
        if existing:
            return {"id": existing[0], "skipped": True, "existing": True}
        return {"skipped": True}

    app_id, inserted = row
    if inserted:
        cur.execute(
            "INSERT INTO status_history (record_type, record_id, old_status, new_status, notes) "
            "VALUES ('application', %s, NULL, %s, 'Imported from USAC Open Data')",
            [app_id, app.get("application_status")]
        )
        return {"id": app_id, "inserted": True}
    return {"id": app_id, "inserted": False}


def upsert_frn(cur: psycopg.Cursor, frn: Dict[str, Any], *, insert_only: bool = False, source_hash: Optional[str] = None) -> Dict[str, Any]:
    if not frn.get("application_id") or not frn.get("frn_number"):
        return {"skipped": True}

    values = [
        frn.get("application_id"), frn.get("frn_number"), frn.get("category"), frn.get("service_type"), frn.get("function_type"),
        frn.get("spin"), frn.get("service_provider_name"), frn.get("pre_discount_amount"), frn.get("discount_percentage"),
        frn.get("frn_status"), frn.get("service_start_date"), frn.get("invoicing_deadline"),
        frn.get("committed_amount"), frn.get("disbursed_amount"), frn.get("pia_status"), frn.get("form_486_status"),
        frn.get("form_473_status"), frn.get("notes"), source_hash,
    ]
    sql = FRN_INSERT_ONLY if insert_only else FRN_UPSERT
    cur.execute(sql, values)
    row = cur.fetchone()
    if not row:
        return {"skipped": True, "existing": True}
    frn_id, inserted = row
    if inserted:
        cur.execute(
            "INSERT INTO status_history (record_type, record_id, old_status, new_status, notes) "
            "VALUES ('frn', %s, NULL, %s, 'Imported from USAC Open Data')",
            [frn_id, frn.get("frn_status")]
        )
        return {"id": frn_id, "inserted": True}
    return {"id": frn_id, "inserted": False}


def import_applications(cur: psycopg.Cursor, rows: List[Dict], stats: Dict, *, insert_only: bool = False):
    for raw in rows:
        app = map_basic_info_to_application(raw)
        if not app.get("application_number") or not app.get("funding_year"):
            stats["applications"]["skipped"] += 1
            continue
        source_hash = hash_application_row(raw)
        key = app_key(app["application_number"], app["funding_year"])
        existing_hash = stats["applicationHashes"].get(key)
        if existing_hash == source_hash and key in stats["applicationIds"]:
            stats["applications"]["unchanged"] += 1
            continue
        result = upsert_application(cur, app, insert_only=insert_only, source_hash=source_hash)
        if result.get("skipped"):
            if result.get("existing"):
                stats["applications"]["existing"] += 1
            else:
                stats["applications"]["skipped"] += 1
            continue
        if result.get("inserted"):
            stats["applications"]["inserted"] += 1
        else:
            stats["applications"]["updated"] += 1
        stats["applicationIds"][key] = result["id"]
        stats["applicationHashes"][key] = source_hash


def import_frns(cur: psycopg.Cursor, rows: List[Dict], stats: Dict, *, insert_only: bool = False):
    for raw in rows:
        source_hash = hash_frn_row(raw)
        frn_number = (raw.get("funding_request_number") or "").strip()
        existing = stats["frnHashes"].get(frn_number) if frn_number else None
        if existing == source_hash:
            stats["frns"]["unchanged"] += 1
            continue

        app_number = (raw.get("application_number") or "").strip()
        funding_year = _parse_funding_year(raw.get("funding_year"))
        key = app_key(app_number, funding_year)
        application_id = stats["applicationIds"].get(key)

        if not application_id:
            fallback = map_frn_row_to_application_fallback(raw)
            fb_hash = hash_application_row(raw)
            res = upsert_application(cur, fallback, insert_only=insert_only, source_hash=fb_hash)
            if not res.get("id"):
                stats["frns"]["skipped"] += 1
                continue
            application_id = res["id"]
            stats["applicationIds"][key] = application_id
            stats["applicationHashes"][key] = fb_hash
            if res.get("inserted"):
                stats["applications"]["inserted"] += 1
            elif res.get("existing"):
                stats["applications"]["existing"] += 1
            elif not res.get("skipped"):
                stats["applications"]["updated"] += 1

        frn = map_frn_row_to_frn(raw, application_id)
        res = upsert_frn(cur, frn, insert_only=insert_only, source_hash=source_hash)
        if res.get("skipped"):
            if res.get("existing"):
                stats["frns"]["existing"] += 1
            else:
                stats["frns"]["skipped"] += 1
            continue
        if res.get("inserted"):
            stats["frns"]["inserted"] += 1
        else:
            stats["frns"]["updated"] += 1
        if frn_number:
            stats["frnHashes"][frn_number] = source_hash
        if frn.get("fcdl_date"):
            stats["fcdlDates"][key] = frn["fcdl_date"]


def preload_application_ids(cur: psycopg.Cursor, stats: Dict) -> int:
    cur.execute("SELECT id, application_number, funding_year, usac_source_hash FROM applications")
    for row in cur.fetchall():
        app_id, app_no, fy, h = row
        key = app_key(app_no, fy)
        stats["applicationIds"][key] = app_id
        if h:
            stats["applicationHashes"][key] = h

    cur.execute("SELECT frn_number, usac_source_hash FROM frns")
    for row in cur.fetchall():
        frn_no, h = row
        if h and frn_no:
            stats["frnHashes"][frn_no] = h
    return len(stats["applicationIds"])


def apply_fcdl_dates(cur: psycopg.Cursor, fcdl_dates: Dict[str, Any]):
    for key, fcdl in fcdl_dates.items():
        app_no, fy = key.split("|", 1)
        cur.execute(
            "UPDATE applications SET fcdl_date = COALESCE(fcdl_date, %s::date), updated_at = NOW() "
            "WHERE application_number = %s AND funding_year = %s",
            [fcdl, app_no, int(fy)]
        )


def run_import_pass(cur: psycopg.Cursor, config: Dict, pass_def: Dict, stats: Dict) -> int:
    label = pass_def["label"]
    config["log"](f"Importing {label}…")
    total = 0
    iterator = (iterate_basic_info_pages if pass_def["type"] == "applications" else iterate_frn_pages)(
        config, pass_def.get("filters", {}), on_page=None
    )
    for page in iterator:
        if pass_def["type"] == "applications":
            import_applications(cur, page, stats, insert_only=pass_def.get("insertOnly", False))
        else:
            import_frns(cur, page, stats, insert_only=pass_def.get("insertOnly", False))
        total += len(page)
    config["log"](f"  {label}: processed {total} records")
    return total


def import_usac_data(options: Dict[str, Any] = None) -> Dict[str, Any]:
    options = options or {}
    config = resolve_config(options)
    started_at = time.time()
    effective = "full" if config["syncMode"] == "full" else ("skip" if config["syncMode"] == "skip" else ("full" if (options.get("existingApplicationCount") or 0) == 0 else "incremental"))

    log = config["log"]

    if effective == "skip":
        return {"state": config["state"], "syncMode": "skip", "skipped": True, "skippedReason": "sync_mode_skip",
                "elapsedMs": 0, "elapsedSec": 0, "passes": [],
                "applications": {"inserted":0,"updated":0,"skipped":0,"existing":0,"unchanged":0},
                "frns": {"inserted":0,"updated":0,"skipped":0,"existing":0,"unchanged":0},
                "totals": {"applications":0, "frns":0}}

    stats = {
        "state": config["state"],
        "syncMode": effective,
        "passes": [],
        "applications": {"inserted": 0, "updated": 0, "skipped": 0, "existing": 0, "unchanged": 0},
        "frns": {"inserted": 0, "updated": 0, "skipped": 0, "existing": 0, "unchanged": 0},
        "applicationIds": {},
        "applicationHashes": {},
        "frnHashes": {},
        "fcdlDates": {},
    }

    passes = [
        {"label": "California applications (Current)", "type": "applications", "filters": {"formVersion": "Current"}},
        {"label": "California FRNs (Current)", "type": "frns", "filters": {"formVersion": "Current"}},
    ]
    if config["includePending"]:
        passes += [
            {"label": "California applications (Original, Certified)", "type": "applications",
             "filters": {"formVersion": "Original", "applicationStatus": "Certified"}, "insertOnly": True},
            {"label": "California FRNs (Original, Pending)", "type": "frns",
             "filters": {"formVersion": "Original", "frnStatus": "Pending"}, "insertOnly": True},
        ]

    conn = psycopg.connect(os.environ["DATABASE_URL"])
    try:
        dataset_versions = fetch_dataset_versions() if config["checkDatasets"] else None

        if (config["checkDatasets"] and effective == "incremental" and options.get("lastSyncState")
                and not options.get("force") and dataset_versions
                and options["lastSyncState"].get("basic_info_rows_updated_at") == dataset_versions.get("basicInfoRowsUpdatedAt")
                and options["lastSyncState"].get("frn_status_rows_updated_at") == dataset_versions.get("frnStatusRowsUpdatedAt")):
            log("USAC Open Data unchanged since last sync — skipping import.")
            with conn.cursor() as cur:
                save_sync_state(conn, state=config["state"], mode="skipped", versions=dataset_versions,
                                applications={"unchanged": options["lastSyncState"].get("applications_unchanged", 0)},
                                frns={"unchanged": options["lastSyncState"].get("frns_unchanged", 0)},
                                skipped_reason="datasets_unchanged")
            conn.commit()
            return {"state": config["state"], "syncMode": "skipped", "skipped": True, "skippedReason": "datasets_unchanged",
                    "datasetVersions": dataset_versions, "elapsedMs": int((time.time()-started_at)*1000), "elapsedSec": 0,
                    "passes": [], "applications": {"inserted":0,"updated":0,"skipped":0,"existing":0,"unchanged":0},
                    "frns": {"inserted":0,"updated":0,"skipped":0,"existing":0,"unchanged":0}, "totals": {"applications":0,"frns":0}}

        log(f"Starting USAC Open Data {effective} sync for state={config['state']}" + (f" (funding_year >= {config['fundingYearMin']})" if config.get("fundingYearMin") else ""))

        with conn.cursor() as cur:
            conn.autocommit = False
            try:
                pre = preload_application_ids(cur, stats)
                if pre:
                    log(f"  Preloaded {pre} existing applications")

                for p in passes:
                    cnt = run_import_pass(cur, config, p, stats)
                    stats["passes"].append({"label": p["label"], "records": cnt})

                apply_fcdl_dates(cur, stats["fcdlDates"])

                save_sync_state(conn, state=config["state"], mode=effective, versions=dataset_versions,
                                applications=stats["applications"], frns=stats["frns"])
                conn.commit()
            except Exception:
                conn.rollback()
                raise

        elapsed = int((time.time() - started_at) * 1000)
        summary = {
            "state": stats["state"],
            "syncMode": effective,
            "datasetVersions": dataset_versions,
            "elapsedMs": elapsed,
            "elapsedSec": round(elapsed / 1000),
            "passes": stats["passes"],
            "applications": stats["applications"],
            "frns": stats["frns"],
            "totals": {
                "applications": stats["applications"]["inserted"] + stats["applications"]["updated"],
                "frns": stats["frns"]["inserted"] + stats["frns"]["updated"],
            },
        }
        log("USAC import complete:", json.dumps(summary, default=str, indent=2))
        return summary
    finally:
        conn.close()


# =============================================================================
# CLI (port of server/scripts/import-usac.js)
# =============================================================================
def parse_args(argv: List[str]) -> Dict[str, Any]:
    p = argparse.ArgumentParser(description="USAC E-Rate 471 California importer (Python + sodapy)")
    p.add_argument("--state")
    p.add_argument("--year-min", dest="fundingYearMin")
    p.add_argument("--year-max", dest="fundingYearMax")
    p.add_argument("--no-pending", dest="includePending", action="store_false", default=None)
    p.add_argument("--full", dest="syncMode", action="store_const", const="full")
    p.add_argument("--incremental", dest="syncMode", action="store_const", const="incremental")
    p.add_argument("--force", action="store_true")
    p.add_argument("--json", action="store_true", help="Output JSON summary (used by Node integration)")
    p.add_argument("--help", "-h", action="store_true")
    return vars(p.parse_args(argv))


def main():
    args = parse_args(sys.argv[1:])
    if args.get("help"):
        print("Usage: python server/scripts/import_usac.py [options]")
        sys.exit(0)

    if "DATABASE_URL" not in os.environ:
        print("DATABASE_URL is required", file=sys.stderr)
        sys.exit(1)

    try:
        with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*)::int FROM applications")
                existing = cur.fetchone()[0]
            sync_state = get_sync_state(conn)

        options = {k: v for k, v in args.items() if v is not None and k != "help"}
        options["existingApplicationCount"] = existing
        options["lastSyncState"] = sync_state
        if "force" not in options:
            options["force"] = False

        summary = import_usac_data(options)

        if args.get("json"):
            print(json.dumps(summary, default=str))
            sys.exit(0)

        if summary.get("skipped"):
            print(f"USAC sync skipped ({summary.get('skippedReason') or 'no changes'}).")
            sys.exit(0)

        apps = summary.get("applications", {})
        frns = summary.get("frns", {})
        print(
            f"USAC {summary.get('syncMode')} sync for {summary.get('state')}: "
            f"{apps.get('inserted',0)} new apps, {apps.get('updated',0)} updated, {apps.get('unchanged',0)} unchanged; "
            f"{frns.get('inserted',0)} new FRNs, {frns.get('updated',0)} updated, {frns.get('unchanged',0)} unchanged."
        )
        sys.exit(0)
    except Exception as e:
        print(f"USAC import failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
