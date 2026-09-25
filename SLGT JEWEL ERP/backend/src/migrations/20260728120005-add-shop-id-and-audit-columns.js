import { DataTypes } from 'sequelize';
import { addColumnIfMissing, tableExists } from './_helpers.js';

/** Shop-scoped business tables that receive shop_id. */
const SHOP_SCOPED = [
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

/** Mutable entities that get version / soft-delete / origin device. */
const AUDIT_TABLES = [
  'users',
  'products',
  'customers',
  'vendors',
  'schemes',
  'scheme_plans',
  'quotations',
  'orders',
  'purchases',
  'categories',
  'attributes',
  'catalog_items',
  'employees',
  'barcode_templates',
  'settings',
];

/** Immutable / append-oriented rows: origin device only (+ shop_id already). */
const ORIGIN_ONLY = [
  'invoices',
  'expenses',
  'daily_closings',
  'stock_history',
  'inventory_adjustments',
  'campaigns',
  'campaign_messages',
  'notifications',
];

export async function up({ context: qi }) {
  for (const table of SHOP_SCOPED) {
    await addColumnIfMissing(qi, table, 'shop_id', {
      type: DataTypes.STRING,
      allowNull: true,
    });
  }

  for (const table of AUDIT_TABLES) {
    await addColumnIfMissing(qi, table, 'version', {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    });
    await addColumnIfMissing(qi, table, 'deleted_at', {
      type: DataTypes.DATE,
      allowNull: true,
    });
    await addColumnIfMissing(qi, table, 'origin_device_id', {
      type: DataTypes.STRING,
      allowNull: true,
    });
  }

  for (const table of ORIGIN_ONLY) {
    await addColumnIfMissing(qi, table, 'origin_device_id', {
      type: DataTypes.STRING,
      allowNull: true,
    });
  }

  // Preparatory inventory mode for Phase 3 unique-tag model (no behavior change yet)
  await addColumnIfMissing(qi, 'products', 'inventory_mode', {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'quantity',
  });

  // Helpful indexes (non-unique) for shop scoping
  for (const table of ['products', 'customers', 'invoices', 'orders', 'schemes', 'users']) {
    if (await tableExists(qi, table)) {
      try {
        await qi.addIndex(table, ['shop_id'], { name: `${table}_shop_id_idx` });
      } catch {
        // index may already exist
      }
    }
  }
}

export async function down({ context: qi }) {
  const { removeColumnIfExists } = await import('./_helpers.js');

  if (await tableExists(qi, 'products')) {
    await removeColumnIfExists(qi, 'products', 'inventory_mode');
  }

  for (const table of [...AUDIT_TABLES, ...ORIGIN_ONLY]) {
    await removeColumnIfExists(qi, table, 'origin_device_id');
  }
  for (const table of AUDIT_TABLES) {
    await removeColumnIfExists(qi, table, 'deleted_at');
    await removeColumnIfExists(qi, table, 'version');
  }
  for (const table of SHOP_SCOPED) {
    await removeColumnIfExists(qi, table, 'shop_id');
  }
}
