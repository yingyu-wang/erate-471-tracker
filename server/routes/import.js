const express = require('express');
const { query } = require('../db');
const { importUsacData } = require('../lib/usac-import');
const { getSyncState } = require('../lib/usac-sync-state');

const router = express.Router();

let importInProgress = false;

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

    const summary = await importUsacData({
      state: req.body?.state,
      fundingYearMin: req.body?.fundingYearMin,
      fundingYearMax: req.body?.fundingYearMax,
      includePending: req.body?.includePending,
      syncMode: req.body?.force ? 'full' : (req.body?.syncMode || 'auto'),
      existingApplicationCount: countResult.rows[0].count,
      lastSyncState: syncState,
      force: Boolean(req.body?.force),
      log: () => {},
    });

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