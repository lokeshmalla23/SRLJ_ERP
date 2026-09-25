import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';

export const Shop = sequelize.define('Shop', {
  id: { type: DataTypes.STRING, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  code: { type: DataTypes.STRING, allowNull: true },
  gstin: { type: DataTypes.STRING, allowNull: true },
  phone: { type: DataTypes.STRING, allowNull: true },
  email: { type: DataTypes.STRING, allowNull: true },
  address: { type: DataTypes.TEXT, allowNull: true },
  invoice_prefix: { type: DataTypes.STRING, allowNull: true },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
  settings: { type: DataTypes.JSONB, defaultValue: {} },
}, {
  tableName: 'shops',
  timestamps: true,
  underscored: true,
});
