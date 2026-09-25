'use strict';
/**
 * Migration 025 — invoices.customer_address + invoices.detailed_stone_bill
 */
module.exports = {
  id: 25,
  name: 'invoice_address_detailed_stone',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);
    if (!col('invoices', 'customer_address')) {
      db.exec(`ALTER TABLE invoices ADD COLUMN customer_address TEXT`);
    }
    if (!col('invoices', 'detailed_stone_bill')) {
      db.exec(`ALTER TABLE invoices ADD COLUMN detailed_stone_bill INTEGER NOT NULL DEFAULT 0`);
    }
  },
};
