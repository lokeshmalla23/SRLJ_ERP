import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields, shopOriginFields } from './_syncFields.js';

// Covers: collections, tags, metal-types, stone-types, purities, units
export const CatalogItem = sequelize.define('CatalogItem', {
  id: { type: DataTypes.STRING, primaryKey: true },
  type: { type: DataTypes.STRING, allowNull: false },   // 'collection'|'tag'|'metal_type'|'stone_type'|'purity'|'unit'
  name: { type: DataTypes.STRING, allowNull: false },
  code: { type: DataTypes.STRING },
  description: { type: DataTypes.TEXT },
  color: { type: DataTypes.STRING },
  meta: { type: DataTypes.JSONB, defaultValue: {} },
  /** Built-in masters (Gold/Silver, Grams/Piece/Tray, standard purities) — never delete. */
  is_system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  ...shopAuditFields,
}, {
  tableName: 'catalog_items',
  timestamps: true,
  underscored: true,
});
