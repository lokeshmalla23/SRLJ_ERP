// One-off backfill: cancelled_at/returned_at on invoices that were stamped
// with the real wall-clock time by the OLD (pre-fix) cancelInvoice/
// createPartialReturn code, instead of the shop's Transaction date.
//
// The current code always writes these fields as midnight-exact (see
// dateOnlyStamp() in utils/invoiceRead.js) — so any existing row whose time
// component isn't exactly midnight is reliably one the old code wrote, and
// needs correcting.
//
// For each one, the correct date is worked out in order of preference:
//   1. The refund Payment row created in the SAME cancel/return transaction
//      (meta.kind: invoice_cancel_refund / invoice_return_refund) already
//      carries the exact correct business_date — this is ground truth, not
//      a guess, since it was stamped via getActiveBillingDate() at the very
//      moment the cancellation/return happened.
//   2. If there's no such payment (e.g. nothing was collected so no refund
//      was needed, or a TEST/practice invoice, which never posts refund
//      Payment rows at all) — reconstructed from this shop's Daily Closing
//      history instead: closed_at on a closed day marks exactly when the
//      active billing date advanced past it (see advanceActiveBillingDate
//      in dailyClosingService.js).
//
// Dry-run by default — prints what it WOULD change, writes nothing.
// Pass --apply to actually commit the corrections.
//
//   node src/scripts/backfillCancelledReturnedDates.js          (preview)
//   node src/scripts/backfillCancelledReturnedDates.js --apply  (commit)
import sequelize from '../db.js';
import { Op } from 'sequelize';
import { Invoice, DailyClosing, Payment } from '../models/index.js';
import { dateOnlyStamp } from '../utils/invoiceRead.js';

const APPLY = process.argv.includes('--apply');

const REFUND_KIND_FOR_FIELD = {
  cancelled_at: 'invoice_cancel_refund',
  returned_at: 'invoice_return_refund',
};

function addDaysStr(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function parseMeta(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) || {}; } catch { return {}; }
  }
  return {};
}

// True only when a Date's LOCAL wall-clock time is exactly midnight — how
// dateOnlyStamp() always writes these fields now, so this is how we tell
// "already correct" apart from "still has the old real-clock timestamp".
// (Coincidentally cancelling a bill at exactly local midnight would also
// read as already-correct here — an acceptable, vanishingly rare miss.)
function isMidnightLocal(date) {
  return date.getHours() === 0 && date.getMinutes() === 0
    && date.getSeconds() === 0 && date.getMilliseconds() === 0;
}

// Fallback only: which business/Transaction date was active at real time
// `at`, given this shop's closed-day history (sorted ascending by date).
// Before the first close, the active date is the first closed day on
// record; each subsequent close hands off to the next calendar day from
// its closed_at onward.
function resolveBusinessDateAt(closedDays, at) {
  if (!closedDays.length) return null;
  let candidate = closedDays[0].date;
  for (const cd of closedDays) {
    if (cd.closed_at && at >= new Date(cd.closed_at)) {
      candidate = addDaysStr(cd.date, 1);
    } else {
      break;
    }
  }
  return candidate;
}

const run = async () => {
  await sequelize.authenticate();

  const closedDays = (await DailyClosing.findAll({
    where: { status: 'closed' },
    order: [['date', 'ASC']],
    attributes: ['date', 'closed_at'],
  })).map((c) => ({ date: c.date, closed_at: c.closed_at }));

  const invoices = await Invoice.findAll({
    where: {
      status: { [Op.in]: ['cancelled', 'returned', 'partially_returned'] },
      [Op.or]: [
        { cancelled_at: { [Op.ne]: null } },
        { returned_at: { [Op.ne]: null } },
      ],
    },
    attributes: ['id', 'invoice_no', 'status', 'cancelled_at', 'returned_at', 'business_date'],
  });

  const invoiceIds = invoices.map((i) => i.id);
  const refundPayments = invoiceIds.length ? await Payment.findAll({
    where: { invoice_id: { [Op.in]: invoiceIds } },
    attributes: ['invoice_id', 'business_date', 'meta'],
  }) : [];
  // invoiceId -> { invoice_cancel_refund: businessDate, invoice_return_refund: businessDate }
  const refundDateByInvoice = new Map();
  for (const p of refundPayments) {
    const kind = parseMeta(p.meta).kind;
    if (kind !== 'invoice_cancel_refund' && kind !== 'invoice_return_refund') continue;
    if (!p.business_date) continue;
    const entry = refundDateByInvoice.get(p.invoice_id) || {};
    entry[kind] = p.business_date;
    refundDateByInvoice.set(p.invoice_id, entry);
  }

  console.log(`${invoices.length} cancelled/returned invoice(s) on record, ${closedDays.length} closed day(s), ${refundPayments.length} refund payment(s) to cross-reference.\n`);

  let flagged = 0;
  let applied = 0;
  let fromRefund = 0;
  let fromReconstruction = 0;
  let skippedNoSource = 0;

  for (const inv of invoices) {
    for (const field of ['cancelled_at', 'returned_at']) {
      const raw = inv[field];
      if (!raw) continue;
      const d = raw instanceof Date ? raw : new Date(raw);
      if (Number.isNaN(d.getTime()) || isMidnightLocal(d)) continue; // already date-only

      flagged += 1;
      const refundKind = REFUND_KIND_FOR_FIELD[field];
      const fromPayment = refundDateByInvoice.get(inv.id)?.[refundKind] || null;
      let correctDate = fromPayment;
      let source = 'refund payment';
      if (!correctDate) {
        correctDate = resolveBusinessDateAt(closedDays, d);
        source = 'daily closing history';
      } else {
        fromRefund += 1;
      }
      if (!fromPayment && correctDate) fromReconstruction += 1;

      if (!correctDate) {
        skippedNoSource += 1;
        console.log(`  ? ${inv.invoice_no} [${field}]: ${d.toISOString()} — no refund payment or closing history to go by — skipped`);
        continue;
      }

      console.log(`  ${APPLY ? '*' : '-'} ${inv.invoice_no} [${field}]: ${d.toISOString()} -> ${correctDate}  (from ${source})`);
      if (APPLY) {
        await inv.update({ [field]: dateOnlyStamp(correctDate) });
        applied += 1;
      }
    }
  }

  console.log(`\n${flagged} row(s) had a real-clock timestamp instead of a transaction date.`);
  console.log(`  ${fromRefund} resolved exactly from their refund payment's business_date.`);
  console.log(`  ${fromReconstruction} resolved from Daily Closing history (no refund payment existed).`);
  if (skippedNoSource) console.log(`  ${skippedNoSource} could not be resolved either way and were left as-is.`);
  if (APPLY) {
    console.log(`\n${applied} row(s) corrected.`);
  } else if (flagged > skippedNoSource) {
    console.log('\nThis was a preview — nothing was changed. Re-run with --apply to commit these corrections.');
  }

  await sequelize.close();
};

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
