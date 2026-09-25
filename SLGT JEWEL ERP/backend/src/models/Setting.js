import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields } from './_syncFields.js';

export const Setting = sequelize.define('Setting', {
  id: { type: DataTypes.STRING, primaryKey: true },
  key: { type: DataTypes.STRING, allowNull: false, unique: true },
  value: { type: DataTypes.JSONB, defaultValue: {} },
  ...shopAuditFields,
}, {
  tableName: 'settings',
  timestamps: true,
  underscored: true,
});
