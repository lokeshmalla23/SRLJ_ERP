import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields, shopOriginFields } from './_syncFields.js';

export const SchemePlan = sequelize.define('SchemePlan', {
  id: { type: DataTypes.STRING, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  plan_type: { type: DataTypes.STRING, defaultValue: 'amount' }, // 'amount'|'weight'
  duration_months: { type: DataTypes.INTEGER, allowNull: false },
  bonus_months: { type: DataTypes.INTEGER, defaultValue: 1 },
  default_monthly_amount: { type: DataTypes.FLOAT },
  description: { type: DataTypes.TEXT },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  ...shopAuditFields,
}, {
  tableName: 'scheme_plans',
  timestamps: true,
  underscored: true,
});
