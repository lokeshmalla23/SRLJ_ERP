import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields } from './_syncFields.js';

export const Product = sequelize.define('Product', {
  id: { type: DataTypes.STRING, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  code: { type: DataTypes.STRING },
  barcode: { type: DataTypes.STRING },
  category_id: { type: DataTypes.STRING },
  subcategory_id: { type: DataTypes.STRING },
  collection_ids: { type: DataTypes.JSONB, defaultValue: [] },
  tag_ids: { type: DataTypes.JSONB, defaultValue: [] },
  metal_type_id: { type: DataTypes.STRING },
  purity_id: { type: DataTypes.STRING },
  stone_type_ids: { type: DataTypes.JSONB, defaultValue: [] },
  unit_id: { type: DataTypes.STRING },
  attribute_values: { type: DataTypes.JSONB, defaultValue: {} },
  gross_weight: { type: DataTypes.DECIMAL(12, 3), defaultValue: 0 },
  net_weight: { type: DataTypes.DECIMAL(12, 3), defaultValue: 0 },
  stone_weight: { type: DataTypes.DECIMAL(12, 3), defaultValue: 0 },
  making_charges: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  making_charge_type: { type: DataTypes.STRING, defaultValue: 'fixed' },
  wastage_pct: { type: DataTypes.DECIMAL(8, 3), defaultValue: 0 },
  hallmark: { type: DataTypes.STRING },
  hsn_code: { type: DataTypes.STRING },
  gst_slab: { type: DataTypes.DECIMAL(5, 2), defaultValue: 3 },
  purchase_price: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  selling_price: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  stock_qty: { type: DataTypes.DECIMAL(14, 3), defaultValue: 0 },
  low_stock_threshold: { type: DataTypes.DECIMAL(14, 3), defaultValue: 0 },
  /** Tray unit only: combined weight of the whole tray (grams). */
  tray_total_weight: { type: DataTypes.DECIMAL(12, 3), allowNull: true },
  /** Tray unit only: tray_total_weight / stock_qty, rounded to 3 decimals. */
  piece_weight: { type: DataTypes.DECIMAL(12, 3), allowNull: true },
  /**
   * Tray unit only: purchase cost per gram, fixed when the tray is created
   * (total tray purchase amount ÷ tray weight). COGS = this × weight sold;
   * stock value = this × remaining tray_total_weight. Stored separately
   * because tray_total_weight shrinks with every sale.
   */
  purchase_cost_per_gram: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
  description: { type: DataTypes.TEXT },
  design_no: { type: DataTypes.STRING },
  /** Optional shop code (Settings → Application Management → Cal Code); can print on the barcode tag. */
  cal_code: { type: DataTypes.STRING, allowNull: true },
  size: { type: DataTypes.STRING },
  showcase_location: { type: DataTypes.STRING },
  /** FK-by-convention to ShopCounter.id — the physical counter this stock sits at. */
  counter_id: { type: DataTypes.STRING, allowNull: true },
  /** Valid values: 'available', 'sold', 'reserved', 'on_display', 'discontinued', 'deleted', 'deleted_p' */
  status: { type: DataTypes.STRING, defaultValue: 'available' },
  purchase_date: { type: DataTypes.DATEONLY, allowNull: true },
  deleted_at: { type: DataTypes.DATE, allowNull: true },
  stone_details: { type: DataTypes.JSONB, defaultValue: [] },
  certification: { type: DataTypes.STRING },
  vendor_id: { type: DataTypes.STRING },
  /** Phase 3 will enforce unique_tag sell-once semantics; Phase 2 schema only. */
  inventory_mode: { type: DataTypes.STRING, allowNull: false, defaultValue: 'quantity' },
  ...shopAuditFields,
}, {
  tableName: 'products',
  timestamps: true,
  underscored: true,
});
