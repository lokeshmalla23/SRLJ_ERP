import { DataTypes } from 'sequelize';
import { tableExists, indexExists } from './_helpers.js';

/** Pure gold/silver coins & biscuits inventory (qty-tracked sellable units). */
export async function up({ context: qi }) {
  if (!(await tableExists(qi, 'pure_products'))) {
    await qi.createTable('pure_products', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: true },
      metal: { type: DataTypes.STRING, allowNull: false },
      form_type: { type: DataTypes.STRING, allowNull: false },
      weight_g: { type: DataTypes.DECIMAL(12, 3), allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      stock_qty: { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
      low_stock_threshold: { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
      notes: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
  }

  const sequelize = qi.sequelize;
  if (!(await indexExists(sequelize, 'pure_products_shop_metal_form_weight_uk'))) {
    await qi.addIndex('pure_products', ['shop_id', 'metal', 'form_type', 'weight_g'], {
      unique: true,
      name: 'pure_products_shop_metal_form_weight_uk',
    });
  }
}

export async function down({ context: qi }) {
  if (await tableExists(qi, 'pure_products')) {
    await qi.dropTable('pure_products');
  }
}
