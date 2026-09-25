import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields, shopOriginFields } from './_syncFields.js';

export const Employee = sequelize.define('Employee', {
  id: { type: DataTypes.STRING, primaryKey: true },
  user_id: { type: DataTypes.STRING },
  name: { type: DataTypes.STRING, allowNull: false },
  mobile: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING },
  job_title: { type: DataTypes.STRING },
  department: { type: DataTypes.STRING },
  salary: { type: DataTypes.FLOAT, defaultValue: 0 },
  /** Percent of making charges (or sales) attributed to salesperson */
  commission_pct: { type: DataTypes.DECIMAL(8, 3), defaultValue: 0 },
  /** making | sales */
  commission_on: { type: DataTypes.STRING, defaultValue: 'making' },
  join_date: { type: DataTypes.DATEONLY },
  status: { type: DataTypes.STRING, defaultValue: 'active' },
  address: { type: DataTypes.TEXT },
  emergency_contact: { type: DataTypes.STRING },
  notes: { type: DataTypes.TEXT },
  employee_code: { type: DataTypes.STRING },
  ...shopAuditFields,
}, { tableName: 'employees', timestamps: true, underscored: true });
