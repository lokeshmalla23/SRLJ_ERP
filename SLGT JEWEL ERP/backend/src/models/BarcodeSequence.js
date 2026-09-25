import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';

/**
 * Per-shop counter for auto-generated product barcodes — a plain incrementing
 * integer (no date/prefix dimension, unlike invoice numbers).
 * Allocation must use allocateBarcodeNumber() (atomic UPDATE ... RETURNING).
 */
export const BarcodeSequence = sequelize.define('BarcodeSequence', {
  shop_id: { type: DataTypes.STRING, primaryKey: true },
  next_value: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10001 },
}, {
  tableName: 'barcode_sequences',
  timestamps: true,
  underscored: true,
});
