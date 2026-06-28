const { query } = require('../db');
const { DATASETS, fetchDatasetMetadata } = require('./usac-client');

async function getSyncState() {
  const result = await query('SELECT * FROM usac_sync_state WHERE id = 1');
  return result.rows[0] || null;
}

async function fetchDatasetVersions(baseUrl) {
  const [basicInfo, frnStatus] = await Promise.all([
    fetchDatasetMetadata(baseUrl, DATASETS.basicInfo),
    fetchDatasetMetadata(baseUrl, DATASETS.frnStatus),
  ]);

  return {
    basicInfoRowsUpdatedAt: basicInfo.rowsUpdatedAt,
    frnStatusRowsUpdatedAt: frnStatus.rowsUpdatedAt,
  };
}

function hoursSinceSync(syncState) {
  if (!syncState?.last_sync_at) return null;
  const ageMs = Date.now() - new Date(syncState.last_sync_at).getTime();
  return ageMs / (1000 * 60 * 60);
}

function isSyncWithinMinInterval(syncState, minIntervalHours = 24) {
  const hours = hoursSinceSync(syncState);
  if (hours === null) return false;
  return hours < minIntervalHours;
}

function datasetsChangedSinceLastSync(syncState, versions) {
  if (!syncState?.last_sync_at) return true;
  if (!syncState.basic_info_rows_updated_at || !syncState.frn_status_rows_updated_at) {
    return true;
  }

  return (
    syncState.basic_info_rows_updated_at !== versions.basicInfoRowsUpdatedAt
    || syncState.frn_status_rows_updated_at !== versions.frnStatusRowsUpdatedAt
  );
}

async function saveSyncState(client, {
  state,
  mode,
  versions,
  applications,
  frns,
  skippedReason = null,
}) {
  await client.query(
    `INSERT INTO usac_sync_state (
      id, state, last_sync_at, last_sync_mode,
      basic_info_rows_updated_at, frn_status_rows_updated_at,
      applications_inserted, applications_updated, applications_unchanged,
      frns_inserted, frns_updated, frns_unchanged,
      skipped_reason, updated_at
    ) VALUES (
      1, $1, NOW(), $2,
      $3, $4,
      $5, $6, $7,
      $8, $9, $10,
      $11, NOW()
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
      updated_at = NOW()`,
    [
      state,
      mode,
      versions?.basicInfoRowsUpdatedAt ?? null,
      versions?.frnStatusRowsUpdatedAt ?? null,
      applications?.inserted ?? 0,
      applications?.updated ?? 0,
      applications?.unchanged ?? 0,
      frns?.inserted ?? 0,
      frns?.updated ?? 0,
      frns?.unchanged ?? 0,
      skippedReason,
    ]
  );
}

async function recordPreloadedSync(client, state = 'CA') {
  await client.query(
    `INSERT INTO usac_sync_state (
      id, state, last_sync_at, last_sync_mode, skipped_reason, updated_at
    ) VALUES (1, $1, NOW(), 'preloaded', 'preloaded_dump', NOW())
    ON CONFLICT (id) DO UPDATE SET
      state = EXCLUDED.state,
      last_sync_at = EXCLUDED.last_sync_at,
      last_sync_mode = EXCLUDED.last_sync_mode,
      skipped_reason = EXCLUDED.skipped_reason,
      updated_at = NOW()`,
    [state]
  );
}

module.exports = {
  getSyncState,
  fetchDatasetVersions,
  hoursSinceSync,
  isSyncWithinMinInterval,
  datasetsChangedSinceLastSync,
  saveSyncState,
  recordPreloadedSync,
};