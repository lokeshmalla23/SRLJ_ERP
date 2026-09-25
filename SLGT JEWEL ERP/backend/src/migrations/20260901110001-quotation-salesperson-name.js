import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

/**
 * Snapshot of the salesperson's name at estimation time, printed as the
 * "Employee Name" on the estimation slip even if the employee record is
 * later renamed or removed.
 */
export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'quotations', 'salesperson_name', {
    type: DataTypes.STRING,
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'quotations', 'salesperson_name');
}
