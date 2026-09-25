import { DataTypes } from 'sequelize';
import { tableExists } from './_helpers.js';

export async function up({ context: qi }) {
  if (!(await tableExists(qi, 'barcode_sequences'))) {
    await qi.createTable('barcode_sequences', {
      shop_id: { type: DataTypes.STRING, primaryKey: true },
      next_value: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10001 },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
  }
}

export async function down({ context: qi }) {
  await qi.dropTable('barcode_sequences');
}
