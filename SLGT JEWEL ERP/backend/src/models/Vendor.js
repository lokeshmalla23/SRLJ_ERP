import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields, shopOriginFields } from './_syncFields.js';

export const Vendor = sequelize.define('Vendor', {
  id: { type: DataTypes.STRING, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  type: { type: DataTypes.STRING, defaultValue: 'gold_supplier' }, // gold_supplier|stone_supplier|manufacturer|karigar|other
  contact_person: { type: DataTypes.STRING },
  mobile: { type: DataTypes.STRING },
  email: { type: DataTypes.STRING },
  address: { type: DataTypes.TEXT },
  gst_number: { type: DataTypes.STRING },
  pan_number: { type: DataTypes.STRING },
  bank_details: { type: DataTypes.JSONB, defaultValue: {} },
  credit_limit: { type: DataTypes.FLOAT, defaultValue: 0 },
  credit_days: { type: DataTypes.INTEGER, defaultValue: 0 },
  outstanding_balance: { type: DataTypes.FLOAT, defaultValue: 0 },
  total_purchases: { type: DataTypes.FLOAT, defaultValue: 0 },
  notes: { type: DataTypes.TEXT },
  status: { type: DataTypes.STRING, defaultValue: 'active' },
  ...shopAuditFields,
}, { tableName: 'vendors', timestamps: true, underscored: true });
