import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields, shopOriginFields } from './_syncFields.js';
import { financialModeField, attachFinancialModeHook } from './_financialMode.js';

export const Purchase = sequelize.define('Purchase', {
  id: { type: DataTypes.STRING, primaryKey: true },
  po_number: { type: DataTypes.STRING, unique: true },
  vendor_id: { type: DataTypes.STRING },
  vendor_name: { type: DataTypes.STRING },
  purchase_date: { type: DataTypes.DATEONLY, allowNull: false },
  purchase_type: { type: DataTypes.STRING, defaultValue: 'finished_goods' }, // gold_bullion|finished_goods|stones|karigar_work|other
  items: { type: DataTypes.JSONB, defaultValue: [] },
  subtotal: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  gst_pct: { type: DataTypes.DECIMAL(5, 2), defaultValue: 3 },
  gst_amount: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  cgst_amount: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  sgst_amount: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  igst_amount: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  tax_type: { type: DataTypes.STRING, defaultValue: 'intra' },
  grand_total: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  paid_amount: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  balance: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  payments: { type: DataTypes.JSONB, defaultValue: [] },
  status: { type: DataTypes.STRING, defaultValue: 'received' }, // draft|received|partially_paid|paid
  notes: { type: DataTypes.TEXT },
  created_by: { type: DataTypes.STRING },
  ...financialModeField,
  ...shopAuditFields,
}, { tableName: 'purchases', timestamps: true, underscored: true });

attachFinancialModeHook(Purchase);
