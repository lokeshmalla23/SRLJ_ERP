import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields } from './_syncFields.js';

/** Physical showcase / category counter — categories (and their products) are allocated here. */
export const ShopCounter = sequelize.define('ShopCounter', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  code: { type: DataTypes.STRING, allowNull: true },
  device_id: { type: DataTypes.STRING, allowNull: true },
  is_default: { type: DataTypes.BOOLEAN, defaultValue: false },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
  ...shopAuditFields,
}, {
  tableName: 'shop_counters',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['shop_id', 'status'] },
  ],
});
