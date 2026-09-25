'use strict';
/**
 * Migration 014 — daily closing snapshot + checklist JSON.
 */
module.exports = {
  id: 14,
  name: 'daily_closing_snapshot',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);

    if (!col('daily_closings', 'snapshot_json')) {
      db.exec(`ALTER TABLE daily_closings ADD COLUMN snapshot_json TEXT`);
    }
    if (!col('daily_closings', 'checklist_json')) {
      db.exec(`ALTER TABLE daily_closings ADD COLUMN checklist_json TEXT DEFAULT '{}'`);
    }
  },
};
