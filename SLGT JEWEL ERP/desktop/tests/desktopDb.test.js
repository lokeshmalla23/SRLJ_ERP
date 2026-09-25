/**
 * Phase C tests — embedded SQLite init/migrate/integrity.
 * Runs under plain Node (no Electron required).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initLocalDb, shutdownLocalDb, backupLocalDb, getLocalDb } = require('../lib/db');

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `crm-sqlite-${label}-`));
  return dir;
}

function testFreshInstall() {
  const dir = tempDir('fresh');
  const info = initLocalDb(dir);
  assert(info.schemaVersion === 1, `expected schema 1 got ${info.schemaVersion}`);
  assert(info.migration.applied.length === 1, 'expected one migration applied');
  assert(info.integrity.ok, 'integrity check failed');
  assert(fs.existsSync(info.dbPath), 'db file missing');
  assert(!info.dbPath.includes('Program Files'), 'db must not live in Program Files');
  assert(info.dbPath.includes(`${path.sep}data${path.sep}`), 'db should be under data/');

  const { db } = getLocalDb();
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all().map((r) => r.name);
  for (const t of [
    'shops', 'devices', 'products', 'customers', 'invoices', 'inventory_movements',
    'sync_outbox', 'sync_processed_events', 'audit_events', 'coordination_state',
  ]) {
    assert(tables.includes(t), `missing table ${t}`);
  }

  const mode = db.pragma('journal_mode', { simple: true });
  assert(String(mode).toLowerCase() === 'wal', `expected WAL got ${mode}`);
  const fk = db.pragma('foreign_keys', { simple: true });
  assert(Number(fk) === 1, 'foreign_keys should be ON');

  shutdownLocalDb();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('1. Fresh install + WAL + tables — PASS');
}

function testIdempotentMigrate() {
  const dir = tempDir('idem');
  initLocalDb(dir);
  shutdownLocalDb();
  const again = initLocalDb(dir);
  assert(again.migration.applied.length === 0, 'second migrate should apply nothing');
  assert(again.schemaVersion === 1, 'schema stays 1');
  shutdownLocalDb();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('2. Idempotent migrate — PASS');
}

async function testBackup() {
  const dir = tempDir('bak');
  initLocalDb(dir);
  const { db } = getLocalDb();
  db.prepare(
    "INSERT INTO shops (id, name) VALUES ('shop1', 'Test Shop')",
  ).run();
  const bak = await backupLocalDb();
  assert(bak.ok, bak.error || 'backup failed');
  assert(fs.existsSync(bak.path), 'backup file missing');

  const Database = require('better-sqlite3');
  const restored = new Database(bak.path, { readonly: true });
  const shop = restored.prepare('SELECT name FROM shops WHERE id = ?').get('shop1');
  assert(shop && shop.name === 'Test Shop', 'backup content missing');
  restored.close();

  shutdownLocalDb();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('3. Backup API — PASS');
}

function testTransactionRollback() {
  const dir = tempDir('tx');
  initLocalDb(dir);
  const { db } = getLocalDb();
  try {
    db.transaction(() => {
      db.prepare("INSERT INTO shops (id, name) VALUES ('s2', 'X')").run();
      throw new Error('boom');
    })();
  } catch {
    /* expected */
  }
  const row = db.prepare("SELECT * FROM shops WHERE id = 's2'").get();
  assert(!row, 'rolled back insert should not exist');
  shutdownLocalDb();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('4. Transaction rollback — PASS');
}

async function main() {
  try {
    testFreshInstall();
    testIdempotentMigrate();
    await testBackup();
    testTransactionRollback();
    console.log('\nALL DESKTOP-DB TESTS PASSED');
    process.exit(0);
  } catch (err) {
    console.error('\nDESKTOP-DB TESTS FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
