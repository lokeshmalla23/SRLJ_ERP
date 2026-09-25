import { indexExists, tableExists } from './_helpers.js';

/**
 * Functional index on lower(barcode) so the POS autocomplete prefix search
 * (GET /api/products/barcode-search) stays index-backed as inventory grows,
 * instead of a sequential scan.
 */
export async function up({ context: qi }) {
  const sequelize = qi.sequelize;
  if (!(await tableExists(qi, 'products'))) return;

  if (await indexExists(sequelize, 'products_barcode_lower_prefix_idx')) return;

  await sequelize.query(`
    CREATE INDEX products_barcode_lower_prefix_idx
    ON products (lower(barcode) varchar_pattern_ops)
  `);
}

export async function down({ context: qi }) {
  await qi.sequelize.query(`DROP INDEX IF EXISTS products_barcode_lower_prefix_idx`);
}
