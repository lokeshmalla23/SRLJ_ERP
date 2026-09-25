import { DataTypes } from 'sequelize';
import { addColumnIfMissing, tableExists } from './_helpers.js';

/**
 * Persist full EOD report + checklist on daily_closings.
 */
export async function up({ context: queryInterface }) {
  if (!(await tableExists(queryInterface, 'daily_closings'))) return;

  await addColumnIfMissing(queryInterface, 'daily_closings', 'snapshot_json', {
    type: DataTypes.JSONB,
    allowNull: true,
  });
  await addColumnIfMissing(queryInterface, 'daily_closings', 'checklist_json', {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: {},
  });
}

export async function down({ context: queryInterface }) {
  if (!(await tableExists(queryInterface, 'daily_closings'))) return;
  try {
    await queryInterface.removeColumn('daily_closings', 'snapshot_json');
  } catch { /* */ }
  try {
    await queryInterface.removeColumn('daily_closings', 'checklist_json');
  } catch { /* */ }
}
