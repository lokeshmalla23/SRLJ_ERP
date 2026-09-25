import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';

/** Singleton-ish shop cluster identity (one row per shop on this node). */
export const ClusterState = sequelize.define('ClusterState', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false, unique: true },
  node_id: { type: DataTypes.STRING, allowNull: false },
  host_id: { type: DataTypes.STRING, allowNull: true },
  host_term: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  role: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active_host' }, // active_host | replica
  event_watermark: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
  fenced: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  fenced_reason: { type: DataTypes.TEXT, allowNull: true },
  meta: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: 'cluster_state',
  timestamps: true,
  underscored: true,
});
