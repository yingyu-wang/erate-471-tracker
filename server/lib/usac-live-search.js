const { query } = require('../db');
const { DATASETS, escapeSoql, fetchRows } = require('./usac-client');
const { persistSearchResults } = require('./usac-import');

const DEFAULT_LIMIT = Number(process.env.USAC_LIVE_SEARCH_LIMIT || 50);
const FRN_FETCH_LIMIT = Number(process.env.USAC_LIVE_SEARCH_FRN_LIMIT || 5000);

function classifySearchTerm(search) {
  const trimmed = search.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    return { kind: 'application_number', value: trimmed };
  }
  return { kind: 'entity', value: trimmed };
}

function buildBasicInfoSearchWhere(search, state, fundingYear) {
  const classified = classifySearchTerm(search);
  if (!classified) return null;

  const clauses = [
    `org_state='${escapeSoql(state)}'`,
    "form_version='Current'",
  ];

  if (fundingYear) {
    clauses.push(`funding_year='${escapeSoql(String(fundingYear))}'`);
  }

  if (classified.kind === 'application_number') {
    const digits = escapeSoql(classified.value);
    clauses.push(
      `(application_number like '%${digits}%'`
      + ` OR epc_organization_id='${digits}'`
      + ` OR fcc_registration_number='${digits}')`
    );
  } else {
    const term = escapeSoql(classified.value.toUpperCase());
    clauses.push(`upper(organization_name) like '%${term}%'`);
  }

  return clauses.join(' AND ');
}

function buildFrnSearchWhere(appNumbers, state, fundingYear) {
  if (!appNumbers.length) return null;

  const clauses = [
    `state='${escapeSoql(state)}'`,
    "form_version='Current'",
  ];

  if (fundingYear) {
    clauses.push(`funding_year='${escapeSoql(String(fundingYear))}'`);
  }

  const inList = appNumbers.map((n) => `'${escapeSoql(n)}'`).join(',');
  clauses.push(`application_number in (${inList})`);
  return clauses.join(' AND ');
}

function buildApplicationPairWhere(basicRows, startIndex = 1) {
  const params = [];
  const conditions = basicRows.map((row, index) => {
    const appNumber = row.application_number?.trim();
    const fundingYear = parseInt(row.funding_year, 10);
    const base = startIndex + index * 2;
    params.push(appNumber, fundingYear);
    return `(a.application_number = $${base} AND a.funding_year = $${base + 1})`;
  });

  return { conditions: conditions.join(' OR '), params };
}

async function queryPersistedApplications(basicRows, { status, fundingYear } = {}) {
  if (!basicRows.length) return [];

  const { conditions, params } = buildApplicationPairWhere(basicRows);
  const filters = [conditions];
  let paramIndex = params.length + 1;

  if (fundingYear) {
    filters.push(`a.funding_year = $${paramIndex++}`);
    params.push(parseInt(fundingYear, 10));
  }
  if (status) {
    filters.push(`a.application_status = $${paramIndex++}`);
    params.push(status);
  }

  const result = await query(
    `SELECT a.*,
            COUNT(f.id)::int AS frn_count,
            COALESCE(SUM(f.pre_discount_amount), 0)::float AS total_requested,
            COALESCE(SUM(f.committed_amount), 0)::float AS total_committed
     FROM applications a
     LEFT JOIN frns f ON f.application_id = a.id
     WHERE ${filters.join(' AND ')}
     GROUP BY a.id
     ORDER BY a.funding_year DESC, a.application_number DESC`,
    params
  );

  return result.rows;
}

async function searchUsacApplications({
  search,
  fundingYear = null,
  status = null,
  state = null,
  limit = DEFAULT_LIMIT,
} = {}) {
  const trimmed = search?.trim();
  if (!trimmed || trimmed.length < 2) {
    const err = new Error('Search must be at least 2 characters for live USAC lookup');
    err.status = 400;
    throw err;
  }

  const classified = classifySearchTerm(trimmed);
  if (classified.kind === 'entity' && trimmed.length < 3) {
    const err = new Error('Entity name search must be at least 3 characters');
    err.status = 400;
    throw err;
  }

  const baseUrl = process.env.USAC_API_BASE || 'https://opendata.usac.org';
  const importState = state || process.env.USAC_IMPORT_STATE || 'CA';
  const where = buildBasicInfoSearchWhere(trimmed, importState, fundingYear);

  const basicRows = await fetchRows(baseUrl, DATASETS.basicInfo, {
    where,
    order: 'funding_year DESC, application_number DESC',
    limit,
  });

  if (!basicRows.length) {
    return {
      source: 'usac_live',
      search: trimmed,
      fetched_at: new Date().toISOString(),
      usac_matches: 0,
      results: [],
    };
  }

  const appNumbers = [...new Set(
    basicRows.map((row) => row.application_number?.trim()).filter(Boolean)
  )];

  const frnWhere = buildFrnSearchWhere(appNumbers, importState, fundingYear);
  const frnRows = frnWhere
    ? await fetchRows(baseUrl, DATASETS.frnStatus, {
      where: frnWhere,
      order: 'funding_request_number',
      limit: FRN_FETCH_LIMIT,
    })
    : [];

  await persistSearchResults(basicRows, frnRows);

  const results = await queryPersistedApplications(basicRows, { status, fundingYear });

  return {
    source: 'usac_live',
    search: trimmed,
    fetched_at: new Date().toISOString(),
    usac_matches: basicRows.length,
    results,
  };
}

async function refreshApplicationFromUsac(applicationNumber, fundingYear, state = null) {
  const importState = state || process.env.USAC_IMPORT_STATE || 'CA';
  const baseUrl = process.env.USAC_API_BASE || 'https://opendata.usac.org';
  const appNo = escapeSoql(applicationNumber.trim());
  const year = escapeSoql(String(fundingYear));

  const basicWhere = [
    `org_state='${escapeSoql(importState)}'`,
    "form_version='Current'",
    `application_number='${appNo}'`,
    `funding_year='${year}'`,
  ].join(' AND ');

  const basicRows = await fetchRows(baseUrl, DATASETS.basicInfo, {
    where: basicWhere,
    limit: 5,
  });

  const frnWhere = [
    `state='${escapeSoql(importState)}'`,
    "form_version='Current'",
    `application_number='${appNo}'`,
    `funding_year='${year}'`,
  ].join(' AND ');

  const frnRows = await fetchRows(baseUrl, DATASETS.frnStatus, {
    where: frnWhere,
    limit: FRN_FETCH_LIMIT,
  });

  if (basicRows.length || frnRows.length) {
    await persistSearchResults(basicRows, frnRows);
  }

  return { basicRows: basicRows.length, frnRows: frnRows.length };
}

module.exports = {
  classifySearchTerm,
  searchUsacApplications,
  refreshApplicationFromUsac,
};