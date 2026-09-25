import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields, shopOriginFields } from './_syncFields.js';

export const Category = sequelize.define('Category', {
  id: { type: DataTypes.STRING, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },
  parent_id: { type: DataTypes.STRING, allowNull: true },
  icon: { type: DataTypes.STRING },
  display_order: { type: DataTypes.STRING, defaultValue: '0' }, // free-form sort key — sorted alphabetically, not numerically
  code_prefix: { type: DataTypes.STRING, allowNull: true }, // e.g. "RNG", "NCK" — used to auto-generate product codes/barcodes
  default_metal_type_id: { type: DataTypes.STRING, allowNull: true }, // FK to catalog_items (kind=metal_type) — auto-fill in Inventory
  default_wastage_pct: { type: DataTypes.FLOAT, allowNull: true },
  default_making_charge: { type: DataTypes.FLOAT, allowNull: true },
  default_making_charge_type: { type: DataTypes.STRING, allowNull: true }, // fixed|per_gram|percentage
  /** Pieces across products in this sub-category; alert when total stock_qty <= this. */
  low_stock_threshold: { type: DataTypes.DECIMAL(14, 3), allowNull: true, defaultValue: null },
  /** FK-by-convention to ShopCounter.id — default counter for products in this category. */
  counter_id: { type: DataTypes.STRING, allowNull: true },
  ...shopAuditFields,
}, {
  tableName: 'categories',
  timestamps: true,
  underscored: true,
});
