/**
 * SQLite-safe barcode uniqueness: audit duplicates, apply UNIQUE only when clean.
 */
import { tableExists, columnExists, indexExists } from './_helpers.js';

export async function up({ context: queryInterface }) {
  const qi = queryInterface;
  const sequelize = qi.sequelize;
  if (!(await tableExists(qi, 'products'))) return;
  if (!(await columnExists(qi, 'products', 'barcode'))) return;

  const dialect = sequelize.getDialect();
  let dupes;
  if (dialect === 'sqlite') {
    [dupes] = await sequelize.query(`
      SELECT shop_id, barcode, COUNT(*) AS cnt, GROUP_CONCAT(id) AS product_ids
      FROM products
      WHERE barcode IS NOT NULL AND TRIM(barcode) <> ''
      GROUP BY shop_id, barcode
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC, barcode
    `);
  } else {
    [dupes] = await sequelize.query(`
      SELECT shop_id, barcode, COUNT(*)::int AS cnt, ARRAY_AGG(id)::text AS product_ids
      FROM products
      WHERE barcode IS NOT NULL AND BTRIM(barcode) <> ''
      GROUP BY shop_id, barcode
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC, barcode
    `);
  }

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS barcode_duplicate_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id TEXT,
      barcode TEXT,
      conflict_count INT,
      product_ids TEXT,
      reported_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).catch(async () => {
    // Postgres may need SERIAL
    if (dialect !== 'sqlite') {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS barcode_duplicate_audit (
          id SERIAL PRIMARY KEY,
          shop_id TEXT,
          barcode TEXT,
          conflict_count INT,
          product_ids TEXT,
          reported_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    }
  });

  if (dupes.length > 0) {
    console.warn(`[barcode] ${dupes.length} duplicate barcode groups — UNIQUE not applied`);
    await sequelize.query('DELETE FROM barcode_duplicate_audit').catch(() => {});
    for (const d of dupes) {
      await sequelize.query(
        `INSERT INTO barcode_duplicate_audit (shop_id, barcode, conflict_count, product_ids)
         VALUES (:shop_id, :barcode, :cnt, :ids)`,
        {
          replacements: {
            shop_id: d.shop_id,
            barcode: d.barcode,
            cnt: d.cnt,
            ids: String(d.product_ids),
          },
        }
      );
    }
    return;
  }

  if (await indexExists(sequelize, 'products_shop_id_barcode_uk')) {
    console.log('  = products_shop_id_barcode_uk already exists');
    return;
  }

  if (dialect === 'sqlite') {
    await sequelize.query(`
      CREATE UNIQUE INDEX products_shop_id_barcode_uk
      ON products (shop_id, barcode)
      WHERE barcode IS NOT NULL AND TRIM(barcode) <> ''
    `);
  } else {
    await sequelize.query(`
      CREATE UNIQUE INDEX products_shop_id_barcode_uk
      ON products (shop_id, barcode)
      WHERE barcode IS NOT NULL AND BTRIM(barcode) <> ''
    `);
  }
  console.log('  ✓ Unique index products_shop_id_barcode_uk created');
}

export async function down() {}
