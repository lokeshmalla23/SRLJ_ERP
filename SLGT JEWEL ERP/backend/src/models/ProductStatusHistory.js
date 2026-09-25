import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields } from './_syncFields.js';

/** Append-only status history for unique jewellery products (physical tags). */
export const ProductStatusHistory = sequelize.define('ProductStatusHistory', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  product_id: { type: DataTypes.STRING, allowNull: false },
  from_status: { type: DataTypes.STRING, allowNull: true },
  to_status: { type: DataTypes.STRING, allowNull: false },
  reason: { type: DataTypes.STRING, allowNull: true },
  reference_type: { type: DataTypes.STRING, allowNull: true },
  reference_id: { type: DataTypes.STRING, allowNull: true },
  user_id: { type: DataTypes.STRING, allowNull: true },
  device_id: { type: DataTypes.STRING, allowNull: true },
  meta: { type: DataTypes.JSONB, defaultValue: {} },
  ...shopAuditFields,
}, {
  tableName: 'product_status_history',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['shop_id', 'product_id'] },
    { fields: ['reference_type', 'reference_id'] },
  ],
});
