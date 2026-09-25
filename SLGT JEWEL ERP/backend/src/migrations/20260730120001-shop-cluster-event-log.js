import { DataTypes } from 'sequelize';
import { tableExists, indexExists } from './_helpers.js';

export async function up({ context: qi }) {
  const sequelize = qi.sequelize;

  if (!(await tableExists(qi, 'cluster_state'))) {
    await qi.createTable('cluster_state', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false, unique: true },
      node_id: { type: DataTypes.STRING, allowNull: false },
      host_id: { type: DataTypes.STRING, allowNull: true },
      host_term: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      role: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active_host' },
      event_watermark: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      fenced: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      fenced_reason: { type: DataTypes.TEXT, allowNull: true },
      meta: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
  }

  if (!(await tableExists(qi, 'event_log'))) {
    await qi.createTable('event_log', {
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
      created_at: { type: DataTypes.DATE, allowNull: false },
    });
  }
  if (!(await indexExists(sequelize, 'event_log_shop_seq_uk'))) {
    await qi.addIndex('event_log', ['shop_id', 'seq'], { unique: true, name: 'event_log_shop_seq_uk' });
  }

  if (!(await tableExists(qi, 'operation_ledger'))) {
    await qi.createTable('operation_ledger', {
      operation_id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      operation_type: { type: DataTypes.STRING, allowNull: false },
      entity_type: { type: DataTypes.STRING, allowNull: true },
      entity_id: { type: DataTypes.STRING, allowNull: true },
      host_term: { type: DataTypes.INTEGER, allowNull: true },
      result: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      device_id: { type: DataTypes.STRING, allowNull: true },
      user_id: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
  }

  if (!(await tableExists(qi, 'audit_events'))) {
    await qi.createTable('audit_events', {
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
      created_at: { type: DataTypes.DATE, allowNull: false },
    });
  }
  if (!(await indexExists(sequelize, 'audit_events_shop_seq_uk'))) {
    await qi.addIndex('audit_events', ['shop_id', 'seq'], { unique: true, name: 'audit_events_shop_seq_uk' });
  }

  if (!(await tableExists(qi, 'replica_acks'))) {
    await qi.createTable('replica_acks', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      event_seq: { type: DataTypes.BIGINT, allowNull: false },
      device_id: { type: DataTypes.STRING, allowNull: false },
      acked_at: { type: DataTypes.DATE, allowNull: false },
    });
  }
  if (!(await indexExists(sequelize, 'replica_acks_shop_seq_device_uk'))) {
    await qi.addIndex('replica_acks', ['shop_id', 'event_seq', 'device_id'], {
      unique: true,
      name: 'replica_acks_shop_seq_device_uk',
    });
  }
}

export async function down({ context: qi }) {
  await qi.dropTable('replica_acks').catch(() => {});
  await qi.dropTable('audit_events').catch(() => {});
  await qi.dropTable('operation_ledger').catch(() => {});
  await qi.dropTable('event_log').catch(() => {});
  await qi.dropTable('cluster_state').catch(() => {});
}
