import { DataTypes } from 'sequelize';
import { addColumnIfMissing, tableExists } from './_helpers.js';

/** Hidden / non-GST bills flag on invoices. */
export async function up({ context: queryInterface }) {
  if (!(await tableExists(queryInterface, 'invoices'))) return;
  await addColumnIfMissing(queryInterface, 'invoices', 'is_hidden', {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
}

export async function down({ context: queryInterface }) {
  if (!(await tableExists(queryInterface, 'invoices'))) return;
  try {
    await queryInterface.removeColumn('invoices', 'is_hidden');
  } catch { /* */ }
}
