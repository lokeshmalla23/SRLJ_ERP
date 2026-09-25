'use strict';
/**
 * Migration 038 — optional product Cal Code (printable on barcode tags):
 *   products.cal_code
 */
module.exports = {
  id: 38,
  name: 'product_cal_code',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);

    if (col('products', 'id') && !col('products', 'cal_code')) {
      db.exec(`ALTER TABLE products ADD COLUMN cal_code TEXT`);
    }
  },
};
