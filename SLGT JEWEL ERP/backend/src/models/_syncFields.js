import { DataTypes } from 'sequelize';

/** Fields for shop-scoped + syncable mutable entities. */
export const shopAuditFields = {
  shop_id: { type: DataTypes.STRING, allowNull: true },
  version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  deleted_at: { type: DataTypes.DATE, allowNull: true },
  origin_device_id: { type: DataTypes.STRING, allowNull: true },
};

/** shop_id + origin only (immutable / append-style rows). */
export const shopOriginFields = {
  shop_id: { type: DataTypes.STRING, allowNull: true },
  origin_device_id: { type: DataTypes.STRING, allowNull: true },
};

export const shopIdField = {
  shop_id: { type: DataTypes.STRING, allowNull: true },
};
