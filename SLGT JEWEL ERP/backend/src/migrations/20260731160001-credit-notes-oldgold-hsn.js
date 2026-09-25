/**
 * Credit notes, old-gold receipts, HSN master tables.
 */
import { DataTypes } from 'sequelize';
import { tableExists } from './_helpers.js';

export async function up({ context: queryInterface }) {
  const qi = queryInterface;

  if (!(await tableExists(qi, 'credit_notes'))) {
    await qi.createTable('credit_notes', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      credit_note_no: { type: DataTypes.STRING, allowNull: false },
      invoice_id: { type: DataTypes.STRING, allowNull: false },
      customer_id: { type: DataTypes.STRING, allowNull: true },
      items: { type: DataTypes.JSONB, defaultValue: [] },
      subtotal: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
      gst_amount: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
      grand_total: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
      amount_paise: { type: DataTypes.INTEGER, allowNull: true },
      reason: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'posted' },
      request_id: { type: DataTypes.STRING, allowNull: true },
      created_by: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      updated_by_device_id: { type: DataTypes.STRING, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
  }

  if (!(await tableExists(qi, 'old_gold_receipts'))) {
    await qi.createTable('old_gold_receipts', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      receipt_no: { type: DataTypes.STRING, allowNull: false },
      customer_id: { type: DataTypes.STRING, allowNull: true },
      invoice_id: { type: DataTypes.STRING, allowNull: true },
      weight_g: { type: DataTypes.DECIMAL(12, 3), allowNull: false },
      purity: { type: DataTypes.STRING, allowNull: true },
      rate: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      value: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      value_paise: { type: DataTypes.INTEGER, allowNull: true },
      description: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'posted' },
      created_by: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      updated_by_device_id: { type: DataTypes.STRING, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
  }

  if (!(await tableExists(qi, 'hsn_codes'))) {
    await qi.createTable('hsn_codes', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      code: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.STRING, allowNull: true },
      gst_pct: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 3 },
      is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      updated_by_device_id: { type: DataTypes.STRING, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
  }
}

export async function down({ context: queryInterface }) {
  await queryInterface.dropTable('hsn_codes').catch(() => {});
  await queryInterface.dropTable('old_gold_receipts').catch(() => {});
  await queryInterface.dropTable('credit_notes').catch(() => {});
}
