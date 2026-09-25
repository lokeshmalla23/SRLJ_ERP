'use strict';
/**
 * Migration 004 — rebuild sync_state to match Sequelize SyncState model.
 * Old schema: (shop_id, channel) PK — used 'channel' to identify direction.
 * New schema: id PK, (shop_id, device_id, direction) UNIQUE — matches Sequelize
 *             so sequelize.sync() can create its index without error.
 */
module.exports = {
  id: 4,
  name: 'sync_state_align',
  up(db) {
    db.exec(`
      DROP TABLE IF EXISTS sync_state;
      CREATE TABLE sync_state (
        id               TEXT PRIMARY KEY NOT NULL,
        shop_id          TEXT NOT NULL,
        device_id        TEXT NOT NULL DEFAULT '',
        direction        TEXT NOT NULL,
        cursor           TEXT,
        last_success_at  TEXT,
        last_error       TEXT,
        meta             TEXT NOT NULL DEFAULT '{}',
        created_at       TEXT,
        updated_at       TEXT
      );
      CREATE UNIQUE INDEX sync_state_shop_device_dir
        ON sync_state (shop_id, device_id, direction);
    `);
  },
};
