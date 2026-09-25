'use strict';
/**
 * Migration 026 — customers.aadhaar_number + invoices.aadhaar_number
 * Same pattern as pan_number: stored on the customer record and snapshotted
 * onto the invoice at billing time so historical invoices keep the Aadhaar
 * that was on file when billed.
 */
module.exports = {
  id: 26,
  name: 'customer_invoice_aadhaar',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);
    if (!col('customers', 'aadhaar_number')) {
      db.exec(`ALTER TABLE customers ADD COLUMN aadhaar_number TEXT`);
    }
    if (!col('invoices', 'aadhaar_number')) {
      db.exec(`ALTER TABLE invoices ADD COLUMN aadhaar_number TEXT`);
    }
  },
};
