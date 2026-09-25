import { DataTypes } from 'sequelize';
import { addColumnIfMissing, columnExists, tableExists } from './_helpers.js';

/**
 * Daily Closing: add cash_purchases so cash reconciliation (expected_cash)
 * accounts for cash paid out to vendors via Purchases, same as it already
 * accounts for Expenses and Income.
 */
export async function up({ context: queryInterface }) {
  if (!(await tableExists(queryInterface, 'daily_closings'))) return;

  await addColumnIfMissing(queryInterface, 'daily_closings', 'cash_purchases', {
    type: DataTypes.FLOAT, defaultValue: 0,
  });
}

export async function down({ context: queryInterface }) {
  if (!(await tableExists(queryInterface, 'daily_closings'))) return;
  if (await columnExists(queryInterface, 'daily_closings', 'cash_purchases')) {
    await queryInterface.removeColumn('daily_closings', 'cash_purchases');
  }
}
