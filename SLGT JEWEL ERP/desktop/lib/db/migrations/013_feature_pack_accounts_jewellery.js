'use strict';
module.exports = {
  id: 13,
  name: 'feature_pack_accounts_jewellery',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);
    const hasTable = (name) =>
      db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);

    if (!hasTable('cashbook_entries')) {
      db.exec(`
        CREATE TABLE cashbook_entries (
          id TEXT PRIMARY KEY NOT NULL,
          shop_id TEXT,
          date TEXT NOT NULL,
          entry_type TEXT NOT NULL,
          mode TEXT NOT NULL DEFAULT 'cash',
          amount REAL NOT NULL,
          contra INTEGER DEFAULT 0,
          reference TEXT,
          notes TEXT,
          linked_expense_id TEXT,
          linked_invoice_id TEXT,
          created_by TEXT,
          origin_device_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT
        );
        CREATE INDEX IF NOT EXISTS cashbook_shop_date_idx ON cashbook_entries (shop_id, date);
      `);
    }

    if (!hasTable('metal_issues')) {
      db.exec(`
        CREATE TABLE metal_issues (
          id TEXT PRIMARY KEY NOT NULL,
          shop_id TEXT,
          order_id TEXT,
          karigar_vendor_id TEXT NOT NULL,
          movement_type TEXT NOT NULL,
          metal_type TEXT,
          purity TEXT,
          weight REAL NOT NULL DEFAULT 0,
          scrap_weight REAL DEFAULT 0,
          notes TEXT,
          created_by TEXT,
          origin_device_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT
        );
      `);
    }

    if (!hasTable('gold_rate_history')) {
      db.exec(`
        CREATE TABLE gold_rate_history (
          id TEXT PRIMARY KEY NOT NULL,
          shop_id TEXT,
          rates TEXT NOT NULL DEFAULT '{}',
          changed_by TEXT,
          source TEXT DEFAULT 'settings',
          origin_device_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    }

    if (!hasTable('billing_rate_events')) {
      db.exec(`
        CREATE TABLE billing_rate_events (
          id TEXT PRIMARY KEY NOT NULL,
          shop_id TEXT,
          event_type TEXT NOT NULL,
          gold_rate REAL,
          previous_rate REAL,
          invoice_id TEXT,
          user_id TEXT,
          meta TEXT NOT NULL DEFAULT '{}',
          origin_device_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    }

    if (hasTable('employees') && !col('employees', 'commission_pct')) {
      db.exec(`ALTER TABLE employees ADD COLUMN commission_pct REAL DEFAULT 0`);
    }
    if (hasTable('employees') && !col('employees', 'commission_on')) {
      db.exec(`ALTER TABLE employees ADD COLUMN commission_on TEXT DEFAULT 'making'`);
    }
    if (hasTable('old_gold_receipts') && !col('old_gold_receipts', 'status')) {
      db.exec(`ALTER TABLE old_gold_receipts ADD COLUMN status TEXT DEFAULT 'received'`);
    }
    if (hasTable('old_gold_receipts') && !col('old_gold_receipts', 'trail_notes')) {
      db.exec(`ALTER TABLE old_gold_receipts ADD COLUMN trail_notes TEXT`);
    }
    if (hasTable('journal_entries') && !col('journal_entries', 'voucher_type')) {
      db.exec(`ALTER TABLE journal_entries ADD COLUMN voucher_type TEXT DEFAULT 'auto'`);
    }
    if (hasTable('journal_entries') && !col('journal_entries', 'voucher_no')) {
      db.exec(`ALTER TABLE journal_entries ADD COLUMN voucher_no TEXT`);
    }
  },
};
