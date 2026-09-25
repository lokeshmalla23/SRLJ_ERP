import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields } from './_syncFields.js';
import { financialModeField, attachFinancialModeHook } from './_financialMode.js';

/** Customer advance liability ledger. */
export const CustomerAdvance = sequelize.define('CustomerAdvance', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  customer_id: { type: DataTypes.STRING, allowNull: false },
  amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  amount_paise: { type: DataTypes.INTEGER, allowNull: true },
  used_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  remaining_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  mode: { type: DataTypes.STRING, allowNull: true },
  reference: { type: DataTypes.STRING, allowNull: true },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'open' },
  request_id: { type: DataTypes.STRING, allowNull: true },
  received_by: { type: DataTypes.STRING, allowNull: true },
  meta: { type: DataTypes.JSONB, defaultValue: {} },
  /** Active billing day this advance counts toward — see invoices.business_date. */
  business_date: { type: DataTypes.DATEONLY, allowNull: true },
  ...financialModeField,
  ...shopAuditFields,
}, {
  tableName: 'customer_advances',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['shop_id', 'customer_id', 'status'] },
    { fields: ['request_id'] },
  ],
});

attachFinancialModeHook(CustomerAdvance);

export const CustomerAdvanceApplication = sequelize.define('CustomerAdvanceApplication', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  advance_id: { type: DataTypes.STRING, allowNull: false },
  invoice_id: { type: DataTypes.STRING, allowNull: false },
  amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  amount_paise: { type: DataTypes.INTEGER, allowNull: true },
  request_id: { type: DataTypes.STRING, allowNull: true },
  meta: { type: DataTypes.JSONB, defaultValue: {} },
  ...financialModeField,
  ...shopAuditFields,
}, {
  tableName: 'customer_advance_applications',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['advance_id'] },
    { fields: ['invoice_id'] },
    { fields: ['request_id'] },
  ],
});

attachFinancialModeHook(CustomerAdvanceApplication, {
  inheritInvoiceIdField: 'invoice_id',
  inheritAdvanceIdField: 'advance_id',
});
