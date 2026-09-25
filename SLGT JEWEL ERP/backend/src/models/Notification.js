import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields, shopOriginFields } from './_syncFields.js';

export const Notification = sequelize.define('Notification', {
  id: { type: DataTypes.STRING, primaryKey: true },
  type: { type: DataTypes.STRING, allowNull: false },
  title: { type: DataTypes.STRING, allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  data: { type: DataTypes.JSONB, defaultValue: {} },
  is_read: { type: DataTypes.BOOLEAN, defaultValue: false },
  user_id: { type: DataTypes.STRING },
  ...shopOriginFields,
}, { tableName: 'notifications', timestamps: true, underscored: true });
