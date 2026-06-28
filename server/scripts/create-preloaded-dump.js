require('dotenv').config();
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const OUTPUT = path.join(__dirname, '..', '..', 'db', 'preloaded.sql');

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

function runPgDump(db) {
  return new Promise((resolve, reject) => {
    const args = [
      '--host', db.host,
      '--port', db.port,
      '--username', db.user,
      '--dbname', db.database,
      '--data-only',
      '--table', 'applications',
      '--table', 'frns',
      '--table', 'status_history',
      '--table', 'usac_sync_state',
      '--file', OUTPUT,
    ];

    const child = execFile('pg_dump', args, {
      env: { ...process.env, PGPASSWORD: db.password },
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump failed with exit code ${code}`));
    });
  });
}

function runDockerPgDump() {
  const container = process.env.PG_DUMP_CONTAINER || 'erate-471-postgres';
  const tmpPath = '/tmp/preloaded.sql';

  return new Promise((resolve, reject) => {
    const dumpArgs = [
      'exec', container,
      'pg_dump', '-U', 'erate', '-d', 'erate_471',
      '--data-only',
      '--table', 'applications',
      '--table', 'frns',
      '--table', 'status_history',
      '--table', 'usac_sync_state',
      '-f', tmpPath,
    ];

    const dump = execFile('docker', dumpArgs, (dumpErr) => {
      if (dumpErr) return reject(dumpErr);

      const copy = execFile('docker', ['cp', `${container}:${tmpPath}`, OUTPUT], (copyErr) => {
        if (copyErr) return reject(copyErr);
        resolve();
      });
      copy.on('error', reject);
    });
    dump.on('error', reject);
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  try {
    const db = parseDatabaseUrl(databaseUrl);
    await runPgDump(db);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    console.log('pg_dump not found locally — using Docker container dump…');
    await runDockerPgDump();
  }

  const sizeMb = (fs.statSync(OUTPUT).size / (1024 * 1024)).toFixed(1);
  console.log(`Wrote ${OUTPUT} (${sizeMb} MB)`);
  console.log('Rebuild the Docker image to bake this dump into the container.');
}

main().catch((err) => {
  console.error('Failed to create preloaded dump:', err.message);
  console.error('Requires pg_dump in PATH and an already-imported database.');
  process.exit(1);
});