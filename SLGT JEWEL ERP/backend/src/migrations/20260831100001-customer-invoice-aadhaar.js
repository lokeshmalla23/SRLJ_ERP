import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists } from './_helpers.js';

/**
 * Aadhaar number, alongside the existing PAN fields, on customers and as an
 * invoice-time snapshot (same pattern as pan_number/customer_address) so
 * historical invoices keep the Aadhaar that was on file when billed.
 */
export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'customers', 'aadhaar_number', {
    type: DataTypes.STRING,
    allowNull: true,
  });
  await addColumnIfMissing(qi, 'invoices', 'aadhaar_number', {
    type: DataTypes.STRING,
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  await removeColumnIfExists(qi, 'invoices', 'aadhaar_number');
  await removeColumnIfExists(qi, 'customers', 'aadhaar_number');
}
