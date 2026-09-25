import { DataTypes } from 'sequelize';
import { addColumnIfMissing, tableExists } from './_helpers.js';

/** Snapshot customer address + per-invoice detailed stone bill flag. */
export async function up({ context: queryInterface }) {
  if (!(await tableExists(queryInterface, 'invoices'))) return;
  await addColumnIfMissing(queryInterface, 'invoices', 'customer_address', {
    type: DataTypes.TEXT,
    allowNull: true,
  });
  await addColumnIfMissing(queryInterface, 'invoices', 'detailed_stone_bill', {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
}

export async function down({ context: queryInterface }) {
  if (!(await tableExists(queryInterface, 'invoices'))) return;
  try { await queryInterface.removeColumn('invoices', 'detailed_stone_bill'); } catch { /* */ }
  try { await queryInterface.removeColumn('invoices', 'customer_address'); } catch { /* */ }
}
