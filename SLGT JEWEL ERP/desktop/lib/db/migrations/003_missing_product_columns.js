'use strict';
/**
 * Migration 003 — add missing product columns omitted from 002's prodAdd list.
 */
module.exports = {
  id: 3,
  name: 'missing_product_columns',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);

    if (!col('products', 'description')) db.exec(`ALTER TABLE products ADD COLUMN description TEXT`);
    if (!col('products', 'vendor_id'))   db.exec(`ALTER TABLE products ADD COLUMN vendor_id TEXT`);
  },
};
