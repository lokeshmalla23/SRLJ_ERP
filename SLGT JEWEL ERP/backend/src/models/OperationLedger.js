import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';

/** Idempotency ledger for critical operations. */
export const OperationLedger = sequelize.define('OperationLedger', {
  operation_id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  operation_type: { type: DataTypes.STRING, allowNull: false },
  entity_type: { type: DataTypes.STRING, allowNull: true },
  entity_id: { type: DataTypes.STRING, allowNull: true },
  host_term: { type: DataTypes.INTEGER, allowNull: true },
  result: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  device_id: { type: DataTypes.STRING, allowNull: true },
  user_id: { type: DataTypes.STRING, allowNull: true },
}, {
  tableName: 'operation_ledger',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['shop_id', 'operation_type', 'created_at'] },
  ],
});
