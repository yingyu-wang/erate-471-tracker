require('dotenv').config();
const { pool } = require('../db');
const { importUsacData } = require('../lib/usac-import');
const { getSyncState } = require('../lib/usac-sync-state');

function parseArgs(argv) {
  const options = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--state' && argv[i + 1]) {
      options.state = argv[++i];
    } else if (arg === '--year-min' && argv[i + 1]) {
      options.fundingYearMin = argv[++i];
    } else if (arg === '--year-max' && argv[i + 1]) {
      options.fundingYearMax = argv[++i];
    } else if (arg === '--no-pending') {
      options.includePending = false;
    } else if (arg === '--full') {
      options.syncMode = 'full';
    } else if (arg === '--incremental') {
      options.syncMode = 'incremental';
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: npm run import:usac -- [options]

Options:
  --state <code>     State to import (default: CA)
  --year-min <year>  Minimum funding year (e.g. 2024)
  --year-max <year>  Maximum funding year
  --no-pending       Skip Original-version Certified/Pending records
  --full             Re-import all funding years (ignore incremental window)
  --incremental      Sync recent years only; skip if USAC data unchanged
  -h, --help         Show this help
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  try {
    const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM applications');
    const syncState = await getSyncState().catch(() => null);

    const summary = await importUsacData({
      ...options,
      existingApplicationCount: countResult.rows[0].count,
      lastSyncState: syncState,
      force: options.syncMode === 'full',
    });

    if (summary.skipped) {
      console.log(`USAC sync skipped (${summary.skippedReason || 'no changes'}).`);
      process.exit(0);
    }

    console.log(
      `USAC ${summary.syncMode} sync for ${summary.state}: `
      + `${summary.applications.inserted} new apps, ${summary.applications.updated} updated, `
      + `${summary.applications.unchanged} unchanged; `
      + `${summary.frns.inserted} new FRNs, ${summary.frns.updated} updated, `
      + `${summary.frns.unchanged} unchanged.`
    );
    process.exit(0);
  } catch (err) {
    console.error('USAC import failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();