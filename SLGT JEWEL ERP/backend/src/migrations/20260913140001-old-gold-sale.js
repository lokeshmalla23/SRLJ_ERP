/**
 * Old Gold Sale/Disposal — selling accumulated old-gold stock (1300) to a
 * wholesaler/refiner. Adds the old_gold_sales table plus a link column on
 * old_gold_receipts so a receipt can be marked disposed exactly once.
 */
import { DataTypes } from 'sequelize';
import { tableExists, addColumnIfMissing } from './_helpers.js';

export async function up({ context: queryInterface }) {
  const qi = queryInterface;

  if (!(await tableExists(qi, 'old_gold_sales'))) {
    await qi.createTable('old_gold_sales', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      sale_no: { type: DataTypes.STRING, allowNull: false },
      business_date: { type: DataTypes.DATEONLY, allowNull: true },
      buyer_name: { type: DataTypes.STRING, allowNull: false },
      vendor_id: { type: DataTypes.STRING, allowNull: true },
      receipt_ids: { type: DataTypes.JSONB, defaultValue: [] },
      gross_weight_g: { type: DataTypes.DECIMAL(12, 3), defaultValue: 0 },
      purity: { type: DataTypes.STRING, allowNull: true },
      fine_weight_g: { type: DataTypes.DECIMAL(12, 3), allowNull: true },
      book_value: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      sale_value: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      refining_charges: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      gain_loss_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      payment_mode: { type: DataTypes.STRING, allowNull: false, defaultValue: 'cash' },
      reference_no: { type: DataTypes.STRING, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'posted' },
      cancelled_at: { type: DataTypes.DATE, allowNull: true },
      cancelled_by: { type: DataTypes.STRING, allowNull: true },
      cancel_reason: { type: DataTypes.STRING, allowNull: true },
      created_by: { type: DataTypes.STRING, allowNull: true },
      request_id: { type: DataTypes.STRING, allowNull: true },
      financial_mode: { type: DataTypes.STRING(32), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      updated_by_device_id: { type: DataTypes.STRING, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
    await qi.addIndex('old_gold_sales', ['shop_id', 'sale_no'], {
      unique: true,
      name: 'old_gold_sales_no_uk',
    });
    await qi.addIndex('old_gold_sales', ['shop_id', 'business_date'], {
      name: 'old_gold_sales_shop_date_idx',
    });
    await qi.addIndex('old_gold_sales', ['request_id'], {
      name: 'old_gold_sales_request_id_idx',
    });
  }

  await addColumnIfMissing(qi, 'old_gold_receipts', 'old_gold_sale_id', {
    type: DataTypes.STRING,
    allowNull: true,
  });
  if (await tableExists(qi, 'old_gold_receipts')) {
    await qi.addIndex('old_gold_receipts', ['shop_id', 'old_gold_sale_id'], {
      name: 'old_gold_receipts_sale_idx',
    }).catch(() => {});
  }
}

export async function down({ context: queryInterface }) {
  await queryInterface.removeIndex('old_gold_receipts', 'old_gold_receipts_sale_idx').catch(() => {});
  await queryInterface.removeColumn('old_gold_receipts', 'old_gold_sale_id').catch(() => {});
  await queryInterface.dropTable('old_gold_sales').catch(() => {});
}
