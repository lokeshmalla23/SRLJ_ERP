import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

/**
 * categories.default_metal_type_id — the default metal type (from the Metal
 * Types catalog) for products in this category, auto-filled in Inventory.
 */
export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'categories', 'default_metal_type_id', {
    type: DataTypes.STRING,
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'categories', 'default_metal_type_id');
}
