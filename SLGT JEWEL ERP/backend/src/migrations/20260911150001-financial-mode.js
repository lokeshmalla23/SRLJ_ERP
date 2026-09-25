import { DataTypes } from 'sequelize';
import { addColumnIfMissing } from './_helpers.js';

const TABLES = [
  'invoices',
  'payments',
  'expenses',
  'purchases',
  'customer_advances',
  'customer_advance_applications',
  'quotations',
  'credit_notes',
  'old_gold_receipts',
  'cashbook_entries',
  'schemes',
  'orders',
  'journal_entries',
];

/**
 * Shop-scoped PRE_ACCOUNTS vs LIVE classification for financial rows.
 * Inventory tables are intentionally omitted.
 *
 * SQLite desktop skips Umzug — sequelize.sync + ensureLocalSqliteSchema add the
 * column, then financialMode.backfillFinancialModes runs at boot.
 */
export async function up({ sequelize, context: qi }) {
  for (const table of TABLES) {
    await addColumnIfMissing(qi, table, 'financial_mode', {
      type: DataTypes.STRING(32),
      allowNull: true,
    });
  }

  try {
    const { backfillFinancialModes } = await import('../services/financialMode.js');
    await backfillFinancialModes(sequelize);
  } catch (err) {
    console.warn('[migration] financial_mode backfill deferred:', err?.message);
  }
}

export async function down({ context: qi }) {
  const { removeColumnIfExists } = await import('./_helpers.js');
  for (const table of TABLES) {
    await removeColumnIfExists(qi, table, 'financial_mode');
  }
}
