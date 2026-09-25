/**
 * Bootstrap an isolated local PostgreSQL cluster for Branch Service testing.
 * Does NOT modify the system PostgreSQL services (x64-14 / x64-18).
 *
 * Uses scoop/installed PostgreSQL binaries (initdb + pg_ctl).
 * Auth: trust for 127.0.0.1 only on dedicated port (default 55432).
 *
 * Usage:
 *   node src/scripts/bootstrapBranchPostgres.js
 *   node src/scripts/bootstrapBranchPostgres.js --stop
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync, execFileSync } from 'child_process';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../..');
const dataDir = path.join(backendRoot, '.local-pgdata');
const port = Number(process.env.BRANCH_PG_PORT || 55432);
const dbName = 'jewellery_crm_branch';
const stopOnly = process.argv.includes('--stop');

function findPgBin() {
  const candidates = [
    process.env.PGBIN,
    path.join(process.env.USERPROFILE || '', 'scoop', 'apps', 'postgresql', 'current', 'bin'),
    'C:\\Program Files\\PostgreSQL\\18\\bin',
    'C:\\Program Files\\PostgreSQL\\14\\bin',
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'initdb.exe')) || fs.existsSync(path.join(dir, 'initdb'))) {
      return dir;
    }
  }
  throw new Error('PostgreSQL binaries not found. Install PostgreSQL or set PGBIN.');
}

function bin(name) {
  const base = findPgBin();
  const win = path.join(base, `${name}.exe`);
  if (fs.existsSync(win)) return win;
  return path.join(base, name);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: opts.timeout ?? 60000,
    ...opts,
  });
  if (r.error && r.error.code === 'ETIMEDOUT') {
    throw new Error(`${path.basename(cmd)} timed out`);
  }
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').trim();
    throw new Error(`${path.basename(cmd)} failed: ${err || `exit ${r.status}`}`);
  }
  return r.stdout;
}

async function waitForAccepting(maxMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const users = [process.env.BRANCH_PG_USER || 'jewellery', 'jewellery', 'postgres'];
    for (const user of users) {
      const c = new pg.Client({
        host: '127.0.0.1',
        port,
        user,
        database: 'postgres',
        password: '',
        connectionTimeoutMillis: 2000,
      });
      try {
        await c.connect();
        await c.end();
        return user;
      } catch {
        try { await c.end(); } catch { /* */ }
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Branch postgres did not accept connections in time');
}

function isRunning() {
  try {
    run(bin('pg_ctl'), ['-D', dataDir, 'status']);
    return true;
  } catch {
    return false;
  }
}

async function ensureDatabase() {
  const client = new pg.Client({
    host: '127.0.0.1',
    port,
    user: process.env.USERNAME || 'postgres',
    database: 'postgres',
    password: '',
    connectionTimeoutMillis: 5000,
  });
  // After initdb without -U, superuser is the OS user; try common names.
  const users = [
    process.env.BRANCH_PG_USER || 'jewellery',
    'jewellery',
    'postgres',
  ].filter(Boolean);

  let connected = null;
  for (const user of users) {
    const c = new pg.Client({
      host: '127.0.0.1',
      port,
      user,
      database: 'postgres',
      password: '',
      connectionTimeoutMillis: 3000,
    });
    try {
      await c.connect();
      connected = c;
      break;
    } catch {
      try { await c.end(); } catch { /* */ }
    }
  }
  if (!connected) throw new Error('Could not connect to branch postgres as any local user');

  const exists = await connected.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!exists.rowCount) {
    await connected.query(`CREATE DATABASE ${connected.escapeIdentifier(dbName)}`);
    console.log(`Created database ${dbName}`);
  }
  const user = (await connected.query('SELECT current_user AS u')).rows[0].u;
  await connected.end();
  return user;
}

function writeEnv(user) {
  const envPath = path.join(backendRoot, '.env.branch');
  const url = `postgresql://${encodeURIComponent(user)}@127.0.0.1:${port}/${dbName}`;
  const body = [
    'APP_MODE=branch',
    `DATABASE_URL=${url}`,
    'DB_SSL=false',
    'PORT=8000',
    'LISTEN_HOST=0.0.0.0',
    'CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000',
    'CLOUD_ENDPOINT=',
    `BRANCH_PG_PORT=${port}`,
    `# Generated ${new Date().toISOString()} — local branch cluster (do not commit)`,
    '',
  ].join('\n');
  fs.writeFileSync(envPath, body, { mode: 0o600 });
  console.log(`Wrote ${envPath}`);
}

async function main() {
  const pgBin = findPgBin();
  console.log(`Using PostgreSQL binaries at ${pgBin}`);

  if (stopOnly) {
    if (fs.existsSync(dataDir) && isRunning()) {
      run(bin('pg_ctl'), ['-D', dataDir, '-m', 'fast', 'stop']);
      console.log('Branch postgres stopped');
    } else {
      console.log('Branch postgres not running');
    }
    return;
  }

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    // Avoid OS usernames with spaces — break connection URLs and pg tools.
    const superuser = process.env.BRANCH_PG_USER || 'jewellery';
    console.log(`Initializing cluster at ${dataDir} (superuser=${superuser})`);
    run(bin('initdb'), [
      '-D', dataDir,
      '-U', superuser,
      '--auth-local=trust',
      '--auth-host=trust',
      '-E', 'UTF8',
      '--no-locale',
    ]);
    // Harden: only trust localhost
    const hba = path.join(dataDir, 'pg_hba.conf');
    fs.writeFileSync(hba, [
      '# Branch Service local cluster — trust localhost only',
      'host all all 127.0.0.1/32 trust',
      'host all all ::1/128 trust',
      'local all all trust',
      '',
    ].join('\n'));
  }

  if (!isRunning()) {
    console.log(`Starting branch postgres on port ${port}...`);
    // Do not use pg_ctl -w on Windows — it can hang after the server is already up.
    const start = spawnSync(bin('pg_ctl'), [
      '-D', dataDir,
      '-l', path.join(dataDir, 'pg.log'),
      '-o', `-p ${port}`,
      'start',
    ], { encoding: 'utf8', timeout: 15000 });
    if (start.status !== 0 && start.status != null) {
      const err = (start.stderr || start.stdout || '').trim();
      // "server is already running" is fine
      if (!/already running/i.test(err)) {
        throw new Error(`pg_ctl start failed: ${err || `exit ${start.status}`}`);
      }
    }
  } else {
    console.log('Branch postgres already running');
  }

  await waitForAccepting();
  const user = await ensureDatabase();
  writeEnv(user);
  console.log(JSON.stringify({
    status: 'ready',
    data_dir: dataDir,
    port,
    database: dbName,
    user,
    next: 'npm run start:branch',
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
