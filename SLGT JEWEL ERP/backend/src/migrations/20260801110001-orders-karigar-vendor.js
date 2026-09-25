import { DataTypes } from 'sequelize';
import { addColumnIfMissing } from './_helpers.js';

export async function up({ context: qi }) {
  await addColumnIfMissing(qi, 'orders', 'karigar_vendor_id', {
    type: DataTypes.STRING,
    allowNull: true,
  });
}

export async function down({ context: qi }) {
  // SQLite doesn't support DROP COLUMN reliably — leave in place
}
