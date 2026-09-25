import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopIdField } from './_syncFields.js';

/**
 * Normalized invoice line items, dual-written alongside Invoice.items JSONB
 * (see backend/src/services/billingService.js) since migration
 * 20260731180001-invoice-counter-normalized-lines. Read-only from reports —
 * the JSONB blob on Invoice remains the authoritative snapshot for billing.
 */
export const InvoiceItem = sequelize.define('InvoiceItem', {
  id: { type: DataTypes.STRING, primaryKey: true },
  invoice_id: { type: DataTypes.STRING, allowNull: false },
  line_no: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  product_id: { type: DataTypes.STRING, allowNull: true },
  barcode: { type: DataTypes.STRING, allowNull: true },
  description: { type: DataTypes.STRING, allowNull: true },
  quantity: { type: DataTypes.DECIMAL(14, 4), defaultValue: 1 },
  gross_weight: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
  net_weight: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
  rate: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
  making: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
  wastage: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
  tax_pct: { type: DataTypes.DECIMAL(8, 4), allowNull: true },
  tax_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  hsn_code: { type: DataTypes.STRING, allowNull: true },
  snapshot_json: { type: DataTypes.JSONB, allowNull: true },
  ...shopIdField,
}, {
  tableName: 'invoice_items',
  timestamps: true,
  underscored: true,
});
