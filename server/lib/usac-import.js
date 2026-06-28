const { getClient } = require('../db');
const { iterateBasicInfoPages, iterateFrnPages } = require('./usac-client');
const { hashApplicationRow, hashFrnRow } = require('./usac-hash');
const {
  mapBasicInfoToApplication,
  mapFrnRowToApplicationFallback,
  mapFrnRowToFrn,
} = require('./usac-mappers');
const {
  fetchDatasetVersions,
  saveSyncState,
} = require('./usac-sync-state');

const APPLICATION_UPSERT = `
  INSERT INTO applications (
    application_number, funding_year, ben, entity_name, entity_type,
    application_status, certified_date, fcdl_date,
    contact_name, contact_email, contact_phone, notes, usac_source_hash
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  ON CONFLICT (application_number, funding_year) DO UPDATE SET
    ben = EXCLUDED.ben,
    entity_name = EXCLUDED.entity_name,
    entity_type = EXCLUDED.entity_type,
    application_status = EXCLUDED.application_status,
    certified_date = COALESCE(EXCLUDED.certified_date, applications.certified_date),
    fcdl_date = COALESCE(EXCLUDED.fcdl_date, applications.fcdl_date),
    contact_name = COALESCE(EXCLUDED.contact_name, applications.contact_name),
    contact_email = COALESCE(EXCLUDED.contact_email, applications.contact_email),
    contact_phone = COALESCE(EXCLUDED.contact_phone, applications.contact_phone),
    notes = EXCLUDED.notes,
    usac_source_hash = EXCLUDED.usac_source_hash,
    updated_at = NOW()
  RETURNING id, (xmax = 0) AS inserted
`;

const FRN_UPSERT = `
  INSERT INTO frns (
    application_id, frn_number, category, service_type, function_type,
    spin, service_provider_name, pre_discount_amount, discount_percentage,
    frn_status, service_start_date, invoicing_deadline,
    committed_amount, disbursed_amount, pia_status, form_486_status, form_473_status, notes,
    usac_source_hash
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
  ON CONFLICT (frn_number) DO UPDATE SET
    application_id = EXCLUDED.application_id,
    category = EXCLUDED.category,
    service_type = EXCLUDED.service_type,
    function_type = EXCLUDED.function_type,
    service_provider_name = EXCLUDED.service_provider_name,
    pre_discount_amount = EXCLUDED.pre_discount_amount,
    discount_percentage = EXCLUDED.discount_percentage,
    frn_status = EXCLUDED.frn_status,
    service_start_date = COALESCE(EXCLUDED.service_start_date, frns.service_start_date),
    invoicing_deadline = COALESCE(EXCLUDED.invoicing_deadline, frns.invoicing_deadline),
    committed_amount = EXCLUDED.committed_amount,
    disbursed_amount = EXCLUDED.disbursed_amount,
    pia_status = EXCLUDED.pia_status,
    form_486_status = EXCLUDED.form_486_status,
    form_473_status = EXCLUDED.form_473_status,
    notes = EXCLUDED.notes,
    usac_source_hash = EXCLUDED.usac_source_hash,
    updated_at = NOW()
  RETURNING id, (xmax = 0) AS inserted
`;

function appKey(applicationNumber, fundingYear) {
  return `${applicationNumber}|${fundingYear}`;
}

function resolveSyncMode(options = {}) {
  const raw = options.syncMode || process.env.USAC_SYNC_MODE || 'auto';
  if (raw === 'full' || raw === 'incremental' || raw === 'skip') return raw;
  return 'auto';
}

function resolveIncrementalYearMin(config, syncMode, options = {}) {
  if (options.fundingYearMin || process.env.USAC_IMPORT_FUNDING_YEAR_MIN) {
    return config.fundingYearMin;
  }
  if (syncMode !== 'incremental') return config.fundingYearMin;

  const windowYears = Number(
    options.syncYearWindow || process.env.USAC_SYNC_YEAR_WINDOW || 2
  );
  const currentFundingYear = new Date().getFullYear();
  const minYear = currentFundingYear - windowYears + 1;
  return String(minYear);
}

function resolveConfig(options = {}) {
  const syncMode = resolveSyncMode(options);
  const fundingYearMin = options.fundingYearMin || process.env.USAC_IMPORT_FUNDING_YEAR_MIN || null;

  const config = {
    baseUrl: process.env.USAC_API_BASE || 'https://opendata.usac.org',
    state: options.state || process.env.USAC_IMPORT_STATE || 'CA',
    pageSize: Number(options.pageSize || process.env.USAC_IMPORT_PAGE_SIZE || 50000),
    fundingYearMin,
    fundingYearMax: options.fundingYearMax || process.env.USAC_IMPORT_FUNDING_YEAR_MAX || null,
    includePending: options.includePending !== false
      && process.env.USAC_IMPORT_INCLUDE_PENDING !== 'false',
    batchSize: Number(options.batchSize || 200),
    syncMode,
    checkDatasets: options.checkDatasets !== false
      && process.env.USAC_SYNC_CHECK_DATASETS !== 'false',
    log: options.log || console.log,
  };

  config.fundingYearMin = resolveIncrementalYearMin(config, syncMode, options);
  return config;
}

