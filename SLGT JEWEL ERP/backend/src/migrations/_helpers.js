/**
 * Migration helpers shared across Phase 2 migrations.
 */

export async function tableExists(qi, table) {
  const tables = await qi.showAllTables();
  const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t.table_name));
  return names.includes(table);
}

export async function columnExists(qi, table, column) {
  const desc = await qi.describeTable(table);
  return Object.prototype.hasOwnProperty.call(desc, column);
}

export async function addColumnIfMissing(qi, table, column, spec) {
  if (!(await tableExists(qi, table))) return false;
  if (await columnExists(qi, table, column)) return false;
  await qi.addColumn(table, column, spec);
  return true;
}

export async function removeColumnIfExists(qi, table, column) {
  if (!(await tableExists(qi, table))) return false;
  if (!(await columnExists(qi, table, column))) return false;
  await qi.removeColumn(table, column);
  return true;
}

/** Sequelize DataTypes passed from migration via context if needed — use raw SQL for indexes. */
export async function indexExists(sequelize, indexName) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = :name LIMIT 1`,
    { replacements: { name: indexName } }
  );
  return rows.length > 0;
}
