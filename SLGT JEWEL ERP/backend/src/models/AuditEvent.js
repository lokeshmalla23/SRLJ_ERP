import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';

/** Append-only audit with optional hash chain. */
export const AuditEvent = sequelize.define('AuditEvent', {
  id: { type: DataTypes.STRING, primaryKey: true },
  seq: { type: DataTypes.BIGINT, allowNull: false },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  event_type: { type: DataTypes.STRING, allowNull: false },
  entity_type: { type: DataTypes.STRING, allowNull: true },
  entity_id: { type: DataTypes.STRING, allowNull: true },
  user_id: { type: DataTypes.STRING, allowNull: true },
  device_id: { type: DataTypes.STRING, allowNull: true },
  host_term: { type: DataTypes.INTEGER, allowNull: true },
  action: { type: DataTypes.STRING, allowNull: false },
  old_value: { type: DataTypes.JSONB, allowNull: true },
  new_value: { type: DataTypes.JSONB, allowNull: true },
  reason: { type: DataTypes.TEXT, allowNull: true },
  previous_hash: { type: DataTypes.STRING, allowNull: true },
  hash: { type: DataTypes.STRING, allowNull: false },
}, {
  tableName: 'audit_events',
  timestamps: true,
  underscored: true,
  updatedAt: false,
  createdAt: 'created_at',
  indexes: [
    { unique: true, fields: ['shop_id', 'seq'] },
    { fields: ['shop_id', 'created_at'] },
  ],
});
