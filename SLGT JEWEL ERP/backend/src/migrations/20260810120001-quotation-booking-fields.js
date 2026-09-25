/**
 * Estimation booking fields: price lock, advance snapshot, booked_at.
 */
import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'quotations', 'price_locked', {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await addColumnIfMissing(qi, 'quotations', 'advance_paid', {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
    defaultValue: 0,
  });
  await addColumnIfMissing(qi, 'quotations', 'advance_id', {
    type: DataTypes.STRING,
    allowNull: true,
  });
  await addColumnIfMissing(qi, 'quotations', 'booked_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'quotations', 'booked_at');
  await removeColumnIfExists(qi, 'quotations', 'advance_id');
  await removeColumnIfExists(qi, 'quotations', 'advance_paid');
  await removeColumnIfExists(qi, 'quotations', 'price_locked');
}
