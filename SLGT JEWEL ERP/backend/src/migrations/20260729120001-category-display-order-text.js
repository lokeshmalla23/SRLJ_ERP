import { tableExists, columnExists } from './_helpers.js';
import { SCHEMA_VERSION, SCHEMA_VERSION_KEY } from '../config/schemaVersion.js';

/**
 * categories.display_order becomes a free-form text sort key (was INTEGER) so
 * it can hold alphanumeric values like "A1" — existing numeric values are cast
 * to their string form, no data loss. Sorting becomes alphabetical, not numeric.
 */
export async function up({ context: qi }) {
  const sequelize = qi.sequelize;
  if (!(await tableExists(qi, 'categories'))) return;
  if (!(await columnExists(qi, 'categories', 'display_order'))) return;

  const desc = await qi.describeTable('categories');
  if (desc.display_order?.type?.toUpperCase().includes('CHAR')) {
    console.log('  = categories.display_order already text — skipping');
  } else {
    await sequelize.query(`
      ALTER TABLE categories
        ALTER COLUMN display_order DROP DEFAULT,
        ALTER COLUMN display_order TYPE VARCHAR(255) USING display_order::varchar,
        ALTER COLUMN display_order SET DEFAULT '0'
    `);
  }

  await sequelize.query(
    `INSERT INTO schema_meta (key, value, updated_at)
     VALUES (:key, :value::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    {
      replacements: {
        key: SCHEMA_VERSION_KEY,
        value: JSON.stringify({ version: SCHEMA_VERSION, phase: 'category-display-order-text' }),
      },
    },
  );
}

export async function down({ context: qi }) {
  const sequelize = qi.sequelize;
  if (!(await tableExists(qi, 'categories'))) return;
  if (!(await columnExists(qi, 'categories', 'display_order'))) return;

  await sequelize.query(`
    ALTER TABLE categories
      ALTER COLUMN display_order DROP DEFAULT,
      ALTER COLUMN display_order TYPE INTEGER USING NULLIF(regexp_replace(display_order, '[^0-9-]', '', 'g'), '')::integer,
      ALTER COLUMN display_order SET DEFAULT 0
  `);
}