const APPLICATION_INSERT_ONLY = `
  INSERT INTO applications (
    application_number, funding_year, ben, entity_name, entity_type,
    application_status, certified_date, fcdl_date,
    contact_name, contact_email, contact_phone, notes, usac_source_hash
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  ON CONFLICT (application_number, funding_year) DO NOTHING
  RETURNING id, true AS inserted
`;

async function upsertApplication(client, app, { insertOnly = false, sourceHash = null } = {}) {
  if (!app.application_number || !app.funding_year || !app.ben || !app.entity_name) {
    return { skipped: true };
  }

  const values = [
    app.application_number, app.funding_year, app.ben, app.entity_name, app.entity_type,
    app.application_status, app.certified_date, app.fcdl_date,
    app.contact_name, app.contact_email, app.contact_phone, app.notes, sourceHash,
  ];

  const sql = insertOnly ? APPLICATION_INSERT_ONLY : APPLICATION_UPSERT;
  const result = await client.query(sql, values);
  if (!result.rows.length) {
    const existing = await client.query(
      'SELECT id FROM applications WHERE application_number = $1 AND funding_year = $2',
      [app.application_number, app.funding_year]
    );
    if (existing.rows.length) {
      return { id: existing.rows[0].id, skipped: true, existing: true };
    }
    return { skipped: true };
  }
  const row = result.rows[0];

  if (row.inserted) {
    await client.query(
      `INSERT INTO status_history (record_type, record_id, old_status, new_status, notes)
       VALUES ('application', $1, NULL, $2, 'Imported from USAC Open Data')`,
      [row.id, app.application_status]
    );
    return { id: row.id, inserted: true };
  }

  return { id: row.id, inserted: false };
}

const FRN_INSERT_ONLY = `
  INSERT INTO frns (
    application_id, frn_number, category, service_type, function_type,
    spin, service_provider_name, pre_discount_amount, discount_percentage,
    frn_status, service_start_date, invoicing_deadline,
    committed_amount, disbursed_amount, pia_status, form_486_status, form_473_status, notes,
    usac_source_hash
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
  ON CONFLICT (frn_number) DO NOTHING
  RETURNING id, true AS inserted
`;

async function upsertFrn(client, frn, { insertOnly = false, sourceHash = null } = {}) {
  if (!frn.application_id || !frn.frn_number) {
    return { skipped: true };
  }

  const values = [
    frn.application_id, frn.frn_number, frn.category, frn.service_type, frn.function_type,
    frn.spin, frn.service_provider_name, frn.pre_discount_amount, frn.discount_percentage,
    frn.frn_status, frn.service_start_date, frn.invoicing_deadline,
    frn.committed_amount, frn.disbursed_amount, frn.pia_status, frn.form_486_status,
    frn.form_473_status, frn.notes, sourceHash,
  ];

  const sql = insertOnly ? FRN_INSERT_ONLY : FRN_UPSERT;
  const result = await client.query(sql, values);
  if (!result.rows.length) {
    return { skipped: true, existing: true };
  }
  const row = result.rows[0];

  if (row.inserted) {
    await client.query(
      `INSERT INTO status_history (record_type, record_id, old_status, new_status, notes)
       VALUES ('frn', $1, NULL, $2, 'Imported from USAC Open Data')`,
      [row.id, frn.frn_status]
    );
    return { id: row.id, inserted: true };
  }

  return { id: row.id, inserted: false };
}

async function importApplications(client, rows, stats, { insertOnly = false } = {}) {
  for (const raw of rows) {
    const app = mapBasicInfoToApplication(raw);
    if (!app.application_number || !app.funding_year) {
      stats.applications.skipped += 1;
      continue;
    }

    const sourceHash = hashApplicationRow(raw);
    const key = appKey(app.application_number, app.funding_year);
    const existingHash = stats.applicationHashes.get(key);

    if (existingHash === sourceHash && stats.applicationIds.has(key)) {
      stats.applications.unchanged += 1;
      continue;
    }
    const result = await upsertApplication(client, app, { insertOnly, sourceHash });
    if (result.skipped) {
      if (result.existing) stats.applications.existing += 1;
      else stats.applications.skipped += 1;
      continue;
    }
    if (result.inserted) stats.applications.inserted += 1;
    else stats.applications.updated += 1;
    stats.applicationIds.set(appKey(app.application_number, app.funding_year), result.id);
    stats.applicationHashes.set(appKey(app.application_number, app.funding_year), sourceHash);
  }
}

