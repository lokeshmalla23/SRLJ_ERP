import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sequelize from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Audit duplicate barcodes within each shop.
 * Does NOT modify product data.
 */
async function run() {
  await sequelize.authenticate();

  const [dupes] = await sequelize.query(`
    SELECT shop_id, barcode, COUNT(*)::int AS cnt, ARRAY_AGG(id ORDER BY created_at) AS product_ids
    FROM products
    WHERE barcode IS NOT NULL AND BTRIM(barcode) <> ''
    GROUP BY shop_id, barcode
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC, barcode
  `);

  const report = {
    generated_at: new Date().toISOString(),
    duplicate_groups: dupes.length,
    conflicts: dupes,
    unique_constraint_safe: dupes.length === 0,
  };

  const outDir = path.resolve(__dirname, '../../../docs');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'barcode-duplicate-audit.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`Duplicate barcode groups: ${dupes.length}`);
  if (dupes.length === 0) {
    console.log('Safe to apply unique (shop_id, barcode) partial index.');
  } else {
    console.log('NOT safe — resolve conflicts before adding unique constraint.');
    for (const d of dupes.slice(0, 20)) {
      console.log(`  ${d.barcode} x${d.cnt} shop=${d.shop_id} ids=${d.product_ids}`);
    }
  }
  console.log(`Report written: ${outPath}`);

  await sequelize.close();
  process.exit(dupes.length === 0 ? 0 : 2);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
