'use strict';
const { randomUUID } = require('crypto');

let _db = null;
let _deviceShort = null;
let _shopPrefix = null;

function init(db, deviceId, shopPrefix) {
  _db = db;
  _deviceShort = (deviceId || randomUUID()).replace(/-/g, '').slice(0, 4).toUpperCase();
  _shopPrefix = (shopPrefix || 'INV').toUpperCase().slice(0, 6);
}

/**
 * Allocate the next invoice number for this device.
 * Format: {PREFIX}-{DEVICE_SHORT}-{YYMMDD}-{SEQ:04d}
 * Atomic SQLite operation — race-safe within this process.
 * @returns {string}
 */
function allocate() {
  if (!_db) throw new Error('invoiceSequence not initialised — call init() first');

  const now = new Date();
  const seqDate = [
    String(now.getFullYear()).slice(2),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');

  // Ensure table exists (idempotent)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_sequences (
      id           TEXT PRIMARY KEY,
      shop_prefix  TEXT NOT NULL,
      device_short TEXT NOT NULL,
      seq_date     TEXT NOT NULL,
      next_value   INTEGER NOT NULL DEFAULT 1,
      UNIQUE(shop_prefix, device_short, seq_date)
    )
  `);

  const row = _db.prepare(`
    INSERT INTO invoice_sequences (id, shop_prefix, device_short, seq_date, next_value)
    VALUES (?, ?, ?, ?, 2)
    ON CONFLICT(shop_prefix, device_short, seq_date) DO UPDATE
      SET next_value = next_value + 1
    RETURNING next_value - 1 AS allocated
  `).get(randomUUID(), _shopPrefix, _deviceShort, seqDate);

  const seq = String(row.allocated).padStart(4, '0');
  return `${_shopPrefix}-${_deviceShort}-${seqDate}-${seq}`;
}

/**
 * Preview the next number without allocating it (for display only).
 */
function preview() {
  if (!_db) return null;
  const now = new Date();
  const seqDate = [
    String(now.getFullYear()).slice(2),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_sequences (
      id TEXT PRIMARY KEY, shop_prefix TEXT NOT NULL, device_short TEXT NOT NULL,
      seq_date TEXT NOT NULL, next_value INTEGER NOT NULL DEFAULT 1,
      UNIQUE(shop_prefix, device_short, seq_date)
    )
  `);

  const row = _db.prepare(`
    SELECT next_value FROM invoice_sequences
    WHERE shop_prefix = ? AND device_short = ? AND seq_date = ?
  `).get(_shopPrefix, _deviceShort, seqDate);

  const next = row ? row.next_value : 1;
  return `${_shopPrefix}-${_deviceShort}-${seqDate}-${String(next).padStart(4, '0')}`;
}

module.exports = { init, allocate, preview };
