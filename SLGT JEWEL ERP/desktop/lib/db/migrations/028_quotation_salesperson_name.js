'use strict';
/**
 * Migration 028 — quotations.salesperson_name
 * Snapshot of the salesperson's name at estimation time, printed as the
 * "Employee Name" on the estimation slip even if the employee record is
 * later renamed or removed.
 */
module.exports = {
  id: 28,
  name: 'quotation_salesperson_name',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);
    if (!col('quotations', 'salesperson_name')) {
      db.exec(`ALTER TABLE quotations ADD COLUMN salesperson_name TEXT`);
    }
  },
};
