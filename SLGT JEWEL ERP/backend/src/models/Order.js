import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields, shopOriginFields } from './_syncFields.js';
import { financialModeField, attachFinancialModeHook } from './_financialMode.js';

export const Order = sequelize.define('Order', {
  id: { type: DataTypes.STRING, primaryKey: true },
  order_no: { type: DataTypes.STRING, unique: true },
  type: { type: DataTypes.STRING, allowNull: false }, // custom|repair
  customer_id: { type: DataTypes.STRING },
  customer_name: { type: DataTypes.STRING, allowNull: false },
  customer_mobile: { type: DataTypes.STRING },
  description: { type: DataTypes.TEXT, allowNull: false },
  metal_type: { type: DataTypes.STRING },
  purity: { type: DataTypes.STRING },
  estimated_weight: { type: DataTypes.FLOAT },
  stone_details: { type: DataTypes.TEXT },
  estimated_price: { type: DataTypes.FLOAT, defaultValue: 0 },
  advance_paid: { type: DataTypes.FLOAT, defaultValue: 0 },
  /** Dated history of advance collections: [{ amount, mode, paid_at, business_date, reference }] */
  advance_payments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  balance_due: { type: DataTypes.FLOAT, defaultValue: 0 },
  karigar_name: { type: DataTypes.STRING },
  karigar_vendor_id: { type: DataTypes.STRING },
  customer_dob: { type: DataTypes.STRING, allowNull: true },
  customer_anniversary: { type: DataTypes.STRING, allowNull: true },
  delivery_date: { type: DataTypes.DATEONLY },
  status: { type: DataTypes.STRING, defaultValue: 'received' }, // received|karigar_assigned|in_progress|quality_check|ready|delivered|cancelled
  priority: { type: DataTypes.STRING, defaultValue: 'normal' }, // normal|urgent
  notes: { type: DataTypes.TEXT },
  created_by: { type: DataTypes.STRING },
  ...financialModeField,
  ...shopAuditFields,
}, { tableName: 'orders', timestamps: true, underscored: true });

attachFinancialModeHook(Order);
