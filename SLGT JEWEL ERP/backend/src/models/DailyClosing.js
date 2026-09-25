import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopOriginFields } from './_syncFields.js';

export const DailyClosing = sequelize.define('DailyClosing', {
  id: { type: DataTypes.STRING, primaryKey: true },
  date: { type: DataTypes.DATEONLY, allowNull: false },
  opening_cash: { type: DataTypes.FLOAT, defaultValue: 0 },
  closing_cash: { type: DataTypes.FLOAT, defaultValue: 0 },
  /** System-expected till cash: opening + cash sales − cash expenses */
  expected_cash: { type: DataTypes.FLOAT, defaultValue: 0 },
  /** counted closing_cash − expected_cash */
  variance: { type: DataTypes.FLOAT, defaultValue: 0 },
  cash_expenses: { type: DataTypes.FLOAT, defaultValue: 0 },
  /** Credit side — misc. cash/bank/UPI/card income recorded for the day */
  cash_income: { type: DataTypes.FLOAT, defaultValue: 0 },
  /** Cash paid out to vendors via Purchases on this day */
  cash_purchases: { type: DataTypes.FLOAT, defaultValue: 0 },
  total_sales: { type: DataTypes.FLOAT, defaultValue: 0 },
  total_expenses: { type: DataTypes.FLOAT, defaultValue: 0 },
  total_income: { type: DataTypes.FLOAT, defaultValue: 0 },
  cash_received: { type: DataTypes.FLOAT, defaultValue: 0 },
  upi_received: { type: DataTypes.FLOAT, defaultValue: 0 },
  card_received: { type: DataTypes.FLOAT, defaultValue: 0 },
  bank_received: { type: DataTypes.FLOAT, defaultValue: 0 },
  invoice_count: { type: DataTypes.INTEGER, defaultValue: 0 },
  expense_count: { type: DataTypes.INTEGER, defaultValue: 0 },
  income_count: { type: DataTypes.INTEGER, defaultValue: 0 },
  notes: { type: DataTypes.TEXT },
  /** Frozen EOD report (metals, schemes, stock, etc.) */
  snapshot_json: { type: DataTypes.JSONB, allowNull: true },
  /** Cashier verification checklist */
  checklist_json: { type: DataTypes.JSONB, allowNull: true, defaultValue: {} },
  status: { type: DataTypes.STRING, defaultValue: 'draft' }, // draft | closed
  closed_by: { type: DataTypes.STRING },
  closed_at: { type: DataTypes.DATE, allowNull: true },
  ...shopOriginFields,
}, {
  tableName: 'daily_closings',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['shop_id', 'date'], name: 'daily_closings_shop_date_uk' },
  ],
});
