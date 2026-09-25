import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

/**
 * returned_at: when a full/partial return was processed against this
 * invoice, stamped on the shop's Transaction date (see
 * stampOnTransactionDate) — the return-path counterpart to cancelled_at,
 * so Daily Closing's Returns/Cancelled tile can bucket a return by the day
 * it actually happened, not the invoice's original billing day.
 */
export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'invoices', 'returned_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'invoices', 'returned_at');
}
