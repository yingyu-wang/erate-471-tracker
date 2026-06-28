const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

async function runSqlFile(filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  await pool.query(sql);
  console.log(`Executed: ${path.basename(filePath)}`);
}

async function main() {
  const dbDir = path.join(__dirname, '..', '..', 'db');
  try {
    await runSqlFile(path.join(dbDir, 'schema.sql'));
    console.log('Database schema initialized successfully.');
  } catch (err) {
    console.error('Failed to initialize database:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();