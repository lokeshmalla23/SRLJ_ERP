'use strict';
/**
 * Migration 029 — Barcode Stock Check tables + category-wise session scope.
 *
 * These two tables (barcode_stock_check_sessions, barcode_stock_check_scans)
 * were previously only created by the cloud/Postgres umzug migration
 * (20260818210000-barcode-stock-check.js) — there was never a matching
 * desktop/SQLite migration, so Barcode Stock Check has been non-functional
 * on the desktop/offline build until now. This migration creates both
 * tables (mirroring the cloud schema exactly) and includes the new
 * category_id/category_name columns from the start.
 */
module.exports = {
  id: 29,
  name: 'barcode_stock_check',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);

    db.exec(`
      CREATE TABLE IF NOT EXISTS barcode_stock_check_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_by TEXT,
        device_id TEXT,
        category_id TEXT,
        category_name TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        reset_at TEXT,
        reset_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS barcode_stock_check_sessions_shop_status_idx
      ON barcode_stock_check_sessions (shop_id, status);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS barcode_stock_check_scans (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        shop_id TEXT,
        barcode TEXT NOT NULL,
        product_id TEXT,
        item_name TEXT,
        result TEXT NOT NULL,
        scanned_by TEXT,
        device_id TEXT,
        created_at TEXT NOT NULL
      );
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS barcode_stock_check_scans_session_barcode_idx
      ON barcode_stock_check_scans (session_id, barcode);
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS barcode_stock_check_scans_session_result_idx
      ON barcode_stock_check_scans (session_id, result);
    `);

    // Defensive: if the tables already existed from some earlier partial run
    // without the new columns, add them now.
    if (!col('barcode_stock_check_sessions', 'category_id')) {
      db.exec(`ALTER TABLE barcode_stock_check_sessions ADD COLUMN category_id TEXT`);
    }
    if (!col('barcode_stock_check_sessions', 'category_name')) {
      db.exec(`ALTER TABLE barcode_stock_check_sessions ADD COLUMN category_name TEXT`);
    }
  },
};
