/**
 * Links products to the existing ShopCounter master so stock can be filtered/grouped
 * by physical counter (Stock Check, Counter Stock quick reports).
 */
import { DataTypes } from 'sequelize';
import { addColumnIfMissing, removeColumnIfExists, indexExists } from './_helpers.js';
import { SCHEMA_VERSION_KEY, SCHEMA_VERSION } from '../config/schemaVersion.js';

export async function up({ context: qi }) {
  const sequelize = qi.sequelize;

  await addColumnIfMissing(qi, 'products', 'counter_id', {
    type: DataTypes.STRING,
    allowNull: true,
  });

  if (!(await indexExists(sequelize, 'products_shop_counter_idx'))) {
    await qi.addIndex('products', ['shop_id', 'counter_id'], {
      name: 'products_shop_counter_idx',
    });
  }

  await sequelize.query(
    `INSERT INTO schema_meta (key, value, updated_at)
     VALUES (:key, :value::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    {
      replacements: {
        key: SCHEMA_VERSION_KEY,
        value: JSON.stringify({ version: SCHEMA_VERSION, phase: 'product-counter' }),
      },
    },
  );
}

export async function down({ context: qi }) {
  await qi.removeIndex('products', 'products_shop_counter_idx').catch(() => {});
  await removeColumnIfExists(qi, 'products', 'counter_id');
}
