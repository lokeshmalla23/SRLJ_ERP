import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields } from './_syncFields.js';

/**
 * Pure metal coin / bulk-pure inventory.
 * coin  → per-piece grams + piece qty
 * pure  → bulk grams on hand (stock_qty) with weight threshold
 */
export const PureProduct = sequelize.define('PureProduct', {
  id: { type: DataTypes.STRING, primaryKey: true },
  /** gold | silver */
  metal: { type: DataTypes.STRING, allowNull: false },
  /** coin | biscuit */
  form_type: { type: DataTypes.STRING, allowNull: false },
  /** Grams per piece (e.g. 1, 2, 10, 50). */
  weight_g: { type: DataTypes.DECIMAL(12, 3), allowNull: false },
  /** Display name, e.g. "1 g Gold Coin". Auto-built if omitted. */
  name: { type: DataTypes.STRING, allowNull: false },
  stock_qty: { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
  low_stock_threshold: { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
  notes: { type: DataTypes.TEXT, allowNull: true },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
  ...shopAuditFields,
}, {
  tableName: 'pure_products',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['shop_id', 'metal', 'form_type', 'weight_g'],
      name: 'pure_products_shop_metal_form_weight_uk',
    },
  ],
});
