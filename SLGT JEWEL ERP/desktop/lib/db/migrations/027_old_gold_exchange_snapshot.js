'use strict';
/**
 * Migration 027 — old_gold_receipts customer/invoice snapshots + quotations.old_gold
 * Same rationale as the cloud migration: the Old Gold Exchange report needs
 * customer/invoice details snapshotted on the receipt (historically accurate
 * even if the customer/invoice changes later), and Estimation's Old Metal
 * Exchange calculator needs somewhere to persist its {weight, purity, rate, value}.
 */
module.exports = {
  id: 27,
  name: 'old_gold_exchange_snapshot',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);
    if (!col('old_gold_receipts', 'customer_name')) {
      db.exec(`ALTER TABLE old_gold_receipts ADD COLUMN customer_name TEXT`);
    }
    if (!col('old_gold_receipts', 'customer_phone')) {
      db.exec(`ALTER TABLE old_gold_receipts ADD COLUMN customer_phone TEXT`);
    }
    if (!col('old_gold_receipts', 'invoice_no')) {
      db.exec(`ALTER TABLE old_gold_receipts ADD COLUMN invoice_no TEXT`);
    }
    if (!col('old_gold_receipts', 'invoice_serial')) {
      db.exec(`ALTER TABLE old_gold_receipts ADD COLUMN invoice_serial INTEGER`);
    }
    if (!col('quotations', 'old_gold')) {
      db.exec(`ALTER TABLE quotations ADD COLUMN old_gold TEXT`);
    }
  },
};
