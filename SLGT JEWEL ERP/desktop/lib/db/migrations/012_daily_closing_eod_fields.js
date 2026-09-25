'use strict';
/**
 * Migration 012 — daily closing EOD fields for offline CRM.
 */
module.exports = {
  id: 12,
  name: 'daily_closing_eod_fields',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);

    if (!col('daily_closings', 'expected_cash')) {
      db.exec(`ALTER TABLE daily_closings ADD COLUMN expected_cash REAL DEFAULT 0`);
    }
    if (!col('daily_closings', 'variance')) {
      db.exec(`ALTER TABLE daily_closings ADD COLUMN variance REAL DEFAULT 0`);
    }
    if (!col('daily_closings', 'cash_expenses')) {
      db.exec(`ALTER TABLE daily_closings ADD COLUMN cash_expenses REAL DEFAULT 0`);
    }
    if (!col('daily_closings', 'invoice_count')) {
      db.exec(`ALTER TABLE daily_closings ADD COLUMN invoice_count INTEGER DEFAULT 0`);
    }
    if (!col('daily_closings', 'expense_count')) {
      db.exec(`ALTER TABLE daily_closings ADD COLUMN expense_count INTEGER DEFAULT 0`);
    }
    if (!col('daily_closings', 'closed_at')) {
      db.exec(`ALTER TABLE daily_closings ADD COLUMN closed_at TEXT`);
    }

    db.exec(`DROP INDEX IF EXISTS daily_closings_date_uk`);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS daily_closings_shop_date_uk
      ON daily_closings (shop_id, date)
    `);
  },
};
