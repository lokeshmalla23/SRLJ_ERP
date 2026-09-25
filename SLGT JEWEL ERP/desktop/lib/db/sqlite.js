/**
 * Local SQLite open / pragmas / close.
 * Ownership: Electron main (or Node test harness). Never expose to renderer.
 *
 * Chosen settings (Phase C):
 * - journal_mode = WAL          — concurrent readers + crash resilience
 * - foreign_keys = ON           — referential integrity
 * - busy_timeout = 5000         — wait on lock instead of immediate fail
 * - synchronous = NORMAL        — durable with WAL; FULL optional for max safety
 * - temp_store = MEMORY
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

let applyDbKey = null;
try {
  applyDbKey = require('../security/dbEncryption').applyDbKey;
} catch {
  applyDbKey = null;
}

const DB_FILE_NAME = 'jewellery-crm.sqlite';

function resolveDbPath(userDataPath) {
  if (!userDataPath) throw new Error('userDataPath required for SQLite location');
  const dir = path.join(userDataPath, 'data');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, DB_FILE_NAME);
}

/**
 * @param {string} userDataPath - app.getPath('userData') or test temp dir
 * @param {{ readonly?: boolean }} [opts]
 */
function openDatabase(userDataPath, opts = {}) {
  const dbPath = resolveDbPath(userDataPath);
  const db = new Database(dbPath, {
    readonly: Boolean(opts.readonly),
    fileMustExist: Boolean(opts.fileMustExist),
  });

  // Provision OS-protected DB key; apply SQLCipher pragmas when build supports it
  if (!opts.readonly && applyDbKey) {
    try {
      applyDbKey(db);
    } catch (err) {
      console.warn('[sqlite] dbEncryption:', err.message);
    }
  }

  // Apply pragmas before migrations / business use
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 30000');
  if (!opts.readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');
    // Reduce writer contention with the embedded Branch process
    try { db.pragma('wal_autocheckpoint = 1000'); } catch { /* older sqlite */ }
  }

  return { db, dbPath };
}

function integrityCheck(db) {
  const row = db.pragma('integrity_check', { simple: true });
  // better-sqlite3 returns string for simple, or array of rows
  const result = typeof row === 'string' ? row : (row && row[0] && (row[0].integrity_check || row[0])) || row;
  const ok = String(result).toLowerCase() === 'ok';
  return { ok, result: String(result) };
}

/**
 * Flush WAL so the embedded backend can open the same file without SQLITE_BUSY.
 */
function checkpointWal(db) {
  if (!db) return;
  try { db.pragma('busy_timeout = 30000'); } catch { /* */ }
  try { db.pragma('wal_checkpoint(PASSIVE)'); } catch { /* */ }
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* */ }
}

function closeDatabase(db) {
  if (!db) return;
  try {
    db.close();
  } catch {
    // already closed
  }
}

/**
 * Consistent online backup (SQLite Backup API).
 * better-sqlite3 v11+: db.backup() returns a Promise.
 * @returns {Promise<{ ok: boolean, path?: string, error?: string }>}
 */
async function backupDatabase(db, userDataPath) {
  try {
    const backupDir = path.join(userDataPath, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(backupDir, `jewellery-crm-${stamp}.sqlite`);
    await db.backup(dest);
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  DB_FILE_NAME,
  resolveDbPath,
  openDatabase,
  closeDatabase,
  checkpointWal,
  integrityCheck,
  backupDatabase,
};
