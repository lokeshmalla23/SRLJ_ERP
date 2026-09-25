import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

/**
 * cal_code: optional per-product code, shown on the product form when
 * Settings → Application Management → Cal Code is ON, and printable on the
 * barcode tag's left and/or right panel.
 */
export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'products', 'cal_code', {
    type: DataTypes.STRING,
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'products', 'cal_code');
}
