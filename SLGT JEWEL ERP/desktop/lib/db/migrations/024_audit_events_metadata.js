'use strict';
/**
 * Migration 024 — add desktop audit columns when the table was created by
 * the backend Sequelize schema (seq/hash) without metadata_json / request_id.
 */
module.exports = {
  id: 24,
  name: 'audit_events_metadata',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);
    if (!col('audit_events', 'id')) return;
    if (!col('audit_events', 'metadata_json')) {
      db.exec(`ALTER TABLE audit_events ADD COLUMN metadata_json TEXT DEFAULT '{}'`);
    }
    if (!col('audit_events', 'request_id')) {
      db.exec(`ALTER TABLE audit_events ADD COLUMN request_id TEXT`);
    }
  },
};
