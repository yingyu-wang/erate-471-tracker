require('dotenv').config();
const { pool } = require('../db');

const MAX_ATTEMPTS = Number(process.env.DB_WAIT_ATTEMPTS || 60);
const DELAY_MS = Number(process.env.DB_WAIT_DELAY_MS || 2000);

async function main() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      console.log('Database is ready.');
      process.exit(0);
    } catch (err) {
      console.log(`Waiting for database (${attempt}/${MAX_ATTEMPTS})…`);
      if (attempt === MAX_ATTEMPTS) {
        console.error('Database not ready:', err.message);
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }
}

main().finally(() => pool.end());