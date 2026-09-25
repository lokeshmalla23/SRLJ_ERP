/**
 * Encrypted versioned backups (independent of replication).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { writeEncryptedFile, readEncryptedFile } from '../security/cryptoBox.js';
import { isLocalMode } from '../db.js';
import branchConfig from '../config/branchConfig.js';
import { appendAuditEvent } from './auditTrailService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function backupRoot() {
  if (process.env.BACKUP_DIR) return process.env.BACKUP_DIR;
  if (process.env.ELECTRON_USERDATA) {
    return path.join(process.env.ELECTRON_USERDATA, 'backups');
  }
  return path.resolve(__dirname, '../../.backups');
}

function tierDir(tier) {
  return path.join(backupRoot(), tier);
}

async function dumpSqlite() {
  // Copy live sqlite file if SQLITE_PATH set
  const dbPath = process.env.SQLITE_PATH;
  if (!dbPath || !fs.existsSync(dbPath)) {
    throw new Error('SQLITE_PATH not set or missing — cannot dump SQLite');
  }
  return fs.readFileSync(dbPath);
}

function runPgDump() {
  return new Promise((resolve, reject) => {
    const url = process.env.DATABASE_URL;
    if (!url) return reject(new Error('DATABASE_URL required for pg_dump'));
    const chunks = [];
    const child = spawn('pg_dump', [url, '--no-owner', '--format=custom'], {
      env: process.env,
    });
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', () => {});
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`pg_dump exited ${code}`));
      else resolve(Buffer.concat(chunks));
    });
  });
}

/**
 * Create encrypted backup.
 * @param {'frequent'|'daily'|'weekly'|'monthly'} tier
 */
export async function createEncryptedBackup({ tier = 'frequent', userId = null } = {}) {
  const plain = isLocalMode() ? await dumpSqlite() : await runPgDump();
  const dir = tierDir(tier);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(dir, `backup-${stamp}.enc`);
  writeEncryptedFile(filePath, plain);

  // Retention
  const keep = { frequent: 24, daily: 14, weekly: 8, monthly: 12 }[tier] || 10;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.enc')).sort();
  while (files.length > keep) {
    const old = files.shift();
    try { fs.unlinkSync(path.join(dir, old)); } catch { /* */ }
  }

  try {
    await appendAuditEvent({
      eventType: 'BACKUP_CREATED',
      action: 'backup.create',
      entityType: 'backup',
      entityId: path.basename(filePath),
      userId,
      newValue: { tier, bytes: plain.length },
    });
  } catch { /* audit optional if cluster not ready */ }

  return {
    path: filePath,
    tier,
    bytes: plain.length,
    encrypted: true,
    created_at: new Date().toISOString(),
    shop_id: branchConfig.shop_id,
  };
}

export function listEncryptedBackups() {
  const tiers = ['frequent', 'daily', 'weekly', 'monthly'];
  const out = {};
  for (const tier of tiers) {
    const dir = tierDir(tier);
    if (!fs.existsSync(dir)) {
      out[tier] = [];
      continue;
    }
    out[tier] = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.enc'))
      .sort()
      .reverse()
      .map((f) => {
        const full = path.join(dir, f);
        const st = fs.statSync(full);
        return { name: f, path: full, size: st.size, mtime: st.mtime.toISOString(), encrypted: true };
      });
  }
  return { root: backupRoot(), backups: out };
}

/**
 * Decrypt backup to a destination path (restore drill).
 */
export function restoreEncryptedBackup(encPath, destPath) {
  const plain = readEncryptedFile(encPath);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, plain, { mode: 0o600 });
  return { restored_to: destPath, bytes: plain.length };
}
