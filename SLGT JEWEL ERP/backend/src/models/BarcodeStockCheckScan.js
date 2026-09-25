import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';

/**
 * Append-only log of every scan attempt within a session — matched, already
 * fully verified, or not found. Only 'matched' rows count toward a barcode's
 * scanned quantity; the rest exist for the on-screen scan history / audit.
 */
export const BarcodeStockCheckScan = sequelize.define('BarcodeStockCheckScan', {
  id: { type: DataTypes.STRING, primaryKey: true },
  session_id: { type: DataTypes.STRING, allowNull: false },
  shop_id: { type: DataTypes.STRING, allowNull: true },
  barcode: { type: DataTypes.STRING, allowNull: false },
  product_id: { type: DataTypes.STRING, allowNull: true },
  item_name: { type: DataTypes.STRING, allowNull: true },
  /** 'matched' | 'already_completed' | 'not_found' */
  result: { type: DataTypes.STRING, allowNull: false },
  scanned_by: { type: DataTypes.STRING, allowNull: true },
  device_id: { type: DataTypes.STRING, allowNull: true },
}, {
  tableName: 'barcode_stock_check_scans',
  timestamps: true,
  underscored: true,
  updatedAt: false,
  createdAt: 'created_at',
});
