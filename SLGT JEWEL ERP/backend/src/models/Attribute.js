import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields, shopOriginFields } from './_syncFields.js';

export const Attribute = sequelize.define('Attribute', {
  id: { type: DataTypes.STRING, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  code: { type: DataTypes.STRING, allowNull: false },
  field_type: { type: DataTypes.STRING, allowNull: false, defaultValue: 'text' },
  options: { type: DataTypes.JSONB, defaultValue: [] },
  required: { type: DataTypes.BOOLEAN, defaultValue: false },
  unit: { type: DataTypes.STRING },
  category_ids: { type: DataTypes.JSONB, defaultValue: [] },
  display_order: { type: DataTypes.INTEGER, defaultValue: 0 },
  help_text: { type: DataTypes.TEXT },
  ...shopAuditFields,
}, {
  tableName: 'attributes',
  timestamps: true,
  underscored: true,
});