async function importFrns(client, rows, stats, { insertOnly = false } = {}) {
  for (const raw of rows) {
    const sourceHash = hashFrnRow(raw);
    const frnNumber = raw.funding_request_number?.trim();
    const existingFrnHash = frnNumber ? stats.frnHashes.get(frnNumber) : null;

    if (existingFrnHash === sourceHash) {
      stats.frns.unchanged += 1;
      continue;
    }

    const appNumber = raw.application_number?.trim();
    const fundingYear = parseInt(raw.funding_year, 10);
    const key = appKey(appNumber, fundingYear);
    let applicationId = stats.applicationIds.get(key);

    if (!applicationId) {
      const fallback = mapFrnRowToApplicationFallback(raw);
      const fallbackHash = hashApplicationRow(raw);
      const appResult = await upsertApplication(client, fallback, {
        insertOnly,
        sourceHash: fallbackHash,
      });
      if (!appResult.id) {
        stats.frns.skipped += 1;
        continue;
      }
      applicationId = appResult.id;
      stats.applicationIds.set(key, applicationId);
      stats.applicationHashes.set(key, fallbackHash);
      if (appResult.inserted) stats.applications.inserted += 1;
      else if (appResult.existing) stats.applications.existing += 1;
      else if (!appResult.skipped) stats.applications.updated += 1;
    }

    const frn = mapFrnRowToFrn(raw, applicationId);
    const result = await upsertFrn(client, frn, { insertOnly, sourceHash });
    if (result.skipped) {
      if (result.existing) stats.frns.existing += 1;
      else stats.frns.skipped += 1;
      continue;
    }
    if (result.inserted) stats.frns.inserted += 1;
    else stats.frns.updated += 1;
    if (frnNumber) stats.frnHashes.set(frnNumber, sourceHash);

    if (frn.fcdl_date) {
      stats.fcdlDates.set(key, frn.fcdl_date);
    }
  }
}

async function preloadApplicationIds(client, stats) {
  const [apps, frns] = await Promise.all([
    client.query(
      'SELECT id, application_number, funding_year, usac_source_hash FROM applications'
    ),
    client.query('SELECT frn_number, usac_source_hash FROM frns'),
  ]);

  for (const row of apps.rows) {
    const key = appKey(row.application_number, row.funding_year);
    stats.applicationIds.set(key, row.id);
    if (row.usac_source_hash) stats.applicationHashes.set(key, row.usac_source_hash);
  }

  for (const row of frns.rows) {
    if (row.usac_source_hash) stats.frnHashes.set(row.frn_number, row.usac_source_hash);
  }

  return apps.rows.length;
}

async function applyFcdlDates(client, fcdlDates) {
  for (const [key, fcdlDate] of fcdlDates) {
    const [applicationNumber, fundingYear] = key.split('|');
    await client.query(
      `UPDATE applications
       SET fcdl_date = COALESCE(fcdl_date, $3::date), updated_at = NOW()
       WHERE application_number = $1 AND funding_year = $2`,
      [applicationNumber, Number(fundingYear), fcdlDate]
    );
  }
}

async function runImportPass(client, config, pass, stats) {
  config.log(`Importing ${pass.label}…`);

  let total = 0;
  const onPage = ({ offset, count }) => {
    config.log(`  ${pass.label}: fetched offset ${offset} (${count} rows)`);
  };

  const iterator = pass.type === 'applications'
    ? iterateBasicInfoPages(config, pass.filters, onPage)
    : iterateFrnPages(config, pass.filters, onPage);

  for await (const page of iterator) {
    if (pass.type === 'applications') {
      await importApplications(client, page, stats, { insertOnly: pass.insertOnly });
    } else {
      await importFrns(client, page, stats, { insertOnly: pass.insertOnly });
    }
    total += page.length;
  }

  config.log(`  ${pass.label}: processed ${total} records`);
  return total;
}

