const DEFAULT_BASE = 'https://opendata.usac.org';

const DATASETS = {
  basicInfo: '9s6i-myen',
  frnStatus: 'qdmp-ygft',
};

function escapeSoql(value) {
  return String(value).replace(/'/g, "''");
}

function buildWhere(filters) {
  const clauses = [];

  if (filters.state) {
    clauses.push(`org_state='${filters.state}'`);
  }
  if (filters.billedEntityState) {
    clauses.push(`state='${filters.billedEntityState}'`);
  }
  if (filters.formVersion) {
    clauses.push(`form_version='${filters.formVersion}'`);
  }
  if (filters.applicationStatus) {
    clauses.push(`form_471_status_name='${filters.applicationStatus}'`);
  }
  if (filters.frnStatus) {
    clauses.push(`form_471_frn_status_name='${filters.frnStatus}'`);
  }
  if (filters.fundingYearMin) {
    clauses.push(`funding_year >= '${filters.fundingYearMin}'`);
  }
  if (filters.fundingYearMax) {
    clauses.push(`funding_year <= '${filters.fundingYearMax}'`);
  }

  return clauses.length ? clauses.join(' AND ') : null;
}

async function fetchDatasetMetadata(baseUrl, datasetId) {
  const url = `${baseUrl}/api/views/${datasetId}.json`;
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`USAC metadata error ${res.status} for ${datasetId}: ${body.slice(0, 300)}`);
  }

  const meta = await res.json();
  return {
    id: meta.id,
    rowsUpdatedAt: meta.rowsUpdatedAt ?? null,
    viewLastModified: meta.viewLastModified ?? null,
  };
}

async function fetchPage(baseUrl, datasetId, { where, order, limit, offset }) {
  const params = new URLSearchParams();
  params.set('$limit', String(limit));
  params.set('$offset', String(offset));
  if (where) params.set('$where', where);
  if (order) params.set('$order', order);

  const url = `${baseUrl}/resource/${datasetId}.json?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`USAC API error ${res.status} for ${datasetId}: ${body.slice(0, 300)}`);
  }

  return res.json();
}

async function* paginateDataset(baseUrl, datasetId, options = {}) {
  const {
    where,
    order = 'application_number',
    pageSize = 50000,
    onPage,
  } = options;

  let offset = 0;

  while (true) {
    const rows = await fetchPage(baseUrl, datasetId, { where, order, limit: pageSize, offset });
    if (!rows.length) break;

    if (onPage) onPage({ offset, count: rows.length });
    yield rows;

    if (rows.length < pageSize) break;
    offset += pageSize;
  }
}

function iterateBasicInfoPages(config, filters, onPage) {
  const where = buildWhere({
    state: config.state,
    formVersion: filters.formVersion,
    applicationStatus: filters.applicationStatus,
    fundingYearMin: config.fundingYearMin,
    fundingYearMax: config.fundingYearMax,
  });

  return paginateDataset(config.baseUrl, DATASETS.basicInfo, {
    where,
    order: 'application_number',
    pageSize: config.pageSize,
    onPage,
  });
}

function iterateFrnPages(config, filters, onPage) {
  const where = buildWhere({
    billedEntityState: config.state,
    formVersion: filters.formVersion,
    frnStatus: filters.frnStatus,
    fundingYearMin: config.fundingYearMin,
    fundingYearMax: config.fundingYearMax,
  });

  return paginateDataset(config.baseUrl, DATASETS.frnStatus, {
    where,
    order: 'funding_request_number',
    pageSize: config.pageSize,
    onPage,
  });
}

async function fetchRows(baseUrl, datasetId, { where, order, limit = 100, offset = 0 } = {}) {
  return fetchPage(baseUrl, datasetId, { where, order, limit, offset });
}

module.exports = {
  DATASETS,
  buildWhere,
  escapeSoql,
  fetchDatasetMetadata,
  fetchRows,
  iterateBasicInfoPages,
  iterateFrnPages,
  paginateDataset,
};