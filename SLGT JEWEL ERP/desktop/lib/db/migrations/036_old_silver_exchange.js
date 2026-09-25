'use strict';
/**
 * Migration 036 — Old Silver Exchange (parallel to old gold):
 *   metal on receipts/sales, invoice.old_silver_value, quotation.old_silver JSON.
 */
module.exports = {
  id: 36,
  name: 'old_silver_exchange',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);

    if (col('old_gold_receipts', 'id') && !col('old_gold_receipts', 'metal')) {
      db.exec(`ALTER TABLE old_gold_receipts ADD COLUMN metal TEXT NOT NULL DEFAULT 'gold'`);
    }
    if (col('old_gold_sales', 'id') && !col('old_gold_sales', 'metal')) {
      db.exec(`ALTER TABLE old_gold_sales ADD COLUMN metal TEXT NOT NULL DEFAULT 'gold'`);
    }
    if (col('invoices', 'id') && !col('invoices', 'old_silver_value')) {
      db.exec(`ALTER TABLE invoices ADD COLUMN old_silver_value REAL NOT NULL DEFAULT 0`);
    }
    if (col('quotations', 'id') && !col('quotations', 'old_silver')) {
      db.exec(`ALTER TABLE quotations ADD COLUMN old_silver TEXT`);
    }
  },
};
