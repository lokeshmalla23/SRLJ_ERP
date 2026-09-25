import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields, shopOriginFields } from './_syncFields.js';
import { financialModeField, attachFinancialModeHook } from './_financialMode.js';

export const Scheme = sequelize.define('Scheme', {
  id: { type: DataTypes.STRING, primaryKey: true },
  /** Per-shop running S.No shown to staff/customers (not the internal id). */
  serial_no: { type: DataTypes.INTEGER, allowNull: true },
  customer_id: { type: DataTypes.STRING },
  customer_name: { type: DataTypes.STRING, allowNull: false },
  customer_mobile: { type: DataTypes.STRING },
  plan_name: { type: DataTypes.STRING, allowNull: false },
  /** fixed_amount = cash 11+1 style; swarnakala = gold grams at day's rate */
  scheme_type: { type: DataTypes.STRING, defaultValue: 'fixed_amount' },
  /** amount | weight — mirrors SchemePlan.plan_type */
  plan_type: { type: DataTypes.STRING, defaultValue: 'amount' },
  monthly_amount: { type: DataTypes.FLOAT, allowNull: false },
  duration_months: { type: DataTypes.INTEGER, allowNull: false },
  /** Free/bonus months credited at maturity (cash schemes), e.g. 1 for 11+1 */
  bonus_months: { type: DataTypes.INTEGER, defaultValue: 1 },
  start_date: { type: DataTypes.DATEONLY, allowNull: false },
  status: { type: DataTypes.STRING, defaultValue: 'active' }, // 'active'|'matured'|'completed'|'breaked'|'cancelled'
  payments: { type: DataTypes.JSONB, defaultValue: [] },
  notes: { type: DataTypes.TEXT },
  redeemed_at: { type: DataTypes.DATE, allowNull: true },
  /** Employee who enrolled / registered this scheme (for performance reports). */
  salesperson_id: { type: DataTypes.STRING, allowNull: true },
  ...financialModeField,
  ...shopAuditFields,
}, {
  tableName: 'schemes',
  timestamps: true,
  underscored: true,
});

attachFinancialModeHook(Scheme);
