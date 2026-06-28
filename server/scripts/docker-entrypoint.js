const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function runNodeScript(scriptName) {
  const scriptPath = path.join(__dirname, scriptName);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptName} failed with exit code ${code}`));
    });
  });
}

function startServer() {
  const serverPath = path.join(ROOT, 'server', 'index.js');
  const child = spawn(process.execPath, [serverPath], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });

  child.on('error', (err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });

  child.on('exit', (code) => process.exit(code ?? 0));

  const shutdown = (signal) => {
    child.kill(signal);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function main() {
  console.log('E-Rate 471 Tracker — Docker startup');
  await runNodeScript('wait-for-db.js');
  await runNodeScript('init-db.js');
  await runNodeScript('ensure-usac-import.js');
  console.log('Starting web server…');
  startServer();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});