'use strict';
/**
 * Migration 018 — sub-category low stock threshold on categories.
 */
module.exports = {
  id: 18,
  name: 'category_low_stock_threshold',
  up(db) {
    const cols = db.pragma('table_info(categories)').map((c) => c.name);
    if (!cols.includes('low_stock_threshold')) {
      db.exec('ALTER TABLE categories ADD COLUMN low_stock_threshold REAL');
    }
  },
};
