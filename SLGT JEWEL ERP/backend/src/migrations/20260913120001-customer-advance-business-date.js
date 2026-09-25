import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

/**
 * customer_advances.business_date — same "active billing day" concept already
 * on invoices/payments/old_gold_receipts/credit_notes (see
 * 20260907130001-business-date.js), extended to advance receipts so Receipts/
 * Accounts reports show the same Transaction date for these too.
 */
export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'customer_advances', 'business_date', {
    type: DataTypes.DATEONLY,
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'customer_advances', 'business_date');
}