async function importUsacData(options = {}) {
  const config = resolveConfig(options);
  const startedAt = Date.now();
  const effectiveMode = config.syncMode === 'auto'
    ? (options.existingApplicationCount > 0 ? 'incremental' : 'full')
    : config.syncMode;

  if (effectiveMode === 'skip') {
    return {
      state: config.state,
      syncMode: 'skip',
      skipped: true,
      skippedReason: 'sync_mode_skip',
      elapsedMs: 0,
      elapsedSec: 0,
      passes: [],
      applications: { inserted: 0, updated: 0, skipped: 0, existing: 0, unchanged: 0 },
      frns: { inserted: 0, updated: 0, skipped: 0, existing: 0, unchanged: 0 },
      totals: { applications: 0, frns: 0 },
    };
  }

  const stats = {
    state: config.state,
    syncMode: effectiveMode,
    passes: [],
    applications: { inserted: 0, updated: 0, skipped: 0, existing: 0, unchanged: 0 },
    frns: { inserted: 0, updated: 0, skipped: 0, existing: 0, unchanged: 0 },
    applicationIds: new Map(),
    applicationHashes: new Map(),
    frnHashes: new Map(),
    fcdlDates: new Map(),
  };

  const passes = [
    {
      label: `California applications (Current)`,
      type: 'applications',
      filters: { formVersion: 'Current' },
    },
    {
      label: `California FRNs (Current)`,
      type: 'frns',
      filters: { formVersion: 'Current' },
    },
  ];

  if (config.includePending) {
    passes.push(
      {
        label: `California applications (Original, Certified)`,
        type: 'applications',
        filters: { formVersion: 'Original', applicationStatus: 'Certified' },
        insertOnly: true,
      },
      {
        label: `California FRNs (Original, Pending)`,
        type: 'frns',
        filters: { formVersion: 'Original', frnStatus: 'Pending' },
        insertOnly: true,
      }
    );
  }

  const client = await getClient();

  try {
    const datasetVersions = config.checkDatasets
      ? await fetchDatasetVersions(config.baseUrl)
      : null;

    if (
      config.checkDatasets
      && effectiveMode === 'incremental'
      && options.lastSyncState
      && !options.force
      && datasetVersions
      && options.lastSyncState.basic_info_rows_updated_at === datasetVersions.basicInfoRowsUpdatedAt
      && options.lastSyncState.frn_status_rows_updated_at === datasetVersions.frnStatusRowsUpdatedAt
    ) {
      config.log('USAC Open Data unchanged since last sync — skipping import.');
      await saveSyncState(client, {
        state: config.state,
        mode: 'skipped',
        versions: datasetVersions,
        applications: { unchanged: options.lastSyncState.applications_unchanged ?? 0 },
        frns: { unchanged: options.lastSyncState.frns_unchanged ?? 0 },
        skippedReason: 'datasets_unchanged',
      });

      return {
        state: config.state,
        syncMode: 'skipped',
        skipped: true,
        skippedReason: 'datasets_unchanged',
        datasetVersions,
        elapsedMs: Date.now() - startedAt,
        elapsedSec: 0,
        passes: [],
        applications: { inserted: 0, updated: 0, skipped: 0, existing: 0, unchanged: 0 },
        frns: { inserted: 0, updated: 0, skipped: 0, existing: 0, unchanged: 0 },
        totals: { applications: 0, frns: 0 },
      };
    }

    config.log(
      `Starting USAC Open Data ${effectiveMode} sync for state=${config.state}`
      + (config.fundingYearMin ? ` (funding_year >= ${config.fundingYearMin})` : '')
    );

    await client.query('BEGIN');

    const preloaded = await preloadApplicationIds(client, stats);
    if (preloaded) config.log(`  Preloaded ${preloaded} existing applications`);

    for (const pass of passes) {
      const count = await runImportPass(client, config, pass, stats);
      stats.passes.push({ label: pass.label, records: count });
    }

    await applyFcdlDates(client, stats.fcdlDates);

    await saveSyncState(client, {
      state: config.state,
      mode: effectiveMode,
      versions: datasetVersions,
      applications: stats.applications,
      frns: stats.frns,
    });

    await client.query('COMMIT');

    const elapsedMs = Date.now() - startedAt;
    const summary = {
      state: stats.state,
      syncMode: effectiveMode,
      datasetVersions,
      elapsedMs,
      elapsedSec: Math.round(elapsedMs / 1000),
      passes: stats.passes,
      applications: stats.applications,
      frns: stats.frns,
      totals: {
        applications: stats.applications.inserted + stats.applications.updated,
        frns: stats.frns.inserted + stats.frns.updated,
      },
    };

    config.log('USAC import complete:', JSON.stringify(summary, null, 2));
    return summary;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function persistSearchResults(basicRows, frnRows) {
  if (!basicRows.length && !frnRows.length) return;

  const client = await getClient();
  const stats = {
    applications: { inserted: 0, updated: 0, skipped: 0, existing: 0, unchanged: 0 },
    frns: { inserted: 0, updated: 0, skipped: 0, existing: 0, unchanged: 0 },
    applicationIds: new Map(),
    applicationHashes: new Map(),
    frnHashes: new Map(),
    fcdlDates: new Map(),
  };

  try {
    await client.query('BEGIN');
    await preloadApplicationIds(client, stats);
    if (basicRows.length) {
      await importApplications(client, basicRows, stats);
    }
    if (frnRows.length) {
      await importFrns(client, frnRows, stats);
      await applyFcdlDates(client, stats.fcdlDates);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { importUsacData, resolveConfig, persistSearchResults };