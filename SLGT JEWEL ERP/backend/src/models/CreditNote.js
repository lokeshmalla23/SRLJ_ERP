import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields } from './_syncFields.js';
import { financialModeField, attachFinancialModeHook } from './_financialMode.js';

/** Partial return / credit note against an invoice (distinct from full cancel). */
export const CreditNote = sequelize.define('CreditNote', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  credit_note_no: { type: DataTypes.STRING, allowNull: false },
  invoice_id: { type: DataTypes.STRING, allowNull: false },
  customer_id: { type: DataTypes.STRING, allowNull: true },
  items: { type: DataTypes.JSONB, defaultValue: [] },
  subtotal: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  gst_amount: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  grand_total: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  amount_paise: { type: DataTypes.INTEGER, allowNull: true },
  reason: { type: DataTypes.STRING, allowNull: true },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'posted' },
  request_id: { type: DataTypes.STRING, allowNull: true },
  created_by: { type: DataTypes.STRING, allowNull: true },
  /** Business/billing date this credit note counts toward — see Invoice.business_date */
  business_date: { type: DataTypes.DATEONLY, allowNull: true },
  ...financialModeField,
  ...shopAuditFields,
}, {
  tableName: 'credit_notes',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['shop_id', 'invoice_id'] },
    { unique: true, fields: ['shop_id', 'credit_note_no'], name: 'credit_notes_no_uk' },
    { fields: ['request_id'] },
  ],
});

attachFinancialModeHook(CreditNote, { inheritInvoiceIdField: 'invoice_id' });

/** Old-gold exchange receipt (not double-credited as cash sale). */
export const OldGoldReceipt = sequelize.define('OldGoldReceipt', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  receipt_no: { type: DataTypes.STRING, allowNull: false },
  customer_id: { type: DataTypes.STRING, allowNull: true },
  invoice_id: { type: DataTypes.STRING, allowNull: true },
  weight_g: { type: DataTypes.DECIMAL(12, 3), allowNull: false },
  purity: { type: DataTypes.STRING, allowNull: true },
  rate: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  value: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  value_paise: { type: DataTypes.INTEGER, allowNull: true },
  description: { type: DataTypes.STRING, allowNull: true },
  /**
   * posted | in_stock | melted | sold | returned — buyback/lifecycle trail.
   * 'returned': the linked invoice was cancelled and the gold went back to the
   * customer (set by billingService.cancelInvoice). 'sold': disposed via an
   * OldGoldSale (old_gold_sale_id set) — see models/OldGoldSale.js.
   */
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'posted' },
  trail_notes: { type: DataTypes.TEXT, allowNull: true },
  /** Set once this receipt is disposed via an Old Gold Sale — prevents re-selling. */
  old_gold_sale_id: { type: DataTypes.STRING, allowNull: true },
  created_by: { type: DataTypes.STRING, allowNull: true },
  /** Snapshots for the Old Gold Exchange report — historically accurate even if the customer/invoice changes later. */
  /** gold | silver — inbound exchange metal. Existing rows are gold. */
  metal: { type: DataTypes.STRING, allowNull: false, defaultValue: 'gold' },
  customer_name: { type: DataTypes.STRING, allowNull: true },
  customer_phone: { type: DataTypes.STRING, allowNull: true },
  invoice_no: { type: DataTypes.STRING, allowNull: true },
  invoice_serial: { type: DataTypes.INTEGER, allowNull: true },
  /** Business/billing date this receipt counts toward — see Invoice.business_date */
  business_date: { type: DataTypes.DATEONLY, allowNull: true },
  ...financialModeField,
  ...shopAuditFields,
}, {
  tableName: 'old_gold_receipts',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['shop_id', 'invoice_id'] },
    { unique: true, fields: ['shop_id', 'receipt_no'], name: 'old_gold_receipt_no_uk' },
    { fields: ['shop_id', 'old_gold_sale_id'] },
    { fields: ['shop_id', 'metal'] },
  ],
});

attachFinancialModeHook(OldGoldReceipt, { inheritInvoiceIdField: 'invoice_id' });

/** HSN / SAC master for jewellery GST. */
export const HsnCode = sequelize.define('HsnCode', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  code: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.STRING, allowNull: true },
  gst_pct: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 3 },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
  ...shopAuditFields,
}, {
  tableName: 'hsn_codes',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['shop_id', 'code'], name: 'hsn_shop_code_uk' },
  ],
});
