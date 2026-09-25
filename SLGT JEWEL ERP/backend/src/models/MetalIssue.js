import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopOriginFields } from './_syncFields.js';

/** Metal issued to / returned from karigar against a job order. */
export const MetalIssue = sequelize.define('MetalIssue', {
  id: { type: DataTypes.STRING, primaryKey: true },
  order_id: { type: DataTypes.STRING, allowNull: true },
  karigar_vendor_id: { type: DataTypes.STRING, allowNull: false },
  /** issue | return | scrap */
  movement_type: { type: DataTypes.STRING, allowNull: false },
  metal_type: { type: DataTypes.STRING, allowNull: true },
  purity: { type: DataTypes.STRING, allowNull: true },
  weight: { type: DataTypes.DECIMAL(12, 3), allowNull: false, defaultValue: 0 },
  scrap_weight: { type: DataTypes.DECIMAL(12, 3), defaultValue: 0 },
  notes: { type: DataTypes.TEXT, allowNull: true },
  created_by: { type: DataTypes.STRING, allowNull: true },
  ...shopOriginFields,
}, {
  tableName: 'metal_issues',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['shop_id', 'karigar_vendor_id'] },
    { fields: ['order_id'] },
  ],
});
