import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields, shopOriginFields } from './_syncFields.js';
import { financialModeField, attachFinancialModeHook } from './_financialMode.js';

export const Quotation = sequelize.define('Quotation', {
  id: { type: DataTypes.STRING, primaryKey: true },
  quote_no: { type: DataTypes.STRING, unique: true },
  customer_id: { type: DataTypes.STRING },
  customer_name: { type: DataTypes.STRING, allowNull: false },
  customer_mobile: { type: DataTypes.STRING },
  customer_email: { type: DataTypes.STRING },
  items: { type: DataTypes.JSONB, defaultValue: [] },
  gold_rate: { type: DataTypes.FLOAT, defaultValue: 0 },
  subtotal: { type: DataTypes.FLOAT, defaultValue: 0 },
  discount: { type: DataTypes.FLOAT, defaultValue: 0 },
  discount_type: { type: DataTypes.STRING, defaultValue: 'flat' }, // flat | pct
  gst_pct: { type: DataTypes.FLOAT, defaultValue: 3 },
  gst_amount: { type: DataTypes.FLOAT, defaultValue: 0 },
  grand_total: { type: DataTypes.FLOAT, defaultValue: 0 },
  valid_until: { type: DataTypes.DATEONLY },
  status: { type: DataTypes.STRING, defaultValue: 'draft' }, // draft|sent|accepted|booked|converted|expired|cancelled
  converted_invoice_id: { type: DataTypes.STRING },
  /** When true, POS must use locked line prices / gold_rate from this estimation. */
  price_locked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  /** Snapshot of advance collected when booking (sum of all installments). */
  advance_paid: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  /** Linked customer_advances.id created at first book (legacy / primary). */
  advance_id: { type: DataTypes.STRING, allowNull: true },
  /** Installment history: [{ advance_id, amount, mode, paid_at, reference }] */
  advance_payments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  booked_at: { type: DataTypes.DATE, allowNull: true },
  /** Shop's transaction/business date at the moment of booking — the anchor
   *  date invoiceOccurredAt() combines with booked_at's real time-of-day. */
  business_date: { type: DataTypes.DATEONLY, allowNull: true },
  notes: { type: DataTypes.TEXT },
  terms: { type: DataTypes.TEXT },
  /** Old Metal Exchange calculator snapshot: { active, weight, purity, rate, value } */
  old_gold: { type: DataTypes.JSONB, allowNull: true },
  /** Old silver exchange snapshot: { active, weight, purity, rate, value } */
  old_silver: { type: DataTypes.JSONB, allowNull: true },
  created_by: { type: DataTypes.STRING },
  salesperson_id: { type: DataTypes.STRING, allowNull: true },
  ...financialModeField,
  /** Snapshot of the salesperson's name at estimation time — printed on the slip
   *  even if the employee record is later renamed/removed. */
  salesperson_name: { type: DataTypes.STRING, allowNull: true },
  ...shopAuditFields,
}, { tableName: 'quotations', timestamps: true, underscored: true });

attachFinancialModeHook(Quotation);
