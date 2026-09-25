'use strict';
/**
 * Migration 017 — pure metal daily stock book (gold + silver opening/closing).
 */
module.exports = {
  id: 17,
  name: 'pure_metal_daily',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pure_metal_dailies (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        date TEXT NOT NULL,
        opening_gold_g REAL NOT NULL DEFAULT 0,
        opening_silver_g REAL NOT NULL DEFAULT 0,
        received_gold_g REAL NOT NULL DEFAULT 0,
        received_silver_g REAL NOT NULL DEFAULT 0,
        sold_gold_g REAL NOT NULL DEFAULT 0,
        sold_silver_g REAL NOT NULL DEFAULT 0,
        expected_closing_gold_g REAL NOT NULL DEFAULT 0,
        expected_closing_silver_g REAL NOT NULL DEFAULT 0,
        closing_gold_g REAL NOT NULL DEFAULT 0,
        closing_silver_g REAL NOT NULL DEFAULT 0,
        variance_gold_g REAL NOT NULL DEFAULT 0,
        variance_silver_g REAL NOT NULL DEFAULT 0,
        notes TEXT,
        snapshot_json TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        closed_by TEXT,
        closed_at TEXT,
        origin_device_id TEXT,
        created_at TEXT,
        updated_at TEXT
      );
    `);
    try {
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS pure_metal_dailies_shop_date_uk
        ON pure_metal_dailies (shop_id, date);
      `);
    } catch { /* */ }
  },
};
