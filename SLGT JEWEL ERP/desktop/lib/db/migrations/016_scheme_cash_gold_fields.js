'use strict';
/**
 * Migration 016 — schemes.bonus_months + plan_type for cash 11+1 vs gold gram schemes.
 */
module.exports = {
  id: 16,
  name: 'scheme_cash_gold_fields',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);
    if (!col('schemes', 'bonus_months')) {
      db.exec(`ALTER TABLE schemes ADD COLUMN bonus_months INTEGER DEFAULT 1`);
    }
    if (!col('schemes', 'plan_type')) {
      db.exec(`ALTER TABLE schemes ADD COLUMN plan_type TEXT DEFAULT 'amount'`);
    }
  },
};
