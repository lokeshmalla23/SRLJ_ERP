import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields } from './_syncFields.js';

export const Customer = sequelize.define('Customer', {
  id: { type: DataTypes.STRING, primaryKey: true },
  /** Per-shop running number shown to staff as "CUST-001" (not the internal id). */
  serial_no: { type: DataTypes.INTEGER, allowNull: true },
  name: { type: DataTypes.STRING, allowNull: false },
  mobile: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING },
  address: { type: DataTypes.TEXT },
  gst_number: { type: DataTypes.STRING },
  pan_number: { type: DataTypes.STRING },
  pan_image: { type: DataTypes.TEXT },
  aadhaar_number: { type: DataTypes.STRING },
  dob: { type: DataTypes.DATEONLY },
  anniversary: { type: DataTypes.DATEONLY },
  tag: { type: DataTypes.STRING, defaultValue: 'regular' },
  notes: { type: DataTypes.TEXT },
  total_purchases: { type: DataTypes.FLOAT, defaultValue: 0 },
  loyalty_points: { type: DataTypes.INTEGER, defaultValue: 0 },
  ...shopAuditFields,
}, {
  tableName: 'customers',
  timestamps: true,
  underscored: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});
