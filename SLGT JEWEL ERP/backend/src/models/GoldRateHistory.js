import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopOriginFields } from './_syncFields.js';

/** Append-only gold/silver rate change log. */
export const GoldRateHistory = sequelize.define('GoldRateHistory', {
  id: { type: DataTypes.STRING, primaryKey: true },
  rates: { type: DataTypes.JSONB, defaultValue: {} },
  changed_by: { type: DataTypes.STRING, allowNull: true },
  source: { type: DataTypes.STRING, defaultValue: 'settings' },
  ...shopOriginFields,
}, {
  tableName: 'gold_rate_history',
  timestamps: true,
  underscored: true,
  updatedAt: false,
  indexes: [{ fields: ['shop_id', 'created_at'] }],
});

/** POS rate lock / unlock / override audit. */
export const BillingRateEvent = sequelize.define('BillingRateEvent', {
  id: { type: DataTypes.STRING, primaryKey: true },
  event_type: { type: DataTypes.STRING, allowNull: false }, // lock | unlock | override
  gold_rate: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  previous_rate: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  invoice_id: { type: DataTypes.STRING, allowNull: true },
  user_id: { type: DataTypes.STRING, allowNull: true },
  meta: { type: DataTypes.JSONB, defaultValue: {} },
  ...shopOriginFields,
}, {
  tableName: 'billing_rate_events',
  timestamps: true,
  underscored: true,
  updatedAt: false,
  indexes: [{ fields: ['shop_id', 'created_at'] }],
});
