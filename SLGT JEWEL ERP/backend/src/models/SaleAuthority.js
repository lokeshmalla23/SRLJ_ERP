import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';

/**
 * Cloud authority lease for unique-tag pre-commit reservation.
 * Lifecycle: REQUESTED → GRANTED → COMMITTED | EXPIRED | REJECTED | RELEASED
 *
 * A device must hold a GRANTED lease before committing a unique-tag sale.
 * Leases expire after TTL_SECONDS if not committed.
 */
export const SaleAuthority = sequelize.define('SaleAuthority', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  device_id: { type: DataTypes.STRING, allowNull: false },
  request_id: { type: DataTypes.STRING, allowNull: false },
  entity_type: { type: DataTypes.STRING, allowNull: false, defaultValue: 'product' },
  entity_id: { type: DataTypes.STRING, allowNull: false },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'REQUESTED',
    validate: {
      isIn: [['REQUESTED', 'GRANTED', 'COMMITTED', 'RELEASED', 'EXPIRED', 'REJECTED']],
    },
  },
  expires_at: { type: DataTypes.DATE, allowNull: true },
  committed_at: { type: DataTypes.DATE, allowNull: true },
  released_at: { type: DataTypes.DATE, allowNull: true },
  reject_reason: { type: DataTypes.STRING, allowNull: true },
  meta: { type: DataTypes.JSONB, defaultValue: {} },
}, {
  tableName: 'sale_authorities',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['shop_id', 'entity_type', 'entity_id', 'status'], where: { status: 'GRANTED' }, name: 'sa_one_granted_per_entity' },
    { unique: true, fields: ['request_id'] },
    { fields: ['shop_id', 'status', 'expires_at'] },
    { fields: ['device_id', 'status'] },
  ],
});
