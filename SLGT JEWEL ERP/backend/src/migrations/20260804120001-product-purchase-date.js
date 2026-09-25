import { DataTypes } from 'sequelize';
import { columnExists, tableExists } from './_helpers.js';

export async function up({ context: queryInterface }) {
  if (!(await tableExists(queryInterface, 'products'))) return;
  if (await columnExists(queryInterface, 'products', 'purchase_date')) return;
  await queryInterface.addColumn('products', 'purchase_date', {
    type: DataTypes.DATEONLY,
    allowNull: true,
  });
}

export async function down({ context: queryInterface }) {
  if (!(await tableExists(queryInterface, 'products'))) return;
  if (!(await columnExists(queryInterface, 'products', 'purchase_date'))) return;
  await queryInterface.removeColumn('products', 'purchase_date');
}
