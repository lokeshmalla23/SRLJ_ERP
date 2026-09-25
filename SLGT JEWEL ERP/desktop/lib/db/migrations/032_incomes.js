'use strict';
/**
 * Migration 032 — Income entries (Accounts & Finance): miscellaneous cash/bank
 * receipts not tied to a sales invoice. Mirrors the "expenses" table shape,
 * minus category fields (income has none).
 */
module.exports = {
  id: 32,
  name: 'incomes',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS incomes (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        description TEXT,
        amount REAL NOT NULL DEFAULT 0,
        payment_mode TEXT,
        reference TEXT,
        date TEXT,
        time TEXT,
        notes TEXT,
        created_by TEXT,
        financial_mode TEXT,
        origin_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );
    `);
  },
};
