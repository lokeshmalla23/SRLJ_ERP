import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

/**
 * categories.low_stock_threshold — sub-category level stock alert.
 * Total stock_qty of products under the sub-category is compared to this value.
 */
export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'categories', 'low_stock_threshold', {
    type: DataTypes.DECIMAL(14, 3),
    allowNull: true,
    defaultValue: null,
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'categories', 'low_stock_threshold');
}
