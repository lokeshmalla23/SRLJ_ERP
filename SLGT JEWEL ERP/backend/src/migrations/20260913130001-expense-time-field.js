import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

/**
 * expenses.time — user-entered clock time (HH:MM), paired with the existing
 * `date` (DATEONLY) column so Expense entries can show a full "occurred at"
 * date+time in the ERP Statement/Day Book instead of only a bare date.
 * (incomes.time ships directly in the Income model/table — that table is new
 * this release and has no prior migration to layer onto.)
 */
export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'expenses', 'time', {
    type: DataTypes.STRING,
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'expenses', 'time');
}
