import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';

/** Key/value app metadata (schema version, etc.). */
export const SchemaMeta = sequelize.define('SchemaMeta', {
  key: { type: DataTypes.STRING, primaryKey: true },
  value: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  tableName: 'schema_meta',
  timestamps: false,
  underscored: true,
});
