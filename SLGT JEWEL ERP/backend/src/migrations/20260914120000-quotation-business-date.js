import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

/**
 * Quotations never got the business_date anchor that Invoice/Payment/CreditNote
 * already have — so a booked estimation's "Booked ..." date and its advance
 * installment dates showed the real system clock instead of the shop's current
 * transaction date, unlike everywhere else in the app.
 */
export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'quotations', 'business_date', {
    type: DataTypes.DATEONLY,
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'quotations', 'business_date');
}
