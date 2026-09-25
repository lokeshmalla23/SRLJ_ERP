import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopOriginFields } from './_syncFields.js';
import { financialModeField, attachFinancialModeHook } from './_financialMode.js';

/** Manual cash/bank book line for day-to-day till reconciliation. */
export const CashbookEntry = sequelize.define('CashbookEntry', {
  id: { type: DataTypes.STRING, primaryKey: true },
  date: { type: DataTypes.DATEONLY, allowNull: false },
  /** in | out */
  entry_type: { type: DataTypes.STRING, allowNull: false },
  /** cash | bank | upi | card */
  mode: { type: DataTypes.STRING, allowNull: false, defaultValue: 'cash' },
  amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  contra: { type: DataTypes.BOOLEAN, defaultValue: false },
  reference: { type: DataTypes.STRING, allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
  linked_expense_id: { type: DataTypes.STRING, allowNull: true },
  linked_invoice_id: { type: DataTypes.STRING, allowNull: true },
  created_by: { type: DataTypes.STRING, allowNull: true },
  ...financialModeField,
  ...shopOriginFields,
}, {
  tableName: 'cashbook_entries',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['shop_id', 'date'] },
  ],
});

attachFinancialModeHook(CashbookEntry);
