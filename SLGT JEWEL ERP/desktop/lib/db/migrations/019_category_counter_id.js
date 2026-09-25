'use strict';
/**
 * Migration 019 — default counter on categories (products inherit it).
 */
module.exports = {
  id: 19,
  name: 'category_counter_id',
  up(db) {
    const cols = db.pragma('table_info(categories)').map((c) => c.name);
    if (!cols.includes('counter_id')) {
      db.exec('ALTER TABLE categories ADD COLUMN counter_id TEXT');
    }
  },
};
