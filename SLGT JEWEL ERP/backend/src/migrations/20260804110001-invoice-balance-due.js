import { DataTypes } from 'sequelize';
import { columnExists } from './_helpers.js';

export async function up({ context: queryInterface }) {
  if (!(await columnExists(queryInterface, 'invoices', 'balance_due'))) {
    await queryInterface.addColumn('invoices', 'balance_due', {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
    });
  }
}

export async function down({ context: queryInterface }) {
  await queryInterface.removeColumn('invoices', 'balance_due');
}
