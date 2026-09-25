import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';

export const DraftSale = sequelize.define('DraftSale', {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  cashier_id: { type: DataTypes.INTEGER, allowNull: true },
  customer_id: { type: DataTypes.INTEGER, allowNull: true },
  items: { type: DataTypes.TEXT, allowNull: false },
  subtotal: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  discount_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  total: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
  quoted_gold_rate: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
  status: { type: DataTypes.STRING, defaultValue: 'pending' },
  conflict_reason: { type: DataTypes.TEXT, allowNull: true },
  promoted_invoice_id: { type: DataTypes.INTEGER, allowNull: true },
  pricing_mode: { type: DataTypes.STRING, defaultValue: 'preserve' },
  shop_id: { type: DataTypes.STRING, allowNull: true },
}, {
  tableName: 'draft_sales',
  timestamps: true,
  underscored: true,
});
