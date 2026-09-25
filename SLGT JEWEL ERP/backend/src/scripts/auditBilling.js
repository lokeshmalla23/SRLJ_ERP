import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sequelize from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  await sequelize.authenticate();

  const [invoices] = await sequelize.query(`
    SELECT id, invoice_no, shop_id, items, subtotal, discount, gst_amount, grand_total,
           cgst_amount, sgst_amount, status, request_id, created_at
    FROM invoices
    ORDER BY created_at DESC
    LIMIT 5000
  `);

  const emptyItems = [];
  const dupNos = [];
  const badTotals = [];
  const missingRefs = [];

  const noCounts = new Map();
  for (const inv of invoices) {
    const items = Array.isArray(inv.items) ? inv.items : [];
    if (items.length === 0) emptyItems.push({ id: inv.id, invoice_no: inv.invoice_no });
    noCounts.set(inv.invoice_no, (noCounts.get(inv.invoice_no) || 0) + 1);

    const sumLines = items.reduce((s, it) => s + (Number(it.line_total) || Number(it.subtotal) || 0), 0);
    if (items.length && inv.subtotal != null && Math.abs(sumLines - Number(inv.subtotal)) > 1) {
      // Only flag large mismatches; legacy invoices may lack line_total
      if (items.some((it) => it.line_total != null)) {
        badTotals.push({
          id: inv.id,
          invoice_no: inv.invoice_no,
          subtotal: inv.subtotal,
          sum_line_totals: sumLines,
        });
      }
    }
  }
  for (const [no, c] of noCounts) {
    if (c > 1) dupNos.push({ invoice_no: no, count: c });
  }

  const [orphanSales] = await sequelize.query(`
    SELECT m.id, m.product_id, m.reference_id
    FROM inventory_movements m
    WHERE m.movement_type = 'SALE' AND m.reference_type = 'invoice'
      AND (m.reference_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM invoices i WHERE i.id = m.reference_id
      ))
    LIMIT 100
  `);

  const [negStock] = await sequelize.query(`
    SELECT id, name, stock_qty FROM products WHERE stock_qty < 0 LIMIT 50
  `);

  const [uniqueBad] = await sequelize.query(`
    SELECT id, name, stock_qty, status FROM products
    WHERE inventory_mode = 'unique_tag'
      AND (
        (status = 'sold' AND stock_qty <> 0)
        OR (status IN ('available','on_display','reserved') AND stock_qty <> 1)
      )
    LIMIT 50
  `);

  // Post phase-3 invoices should have SALE movements when they have product lines
  const [phase3Cutoff] = await sequelize.query(`
    SELECT MIN(created_at) AS t FROM inventory_movements WHERE movement_type = 'OPENING'
  `);
  const cutoff = phase3Cutoff[0]?.t;
  let missingMovements = [];
  if (cutoff) {
    const [rows] = await sequelize.query(`
      SELECT i.id, i.invoice_no
      FROM invoices i
      WHERE i.created_at >= :cutoff
        AND jsonb_array_length(COALESCE(i.items, '[]'::jsonb)) > 0
        AND NOT EXISTS (
          SELECT 1 FROM inventory_movements m
          WHERE m.reference_type = 'invoice' AND m.reference_id = i.id AND m.movement_type = 'SALE'
        )
      LIMIT 100
    `, { replacements: { cutoff } });
    missingMovements = rows;
  }

  const report = {
    generated_at: new Date().toISOString(),
    invoices_checked: invoices.length,
    empty_item_invoices: emptyItems.length,
    empty_items: emptyItems.slice(0, 20),
    duplicate_invoice_numbers: dupNos.length,
    duplicates: dupNos,
    subtotal_mismatches: badTotals.length,
    mismatches: badTotals.slice(0, 20),
    orphan_sale_movements: orphanSales.length,
    orphan_sales: orphanSales,
    negative_stock: negStock.length,
    negative_stock_rows: negStock,
    unique_tag_inconsistencies: uniqueBad.length,
    unique_bad: uniqueBad,
    post_ledger_invoices_missing_sale_movement: missingMovements.length,
    missing_sale_movements: missingMovements,
  };

  const out = path.resolve(__dirname, '../../../docs/billing-audit.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    invoices_checked: report.invoices_checked,
    empty_item_invoices: report.empty_item_invoices,
    duplicate_invoice_numbers: report.duplicate_invoice_numbers,
    orphan_sale_movements: report.orphan_sale_movements,
    negative_stock: report.negative_stock,
    unique_tag_inconsistencies: report.unique_tag_inconsistencies,
    post_ledger_invoices_missing_sale_movement: report.post_ledger_invoices_missing_sale_movement,
    report: out,
  }, null, 2));

  await sequelize.close();
  const critical = dupNos.length || negStock.length || uniqueBad.length;
  process.exit(critical ? 2 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
