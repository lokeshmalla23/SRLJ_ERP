'use strict';
/**
 * Migration 008 — align inventory_movements with Neon / Sequelize model.
 * POS checkout writes gross_weight, net_weight, stone_weight, created_by, meta.
 */
module.exports = {
  id: 8,
  name: 'inventory_movements_weights',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);

    if (!col('inventory_movements', 'gross_weight')) {
      db.exec(`ALTER TABLE inventory_movements ADD COLUMN gross_weight REAL NOT NULL DEFAULT 0`);
    }
    if (!col('inventory_movements', 'net_weight')) {
      db.exec(`ALTER TABLE inventory_movements ADD COLUMN net_weight REAL NOT NULL DEFAULT 0`);
    }
    if (!col('inventory_movements', 'stone_weight')) {
      db.exec(`ALTER TABLE inventory_movements ADD COLUMN stone_weight REAL NOT NULL DEFAULT 0`);
    }
    if (!col('inventory_movements', 'created_by')) {
      db.exec(`ALTER TABLE inventory_movements ADD COLUMN created_by TEXT`);
    }
    if (!col('inventory_movements', 'meta')) {
      db.exec(`ALTER TABLE inventory_movements ADD COLUMN meta TEXT NOT NULL DEFAULT '{}'`);
    }
  },
};
