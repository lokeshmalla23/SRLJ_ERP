/**
 * Default shop counter on categories — products inherit this when created.
 */
import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'categories', 'counter_id', {
    type: DataTypes.STRING,
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'categories', 'counter_id');
}
