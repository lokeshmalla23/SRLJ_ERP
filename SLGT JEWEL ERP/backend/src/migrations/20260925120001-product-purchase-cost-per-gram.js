import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

/**
 * purchase_cost_per_gram: tray unit only — total tray purchase amount ÷ tray
 * weight, fixed at create. Tray COGS and stock valuation are weight-based
 * (see services/productCost.js), since tray_total_weight shrinks per sale.
 */
export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'products', 'purchase_cost_per_gram', {
    type: DataTypes.DECIMAL(14, 4),
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'products', 'purchase_cost_per_gram');
}
