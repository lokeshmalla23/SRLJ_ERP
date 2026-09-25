'use strict';
/**
 * Migration 031 — Pure Metal Daily feature removed from Accounts; drop its table.
 */
module.exports = {
  id: 31,
  name: 'drop_pure_metal_daily',
  up(db) {
    db.exec(`DROP TABLE IF EXISTS pure_metal_dailies;`);
  },
};
