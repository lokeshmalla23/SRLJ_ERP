'use strict';
/**
 * Migration 022 — pure gold/silver coins & biscuits inventory.
 */
module.exports = {
  id: 22,
  name: 'pure_products',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pure_products (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        metal TEXT NOT NULL,
        form_type TEXT NOT NULL,
        weight_g REAL NOT NULL,
        name TEXT NOT NULL,
        stock_qty REAL NOT NULL DEFAULT 0,
        low_stock_threshold REAL NOT NULL DEFAULT 0,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        origin_device_id TEXT,
        created_at TEXT,
        updated_at TEXT
      );
    `);
    try {
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS pure_products_shop_metal_form_weight_uk
        ON pure_products (shop_id, metal, form_type, weight_g);
      `);
    } catch { /* */ }
  },
};
