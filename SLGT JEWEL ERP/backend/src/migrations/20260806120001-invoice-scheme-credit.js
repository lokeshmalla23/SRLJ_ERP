import { DataTypes } from 'sequelize';
import { columnExists } from './_helpers.js';

export async function up({ context: queryInterface }) {
  if (!(await columnExists(queryInterface, 'invoices', 'scheme_credit'))) {
    await queryInterface.addColumn('invoices', 'scheme_credit', {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
    });
  }
  if (!(await columnExists(queryInterface, 'invoices', 'scheme_id'))) {
    await queryInterface.addColumn('invoices', 'scheme_id', {
      type: DataTypes.STRING,
      allowNull: true,
    });
  }
  if (!(await columnExists(queryInterface, 'invoices', 'quotation_id'))) {
    await queryInterface.addColumn('invoices', 'quotation_id', {
      type: DataTypes.STRING,
      allowNull: true,
    });
  }
}

export async function down({ context: queryInterface }) {
  if (await columnExists(queryInterface, 'invoices', 'quotation_id')) {
    await queryInterface.removeColumn('invoices', 'quotation_id');
  }
  if (await columnExists(queryInterface, 'invoices', 'scheme_id')) {
    await queryInterface.removeColumn('invoices', 'scheme_id');
  }
  if (await columnExists(queryInterface, 'invoices', 'scheme_credit')) {
    await queryInterface.removeColumn('invoices', 'scheme_credit');
  }
}
