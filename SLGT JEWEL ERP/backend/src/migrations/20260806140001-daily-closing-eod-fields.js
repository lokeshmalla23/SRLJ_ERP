import { DataTypes } from 'sequelize';
import { addColumnIfMissing, columnExists, tableExists } from './_helpers.js';

/**
 * Enrich daily_closings for proper EOD: variance, expected cash, counts, closed_at.
 * Also ensure unique (shop_id, date) for multi-device offline shops.
 */
export async function up({ context: queryInterface }) {
  if (!(await tableExists(queryInterface, 'daily_closings'))) return;

  await addColumnIfMissing(queryInterface, 'daily_closings', 'expected_cash', {
    type: DataTypes.FLOAT, defaultValue: 0,
  });
  await addColumnIfMissing(queryInterface, 'daily_closings', 'variance', {
    type: DataTypes.FLOAT, defaultValue: 0,
  });
  await addColumnIfMissing(queryInterface, 'daily_closings', 'cash_expenses', {
    type: DataTypes.FLOAT, defaultValue: 0,
  });
  await addColumnIfMissing(queryInterface, 'daily_closings', 'invoice_count', {
    type: DataTypes.INTEGER, defaultValue: 0,
  });
  await addColumnIfMissing(queryInterface, 'daily_closings', 'expense_count', {
    type: DataTypes.INTEGER, defaultValue: 0,
  });
  await addColumnIfMissing(queryInterface, 'daily_closings', 'closed_at', {
    type: DataTypes.DATE, allowNull: true,
  });

  const sequelize = queryInterface.sequelize;
  // Drop legacy single-column unique on date if present (Postgres)
  try {
    await sequelize.query(`ALTER TABLE daily_closings DROP CONSTRAINT IF EXISTS daily_closings_date_key`);
  } catch { /* sqlite / absent */ }
  try {
    await sequelize.query(`DROP INDEX IF EXISTS daily_closings_date_uk`);
  } catch { /* */ }

  // Unique per shop + date (idempotent)
  try {
    await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS daily_closings_shop_date_uk
      ON daily_closings (shop_id, date)
    `);
  } catch { /* already exists or dialect quirk */ }
}

export async function down({ context: queryInterface }) {
  if (!(await tableExists(queryInterface, 'daily_closings'))) return;
  for (const col of ['expected_cash', 'variance', 'cash_expenses', 'invoice_count', 'expense_count', 'closed_at']) {
    if (await columnExists(queryInterface, 'daily_closings', col)) {
      await queryInterface.removeColumn('daily_closings', col);
    }
  }
}
