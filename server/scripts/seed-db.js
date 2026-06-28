const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

async function main() {
  const seedPath = path.join(__dirname, '..', '..', 'db', 'seed.sql');
  try {
    const sql = fs.readFileSync(seedPath, 'utf8');
    await pool.query(sql);
    console.log('Sample data seeded successfully.');
  } catch (err) {
    console.error('Failed to seed database:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();