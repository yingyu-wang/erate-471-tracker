"""Socrata / USAC Open Data API client."""

import os
from typing import Any, Iterator

from sodapy import Socrata

DATASETS = {
    "basic_info": "9s6i-myen",
    "frn_status": "qdmp-ygft",
}

DOMAIN = os.getenv("USAC_API_BASE", "https://opendata.usac.org").replace("https://", "").replace("http://", "").rstrip("/")


def _escape_soql(value: str) -> str:
    return value.replace("'", "''")


def build_where(**filters: str | None) -> str | None:
    clauses: list[str] = []
    if filters.get("state"):
        clauses.append(f"org_state='{_escape_soql(filters['state'])}'")
    if filters.get("billed_entity_state"):
        clauses.append(f"state='{_escape_soql(filters['billed_entity_state'])}'")
    if filters.get("form_version"):
        clauses.append(f"form_version='{_escape_soql(filters['form_version'])}'")
    if filters.get("application_status"):
        clauses.append(f"form_471_status_name='{_escape_soql(filters['application_status'])}'")
    return " AND ".join(clauses) if clauses else None


def get_client() -> Socrata:
    return Socrata(DOMAIN, None, timeout=120)


def fetch_dataset_versions() -> dict[str, int | None]:
    with get_client() as client:
        basic = client.get_metadata(DATASETS["basic_info"]) or {}
        frn = client.get_metadata(DATASETS["frn_status"]) or {}
    return {
        "basic_info_rows_updated_at": basic.get("rowsUpdatedAt"),
        "frn_status_rows_updated_at": frn.get("rowsUpdatedAt"),
    }


def iterate_dataset(
    dataset_key: str,
    *,
    where: str | None = None,
    order: str = "application_number",
    page_size: int = 10000,
) -> Iterator[list[dict[str, Any]]]:
    """Yield pages of rows from a USAC dataset."""
    dataset_id = DATASETS[dataset_key]
    batch: list[dict[str, Any]] = []
    with get_client() as client:
        for row in client.get_all(dataset_id, where=where, order=order):
            batch.append(row)
            if len(batch) >= page_size:
                yield batch
                batch = []
    if batch:
        yield batch