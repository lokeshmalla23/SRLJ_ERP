import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields } from './_syncFields.js';
import { financialModeField, attachFinancialModeHook } from './_financialMode.js';

/**
 * Disposal of accumulated Old Gold Stock (1300) to a wholesaler/refiner —
 * distinct from OldGoldReceipt (the inbound receipt of gold from a customer).
 * `receipt_ids` snapshots which OldGoldReceipt rows this sale disposed of;
 * each of those receipts also carries `old_gold_sale_id` back to this row so
 * a receipt can only ever be sold once (see models/CreditNote.js).
 */
export const OldGoldSale = sequelize.define('OldGoldSale', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  sale_no: { type: DataTypes.STRING, allowNull: false },
  business_date: { type: DataTypes.DATEONLY, allowNull: true },
  buyer_name: { type: DataTypes.STRING, allowNull: false },
  vendor_id: { type: DataTypes.STRING, allowNull: true },
  receipt_ids: { type: DataTypes.JSONB, defaultValue: [] },
  gross_weight_g: { type: DataTypes.DECIMAL(12, 3), defaultValue: 0 },
  purity: { type: DataTypes.STRING, allowNull: true },
  fine_weight_g: { type: DataTypes.DECIMAL(12, 3), allowNull: true },
  /** Sum of the disposed receipts' `value` — what leaves account 1300. */
  book_value: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  /** Actual amount realized from the buyer, before refining charges. */
  sale_value: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  refining_charges: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  /** sale_value - book_value (positive = gain, negative = loss); independent of charges. */
  gain_loss_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  payment_mode: { type: DataTypes.STRING, allowNull: false, defaultValue: 'cash' },
  reference_no: { type: DataTypes.STRING, allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
  /** posted | cancelled */
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'posted' },
  cancelled_at: { type: DataTypes.DATE, allowNull: true },
  cancelled_by: { type: DataTypes.STRING, allowNull: true },
  cancel_reason: { type: DataTypes.STRING, allowNull: true },
  created_by: { type: DataTypes.STRING, allowNull: true },
  request_id: { type: DataTypes.STRING, allowNull: true },
  /** gold | silver — which stock this disposal reduced. */
  metal: { type: DataTypes.STRING, allowNull: false, defaultValue: 'gold' },
  ...financialModeField,
  ...shopAuditFields,
}, {
  tableName: 'old_gold_sales',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['shop_id', 'sale_no'], name: 'old_gold_sales_no_uk' },
    { fields: ['shop_id', 'business_date'] },
    { fields: ['request_id'] },
  ],
});

attachFinancialModeHook(OldGoldSale);
