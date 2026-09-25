'use strict';
/**
 * Authority State Machine tests.
 * Run with: node desktop/tests/authorityState.test.js
 * (No test framework required — uses Node's built-in assert)
 */
const assert = require('assert');
const os     = require('os');
const path   = require('path');
const fs     = require('fs');

// ─── Minimal in-memory SQLite for tests ─────────────────────────────────────
const Database = require('better-sqlite3');

function makeTmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
  const db  = new Database(path.join(dir, 'test.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return { db, dir };
}

// ─── Test helpers ────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function eq(a, b, msg) {
  assert.strictEqual(a, b, msg);
}

function ok(val, msg) {
  assert.ok(val, msg);
}

// ─── Test suites ─────────────────────────────────────────────────────────────

async function testInvoiceSequence() {
  console.log('\n[invoiceSequence]');
  const { db, dir } = makeTmpDb();
  const seq = require('../lib/services/invoiceSequence');

  db.exec(`
    CREATE TABLE invoice_sequences (
      shop_id TEXT NOT NULL,
      series  TEXT NOT NULL,
      device_id TEXT,
      next_number INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (shop_id, series)
    )
  `);

  seq.init(db, 'device-abc-1234', 'SSJ');

  const n1 = seq.allocate();
  const n2 = seq.allocate();
  const n3 = seq.allocate();

  await test('allocate increments sequence', () => {
    ok(n1.startsWith('SSJ-'), `expected SSJ- prefix, got ${n1}`);
    ok(n2.startsWith('SSJ-'), `expected SSJ- prefix, got ${n2}`);
    ok(n1 !== n2, 'n1 and n2 should differ');
  });

  await test('allocate is collision-safe (100 sequential allocations)', () => {
    const seen = new Set([n1, n2, n3]);
    for (let i = 0; i < 97; i++) {
      const n = seq.allocate();
      ok(!seen.has(n), `Duplicate invoice number: ${n}`);
      seen.add(n);
    }
    eq(seen.size, 100, 'Expected 100 unique numbers');
  });

  await test('device_short is derived from deviceId', () => {
    ok(n1.includes('DEVI'), `Expected DEVI in invoice number, got ${n1}`);
  });

  db.close();
  fs.rmSync(dir, { recursive: true });
}

async function testOfflineAuth() {
  console.log('\n[offlineAuthService]');
  const bcrypt = require('bcryptjs');
  const { db, dir } = makeTmpDb();

  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY NOT NULL,
      shop_id TEXT,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      permissions_json TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      password_hash TEXT,
      updated_at TEXT
    )
  `);

  const auth = require('../lib/services/offlineAuthService');

  // Insert a test user with known bcrypt hash
  const hash = await bcrypt.hash('TestPass123', 10);
  db.prepare(`
    INSERT INTO users (id, email, name, role, permissions_json, active, password_hash, updated_at)
    VALUES ('u-1', 'test@shop.com', 'Test User', 'staff', '{}', 1, ?, datetime('now'))
  `).run(hash);

  await test('correct password grants access', async () => {
    const result = await auth.loginOffline(db, 'test@shop.com', 'TestPass123');
    ok(result.ok, `Expected ok=true, got: ${result.reason}`);
    eq(result.user.email, 'test@shop.com');
    ok(result.offlineMode, 'Expected offlineMode=true');
  });

  await test('wrong password is rejected', async () => {
    const result = await auth.loginOffline(db, 'test@shop.com', 'WrongPass');
    ok(!result.ok, 'Expected ok=false');
  });

  await test('unknown email is rejected', async () => {
    const result = await auth.loginOffline(db, 'nobody@shop.com', 'TestPass123');
    ok(!result.ok, 'Expected ok=false for unknown email');
  });

  await test('inactive user is rejected', async () => {
    db.prepare("UPDATE users SET active = 0 WHERE id = 'u-1'").run();
    const result = await auth.loginOffline(db, 'test@shop.com', 'TestPass123');
    ok(!result.ok, 'Expected ok=false for inactive user');
    db.prepare("UPDATE users SET active = 1 WHERE id = 'u-1'").run();
  });

  await test('cacheCredential stores/updates hash', async () => {
    const newHash = await bcrypt.hash('NewPass456', 10);
    auth.cacheCredential(db, {
      id: 'u-2', email: 'new@shop.com', name: 'New', role: 'staff',
      permissions: {}, active: true, password_hash: newHash,
    });
    const result = await auth.loginOffline(db, 'new@shop.com', 'NewPass456');
    ok(result.ok, `Expected ok=true after cacheCredential, got: ${result.reason}`);
  });

  db.close();
  fs.rmSync(dir, { recursive: true });
}

async function testMigration() {
  console.log('\n[migrate]');
  const { db, dir } = makeTmpDb();
  const { migrate, getSchemaVersion } = require('../lib/db/migrate');

  await test('migrate applies initial schema', async () => {
    const result = await migrate(db, dir);
    ok(result.applied.length > 0 || result.after > 0, 'Expected migration to run or schema to exist');
    const v = getSchemaVersion(db);
    ok(v >= 1, `Expected schema version >= 1, got ${v}`);
  });

  await test('migrate is idempotent (second run applies nothing)', async () => {
    const result2 = await migrate(db, dir);
    eq(result2.applied.length, 0, 'Second migration should apply nothing');
  });

  await test('audit_events table exists after migration', () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_events'").get();
    ok(row, 'audit_events table should exist');
  });

  await test('sync_outbox table exists after migration', () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_outbox'").get();
    ok(row, 'sync_outbox table should exist');
  });

  await test('coordination_state table exists after migration', () => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='coordination_state'").get();
    ok(row, 'coordination_state table should exist');
  });

  db.close();
  fs.rmSync(dir, { recursive: true });
}

async function testAuditService() {
  console.log('\n[auditService]');
  const { db, dir } = makeTmpDb();

  db.exec(`
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY NOT NULL,
      shop_id TEXT,
      device_id TEXT,
      user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      request_id TEXT,
      reason TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const audit = require('../lib/services/auditService');
  audit.init({ shopId: 'shop-1', deviceId: 'dev-1' });

  await test('log writes an audit event', () => {
    audit.log(db, { action: 'invoice.create', entityType: 'invoice', entityId: 'inv-1', userId: 'user-1' });
    const rows = audit.query(db, { action: 'invoice.create' });
    eq(rows.length, 1, 'Expected 1 audit event');
    eq(rows[0].entity_id, 'inv-1');
  });

  await test('log with null db does not throw', () => {
    audit.log(null, { action: 'test.event' });
  });

  await test('log with missing action does not throw', () => {
    audit.log(db, {});
  });

  await test('query filters by entity_type', () => {
    audit.log(db, { action: 'product.update', entityType: 'product', entityId: 'p-1' });
    const rows = audit.query(db, { entityType: 'product' });
    eq(rows.length, 1, 'Expected 1 product audit event');
  });

  db.close();
  fs.rmSync(dir, { recursive: true });
}

// ─── Run all ─────────────────────────────────────────────────────────────────
(async () => {
  console.log('=== Local-First Desktop Tests ===');
  await testMigration();
  await testInvoiceSequence();
  await testOfflineAuth();
  await testAuditService();

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\n✗ Some tests failed');
    process.exit(1);
  } else {
    console.log('\n✓ All tests passed');
  }
})();
