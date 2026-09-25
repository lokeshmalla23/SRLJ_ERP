/**
 * Chart of accounts, journals, and shop counters setting support (tables only).
 */
import { DataTypes } from 'sequelize';
import { tableExists } from './_helpers.js';

export async function up({ context: queryInterface }) {
  const qi = queryInterface;

  if (!(await tableExists(qi, 'chart_of_accounts'))) {
    await qi.createTable('chart_of_accounts', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      code: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      is_system: { type: DataTypes.BOOLEAN, defaultValue: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      updated_by_device_id: { type: DataTypes.STRING, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
  }

  if (!(await tableExists(qi, 'journal_entries'))) {
    await qi.createTable('journal_entries', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      entry_date: { type: DataTypes.DATEONLY, allowNull: false },
      memo: { type: DataTypes.STRING, allowNull: true },
      source_type: { type: DataTypes.STRING, allowNull: true },
      source_id: { type: DataTypes.STRING, allowNull: true },
      request_id: { type: DataTypes.STRING, allowNull: true },
      created_by: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      updated_by_device_id: { type: DataTypes.STRING, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
  }

  if (!(await tableExists(qi, 'journal_lines'))) {
    await qi.createTable('journal_lines', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      journal_entry_id: { type: DataTypes.STRING, allowNull: false },
      account_id: { type: DataTypes.STRING, allowNull: false },
      debit_paise: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      credit_paise: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      memo: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      updated_by_device_id: { type: DataTypes.STRING, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
  }

  if (!(await tableExists(qi, 'shop_counters'))) {
    await qi.createTable('shop_counters', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      code: { type: DataTypes.STRING, allowNull: true },
      device_id: { type: DataTypes.STRING, allowNull: true },
      is_default: { type: DataTypes.BOOLEAN, defaultValue: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      updated_by_device_id: { type: DataTypes.STRING, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
  }
}

export async function down({ context: queryInterface }) {
  await queryInterface.dropTable('journal_lines').catch(() => {});
  await queryInterface.dropTable('journal_entries').catch(() => {});
  await queryInterface.dropTable('chart_of_accounts').catch(() => {});
  await queryInterface.dropTable('shop_counters').catch(() => {});
}
