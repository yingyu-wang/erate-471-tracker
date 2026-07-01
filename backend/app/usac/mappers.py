"""Map USAC Open Data rows to tracker application/FRN records."""

import hashlib
import json
from datetime import date
from typing import Any

from app.models import ApplicationStatus, FrnStatus

APPLICATION_STATUS_MAP = {
    "Certified": ApplicationStatus.CERTIFIED,
    "Committed": ApplicationStatus.FCDL_APPROVED,
    "Pending": ApplicationStatus.UNDER_REVIEW,
    "Denied": ApplicationStatus.FCDL_DENIED,
    "Cancelled": ApplicationStatus.CANCELLED,
}

FRN_STATUS_MAP = {
    "Funded": FrnStatus.FUNDED,
    "Pending": FrnStatus.PENDING,
    "Denied": FrnStatus.DENIED,
    "Cancelled": FrnStatus.CANCELLED,
    "As yet unfunded": FrnStatus.PENDING,
    "Partially Funded": FrnStatus.PARTIAL,
}


def _stable_hash(fields: dict[str, Any]) -> str:
    payload = json.dumps(fields, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


def parse_funding_year(value: Any) -> int | None:
    try:
        year = int(value)
        return year if 1997 <= year <= 2100 else None
    except (TypeError, ValueError):
        return None


def parse_date(value: Any) -> date | None:
    if not value:
        return None
    s = str(value)
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def parse_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_discount(value: Any) -> float | None:
    num = parse_number(value)
    if num is None:
        return None
    return round(num * 100, 2) if num <= 1 else round(num, 2)


def map_application_status(name: str | None) -> ApplicationStatus:
    if not name:
        return ApplicationStatus.UNDER_REVIEW
    return APPLICATION_STATUS_MAP.get(name, ApplicationStatus.UNDER_REVIEW)


def map_frn_status(name: str | None) -> FrnStatus:
    if not name:
        return FrnStatus.PENDING
    return FRN_STATUS_MAP.get(name, FrnStatus.PENDING)


def map_basic_info_row(row: dict[str, Any]) -> dict[str, Any] | None:
    app_number = (row.get("application_number") or "").strip()
    funding_year = parse_funding_year(row.get("funding_year"))
    if not app_number or funding_year is None:
        return None

    contact_name = " ".join(
        p for p in [(row.get("cnct_first_name") or "").strip(), (row.get("cnct_last_name") or "").strip()] if p
    ) or None

    discount = parse_discount(row.get("c1_discount") or row.get("c2_discount"))
    total_requested = parse_number(row.get("funding_request_amount") or row.get("pre_discount_eligible_amount"))

    mapped = {
        "application_number": app_number,
        "funding_year": funding_year,
        "ben": (row.get("epc_organization_id") or row.get("fcc_registration_number") or "").strip() or "unknown",
        "organization_name": (row.get("organization_name") or "Unknown").strip(),
        "entity_type": (row.get("organization_entity_type_name") or "").strip() or None,
        "status": map_application_status(row.get("form_471_status_name")),
        "discount_rate": discount,
        "total_requested": total_requested,
        "contact_name": contact_name,
        "contact_email": (row.get("cnct_email") or "").strip() or None,
        "certified_date": parse_date(row.get("certified_datetime")),
        "usac_file_url": (row.get("file_url") or "").strip() or None,
        "notes": f"USAC: {row.get('nickname')}" if row.get("nickname") else "Imported from USAC Open Data",
    }
    mapped["usac_source_hash"] = _stable_hash(
        {k: mapped[k] for k in ("application_number", "funding_year", "organization_name", "status", "usac_file_url")}
    )
    return mapped


def map_frn_row(row: dict[str, Any]) -> dict[str, Any] | None:
    frn_number = (row.get("funding_request_number") or "").strip()
    app_number = (row.get("application_number") or "").strip()
    funding_year = parse_funding_year(row.get("funding_year"))
    if not frn_number or not app_number or funding_year is None:
        return None

    mapped = {
        "application_number": app_number,
        "funding_year": funding_year,
        "frn_number": frn_number,
        "service_type": (row.get("form_471_service_type_name") or "Unknown").strip(),
        "status": map_frn_status(row.get("form_471_frn_status_name")),
        "requested_amount": parse_number(row.get("total_pre_discount_costs")),
        "approved_amount": parse_number(row.get("funding_commitment_request")),
    }
    mapped["usac_source_hash"] = _stable_hash(
        {k: mapped[k] for k in ("frn_number", "service_type", "status", "requested_amount", "approved_amount")}
    )
    return mapped