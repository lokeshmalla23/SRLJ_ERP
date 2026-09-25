import { DataTypes } from 'sequelize';
import { tableExists, indexExists } from './_helpers.js';

export async function up({ context: qi }) {
  const sequelize = qi.sequelize;
  if (!(await tableExists(qi, 'invoice_sequences'))) {
    await qi.createTable('invoice_sequences', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: false },
      sequence_date: { type: DataTypes.STRING(8), allowNull: false },
      prefix: { type: DataTypes.STRING, allowNull: false, defaultValue: 'SSJ' },
      next_value: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
  }

  if (!(await indexExists(sequelize, 'invoice_sequences_shop_date_prefix_uk'))) {
    await qi.addIndex('invoice_sequences', ['shop_id', 'sequence_date', 'prefix'], {
      unique: true,
      name: 'invoice_sequences_shop_date_prefix_uk',
    });
  }
}

export async function down({ context: qi }) {
  await qi.dropTable('invoice_sequences');
}
