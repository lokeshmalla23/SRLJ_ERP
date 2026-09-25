import pkg from 'sequelize';
const { DataTypes } = pkg;
import sequelize from '../db.js';
import { shopAuditFields } from './_syncFields.js';
import { financialModeField, attachFinancialModeHook } from './_financialMode.js';

/** Minimal chart of accounts for shop-level double-entry. */
export const ChartOfAccount = sequelize.define('ChartOfAccount', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  code: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  type: { type: DataTypes.STRING, allowNull: false }, // asset|liability|equity|income|expense
  is_system: { type: DataTypes.BOOLEAN, defaultValue: false },
  ...shopAuditFields,
}, {
  tableName: 'chart_of_accounts',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['shop_id', 'code'], name: 'coa_shop_code_uk' },
  ],
});

export const JournalEntry = sequelize.define('JournalEntry', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  entry_date: { type: DataTypes.DATEONLY, allowNull: false },
  memo: { type: DataTypes.STRING, allowNull: true },
  source_type: { type: DataTypes.STRING, allowNull: true },
  source_id: { type: DataTypes.STRING, allowNull: true },
  request_id: { type: DataTypes.STRING, allowNull: true },
  created_by: { type: DataTypes.STRING, allowNull: true },
  /** auto | journal | payment | receipt | contra */
  voucher_type: { type: DataTypes.STRING, defaultValue: 'auto' },
  voucher_no: { type: DataTypes.STRING, allowNull: true },
  /** Opening-balance / cutover voucher — included in BS, excluded from period P&L by default */
  is_opening: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  ...financialModeField,
  ...shopAuditFields,
}, {
  tableName: 'journal_entries',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['shop_id', 'entry_date'] },
    { fields: ['source_type', 'source_id'] },
    { fields: ['request_id'] },
  ],
});

attachFinancialModeHook(JournalEntry);

export const JournalLine = sequelize.define('JournalLine', {
  id: { type: DataTypes.STRING, primaryKey: true },
  shop_id: { type: DataTypes.STRING, allowNull: false },
  journal_entry_id: { type: DataTypes.STRING, allowNull: false },
  account_id: { type: DataTypes.STRING, allowNull: false },
  debit_paise: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  credit_paise: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  memo: { type: DataTypes.STRING, allowNull: true },
  ...shopAuditFields,
}, {
  tableName: 'journal_lines',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['journal_entry_id'] },
    { fields: ['account_id'] },
  ],
});
