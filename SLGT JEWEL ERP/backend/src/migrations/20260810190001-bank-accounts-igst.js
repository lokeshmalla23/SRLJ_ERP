/**
 * Bank accounts + reconciliation lines; IGST columns on invoices/purchases.
 */
import { DataTypes } from 'sequelize';
import { tableExists, addColumnIfMissing } from './_helpers.js';

export async function up({ context: queryInterface }) {
  const qi = queryInterface;

  if (!(await tableExists(qi, 'bank_accounts'))) {
    await qi.createTable('bank_accounts', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      bank_name: { type: DataTypes.STRING, allowNull: true },
      account_number: { type: DataTypes.STRING, allowNull: true },
      ifsc: { type: DataTypes.STRING, allowNull: true },
      /** Maps to CoA: 1010 bank | 1020 upi | 1030 card */
      gl_code: { type: DataTypes.STRING, allowNull: false, defaultValue: '1010' },
      opening_balance: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      notes: { type: DataTypes.TEXT, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
  }

  if (!(await tableExists(qi, 'bank_reconciliation_items'))) {
    await qi.createTable('bank_reconciliation_items', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      bank_account_id: { type: DataTypes.STRING, allowNull: false },
      journal_entry_id: { type: DataTypes.STRING, allowNull: true },
      journal_line_id: { type: DataTypes.STRING, allowNull: true },
      entry_date: { type: DataTypes.DATEONLY, allowNull: true },
      description: { type: DataTypes.STRING, allowNull: true },
      amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      /** unmatched | matched | pending */
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'unmatched' },
      statement_ref: { type: DataTypes.STRING, allowNull: true },
      statement_date: { type: DataTypes.DATEONLY, allowNull: true },
      reconciled_at: { type: DataTypes.DATE, allowNull: true },
      reconciled_by: { type: DataTypes.STRING, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
  }

  await addColumnIfMissing(qi, 'invoices', 'igst_amount', {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
    defaultValue: 0,
  });
  await addColumnIfMissing(qi, 'invoices', 'tax_type', {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'intra',
  });
  await addColumnIfMissing(qi, 'purchases', 'igst_amount', {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
    defaultValue: 0,
  });
  await addColumnIfMissing(qi, 'purchases', 'cgst_amount', {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
    defaultValue: 0,
  });
  await addColumnIfMissing(qi, 'purchases', 'sgst_amount', {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
    defaultValue: 0,
  });
  await addColumnIfMissing(qi, 'purchases', 'tax_type', {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'intra',
  });
}

export async function down({ context: queryInterface }) {
  await queryInterface.dropTable('bank_reconciliation_items').catch(() => {});
  await queryInterface.dropTable('bank_accounts').catch(() => {});
}
