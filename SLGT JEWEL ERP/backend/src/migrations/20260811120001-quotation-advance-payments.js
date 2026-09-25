/**
 * Track multiple advance installments against a booked estimation.
 * Each entry: { advance_id, amount, mode, paid_at, reference }
 */
import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'quotations', 'advance_payments', {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'quotations', 'advance_payments');
}
