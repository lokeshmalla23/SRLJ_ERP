import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sequelize from '../db.js';
import { ChartOfAccount, JournalEntry, JournalLine, Invoice, Product } from '../models/index.js';
import { resolveUnitCogs } from '../services/ledgerService.js';
import { parseJsonField } from '../utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Read-only audit: for every already-posted `sale_cogs` journal entry, re-run
 * TODAY's (fixed) resolveUnitCogs() against the invoice's own stored line
 * snapshot and compare it to what was actually posted to account 5000 (COGS).
 *
 * Before the fix, resolveUnitCogs() read `line.gold_rate` (the invoice's day
 * gold rate, stamped on every line regardless of metal) ahead of `line.rate`
 * (the line's own correctly-resolved charged rate) whenever a product had no
 * purchase_price — so any such line, sold under any metal, had its estimated
 * cost computed at the gold rate. This audit does not assume "silver" specifically;
 * it re-derives the correct amount from each invoice's own stored data and
 * reports whatever differs, tagging the affected metal per line.
 *
 * Does NOT modify any data — read-only.
 */
async function run() {
  await sequelize.authenticate();

  const cogsAccounts = await ChartOfAccount.findAll({ where: { code: '5000' } });
  if (!cogsAccounts.length) {
    console.log('No COGS (code 5000) account found — nothing to audit.');
    await sequelize.close();
    return;
  }
  const cogsAccountIds = cogsAccounts.map((a) => a.id);

  // sale_cogs: one journal entry per invoice, COGS debited / Inventory credited.
  const cogsEntries = await JournalEntry.findAll({
    where: { source_type: 'sale_cogs' },
    order: [['entry_date', 'ASC']],
  });

  const affected = [];
  let totalPosted = 0;
  let totalCorrect = 0;
  let invoicesChecked = 0;
  let invoicesMissing = 0;

  for (const entry of cogsEntries) {
    const line = await JournalLine.findOne({
      where: { journal_entry_id: entry.id, account_id: cogsAccountIds },
    });
    if (!line) continue;
    const postedRupees = Math.round((line.debit_paise - line.credit_paise)) / 100;

    const invoice = await Invoice.findByPk(entry.source_id);
    if (!invoice) {
      invoicesMissing += 1;
      continue;
    }
    invoicesChecked += 1;

    const items = parseJsonField(invoice.items, []);
    let correctTotal = 0;
    const lineBreakdown = [];
    for (const it of Array.isArray(items) ? items : []) {
      if (!it?.product_id) continue;
      const prod = await Product.findByPk(it.product_id);
      const resolved = resolveUnitCogs(prod, it);
      correctTotal += resolved.total || 0;
      lineBreakdown.push({
        product_id: it.product_id,
        product_name: it.product_name || it.name || null,
        metal: it.metal || it.metal_name || null,
        purity: it.purity || null,
        net_weight: it.net_weight ?? null,
        line_rate: it.rate ?? null,
        line_gold_rate: it.gold_rate ?? null,
        cogs_source: resolved.source,
        recomputed_line_cogs: resolved.total,
      });
    }
    correctTotal = Math.round(correctTotal * 100) / 100;

    totalPosted += postedRupees;
    totalCorrect += correctTotal;

    const diff = Math.round((postedRupees - correctTotal) * 100) / 100;
    if (Math.abs(diff) > 0.5) {
      affected.push({
        invoice_id: invoice.id,
        invoice_no: invoice.invoice_no,
        invoice_date: invoice.created_at,
        journal_entry_id: entry.id,
        entry_date: entry.entry_date,
        posted_cogs: postedRupees,
        recomputed_cogs: correctTotal,
        overstatement: diff,
        lines: lineBreakdown,
      });
    }
  }

  // sale_cogs_return: flagged separately — returned-line objects don't carry
  // enough detail (net_weight/rate/purity/metal) to recompute a "should have
  // been" reversal, so we only report what's already there, not a correction.
  const reverseEntries = await JournalEntry.findAll({ where: { source_type: 'sale_cogs_return' } });
  let totalReversed = 0;
  for (const entry of reverseEntries) {
    const line = await JournalLine.findOne({
      where: { journal_entry_id: entry.id, account_id: cogsAccountIds },
    });
    if (line) totalReversed += (line.credit_paise - line.debit_paise) / 100;
  }

  affected.sort((a, b) => Math.abs(b.overstatement) - Math.abs(a.overstatement));

  const report = {
    generated_at: new Date().toISOString(),
    cogs_account_ids: cogsAccountIds,
    sale_cogs_entries_found: cogsEntries.length,
    invoices_checked: invoicesChecked,
    invoices_missing: invoicesMissing,
    total_posted_cogs: Math.round(totalPosted * 100) / 100,
    total_recomputed_cogs: Math.round(totalCorrect * 100) / 100,
    total_overstatement: Math.round((totalPosted - totalCorrect) * 100) / 100,
    total_cogs_reversed_via_returns: Math.round(totalReversed * 100) / 100,
    affected_invoice_count: affected.length,
    affected_invoices: affected,
  };

  const outDir = path.resolve(__dirname, '../../../docs');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'cogs-overstatement-audit.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`sale_cogs journal entries found: ${cogsEntries.length}`);
  console.log(`Invoices checked: ${invoicesChecked} (missing: ${invoicesMissing})`);
  console.log(`Total posted COGS:     ₹${report.total_posted_cogs.toLocaleString('en-IN')}`);
  console.log(`Total recomputed COGS: ₹${report.total_recomputed_cogs.toLocaleString('en-IN')}`);
  console.log(`Total overstatement:   ₹${report.total_overstatement.toLocaleString('en-IN')}`);
  console.log(`Affected invoices: ${affected.length}`);
  for (const a of affected.slice(0, 25)) {
    console.log(`  invoice ${a.invoice_no || a.invoice_id} — posted ₹${a.posted_cogs} vs correct ₹${a.recomputed_cogs} (overstated ₹${a.overstatement})`);
  }
  console.log(`Full report written: ${outPath}`);

  await sequelize.close();
}

run().catch(async (err) => {
  console.error(err);
  try { await sequelize.close(); } catch { /* ignore */ }
  process.exit(1);
});
