import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';

/**
 * Authoritative inventory ledger (Phase 3).
 * Append-oriented — corrections use compensating movements.
 */
export const InventoryMovement = sequelize.define('InventoryMovement', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  product_id: { type: DataTypes.STRING, allowNull: false },
  movement_type: { type: DataTypes.STRING, allowNull: false },
  /** Signed quantity delta: + in, - out */
  quantity: { type: DataTypes.FLOAT, allowNull: false },
  gross_weight: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  net_weight: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  stone_weight: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  qty_before: { type: DataTypes.FLOAT, allowNull: true },
  qty_after: { type: DataTypes.FLOAT, allowNull: true },
  reference_type: { type: DataTypes.STRING, allowNull: true },
  reference_id: { type: DataTypes.STRING, allowNull: true },
  origin_device_id: { type: DataTypes.STRING, allowNull: true },
  created_by: { type: DataTypes.STRING, allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
  meta: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: 'inventory_movements',
  timestamps: true,
  underscored: true,
  updatedAt: false, // append-only
  createdAt: 'created_at',
});
