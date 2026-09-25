'use strict';
/**
 * Migration 005 — add created_at (and updated_at where missing) to every
 * table that Sequelize touches with timestamps:true + underscored:true.
 * Rows that existed before get created_at = updated_at (or datetime('now')).
 */
module.exports = {
  id: 5,
  name: 'add_created_at',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);

    const tables = [
      'shops', 'devices', 'users', 'employees',
      'customers', 'products', 'quotations', 'orders', 'schemes',
    ];

    for (const t of tables) {
      // Add updated_at first (devices is missing it entirely)
      if (!col(t, 'updated_at')) {
        db.exec(`ALTER TABLE ${t} ADD COLUMN updated_at TEXT`);
      }
      // Add created_at defaulting to updated_at so existing rows have a sane value
      if (!col(t, 'created_at')) {
        db.exec(`ALTER TABLE ${t} ADD COLUMN created_at TEXT`);
        db.exec(`UPDATE ${t} SET created_at = COALESCE(updated_at, datetime('now')) WHERE created_at IS NULL`);
      }
    }
  },
};
