import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields } from './_syncFields.js';

export const User = sequelize.define('User', {
  id: { type: DataTypes.STRING, primaryKey: true },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  name: { type: DataTypes.STRING, allowNull: false },
  password_hash: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.STRING, allowNull: false, defaultValue: 'cashier' },
  permissions: { type: DataTypes.JSONB, defaultValue: {} },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  ...shopAuditFields,
}, {
  tableName: 'users',
  timestamps: true,
  underscored: true,
});
