/**
 * One-shot: rewrite stored created_at / paid_at / booked_at so the calendar
 * day is the Transaction date (business_date / date / purchase_date /
 * entry_date). Time of day stays the original clock.
 */
import { logger } from '../utils/logger.js';
import { stampOnTransactionDate, parseOccurredAt, modelValue } from '../utils/invoiceRead.js';

const META_KEY = 'transaction_stamp_backfill';
const VERSION = 1;

function localYmd(raw) {
  const d = raw instanceof Date ? raw : parseOccurredAt(raw);
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function needsRewrite(anchorYmd, clock) {
  if (!anchorYmd) return false;
  const ymd = String(anchorYmd).slice(0, 10);
  const have = localYmd(clock);
  return Boolean(have && have !== ymd);
}

async function rewriteRow(row, anchorYmd, clockField = 'created_at') {
  const clock = modelValue(row, clockField, 'createdAt', 'paid_at', 'booked_at');
  if (!needsRewrite(anchorYmd, clock || row.created_at || row.createdAt)) return false;
  const stamped = stampOnTransactionDate(anchorYmd, clock || row.created_at || row.createdAt || new Date());
  const patch = { created_at: stamped };
  if (row.paid_at) patch.paid_at = stampOnTransactionDate(anchorYmd, row.paid_at);
  if (row.booked_at) patch.booked_at = stampOnTransactionDate(anchorYmd, row.booked_at);
  await row.update(patch, { hooks: false, silent: true });
  return true;
}

export async function backfillTransactionStamps() {
  const { SchemaMeta } = await import('../models/index.js');
  const existing = await SchemaMeta.findByPk(META_KEY).catch(() => null);
  const already = existing?.value?.version === VERSION;
  if (already) return { skipped: true, version: VERSION };

  const {
    Invoice, InvoiceItem, Payment, InventoryMovement, ProductStatusHistory,
    Income, Expense, Purchase, Quotation, CreditNote, CustomerAdvance, JournalEntry,
  } = await import('../models/index.js');

  let invoices = 0;
  let children = 0;
  let other = 0;

  const invRows = await Invoice.findAll({
    attributes: ['id', 'business_date', 'created_at'],
  });
  for (const inv of invRows) {
    const ymd = inv.business_date;
    if (!ymd) continue;
    if (await rewriteRow(inv, ymd)) invoices += 1;
    const stamped = stampOnTransactionDate(ymd, inv.created_at || inv.createdAt);

    const itemCount = await InvoiceItem.update(
      { created_at: stamped },
      { where: { invoice_id: inv.id }, hooks: false, silent: true },
    );
    children += Number(Array.isArray(itemCount) ? itemCount[0] : itemCount) || 0;

    const payRows = await Payment.findAll({ where: { invoice_id: inv.id } });
    for (const p of payRows) {
      if (await rewriteRow(p, p.business_date || ymd, 'paid_at')) children += 1;
    }

    const movRows = await InventoryMovement.findAll({ where: { reference_id: inv.id } });
    for (const m of movRows) {
      if (await rewriteRow(m, ymd)) children += 1;
    }

    const histRows = await ProductStatusHistory.findAll({ where: { reference_id: inv.id } });
    for (const h of histRows) {
      if (await rewriteRow(h, ymd)) children += 1;
    }
  }

  const simple = [
    [Income, 'date'],
    [Expense, 'date'],
    [Purchase, 'purchase_date'],
    [Quotation, 'business_date'],
    [CreditNote, 'business_date'],
    [CustomerAdvance, 'business_date'],
    [JournalEntry, 'entry_date'],
    [Payment, 'business_date'],
  ];
  for (const [Model, field] of simple) {
    const rows = await Model.findAll().catch(() => []);
    for (const row of rows) {
      const ymd = row[field];
      if (!ymd) continue;
      if (await rewriteRow(row, ymd, field === 'business_date' && row.paid_at ? 'paid_at' : 'created_at')) {
        other += 1;
      }
    }
  }

  await SchemaMeta.upsert({
    key: META_KEY,
    value: { version: VERSION, invoices, children, other, at: new Date().toISOString() },
    updated_at: new Date(),
  });

  logger.info('accounts', 'transaction stamp backfill', { invoices, children, other });
  return { skipped: false, invoices, children, other, version: VERSION };
}
