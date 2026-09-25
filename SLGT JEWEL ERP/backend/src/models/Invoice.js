import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopOriginFields } from './_syncFields.js';
import { financialModeField, attachFinancialModeHook } from './_financialMode.js';

export const Invoice = sequelize.define('Invoice', {
  id: { type: DataTypes.STRING, primaryKey: true },
  invoice_no: { type: DataTypes.STRING, unique: true },
  customer_id: { type: DataTypes.STRING },
  customer_name: { type: DataTypes.STRING },
  customer_mobile: { type: DataTypes.STRING },
  items: { type: DataTypes.JSONB, defaultValue: [] },
  subtotal: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  discount: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  discount_type: { type: DataTypes.STRING, defaultValue: 'flat' },
  gst_pct: { type: DataTypes.DECIMAL(8, 4), defaultValue: 3 },
  gst_amount: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  cgst_amount: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  sgst_amount: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  igst_amount: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  /** intra = CGST+SGST | inter = IGST */
  tax_type: { type: DataTypes.STRING, defaultValue: 'intra' },
  old_gold_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  old_silver_value: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  scheme_credit: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  scheme_id: { type: DataTypes.STRING, allowNull: true },
  quotation_id: { type: DataTypes.STRING, allowNull: true },
  gold_rate: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  grand_total: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  round_off: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  payments: { type: DataTypes.JSONB, defaultValue: [] },
  balance_due: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  notes: { type: DataTypes.TEXT },
  pan_number: { type: DataTypes.STRING, allowNull: true },
  aadhaar_number: { type: DataTypes.STRING, allowNull: true },
  customer_address: { type: DataTypes.TEXT, allowNull: true },
  detailed_stone_bill: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  salesperson_id: { type: DataTypes.STRING, allowNull: true },
  status: { type: DataTypes.STRING, defaultValue: 'paid' },
  /** Owner-only bill excluded from normal books until unlocked */
  is_hidden: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  request_id: { type: DataTypes.STRING, allowNull: true },
  created_by: { type: DataTypes.STRING, allowNull: true },
  counter_id: { type: DataTypes.STRING, allowNull: true },
  device_id: { type: DataTypes.STRING, allowNull: true },
  branch_id: { type: DataTypes.STRING, allowNull: true },
  cancelled_at: { type: DataTypes.DATE, allowNull: true },
  cancelled_by: { type: DataTypes.STRING, allowNull: true },
  cancel_reason: { type: DataTypes.TEXT, allowNull: true },
  /** When a full/partial return was processed — the return-path counterpart
   *  to cancelled_at, stamped on the Transaction date. See returnService.js. */
  returned_at: { type: DataTypes.DATE, allowNull: true },
  /** Business/billing date (independent of created_at) — the day this invoice
   *  counts toward until Day Close advances it; see dailyClosingService.js */
  business_date: { type: DataTypes.DATEONLY, allowNull: true },
  ...financialModeField,
  ...shopOriginFields,
}, {
  tableName: 'invoices',
  timestamps: true,
  underscored: true,
});

attachFinancialModeHook(Invoice);
