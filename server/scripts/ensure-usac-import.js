require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pool } = require('../db');
const { importUsacData } = require('../lib/usac-import');
const {
  getSyncState,
  hoursSinceSync,
  isSyncWithinMinInterval,
  recordPreloadedSync,
} = require('../lib/usac-sync-state');

const PRELOADED_DUMP = path.join(__dirname, '..', '..', 'db', 'preloaded.sql');
const MIN_IMPORTED_APPS = Number(process.env.USAC_MIN_IMPORTED_APPS || 1000);
const SYNC_MIN_INTERVAL_HOURS = Number(process.env.USAC_SYNC_MIN_INTERVAL_HOURS || 24);

function parseDatabaseUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
  };
}

async function getApplicationCount() {
  const result = await pool.query('SELECT COUNT(*)::int AS count FROM applications');
  return result.rows[0].count;
}

function restoreViaPsql(dumpPath, databaseUrl) {
  const db = parseDatabaseUrl(databaseUrl);

  return new Promise((resolve, reject) => {
    const child = spawn('psql', [
      '-h', db.host,
      '-p', db.port,
      '-U', db.user,
      '-d', db.database,
      '-v', 'ON_ERROR_STOP=1',
      '-q',
      '-f', dumpPath,
    ], {
      env: { ...process.env, PGPASSWORD: db.password },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql restore failed with exit code ${code}`));
    });
  });
}

async function restorePreloadedDump() {
  if (!fs.existsSync(PRELOADED_DUMP)) return false;

  const sizeMb = (fs.statSync(PRELOADED_DUMP).size / (1024 * 1024)).toFixed(1);
  console.log(`Restoring preloaded California USAC data from db/preloaded.sql (${sizeMb} MB)…`);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to restore preloaded data');
  }

  try {
    await restoreViaPsql(PRELOADED_DUMP, databaseUrl);
  } catch (psqlErr) {
    console.log('psql not available or restore failed — falling back to Node SQL restore…');
    const sql = fs.readFileSync(PRELOADED_DUMP, 'utf8');
    await pool.query(sql);
  }

  const importState = process.env.USAC_IMPORT_STATE || 'CA';
  await recordPreloadedSync(pool, importState);
  console.log('Preloaded data restored.');
  return true;
}

function buildImportOptions(existingCount, syncState) {
  const force = process.env.FORCE_USAC_IMPORT === 'true';

  return {
    state: process.env.USAC_IMPORT_STATE || 'CA',
    includePending: process.env.USAC_IMPORT_INCLUDE_PENDING !== 'false',
    fundingYearMin: process.env.USAC_IMPORT_FUNDING_YEAR_MIN || null,
    fundingYearMax: process.env.USAC_IMPORT_FUNDING_YEAR_MAX || null,
    syncMode: force ? 'full' : (process.env.USAC_SYNC_MODE || 'auto'),
    existingApplicationCount: existingCount,
    lastSyncState: syncState,
    force,
  };
}

function shouldSkipStartupSync(existing, syncState, force) {
  if (force) return false;
  if (existing < MIN_IMPORTED_APPS) return false;
  if (!isSyncWithinMinInterval(syncState, SYNC_MIN_INTERVAL_HOURS)) return false;

  const hours = hoursSinceSync(syncState);
  console.log(
    `Last USAC sync was ${hours.toFixed(1)}h ago `
    + `(< ${SYNC_MIN_INTERVAL_HOURS}h) — skipping Open Data import.`
  );
  return true;
}

async function main() {
  const autoImport = process.env.AUTO_IMPORT_USAC !== 'false';
  if (!autoImport) {
    console.log('AUTO_IMPORT_USAC=false — skipping USAC import.');
    return;
  }

  const force = process.env.FORCE_USAC_IMPORT === 'true';
  let existing = await getApplicationCount();
  const syncState = await getSyncState().catch(() => null);

  if (shouldSkipStartupSync(existing, syncState, force)) {
    return;
  }

  if (existing >= MIN_IMPORTED_APPS && !force) {
    console.log(`Found ${existing} applications — running incremental USAC sync (if Open Data changed)…`);
    const summary = await importUsacData(buildImportOptions(existing, syncState));

    if (summary.skipped) {
      console.log(`USAC sync skipped: ${summary.skippedReason || 'no changes'}.`);
      return;
    }

    console.log(
      `USAC sync finished (${summary.syncMode}): `
      + `${summary.applications.inserted} new apps, ${summary.applications.updated} updated, `
      + `${summary.applications.unchanged} unchanged; `
      + `${summary.frns.inserted} new FRNs, ${summary.frns.updated} updated, `
      + `${summary.frns.unchanged} unchanged.`
    );
    return;
  }

  if (existing < MIN_IMPORTED_APPS && !force && (await restorePreloadedDump())) {
    existing = await getApplicationCount();
    if (existing >= MIN_IMPORTED_APPS) {
      console.log(`Restored ${existing} applications from preloaded dump — skipping USAC API import.`);
      return;
    }
  }

  console.log('Importing California Form 471 data (Current + Pending) from USAC Open Data…');
  console.log('This first-time import may take several minutes.');

  const summary = await importUsacData(buildImportOptions(existing, syncState));

  console.log(
    `USAC import finished: ${summary.totals.applications} applications, ${summary.totals.frns} FRNs.`
  );
}

main()
  .catch((err) => {
    console.error('USAC import setup failed:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());