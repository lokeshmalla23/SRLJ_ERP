/**
 * Probe local PostgreSQL and optionally create the branch database.
 * Usage:
 *   node src/scripts/setupLocalPostgres.js --probe
 *   node src/scripts/setupLocalPostgres.js --create --password=SECRET
 *
 * Does not print passwords. Writes backend/.env.branch (gitignored pattern).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../..');

function arg(name, fallback = null) {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  if (hit) return hit.slice(pref.length);
  if (process.argv.includes(`--${name}`)) return true;
  return fallback;
}

const host = arg('host', process.env.PGHOST || '127.0.0.1');
const port = Number(arg('port', process.env.PGPORT || '5432'));
const adminUser = arg('user', process.env.PGUSER || 'postgres');
const password = String(arg('password', process.env.PGPASSWORD != null ? process.env.PGPASSWORD : '') ?? '');
const dbName = arg('db', 'jewellery_crm_branch');
const appUser = arg('app-user', 'jewellery_crm');
const appPassword = arg('app-password', process.env.BRANCH_DB_PASSWORD || `branch_${Date.now().toString(36)}`);
const doCreate = Boolean(arg('create', false));
const doProbe = Boolean(arg('probe', !doCreate));

async function tryConnect(cfg) {
  const client = new pg.Client({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database || 'postgres',
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const r = await client.query('SELECT version() AS v, current_user AS u');
    return { ok: true, client, version: r.rows[0].v, user: r.rows[0].u };
  } catch (err) {
    try { await client.end(); } catch { /* */ }
    return { ok: false, error: err.message };
  }
}

async function main() {
  const ports = [port, 5432, 5433].filter((v, i, a) => a.indexOf(v) === i);
  const results = [];

  for (const p of ports) {
    const attempt = await tryConnect({
      host, port: p, user: adminUser, password, database: 'postgres',
    });
    results.push({
      host, port: p, user: adminUser,
      ok: attempt.ok,
      error: attempt.ok ? undefined : attempt.error,
      version: attempt.ok ? attempt.version.split(',')[0] : undefined,
    });
    if (attempt.ok) {
      if (doCreate) {
        const client = attempt.client;
        await client.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [appUser]).then(async (r) => {
          if (!r.rowCount) {
            await client.query(`CREATE ROLE ${client.escapeIdentifier(appUser)} LOGIN PASSWORD '${appPassword.replace(/'/g, "''")}'`);
            console.log(`Created role ${appUser}`);
          } else {
            console.log(`Role ${appUser} already exists (password unchanged)`);
          }
        });
        const dbExists = await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
        if (!dbExists.rowCount) {
          await client.query(`CREATE DATABASE ${client.escapeIdentifier(dbName)} OWNER ${client.escapeIdentifier(appUser)}`);
          console.log(`Created database ${dbName}`);
        } else {
          console.log(`Database ${dbName} already exists`);
        }
        await client.query(`GRANT ALL PRIVILEGES ON DATABASE ${client.escapeIdentifier(dbName)} TO ${client.escapeIdentifier(appUser)}`);
        await client.end();

        const envPath = path.join(backendRoot, '.env.branch');
        const url = `postgresql://${encodeURIComponent(appUser)}:${encodeURIComponent(appPassword)}@${host}:${p}/${dbName}`;
        const envBody = [
          'APP_MODE=branch',
          `DATABASE_URL=${url}`,
          'DB_SSL=false',
          'PORT=8000',
          'LISTEN_HOST=0.0.0.0',
          'CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000',
          'CLOUD_ENDPOINT=',
          `# Generated ${new Date().toISOString()} — do not commit`,
          '',
        ].join('\n');
        fs.writeFileSync(envPath, envBody, { mode: 0o600 });
        console.log(`Wrote ${envPath} (contains secrets — keep local)`);
        console.log(JSON.stringify({
          status: 'ready',
          database: dbName,
          port: p,
          app_user: appUser,
          next: 'dotenv -e .env.branch -- npm start   OR   copy vars into shell and npm start',
        }, null, 2));
        return;
      }
      await attempt.client.end();
      console.log(JSON.stringify({ status: 'reachable', results }, null, 2));
      return;
    }
  }

  console.log(JSON.stringify({
    status: 'unreachable',
    hint: 'Provide --password=... or set PGPASSWORD. Ensure PostgreSQL is running and pg_hba allows password auth from 127.0.0.1.',
    results,
  }, null, 2));
  process.exit(doProbe && !doCreate ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
