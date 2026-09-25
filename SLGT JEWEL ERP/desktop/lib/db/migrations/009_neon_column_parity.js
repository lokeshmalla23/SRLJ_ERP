'use strict';
/**
 * Migration 009 — align SQLite with Neon columns that were missing:
 *   products.piece_weight, products.tray_total_weight
 *   invoices.round_off
 *   quotations.salesperson_id
 */
module.exports = {
  id: 9,
  name: 'neon_column_parity',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);

    if (!col('products', 'piece_weight')) {
      db.exec(`ALTER TABLE products ADD COLUMN piece_weight REAL DEFAULT 0`);
    }
    if (!col('products', 'tray_total_weight')) {
      db.exec(`ALTER TABLE products ADD COLUMN tray_total_weight REAL DEFAULT 0`);
    }
    if (!col('invoices', 'round_off')) {
      db.exec(`ALTER TABLE invoices ADD COLUMN round_off REAL DEFAULT 0`);
    }
    if (!col('quotations', 'salesperson_id')) {
      db.exec(`ALTER TABLE quotations ADD COLUMN salesperson_id TEXT`);
    }
  },
};
