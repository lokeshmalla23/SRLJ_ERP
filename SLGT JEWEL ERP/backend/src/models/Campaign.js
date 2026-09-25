import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields, shopOriginFields } from './_syncFields.js';

export const Campaign = sequelize.define('Campaign', {
  id: { type: DataTypes.STRING, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  type: { type: DataTypes.STRING, allowNull: false }, // festival|birthday|anniversary|scheme_reminder|scheme_maturity|new_collection|invoice|custom
  message_template: { type: DataTypes.TEXT, allowNull: false },
  segment: { type: DataTypes.STRING, allowNull: false }, // all|vip|birthday_month|anniversary_month|scheme_overdue|scheme_matured|inactive|high_value
  segment_config: { type: DataTypes.JSONB, defaultValue: {} },
  status: { type: DataTypes.STRING, defaultValue: 'draft' }, // draft|scheduled|sent
  scheduled_at: { type: DataTypes.STRING, allowNull: true },
  sent_at: { type: DataTypes.STRING, allowNull: true },
  total_recipients: { type: DataTypes.INTEGER, defaultValue: 0 },
  sent_count: { type: DataTypes.INTEGER, defaultValue: 0 },
  created_by: { type: DataTypes.STRING, allowNull: true },
  ...shopOriginFields,
}, {
  tableName: 'campaigns',
  timestamps: true,
  underscored: true,
});
