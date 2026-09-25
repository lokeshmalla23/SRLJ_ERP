import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields, shopOriginFields } from './_syncFields.js';

export const InventoryAdjustment = sequelize.define('InventoryAdjustment', {
  id: { type: DataTypes.STRING, primaryKey: true },
  product_id: { type: DataTypes.STRING, allowNull: false },
  product_name: { type: DataTypes.STRING },
  adjustment_type: { type: DataTypes.STRING, allowNull: false },
  qty_before: { type: DataTypes.FLOAT, defaultValue: 0 },
  qty_change: { type: DataTypes.FLOAT, allowNull: false },
  qty_after: { type: DataTypes.FLOAT, defaultValue: 0 },
  reason: { type: DataTypes.STRING },
  notes: { type: DataTypes.TEXT },
  created_by: { type: DataTypes.STRING },
  ...shopOriginFields,
}, { tableName: 'inventory_adjustments', timestamps: true, underscored: true });
