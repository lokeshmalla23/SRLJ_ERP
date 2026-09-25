import { columnExists, tableExists } from './_helpers.js';

const REQUIRED_SHOP_ID = [
  'users',
  'settings',
  'categories',
  'attributes',
  'catalog_items',
  'products',
  'customers',
  'invoices',
  'quotations',
  'orders',
  'schemes',
  'scheme_plans',
  'vendors',
  'purchases',
  'stock_history',
  'inventory_adjustments',
  'barcode_templates',
  'employees',
  'expenses',
  'expense_categories',
  'daily_closings',
  'campaigns',
  'campaign_messages',
  'notifications',
];

/**
 * After backfill, enforce NOT NULL shop_id on tables that have no nulls.
 * Skips (with warning) if any null remains.
 */
export async function up({ context: qi }) {
  const sequelize = qi.sequelize;

  for (const table of REQUIRED_SHOP_ID) {
    if (!(await tableExists(qi, table))) continue;
    if (!(await columnExists(qi, table, 'shop_id'))) continue;

    const [rows] = await sequelize.query(
      `SELECT COUNT(*)::int AS c FROM ${table} WHERE shop_id IS NULL`
    );
    const nullCount = rows[0]?.c ?? 0;
    if (nullCount > 0) {
      console.warn(
        `  ! Skipping NOT NULL on ${table}.shop_id — ${nullCount} null row(s) remain`
      );
      continue;
    }

    await sequelize.query(
      `ALTER TABLE ${table} ALTER COLUMN shop_id SET NOT NULL`
    );
  }
}

export async function down({ context: qi }) {
  const sequelize = qi.sequelize;
  for (const table of REQUIRED_SHOP_ID) {
    if (!(await tableExists(qi, table))) continue;
    if (!(await columnExists(qi, table, 'shop_id'))) continue;
    await sequelize.query(
      `ALTER TABLE ${table} ALTER COLUMN shop_id DROP NOT NULL`
    );
  }
}
