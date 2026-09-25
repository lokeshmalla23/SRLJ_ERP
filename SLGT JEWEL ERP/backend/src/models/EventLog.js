import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';

/**
 * Durable ordered change log for LAN replication (not cloud outbox).
 * seq is monotonic per shop on the host.
 */
export const EventLog = sequelize.define('EventLog', {
  id: { type: DataTypes.STRING, primaryKey: true },
  seq: { type: DataTypes.BIGINT, allowNull: false },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  host_term: { type: DataTypes.INTEGER, allowNull: false },
  event_type: { type: DataTypes.STRING, allowNull: false },
  entity_type: { type: DataTypes.STRING, allowNull: true },
  entity_id: { type: DataTypes.STRING, allowNull: true },
  operation_id: { type: DataTypes.STRING, allowNull: true },
  origin_device_id: { type: DataTypes.STRING, allowNull: true },
  user_id: { type: DataTypes.STRING, allowNull: true },
  critical: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: 'event_log',
  timestamps: true,
  underscored: true,
  updatedAt: false,
  createdAt: 'created_at',
  indexes: [
    { unique: true, fields: ['shop_id', 'seq'] },
    { fields: ['shop_id', 'operation_id'] },
    { fields: ['shop_id', 'created_at'] },
  ],
});
