'use strict';
/**
 * Migration 034 — business_date on customer_advances, same concept as
 * migration 030 (invoices, payments, old_gold_receipts, credit_notes) —
 * extended here so advance receipts/refunds show the correct Transaction
 * date in Receipts/Accounts reports instead of falling back to created_at.
 */
module.exports = {
  id: 34,
  name: 'customer_advance_business_date',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);
    if (!col('customer_advances', 'business_date')) {
      db.exec(`ALTER TABLE customer_advances ADD COLUMN business_date TEXT`);
    }
  },
};
