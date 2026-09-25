import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

/**
 * Tray unit support: total weight of the tray + derived per-piece weight
 * (tray_total_weight / stock_qty, rounded to 3 decimals). Both nullable —
 * only meaningful for products using the "Tray" unit.
 */
export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'products', 'tray_total_weight', {
    type: DataTypes.FLOAT,
    allowNull: true,
  });
  await addColumnIfMissing(qi, 'products', 'piece_weight', {
    type: DataTypes.FLOAT,
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'products', 'piece_weight');
  await removeColumnIfExists(qi, 'products', 'tray_total_weight');
}
