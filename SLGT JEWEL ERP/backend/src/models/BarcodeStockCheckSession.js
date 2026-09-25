import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';

/**
 * A physical stock verification session — one "run" of scanning the shop's
 * barcoded stock against ERP records. Never touches Product/stock_qty;
 * BarcodeStockCheckScan rows record what was scanned so expected/scanned/
 * pending quantities can be computed on demand.
 */
export const BarcodeStockCheckSession = sequelize.define('BarcodeStockCheckSession', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: true },
  /** Informational only — recomputed from live totals, not authoritative. */
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
  created_by: { type: DataTypes.STRING, allowNull: true },
  device_id: { type: DataTypes.STRING, allowNull: true },
  /** null = "All Products" scope (existing behavior, unchanged). Set = this
   *  session only covers one category; category_name is a snapshot so the
   *  session keeps its label even if the category is later renamed/removed. */
  category_id: { type: DataTypes.STRING, allowNull: true },
  category_name: { type: DataTypes.STRING, allowNull: true },
  started_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  completed_at: { type: DataTypes.DATE, allowNull: true },
  reset_at: { type: DataTypes.DATE, allowNull: true },
  reset_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  tableName: 'barcode_stock_check_sessions',
  timestamps: true,
  underscored: true,
});
