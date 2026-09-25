/**
 * catalog_items.is_system — protect built-in metal/unit/purity masters from delete.
 */
import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'catalog_items', 'is_system', {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'catalog_items', 'is_system');
}
