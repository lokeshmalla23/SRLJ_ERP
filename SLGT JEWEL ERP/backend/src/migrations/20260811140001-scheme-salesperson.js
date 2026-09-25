/**
 * Attribute scheme enrollments to the employee who registered them.
 */
import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'schemes', 'salesperson_id', {
    type: DataTypes.STRING,
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'schemes', 'salesperson_id');
}
