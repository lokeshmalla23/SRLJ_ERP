import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';

export const Device = sequelize.define('Device', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  device_name: { type: DataTypes.STRING, allowNull: false },
  device_identifier: { type: DataTypes.STRING, allowNull: false },
  device_number: { type: DataTypes.INTEGER, allowNull: true },
  role: { type: DataTypes.STRING, allowNull: false, defaultValue: 'client' },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
  last_seen_at: { type: DataTypes.DATE, allowNull: true },
  meta: { type: DataTypes.JSONB, defaultValue: {} },
}, {
  tableName: 'devices',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['shop_id', 'device_identifier'] },
    { fields: ['shop_id', 'role'] },
    { fields: ['shop_id', 'status'] },
  ],
});
