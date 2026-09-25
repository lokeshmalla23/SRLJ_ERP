import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopOriginFields } from './_syncFields.js';

/** Named bank / UPI settlement accounts linked to a GL cash code. */
export const BankAccount = sequelize.define('BankAccount', {
  id: { type: DataTypes.STRING, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  bank_name: { type: DataTypes.STRING, allowNull: true },
  account_number: { type: DataTypes.STRING, allowNull: true },
  ifsc: { type: DataTypes.STRING, allowNull: true },
  /** 1010 | 1020 | 1030 */
  gl_code: { type: DataTypes.STRING, allowNull: false, defaultValue: '1010' },
  opening_balance: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
  notes: { type: DataTypes.TEXT, allowNull: true },
  ...shopOriginFields,
}, {
  tableName: 'bank_accounts',
  timestamps: true,
  underscored: true,
  indexes: [{ fields: ['shop_id', 'status'] }],
});

/** Bank statement match marks — never deletes journals. */
export const BankReconciliationItem = sequelize.define('BankReconciliationItem', {
  id: { type: DataTypes.STRING, primaryKey: true },
  bank_account_id: { type: DataTypes.STRING, allowNull: false },
  journal_entry_id: { type: DataTypes.STRING, allowNull: true },
  journal_line_id: { type: DataTypes.STRING, allowNull: true },
  entry_date: { type: DataTypes.DATEONLY, allowNull: true },
  description: { type: DataTypes.STRING, allowNull: true },
  amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'unmatched' },
  statement_ref: { type: DataTypes.STRING, allowNull: true },
  statement_date: { type: DataTypes.DATEONLY, allowNull: true },
  reconciled_at: { type: DataTypes.DATE, allowNull: true },
  reconciled_by: { type: DataTypes.STRING, allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
  ...shopOriginFields,
}, {
  tableName: 'bank_reconciliation_items',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['shop_id', 'bank_account_id'] },
    { fields: ['journal_line_id'] },
  ],
});
