import { DataTypes } from 'sequelize';
import { addColumnIfMissing } from './_helpers.js';

export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'old_gold_receipts', 'metal', {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'gold',
  });
  await addColumnIfMissing(qi, 'old_gold_sales', 'metal', {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'gold',
  });
  await addColumnIfMissing(qi, 'invoices', 'old_silver_value', {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
    defaultValue: 0,
  });
  await addColumnIfMissing(qi, 'quotations', 'old_silver', {
    type: DataTypes.JSONB,
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  const { removeColumnIfExists } = await import('./_helpers.js');
  await removeColumnIfExists(qi, 'quotations', 'old_silver');
  await removeColumnIfExists(qi, 'invoices', 'old_silver_value');
  await removeColumnIfExists(qi, 'old_gold_sales', 'metal');
  await removeColumnIfExists(qi, 'old_gold_receipts', 'metal');
}
