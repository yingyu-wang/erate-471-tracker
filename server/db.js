const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://erate:erate_secret@localhost:5432/erate_471',
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

async function getClient() {
  return pool.connect();
}

module.exports = { pool, query, getClient };