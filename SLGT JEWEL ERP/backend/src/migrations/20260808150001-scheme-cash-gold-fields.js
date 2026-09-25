import { DataTypes } from 'sequelize';
import { addColumnIfMissing, tableExists } from './_helpers.js';

/** Cash vs gold scheme fields on member schemes. */
export async function up({ context: queryInterface }) {
  if (!(await tableExists(queryInterface, 'schemes'))) return;
  await addColumnIfMissing(queryInterface, 'schemes', 'bonus_months', {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  });
  await addColumnIfMissing(queryInterface, 'schemes', 'plan_type', {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'amount',
  });
}

export async function down({ context: queryInterface }) {
  if (!(await tableExists(queryInterface, 'schemes'))) return;
  try { await queryInterface.removeColumn('schemes', 'bonus_months'); } catch { /* */ }
  try { await queryInterface.removeColumn('schemes', 'plan_type'); } catch { /* */ }
}
