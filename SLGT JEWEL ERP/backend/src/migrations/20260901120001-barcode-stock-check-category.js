import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

/**
 * Category-wise Barcode Stock Check: a session's scope is now optionally
 * pinned to one category (category_id null = existing "All Products"
 * behavior, unchanged). category_name is a snapshot so a session started
 * against "Rings" keeps showing "Rings" even if that category is later
 * renamed or deleted.
 */
export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'barcode_stock_check_sessions', 'category_id', {
    type: DataTypes.STRING,
    allowNull: true,
  });
  await addColumnIfMissing(qi, 'barcode_stock_check_sessions', 'category_name', {
    type: DataTypes.STRING,
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'barcode_stock_check_sessions', 'category_name');
  await removeColumnIfExists(qi, 'barcode_stock_check_sessions', 'category_id');
}
