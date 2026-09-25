import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields } from './_syncFields.js';
import { financialModeField, attachFinancialModeHook } from './_financialMode.js';

/** First-class payment row (not only invoice JSON). */
export const Payment = sequelize.define('Payment', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  invoice_id: { type: DataTypes.STRING, allowNull: true },
  customer_id: { type: DataTypes.STRING, allowNull: true },
  mode: { type: DataTypes.STRING, allowNull: false },
  amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  amount_paise: { type: DataTypes.INTEGER, allowNull: true },
  reference: { type: DataTypes.STRING, allowNull: true },
  received_by: { type: DataTypes.STRING, allowNull: true },
  request_id: { type: DataTypes.STRING, allowNull: true },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'posted' },
  paid_at: { type: DataTypes.DATE, allowNull: true },
  /** Business/billing date this payment counts toward — see Invoice.business_date */
  business_date: { type: DataTypes.DATEONLY, allowNull: true },
  meta: { type: DataTypes.JSONB, defaultValue: {} },
  ...financialModeField,
  ...shopAuditFields,
}, {
  tableName: 'payments',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['shop_id', 'invoice_id'] },
    { fields: ['shop_id', 'customer_id'] },
    { fields: ['request_id'] },
  ],
});

attachFinancialModeHook(Payment, { inheritInvoiceIdField: 'invoice_id' });
