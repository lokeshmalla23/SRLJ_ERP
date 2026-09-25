import { DataTypes } from 'sequelize';
import { tableExists } from './_helpers.js';

export async function up({ context: queryInterface }) {
  if (await tableExists(queryInterface, 'draft_sales')) return;

  await queryInterface.createTable('draft_sales', {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    cashier_id: { type: DataTypes.INTEGER, allowNull: true },
    customer_id: { type: DataTypes.INTEGER, allowNull: true },
    items: { type: DataTypes.TEXT, allowNull: false },
    subtotal: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    discount_amount: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    total: { type: DataTypes.DECIMAL(12, 2), defaultValue: 0 },
    quoted_gold_rate: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
    conflict_reason: { type: DataTypes.TEXT, allowNull: true },
    promoted_invoice_id: { type: DataTypes.INTEGER, allowNull: true },
    pricing_mode: { type: DataTypes.STRING, allowNull: false, defaultValue: 'preserve' },
    shop_id: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });
}

export async function down({ context: queryInterface }) {
  await queryInterface.dropTable('draft_sales').catch(() => {});
}
