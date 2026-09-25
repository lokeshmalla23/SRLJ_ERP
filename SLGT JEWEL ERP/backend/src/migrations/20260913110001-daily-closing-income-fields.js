import { DataTypes } from 'sequelize';
import { addColumnIfMissing, columnExists, tableExists } from './_helpers.js';

/**
 * Daily Closing "credit side": add cash_income / total_income / income_count
 * so the cash reconciliation (expected_cash) can account for miscellaneous
 * Income entries the same way it already accounts for Expenses.
 */
export async function up({ context: queryInterface }) {
  if (!(await tableExists(queryInterface, 'daily_closings'))) return;

  await addColumnIfMissing(queryInterface, 'daily_closings', 'cash_income', {
    type: DataTypes.FLOAT, defaultValue: 0,
  });
  await addColumnIfMissing(queryInterface, 'daily_closings', 'total_income', {
    type: DataTypes.FLOAT, defaultValue: 0,
  });
  await addColumnIfMissing(queryInterface, 'daily_closings', 'income_count', {
    type: DataTypes.INTEGER, defaultValue: 0,
  });
}

export async function down({ context: queryInterface }) {
  if (!(await tableExists(queryInterface, 'daily_closings'))) return;
  for (const col of ['cash_income', 'total_income', 'income_count']) {
    if (await columnExists(queryInterface, 'daily_closings', col)) {
      await queryInterface.removeColumn('daily_closings', col);
    }
  }
}
