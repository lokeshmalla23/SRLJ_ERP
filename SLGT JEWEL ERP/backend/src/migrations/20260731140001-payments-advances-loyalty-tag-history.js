/**
 * Phase 2+ foundation tables: payments, advances, loyalty, tag status history.
 * Safe for existing DBs — createTable IF NOT EXISTS style via helpers.
 */
import { DataTypes } from 'sequelize';
import { tableExists } from './_helpers.js';

export async function up({ context: queryInterface }) {
  const qi = queryInterface;

  if (!(await tableExists(qi, 'payments'))) {
    await qi.createTable('payments', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      invoice_id: { type: DataTypes.STRING, allowNull: true },
      customer_id: { type: DataTypes.STRING, allowNull: true },
      mode: { type: DataTypes.STRING, allowNull: false },
      amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      amount_paise: { type: DataTypes.INTEGER, allowNull: true },
      reference: { type: DataTypes.STRING, allowNull: true },
      received_by: { type: DataTypes.STRING, allowNull: true },
      request_id: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'posted' },
      paid_at: { type: DataTypes.DATE, allowNull: true },
      meta: { type: DataTypes.JSONB, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      updated_by_device_id: { type: DataTypes.STRING, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
  }

  if (!(await tableExists(qi, 'customer_advances'))) {
    await qi.createTable('customer_advances', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      customer_id: { type: DataTypes.STRING, allowNull: false },
      amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      amount_paise: { type: DataTypes.INTEGER, allowNull: true },
      used_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      remaining_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      mode: { type: DataTypes.STRING, allowNull: true },
      reference: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'open' },
      request_id: { type: DataTypes.STRING, allowNull: true },
      received_by: { type: DataTypes.STRING, allowNull: true },
      meta: { type: DataTypes.JSONB, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      updated_by_device_id: { type: DataTypes.STRING, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
  }

  if (!(await tableExists(qi, 'customer_advance_applications'))) {
    await qi.createTable('customer_advance_applications', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      advance_id: { type: DataTypes.STRING, allowNull: false },
      invoice_id: { type: DataTypes.STRING, allowNull: false },
      amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      amount_paise: { type: DataTypes.INTEGER, allowNull: true },
      request_id: { type: DataTypes.STRING, allowNull: true },
      meta: { type: DataTypes.JSONB, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      updated_by_device_id: { type: DataTypes.STRING, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
  }

  if (!(await tableExists(qi, 'loyalty_transactions'))) {
    await qi.createTable('loyalty_transactions', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      customer_id: { type: DataTypes.STRING, allowNull: false },
      points: { type: DataTypes.INTEGER, allowNull: false },
      balance_after: { type: DataTypes.INTEGER, allowNull: true },
      type: { type: DataTypes.STRING, allowNull: false },
      invoice_id: { type: DataTypes.STRING, allowNull: true },
      reason: { type: DataTypes.STRING, allowNull: true },
      request_id: { type: DataTypes.STRING, allowNull: true },
      meta: { type: DataTypes.JSONB, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      updated_by_device_id: { type: DataTypes.STRING, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
  }

  if (!(await tableExists(qi, 'product_status_history'))) {
    await qi.createTable('product_status_history', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      product_id: { type: DataTypes.STRING, allowNull: false },
      from_status: { type: DataTypes.STRING, allowNull: true },
      to_status: { type: DataTypes.STRING, allowNull: false },
      reason: { type: DataTypes.STRING, allowNull: true },
      reference_type: { type: DataTypes.STRING, allowNull: true },
      reference_id: { type: DataTypes.STRING, allowNull: true },
      user_id: { type: DataTypes.STRING, allowNull: true },
      device_id: { type: DataTypes.STRING, allowNull: true },
      meta: { type: DataTypes.JSONB, defaultValue: {} },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      updated_by_device_id: { type: DataTypes.STRING, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
  }
}

export async function down({ context: queryInterface }) {
  const tables = [
    'product_status_history',
    'loyalty_transactions',
    'customer_advance_applications',
    'customer_advances',
    'payments',
  ];
  for (const t of tables) {
    if (await tableExists(queryInterface, t)) {
      await queryInterface.dropTable(t);
    }
  }
}
