import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

/**
 * business_date: the billing/business day a transaction counts toward,
 * independent of created_at. Stays pinned to the active (unclosed) business
 * day until Day Close advances it — see dailyClosingService.js
 * getActiveBillingDate/advanceActiveBillingDate.
 */
export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'invoices', 'business_date', {
    type: DataTypes.DATEONLY,
    allowNull: true,
  });
  await addColumnIfMissing(qi, 'payments', 'business_date', {
    type: DataTypes.DATEONLY,
    allowNull: true,
  });
  await addColumnIfMissing(qi, 'old_gold_receipts', 'business_date', {
    type: DataTypes.DATEONLY,
    allowNull: true,
  });
  await addColumnIfMissing(qi, 'credit_notes', 'business_date', {
    type: DataTypes.DATEONLY,
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'credit_notes', 'business_date');
  await removeColumnIfExists(qi, 'old_gold_receipts', 'business_date');
  await removeColumnIfExists(qi, 'payments', 'business_date');
  await removeColumnIfExists(qi, 'invoices', 'business_date');
}
