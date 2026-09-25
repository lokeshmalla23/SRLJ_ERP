import { DataTypes } from 'sequelize';
import { tableExists, indexExists } from './_helpers.js';

/** Daily pure gold / silver stock book. */
export async function up({ context: qi }) {
  if (!(await tableExists(qi, 'pure_metal_dailies'))) {
    await qi.createTable('pure_metal_dailies', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: true },
      date: { type: DataTypes.DATEONLY, allowNull: false },
      opening_gold_g: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      opening_silver_g: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      received_gold_g: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      received_silver_g: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      sold_gold_g: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      sold_silver_g: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      expected_closing_gold_g: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      expected_closing_silver_g: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      closing_gold_g: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      closing_silver_g: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      variance_gold_g: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      variance_silver_g: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      notes: { type: DataTypes.TEXT, allowNull: true },
      snapshot_json: { type: DataTypes.JSONB, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'draft' },
      closed_by: { type: DataTypes.STRING, allowNull: true },
      closed_at: { type: DataTypes.DATE, allowNull: true },
      origin_device_id: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
  }

  const sequelize = qi.sequelize;
  if (!(await indexExists(sequelize, 'pure_metal_dailies_shop_date_uk'))) {
    await qi.addIndex('pure_metal_dailies', ['shop_id', 'date'], {
      unique: true,
      name: 'pure_metal_dailies_shop_date_uk',
    });
  }
}

export async function down({ context: qi }) {
  if (await tableExists(qi, 'pure_metal_dailies')) {
    await qi.dropTable('pure_metal_dailies');
  }
}
