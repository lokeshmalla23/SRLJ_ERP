'use strict';
/**
 * Migration 010 — product code sequences per category prefix (RNG-0001, CHN-0002, …).
 */
module.exports = {
  id: 10,
  name: 'product_code_sequences',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS product_code_sequences (
        shop_id TEXT NOT NULL,
        prefix TEXT NOT NULL,
        next_value INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (shop_id, prefix)
      );
    `);
  },
};
