import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopIdField } from './_syncFields.js';

export const ExpenseCategory = sequelize.define('ExpenseCategory', {
  id: { type: DataTypes.STRING, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },
  icon: { type: DataTypes.STRING },
  color: { type: DataTypes.STRING, defaultValue: '#737373' },
  ...shopIdField,
}, { tableName: 'expense_categories', timestamps: true, underscored: true });
