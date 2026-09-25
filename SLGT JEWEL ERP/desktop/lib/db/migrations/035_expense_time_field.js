'use strict';
/**
 * Migration 035 — expenses.time: user-entered clock time (HH:MM), paired
 * with the existing `date` column so Expense entries can show a full
 * "occurred at" date+time in the ERP Statement/Day Book instead of a bare
 * date. (incomes.time ships directly in migration 032 — that table is new.)
 */
module.exports = {
  id: 35,
  name: 'expense_time_field',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);
    if (!col('expenses', 'time')) {
      db.exec(`ALTER TABLE expenses ADD COLUMN time TEXT`);
    }
  },
};
