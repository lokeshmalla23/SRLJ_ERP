'use strict';
/**
 * Migration 030 — business_date on invoices, payments, old_gold_receipts,
 * credit_notes. The billing/business day a transaction counts toward,
 * independent of created_at — see backend dailyClosingService.js.
 */
module.exports = {
  id: 30,
  name: 'business_date',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);
    for (const table of ['invoices', 'payments', 'old_gold_receipts', 'credit_notes']) {
      if (!col(table, 'business_date')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN business_date TEXT`);
      }
    }
  },
};
