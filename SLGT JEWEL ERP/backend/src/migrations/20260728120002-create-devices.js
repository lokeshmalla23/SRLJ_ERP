import { DataTypes } from 'sequelize';
import { tableExists, indexExists } from './_helpers.js';

export async function up({ context: qi }) {
  const sequelize = qi.sequelize;
  if (!(await tableExists(qi, 'devices'))) {
    await qi.createTable('devices', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      device_name: { type: DataTypes.STRING, allowNull: false },
      device_identifier: { type: DataTypes.STRING, allowNull: false },
      role: { type: DataTypes.STRING, allowNull: false, defaultValue: 'client' },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
      last_seen_at: { type: DataTypes.DATE, allowNull: true },
      meta: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
  }

  if (!(await indexExists(sequelize, 'devices_shop_id_device_identifier_uk'))) {
    await qi.addIndex('devices', ['shop_id', 'device_identifier'], {
      unique: true,
      name: 'devices_shop_id_device_identifier_uk',
    });
  }
  if (!(await indexExists(sequelize, 'devices_shop_id_role_idx'))) {
    await qi.addIndex('devices', ['shop_id', 'role'], { name: 'devices_shop_id_role_idx' });
  }
  if (!(await indexExists(sequelize, 'devices_shop_id_status_idx'))) {
    await qi.addIndex('devices', ['shop_id', 'status'], { name: 'devices_shop_id_status_idx' });
  }
}

export async function down({ context: qi }) {
  await qi.dropTable('devices');
}
