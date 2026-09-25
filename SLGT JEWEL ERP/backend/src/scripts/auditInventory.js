import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sequelize from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Compare products.stock_qty to SUM(inventory_movements.quantity) per product.
 * Also report unique-tag violations and missing barcodes for unique_tag mode.
 * Does NOT modify data.
 */
async function run() {
  await sequelize.authenticate();

  const [products] = await sequelize.query(`
    SELECT id, shop_id, name, barcode, stock_qty, status, inventory_mode,
           gross_weight, net_weight, stone_weight
    FROM products
    ORDER BY name
  `);

  const [sums] = await sequelize.query(`
    SELECT product_id, COALESCE(SUM(quantity), 0)::float AS ledger_qty
    FROM inventory_movements
    GROUP BY product_id
  `);
  const ledgerMap = new Map(sums.map((r) => [r.product_id, parseFloat(r.ledger_qty)]));

  const mismatched = [];
  const uniqueViolations = [];
  const missingBarcodes = [];
  let balanced = 0;

  for (const p of products) {
    const stock = parseFloat(p.stock_qty) || 0;
    const ledger = ledgerMap.has(p.id) ? ledgerMap.get(p.id) : null;

    if (ledger == null) {
      mismatched.push({
        id: p.id,
        name: p.name,
        stock_qty: stock,
        ledger_qty: null,
        reason: 'no_movements',
      });
    } else if (Math.abs(stock - ledger) > 0.0001) {
      mismatched.push({
        id: p.id,
        name: p.name,
        stock_qty: stock,
        ledger_qty: ledger,
        delta: stock - ledger,
        reason: 'qty_mismatch',
      });
    } else {
      balanced += 1;
    }

    if (p.inventory_mode === 'unique_tag') {
      if (!p.barcode || !String(p.barcode).trim()) {
        missingBarcodes.push({ id: p.id, name: p.name });
      }
      if (stock !== 0 && stock !== 1) {
        uniqueViolations.push({
          id: p.id,
          name: p.name,
          stock_qty: stock,
          reason: 'unique_tag_qty_not_0_or_1',
        });
      }
      if (p.status === 'sold' && stock !== 0) {
        uniqueViolations.push({
          id: p.id,
          name: p.name,
          stock_qty: stock,
          status: p.status,
          reason: 'sold_with_nonzero_stock',
        });
      }
      if (['available', 'on_display', 'reserved'].includes(p.status) && stock !== 1) {
        uniqueViolations.push({
          id: p.id,
          name: p.name,
          stock_qty: stock,
          status: p.status,
          reason: 'sellable_unique_without_qty_1',
        });
      }
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    products_checked: products.length,
    balanced,
    mismatched: mismatched.length,
    mismatches: mismatched,
    unique_tag_violations: uniqueViolations.length,
    unique_violations: uniqueViolations,
    missing_barcodes_unique_tag: missingBarcodes.length,
    missing_barcodes: missingBarcodes,
    quantity_mode_count: products.filter((p) => p.inventory_mode !== 'unique_tag').length,
    unique_tag_count: products.filter((p) => p.inventory_mode === 'unique_tag').length,
  };

  const outPath = path.resolve(__dirname, '../../../docs/inventory-audit.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`Products checked: ${report.products_checked}`);
  console.log(`Balanced: ${report.balanced}`);
  console.log(`Mismatched: ${report.mismatched}`);
  console.log(`Unique-tag violations: ${report.unique_tag_violations}`);
  console.log(`Missing barcodes (unique_tag): ${report.missing_barcodes_unique_tag}`);
  console.log(`Report: ${outPath}`);

  await sequelize.close();
  process.exit(mismatched.length || uniqueViolations.length ? 2 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
