import { indexExists, tableExists, columnExists } from './_helpers.js';

/**
 * Attempt unique (shop_id, barcode) WHERE barcode IS NOT NULL AND barcode <> ''.
 * If duplicates exist, SKIP constraint and write findings to console
 * (does not modify/delete barcodes).
 */
export async function up({ context: qi }) {
  const sequelize = qi.sequelize;

  if (!(await tableExists(qi, 'products'))) {
    console.log('  = products table missing — skip barcode constraint');
    return;
  }
  if (!(await columnExists(qi, 'products', 'shop_id'))) {
    console.log('  = products.shop_id missing — skip barcode constraint');
    return;
  }

  const [dupes] = await sequelize.query(`
    SELECT shop_id, barcode, COUNT(*)::int AS cnt, ARRAY_AGG(id) AS product_ids
    FROM products
    WHERE barcode IS NOT NULL AND BTRIM(barcode) <> ''
    GROUP BY shop_id, barcode
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC, barcode
  `);

  if (dupes.length > 0) {
    console.warn('  ! Duplicate barcodes found — unique constraint NOT applied:');
    for (const d of dupes) {
      console.warn(
        `    barcode=${d.barcode} shop=${d.shop_id} count=${d.cnt} ids=${d.product_ids}`
      );
    }
    console.warn(
      '  ! Resolve duplicates manually, then re-run audit script / add constraint migration.'
    );
    // Persist report table for operators (optional lightweight)
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS barcode_duplicate_audit (
        id SERIAL PRIMARY KEY,
        shop_id TEXT,
        barcode TEXT,
        conflict_count INT,
        product_ids TEXT[],
        reported_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await sequelize.query(`DELETE FROM barcode_duplicate_audit`);
    for (const d of dupes) {
      await sequelize.query(
        `INSERT INTO barcode_duplicate_audit (shop_id, barcode, conflict_count, product_ids)
         VALUES (:shop_id, :barcode, :cnt, :ids)`,
        {
          replacements: {
            shop_id: d.shop_id,
            barcode: d.barcode,
            cnt: d.cnt,
            ids: d.product_ids,
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

  await sequelize.query(`
    CREATE UNIQUE INDEX products_shop_id_barcode_uk
    ON products (shop_id, barcode)
    WHERE barcode IS NOT NULL AND BTRIM(barcode) <> ''
  `);
  console.log('  ✓ Unique index products_shop_id_barcode_uk created');
}

export async function down({ context: qi }) {
  const sequelize = qi.sequelize;
  await sequelize.query(`DROP INDEX IF EXISTS products_shop_id_barcode_uk`);
  await sequelize.query(`DROP TABLE IF EXISTS barcode_duplicate_audit`);
}
