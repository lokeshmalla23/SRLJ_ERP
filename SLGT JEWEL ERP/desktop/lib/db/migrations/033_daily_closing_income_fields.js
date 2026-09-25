'use strict';
/**
 * Migration 033 — Daily Closing "credit side": cash_income / total_income /
 * income_count, mirroring the existing expense fields, so cash reconciliation
 * accounts for Income entries the same way it already does Expenses.
 */
module.exports = {
  id: 33,
  name: 'daily_closing_income_fields',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);

    if (!col('daily_closings', 'cash_income')) {
      db.exec(`ALTER TABLE daily_closings ADD COLUMN cash_income REAL DEFAULT 0`);
    }
    if (!col('daily_closings', 'total_income')) {
      db.exec(`ALTER TABLE daily_closings ADD COLUMN total_income REAL DEFAULT 0`);
    }
    if (!col('daily_closings', 'income_count')) {
      db.exec(`ALTER TABLE daily_closings ADD COLUMN income_count INTEGER DEFAULT 0`);
    }
  },
};
