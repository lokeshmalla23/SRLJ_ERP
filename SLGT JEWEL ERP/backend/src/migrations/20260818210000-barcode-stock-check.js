import { DataTypes } from 'sequelize';
import { tableExists } from './_helpers.js';

export async function up({ context: qi }) {
  if (!(await tableExists(qi, 'barcode_stock_check_sessions'))) {
    await qi.createTable('barcode_stock_check_sessions', {
      id: { type: DataTypes.STRING, primaryKey: true },
      shop_id: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      created_by: { type: DataTypes.STRING, allowNull: true },
      device_id: { type: DataTypes.STRING, allowNull: true },
      started_at: { type: DataTypes.DATE, allowNull: false },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      reset_at: { type: DataTypes.DATE, allowNull: true },
      reset_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await qi.addIndex('barcode_stock_check_sessions', ['shop_id', 'status'], {
      name: 'barcode_stock_check_sessions_shop_status_idx',
    });
  }

  if (!(await tableExists(qi, 'barcode_stock_check_scans'))) {
    await qi.createTable('barcode_stock_check_scans', {
      id: { type: DataTypes.STRING, primaryKey: true },
      session_id: { type: DataTypes.STRING, allowNull: false },
      shop_id: { type: DataTypes.STRING, allowNull: true },
      barcode: { type: DataTypes.STRING, allowNull: false },
      product_id: { type: DataTypes.STRING, allowNull: true },
      item_name: { type: DataTypes.STRING, allowNull: true },
      result: { type: DataTypes.STRING, allowNull: false },
      scanned_by: { type: DataTypes.STRING, allowNull: true },
      device_id: { type: DataTypes.STRING, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
    });
    await qi.addIndex('barcode_stock_check_scans', ['session_id', 'barcode'], {
      name: 'barcode_stock_check_scans_session_barcode_idx',
    });
    await qi.addIndex('barcode_stock_check_scans', ['session_id', 'result'], {
      name: 'barcode_stock_check_scans_session_result_idx',
    });
  }
}

export async function down({ context: qi }) {
  await qi.dropTable('barcode_stock_check_scans').catch(() => {});
  await qi.dropTable('barcode_stock_check_sessions').catch(() => {});
}
