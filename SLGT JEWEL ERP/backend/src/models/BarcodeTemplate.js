import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields, shopOriginFields } from './_syncFields.js';

export const BarcodeTemplate = sequelize.define('BarcodeTemplate', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.STRING },
  fields: { type: DataTypes.JSONB, defaultValue: ['shop_name','product_name','purity','gross_weight','barcode_img','sku'] },
  barcode_type: { type: DataTypes.STRING, defaultValue: 'CODE128' }, // CODE128 | QR
  columns: { type: DataTypes.INTEGER, defaultValue: 2 },
  label_size: { type: DataTypes.STRING, defaultValue: 'a4' }, // a4 | thermal_58 | thermal_80 | custom
  label_width_mm: { type: DataTypes.FLOAT },
  label_height_mm: { type: DataTypes.FLOAT },
  show_border: { type: DataTypes.BOOLEAN, defaultValue: true },
  font_size: { type: DataTypes.STRING, defaultValue: 'medium' }, // small | medium | large
  is_default: { type: DataTypes.BOOLEAN, defaultValue: false },
  ...shopAuditFields,
}, { tableName: 'barcode_templates', timestamps: true, underscored: true });
