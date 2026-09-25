'use strict';
/**
 * Migration 021 — catalog_items.is_system for built-in masters.
 */
module.exports = {
  id: 21,
  name: 'catalog_is_system',
  up(db) {
    const cols = db.pragma('table_info(catalog_items)').map((c) => c.name);
    if (!cols.includes('is_system')) {
      db.exec('ALTER TABLE catalog_items ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0');
    }
  },
};
