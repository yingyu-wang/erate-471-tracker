const path = require('path');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const applicationsRouter = require('./routes/applications');
const frnsRouter = require('./routes/frns');
const dashboardRouter = require('./routes/dashboard');
const importRouter = require('./routes/import');
const { pool } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', database: 'disconnected', error: err.message });
  }
});

app.use('/api/applications', applicationsRouter);
app.use('/api/frns', frnsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/import', importRouter);

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`E-Rate 471 Tracker running at http://localhost:${PORT}`);
});