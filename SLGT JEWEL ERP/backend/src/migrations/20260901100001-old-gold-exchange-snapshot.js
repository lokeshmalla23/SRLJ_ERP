import { DataTypes } from 'sequelize';
import { addColumnIfMissing } from './_helpers.js';

/**
 * Old Gold Exchange report needs customer/invoice snapshots on the receipt
 * itself (historically accurate even if the customer/invoice changes later),
 * plus the raw invoice sequence number ("Invoice Serial Number").
 */
export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'old_gold_receipts', 'customer_name', {
    type: DataTypes.STRING,
    allowNull: true,
  });
  await addColumnIfMissing(qi, 'old_gold_receipts', 'customer_phone', {
    type: DataTypes.STRING,
    allowNull: true,
  });
  await addColumnIfMissing(qi, 'old_gold_receipts', 'invoice_no', {
    type: DataTypes.STRING,
    allowNull: true,
  });
  await addColumnIfMissing(qi, 'old_gold_receipts', 'invoice_serial', {
    type: DataTypes.INTEGER,
    allowNull: true,
  });

  // Estimation "Old Metal Exchange" calculator — {active, weight, purity, rate, value}
  await addColumnIfMissing(qi, 'quotations', 'old_gold', {
    type: DataTypes.JSONB,
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  const { removeColumnIfExists } = await import('./_helpers.js');
  await removeColumnIfExists(qi, 'quotations', 'old_gold');
  await removeColumnIfExists(qi, 'old_gold_receipts', 'invoice_serial');
  await removeColumnIfExists(qi, 'old_gold_receipts', 'invoice_no');
  await removeColumnIfExists(qi, 'old_gold_receipts', 'customer_phone');
  await removeColumnIfExists(qi, 'old_gold_receipts', 'customer_name');
}
