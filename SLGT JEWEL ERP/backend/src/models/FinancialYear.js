import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields } from './_syncFields.js';

/**
 * Indian Financial Year master — 01 April YYYY → 31 March YYYY+1.
 *
 * Shop-scoped (accounting data is shop-scoped). The financial year is derived
 * from the ERP's authoritative BUSINESS DATE (journal entry_date / transaction
 * business_date), never from created_at / updated_at / server timestamp.
 *
 * This is a separate concept from financial_mode (PRE_ACCOUNTS / LIVE):
 *   financial mode = PRE_ACCOUNTS / LIVE   (test vs live accounting)
 *   financial year = 2026-27 / 2027-28 …  (the April–March period)
 */
export const FinancialYear = sequelize.define('FinancialYear', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  /** e.g. "2026-27" */
  financial_year_code: { type: DataTypes.STRING, allowNull: false },
  /** e.g. "FY 2026-27 (Apr 2026 – Mar 2027)" */
  display_name: { type: DataTypes.STRING, allowNull: true },
  start_date: { type: DataTypes.DATEONLY, allowNull: false },
  end_date: { type: DataTypes.DATEONLY, allowNull: false },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'OPEN' }, // OPEN | CLOSED
  is_current: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  closed_at: { type: DataTypes.DATE, allowNull: true },
  closed_by: { type: DataTypes.STRING, allowNull: true },
  reopened_at: { type: DataTypes.DATE, allowNull: true },
  reopened_by: { type: DataTypes.STRING, allowNull: true },
  ...shopAuditFields,
}, {
  tableName: 'financial_years',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['shop_id', 'financial_year_code'], name: 'fy_shop_code_uk' },
    { unique: true, fields: ['shop_id', 'start_date'], name: 'fy_shop_start_uk' },
    { fields: ['shop_id', 'is_current'] },
    { fields: ['shop_id', 'status'] },
  ],
});
