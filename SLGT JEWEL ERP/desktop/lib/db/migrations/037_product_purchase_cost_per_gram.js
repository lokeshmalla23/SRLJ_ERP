'use strict';
/**
 * Migration 037 — tray purchase cost per gram (weight-based tray COGS):
 *   products.purchase_cost_per_gram
 */
module.exports = {
  id: 37,
  name: 'product_purchase_cost_per_gram',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);

    if (col('products', 'id') && !col('products', 'purchase_cost_per_gram')) {
      db.exec(`ALTER TABLE products ADD COLUMN purchase_cost_per_gram REAL`);
    }
  },
};
