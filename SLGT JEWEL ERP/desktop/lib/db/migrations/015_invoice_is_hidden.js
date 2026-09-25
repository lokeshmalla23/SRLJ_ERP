'use strict';
/**
 * Migration 015 — invoices.is_hidden for owner-only non-GST bills.
 */
module.exports = {
  id: 15,
  name: 'invoice_is_hidden',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);
    if (!col('invoices', 'is_hidden')) {
      db.exec(`ALTER TABLE invoices ADD COLUMN is_hidden INTEGER DEFAULT 0`);
    }
  },
};
