import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';

/**
 * Per-shop daily sequence counters for invoice numbers.
 * Format retained: {prefix}-{YYMMDD}-{####}
 * Allocation must use allocateInvoiceNumber() with row lock / atomic UPDATE.
 */
export const InvoiceSequence = sequelize.define('InvoiceSequence', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  /** Calendar day key YYYYMMDD (or legacy YYMMDD storage — we use YYYYMMDD internally, format uses YY) */
  sequence_date: { type: DataTypes.STRING(8), allowNull: false },
  prefix: { type: DataTypes.STRING, allowNull: false, defaultValue: 'SSJ' },
  next_value: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
}, {
  tableName: 'invoice_sequences',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['shop_id', 'sequence_date', 'prefix'] },
  ],
});
