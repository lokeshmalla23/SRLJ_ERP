import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopOriginFields } from './_syncFields.js';
import { financialModeField, attachFinancialModeHook } from './_financialMode.js';

export const Income = sequelize.define('Income', {
  id: { type: DataTypes.STRING, primaryKey: true },
  description: { type: DataTypes.STRING, allowNull: false },
  amount: { type: DataTypes.FLOAT, allowNull: false },
  payment_mode: { type: DataTypes.STRING, defaultValue: 'cash' },
  reference: { type: DataTypes.STRING },
  date: { type: DataTypes.DATEONLY, allowNull: false },
  /** User-entered clock time (HH:MM), paired with `date` for full "occurred at" display. */
  time: { type: DataTypes.STRING, allowNull: true },
  notes: { type: DataTypes.TEXT },
  created_by: { type: DataTypes.STRING },
  ...financialModeField,
  ...shopOriginFields,
}, { tableName: 'incomes', timestamps: true, underscored: true });

attachFinancialModeHook(Income);
