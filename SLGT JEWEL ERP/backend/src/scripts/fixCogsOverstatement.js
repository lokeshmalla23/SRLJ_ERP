import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sequelize from '../db.js';
import { QueryTypes } from 'sequelize';
import { Invoice } from '../models/index.js';
import { postCogsReverseJournal } from '../services/ledgerService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Posts a correcting journal entry for every invoice flagged by
 * auditCogsOverstatement.js: Dr Inventory / Cr COGS for the overstated
 * amount, exactly like a normal COGS reversal — it just nets the earlier
 * wrong (gold-rate-priced) COGS entry down to what resolveUnitCogs()
 * (fixed) says it should have been.
 *
 * - Does NOT edit or delete the original sale_cogs journal entries —
 *   preserves the audit trail; this only adds an offsetting entry.
 * - Idempotent: each correction uses a unique request_id
 *   (`cogs-overstatement-fix:<invoiceId>`), so re-running this script is
 *   a no-op for invoices already corrected.
 * - Reads docs/cogs-overstatement-audit.json (produced by
 *   auditCogsOverstatement.js) as its input — run that first.
 * - Backdated per invoice: each correction is entry-dated the same as the
 *   original (wrong) sale_cogs entry it's correcting, so it lands in that
 *   invoice's own day/period rather than today's.
 * - Skips any invoice that's cancelled, or whose original sale_cogs entry
 *   was already fully reversed via a separate `reverse_sale_cogs` entry
 *   (e.g. an edited/voided invoice superseded by a new one) — such an
 *   invoice's COGS is already net zero and needs no overstatement
 *   correction on top of that full reversal.
 */
async function run() {
  const auditPath = path.resolve(__dirname, '../../../docs/cogs-overstatement-audit.json');
  if (!fs.existsSync(auditPath)) {
    console.error(`Audit report not found at ${auditPath} — run auditCogsOverstatement.js first.`);
    process.exit(1);
  }
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  const affected = audit.affected_invoices || [];
  if (!affected.length) {
    console.log('No affected invoices in the audit report — nothing to correct.');
    return;
  }

  await sequelize.authenticate();

  let posted = 0;
  let skipped = 0;
  let totalCorrected = 0;

  for (const a of affected) {
    if (!(a.overstatement > 0)) { skipped += 1; continue; }
    const invoice = await Invoice.findByPk(a.invoice_id);
    if (!invoice) { skipped += 1; continue; }

    if (invoice.status === 'cancelled') {
      skipped += 1;
      console.log(`Skipped invoice ${a.invoice_no || a.invoice_id} (cancelled)`);
      continue;
    }
    const fullyReversed = await sequelize.query(
      `SELECT 1 FROM journal_entries WHERE source_type = 'reverse_sale_cogs' AND source_id = :id LIMIT 1`,
      { replacements: { id: invoice.id }, type: QueryTypes.SELECT },
    );
    if (fullyReversed.length) {
      skipped += 1;
      console.log(`Skipped invoice ${a.invoice_no || a.invoice_id} (original COGS already fully reversed)`);
      continue;
    }

    // Backdated to the same date as the original (wrong) sale_cogs entry —
    // a.entry_date comes straight from that journal entry's own entry_date.
    const correctionDate = a.entry_date || invoice.created_at;

    const result = await sequelize.transaction(async (transaction) => {
      return postCogsReverseJournal({
        shopId: invoice.shop_id,
        sourceId: invoice.id,
        sourceType: 'cogs_overstatement_correction',
        cogsAmount: a.overstatement,
        entryDate: correctionDate,
        requestId: `cogs-overstatement-fix:${invoice.id}`,
        transaction,
      });
    });

    if (result) {
      posted += 1;
      totalCorrected += a.overstatement;
      console.log(`Corrected invoice ${a.invoice_no || a.invoice_id}: -₹${a.overstatement.toLocaleString('en-IN')} COGS (journal ${result.id})`);
    } else {
      skipped += 1;
      console.log(`Skipped invoice ${a.invoice_no || a.invoice_id} (already corrected or zero amount)`);
    }
  }

  console.log(`\nCorrections posted: ${posted}, skipped: ${skipped}`);
  console.log(`Total COGS corrected: ₹${totalCorrected.toLocaleString('en-IN')}`);

  await sequelize.close();
}

run().catch(async (err) => {
  console.error(err);
  try { await sequelize.close(); } catch { /* ignore */ }
  process.exit(1);
});
