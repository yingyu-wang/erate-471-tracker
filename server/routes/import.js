const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const { query } = require('../db');
const { importUsacData } = require('../lib/usac-import');
const { getSyncState } = require('../lib/usac-sync-state');

const router = express.Router();

let importInProgress = false;

async function runPythonImport(opts = {}) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, '..', 'scripts', 'import_usac.py');
    const args = ['--json'];
    if (opts.state) args.push('--state', opts.state);
    if (opts.fundingYearMin != null) args.push('--year-min', String(opts.fundingYearMin));
    if (opts.fundingYearMax != null) args.push('--year-max', String(opts.fundingYearMax));
    if (opts.includePending === false) args.push('--no-pending');
    if (opts.force) args.push('--force');
    if (opts.syncMode) args.push('--' + opts.syncMode);

    const py = process.env.PYTHON || 'python3';
    const child = spawn(py, [script, ...args], {
      cwd: path.join(__dirname, '..', '..'),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`python import failed (code ${code}): ${err.slice(0,400)}`));
      try {
        resolve(JSON.parse(out.trim() || '{}'));
      } catch (e) {
        reject(new Error('Failed to parse python --json output: ' + e.message));
      }
    });
  });
}

router.post('/usac', async (req, res) => {
  if (importInProgress) {
    return res.status(409).json({ error: 'USAC import already in progress' });
  }

  importInProgress = true;

  try {
    const [countResult, syncState] = await Promise.all([
      query('SELECT COUNT(*)::int AS count FROM applications'),
      getSyncState().catch(() => null),
    ]);

    const requestedForce = req.body?.force;
    const force = requestedForce !== false; // default to true for explicit web "Import" clicks (bypass unchanged guard to fetch fresh); explicit false allows skip
    const syncMode = requestedForce ? 'full' : (req.body?.syncMode || 'auto');

    const usePy = process.env.USE_PYTHON_USAC_IMPORT === 'true';
    let summary;
    if (usePy) {
      summary = await runPythonImport({
        state: req.body?.state,
        fundingYearMin: req.body?.fundingYearMin,
        fundingYearMax: req.body?.fundingYearMax,
        includePending: req.body?.includePending,
        force,
        syncMode,
      });
    } else {
      summary = await importUsacData({
        state: req.body?.state,
        fundingYearMin: req.body?.fundingYearMin,
        fundingYearMax: req.body?.fundingYearMax,
        includePending: req.body?.includePending,
        syncMode,
        existingApplicationCount: countResult.rows[0].count,
        lastSyncState: syncState,
        force,
        log: () => {},
      });
    }

    res.json({ ok: true, summary });
  } catch (err) {
    console.error('USAC import failed:', err);
    res.status(500).json({ error: err.message || 'USAC import failed' });
  } finally {
    importInProgress = false;
  }
});

router.get('/usac/status', async (_req, res) => {
  try {
    const syncState = await getSyncState().catch(() => null);
    res.json({ inProgress: importInProgress, lastSync: syncState });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch import status' });
  }
});

module.exports = router;