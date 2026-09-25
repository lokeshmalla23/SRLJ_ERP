import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopIdField } from './_syncFields.js';

/**
 * Normalized purchase line items, dual-written alongside Purchase.items JSONB
 * since migration 20260731180001-invoice-counter-normalized-lines. Read-only
 * from reports — the JSONB blob on Purchase remains authoritative for billing.
 */
export const PurchaseItem = sequelize.define('PurchaseItem', {
  id: { type: DataTypes.STRING, primaryKey: true },
  purchase_id: { type: DataTypes.STRING, allowNull: false },
  line_no: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  product_id: { type: DataTypes.STRING, allowNull: true },
  barcode: { type: DataTypes.STRING, allowNull: true },
  description: { type: DataTypes.STRING, allowNull: true },
  quantity: { type: DataTypes.DECIMAL(14, 4), defaultValue: 1 },
  weight_g: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
  rate: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
  tax_pct: { type: DataTypes.DECIMAL(8, 4), allowNull: true },
  tax_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  snapshot_json: { type: DataTypes.JSONB, allowNull: true },
  ...shopIdField,
}, {
  tableName: 'purchase_items',
  timestamps: true,
  underscored: true,
});
