/**
 * Local database backup helpers (pg_dump) + End-of-Day reconciliation.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import sequelize from '../db.js';
import { getDefaultShopId } from './defaultShop.js';
import { writeRecoverySnapshot } from './recoveryService.js';
import branchConfig from '../config/branchConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function backupDir() {
  if (process.env.BACKUP_DIR) return process.env.BACKUP_DIR;
  if (process.env.ELECTRON_USERDATA) {
    return path.join(process.env.ELECTRON_USERDATA, 'backups');
  }
  return path.resolve(__dirname, '../../.backups');
}

function findPgDump() {
  const candidates = [
    process.env.PGDUMP,
    path.join(process.env.USERPROFILE || '', 'scoop', 'apps', 'postgresql', 'current', 'bin', 'pg_dump.exe'),
    'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe',
    'C:\\Program Files\\PostgreSQL\\14\\bin\\pg_dump.exe',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'pg_dump';
}

export async function createLocalBackup() {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `backup-${stamp}.sql`);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required');

  const pgDump = findPgDump();
  const r = spawnSync(pgDump, [`--dbname=${url}`, '-F', 'p', '-f', file], {
    encoding: 'utf8',
    timeout: 120000,
  });
  if (r.status !== 0) {
    throw new Error(`pg_dump failed: ${(r.stderr || r.stdout || '').slice(0, 500)}`);
  }

  // retention 30 files
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('backup-')).sort();
  while (files.length > 30) {
    const old = files.shift();
    try { fs.unlinkSync(path.join(dir, old)); } catch { /* */ }
  }

  let recovery = null;
  try { recovery = await writeRecoverySnapshot(); } catch (e) {
    recovery = { error: e.message };
  }

  return {
    backup_file: file,
    created_at: new Date().toISOString(),
    recovery,
  };
}

export async function endOfDayReport(day = new Date()) {
  const shopId = await getDefaultShopId();
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);

  // SQLite-compatible queries (no :: casts, no jsonb_array_elements)
  const [[inv]] = await sequelize.query(`
    SELECT COUNT(*) AS invoice_count,
           COALESCE(SUM(grand_total), 0) AS sales_total
    FROM invoices
    WHERE shop_id = :shopId AND created_at >= :start AND created_at <= :end
      AND (status IS NULL OR status <> 'cancelled')
  `, { replacements: { shopId, start: start.toISOString(), end: end.toISOString() } });

  // Aggregate payments by mode in JavaScript (avoids jsonb_array_elements / json_each variance)
  const [invoiceRows] = await sequelize.query(`
    SELECT payments FROM invoices
    WHERE shop_id = :shopId AND created_at >= :start AND created_at <= :end
      AND (status IS NULL OR status <> 'cancelled')
  `, { replacements: { shopId, start: start.toISOString(), end: end.toISOString() } });

  const paymentTotals = {};
  for (const row of invoiceRows) {
    let pArr = row.payments;
    if (typeof pArr === 'string') { try { pArr = JSON.parse(pArr); } catch { pArr = []; } }
    for (const p of (Array.isArray(pArr) ? pArr : [])) {
      const mode = p?.mode || 'unknown';
      paymentTotals[mode] = (paymentTotals[mode] || 0) + (Number(p?.amount) || 0);
    }
  }
  const payments = Object.entries(paymentTotals).map(([mode, total]) => ({ mode, total }));

  const [[moves]] = await sequelize.query(`
    SELECT COUNT(*) AS movement_count
    FROM inventory_movements
    WHERE shop_id = :shopId AND created_at >= :start AND created_at <= :end
  `, { replacements: { shopId, start: start.toISOString(), end: end.toISOString() } });

  return {
    date: start.toISOString().slice(0, 10),
    shop_id: shopId,
    device_id: branchConfig.device_id,
    invoices: inv,
    payments_by_mode: payments,
    inventory_movements: moves.movement_count,
    note: 'End-of-Day verifies reconciliation — local SQLite only',
  };
}
