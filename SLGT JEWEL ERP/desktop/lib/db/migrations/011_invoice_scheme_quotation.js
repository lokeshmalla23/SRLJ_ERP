/**
 * Migration 011 — invoice scheme credit + quotation link columns
 */
module.exports = {
  id: 11,
  name: 'invoice_scheme_quotation_columns',
  up(db) {
    const cols = db.prepare(`PRAGMA table_info(invoices)`).all().map((c) => c.name);
    if (!cols.includes('scheme_credit')) {
      db.exec(`ALTER TABLE invoices ADD COLUMN scheme_credit REAL NOT NULL DEFAULT 0`);
    }
    if (!cols.includes('scheme_id')) {
      db.exec(`ALTER TABLE invoices ADD COLUMN scheme_id TEXT`);
    }
    if (!cols.includes('quotation_id')) {
      db.exec(`ALTER TABLE invoices ADD COLUMN quotation_id TEXT`);
    }
  },
};
