import { DataTypes } from 'sequelize';
import { tableExists, indexExists } from './_helpers.js';

export async function up({ context: qi }) {
  const sequelize = qi.sequelize;

  if (!(await tableExists(qi, 'sync_outbox'))) {
    await qi.createTable('sync_outbox', {
      id: { type: DataTypes.STRING, primaryKey: true },
      event_id: { type: DataTypes.UUID, allowNull: false, unique: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      entity_type: { type: DataTypes.STRING, allowNull: false },
      entity_id: { type: DataTypes.STRING, allowNull: false },
      operation: { type: DataTypes.STRING, allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
      attempt_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      last_error: { type: DataTypes.TEXT, allowNull: true },
      synced_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
  }

  if (!(await indexExists(sequelize, 'sync_outbox_shop_status_created_idx'))) {
    await qi.addIndex('sync_outbox', ['shop_id', 'status', 'created_at'], {
      name: 'sync_outbox_shop_status_created_idx',
    });
  }
  if (!(await indexExists(sequelize, 'sync_outbox_status_attempts_idx'))) {
    await qi.addIndex('sync_outbox', ['status', 'attempt_count'], {
      name: 'sync_outbox_status_attempts_idx',
    });
  }
  if (!(await indexExists(sequelize, 'sync_outbox_entity_idx'))) {
    await qi.addIndex('sync_outbox', ['entity_type', 'entity_id'], {
      name: 'sync_outbox_entity_idx',
    });
  }

  if (!(await tableExists(qi, 'sync_processed_events'))) {
    await qi.createTable('sync_processed_events', {
      event_id: { type: DataTypes.UUID, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      entity_type: { type: DataTypes.STRING, allowNull: true },
      entity_id: { type: DataTypes.STRING, allowNull: true },
      processed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      result: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    });
  }

  if (!(await indexExists(sequelize, 'sync_processed_events_shop_processed_idx'))) {
    await qi.addIndex('sync_processed_events', ['shop_id', 'processed_at'], {
      name: 'sync_processed_events_shop_processed_idx',
    });
  }

  if (!(await tableExists(qi, 'sync_state'))) {
    await qi.createTable('sync_state', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      device_id: { type: DataTypes.STRING, allowNull: true },
      direction: { type: DataTypes.STRING, allowNull: false },
      cursor: { type: DataTypes.STRING, allowNull: true },
      last_success_at: { type: DataTypes.DATE, allowNull: true },
      last_error: { type: DataTypes.TEXT, allowNull: true },
      meta: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
  }

  if (!(await indexExists(sequelize, 'sync_state_shop_device_direction_uk'))) {
    await qi.addIndex('sync_state', ['shop_id', 'device_id', 'direction'], {
      unique: true,
      name: 'sync_state_shop_device_direction_uk',
    });
  }
}

export async function down({ context: qi }) {
  await qi.dropTable('sync_state');
  await qi.dropTable('sync_processed_events');
  await qi.dropTable('sync_outbox');
}
