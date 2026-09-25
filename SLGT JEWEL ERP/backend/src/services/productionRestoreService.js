/**
 * Production restore: decrypt → validate → pre-restore backup → swap live DB.
 */
import fs from 'fs';
import path from 'path';
import { readEncryptedFile } from '../security/cryptoBox.js';
import { isLocalMode } from '../db.js';
import { appendAuditEvent } from './auditTrailService.js';
import { createEncryptedBackup } from './encryptedBackupService.js';

let writeLocked = false;

export function isWriteLocked() {
  return writeLocked;
}

export function assertNotWriteLocked(req, res, next) {
  if (writeLocked && !String(req.originalUrl || '').includes('/cluster/backups/restore')) {
    return res.status(503).json({ detail: 'Host in restore maintenance mode', code: 'WRITE_LOCKED' });
  }
  next();
}

async function pragmaCheck(dbPath) {
  const sqlite3 = (await import('sqlite3')).default;
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
    });
    db.get('PRAGMA integrity_check', (e1, r1) => {
      if (e1) {
        db.close();
        return reject(e1);
      }
      db.all('PRAGMA foreign_key_check', (e2, rows) => {
        db.close();
        if (e2) return reject(e2);
        resolve({
          integrity: r1?.integrity_check || r1,
          fk_violations: rows || [],
        });
      });
    });
  });
}

/**
 * Restore encrypted backup onto live SQLITE_PATH.
 * @returns {{ ok: true, pre_restore: string, restored: string } | throws}
 */
export async function restoreLiveDatabase({ encPath, userId = null } = {}) {
  if (!isLocalMode()) {
    throw Object.assign(new Error('Live restore supported for SQLite Host only'), { status: 400 });
  }
  const livePath = process.env.SQLITE_PATH;
  if (!livePath) throw Object.assign(new Error('SQLITE_PATH not set'), { status: 400 });
  if (!encPath || !fs.existsSync(encPath)) {
    throw Object.assign(new Error('Backup file not found'), { status: 400 });
  }

  // 1. Decrypt to temp
  let plain;
  try {
    plain = readEncryptedFile(encPath);
  } catch (err) {
    throw Object.assign(new Error(`Backup decrypt failed: ${err.message}`), {
      status: 400,
      code: 'BACKUP_CORRUPT',
    });
  }

  const tmpDir = path.join(path.dirname(livePath), '.restore-tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const candidate = path.join(tmpDir, `candidate-${Date.now()}.sqlite`);
  fs.writeFileSync(candidate, plain, { mode: 0o600 });

  // 2. Validate candidate
  let check;
  try {
    check = await pragmaCheck(candidate);
  } catch (err) {
    try { fs.unlinkSync(candidate); } catch { /* */ }
    throw Object.assign(new Error(`Backup validation failed: ${err.message}`), {
      status: 400,
      code: 'BACKUP_INVALID',
    });
  }
  if (String(check.integrity) !== 'ok') {
    try { fs.unlinkSync(candidate); } catch { /* */ }
    throw Object.assign(new Error(`integrity_check failed: ${check.integrity}`), {
      status: 400,
      code: 'BACKUP_INVALID',
    });
  }

  // 3. Pre-restore backup of current live DB
  writeLocked = true;
  let preRestore = null;
  try {
    preRestore = await createEncryptedBackup({ tier: 'frequent', userId });
  } catch (err) {
    writeLocked = false;
    try { fs.unlinkSync(candidate); } catch { /* */ }
    throw Object.assign(new Error(`Pre-restore backup failed: ${err.message}`), { status: 500 });
  }

  // 4. Swap files
  const bak = `${livePath}.pre-restore-${Date.now()}`;
  try {
    if (fs.existsSync(livePath)) fs.renameSync(livePath, bak);
    fs.copyFileSync(candidate, livePath);
    try { fs.unlinkSync(candidate); } catch { /* */ }
  } catch (err) {
    // Attempt recover
    try {
      if (fs.existsSync(bak) && !fs.existsSync(livePath)) fs.renameSync(bak, livePath);
    } catch { /* */ }
    writeLocked = false;
    throw Object.assign(new Error(`DB swap failed: ${err.message}`), { status: 500 });
  }

  // 5. Re-check live
  try {
    const liveCheck = await pragmaCheck(livePath);
    if (String(liveCheck.integrity) !== 'ok') {
      // roll back file
      if (fs.existsSync(livePath)) fs.unlinkSync(livePath);
      if (fs.existsSync(bak)) fs.renameSync(bak, livePath);
      writeLocked = false;
      throw Object.assign(new Error('Restored DB failed integrity_check — previous DB restored'), {
        status: 500,
        code: 'RESTORE_ROLLED_BACK',
      });
    }
  } catch (err) {
    writeLocked = false;
    throw err;
  }

  writeLocked = false;

  try {
    await appendAuditEvent({
      eventType: 'BACKUP_RESTORED',
      action: 'backup.restore_live',
      userId,
      newValue: { encPath, pre_restore: preRestore?.path || preRestore, bak },
    });
  } catch { /* */ }

  return {
    ok: true,
    restored: livePath,
    pre_restore_backup: preRestore,
    previous_db_copy: bak,
    integrity: 'ok',
    restart_required: true,
  };
}
