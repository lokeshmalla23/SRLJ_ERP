import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';

/** Replica ACK tracking for critical events. */
export const ReplicaAck = sequelize.define('ReplicaAck', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  event_seq: { type: DataTypes.BIGINT, allowNull: false },
  device_id: { type: DataTypes.STRING, allowNull: false },
  acked_at: { type: DataTypes.DATE, allowNull: false },
}, {
  tableName: 'replica_acks',
  timestamps: false,
  underscored: true,
  indexes: [
    { unique: true, fields: ['shop_id', 'event_seq', 'device_id'] },
    { fields: ['shop_id', 'event_seq'] },
  ],
});
