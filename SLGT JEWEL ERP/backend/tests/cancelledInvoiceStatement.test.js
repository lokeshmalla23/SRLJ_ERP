/**
 * node tests/cancelledInvoiceStatement.test.js
 *
 * Cancelled invoices must not recreate collected tender as an ERP Statement
 * credit unless a real refund Payment row exists. Fixtures are generic — not
 * tied to any shop's invoice numbers, customers, or amounts.
 */
import assert from 'assert';
import sequelize from '../src/db.js';
import { Invoice, Payment } from '../src/models/index.js';
import { getErpStatement, isRealInvoiceRefundPayment } from '../src/services/accountsModuleService.js';
import { isVoidOrFullyReturnedStatus, loadUncountableInvoiceIds } from '../src/utils/invoiceVisibility.js';
import { getDefaultShopId } from '../src/services/defaultShop.js';

assert.strictEqual(isRealInvoiceRefundPayment(null), false);
assert.strictEqual(isRealInvoiceRefundPayment({ amount: 10000, meta: {} }), false);
assert.strictEqual(isRealInvoiceRefundPayment({
  amount: -10000,
  meta: { kind: 'sale' },
}), false);
assert.strictEqual(isRealInvoiceRefundPayment({
  amount: 10000,
  meta: { kind: 'invoice_payment' },
}), false);
assert.strictEqual(isRealInvoiceRefundPayment({
  amount: -10000,
  meta: { kind: 'invoice_cancel_refund' },
}), true);
assert.strictEqual(isRealInvoiceRefundPayment({
  amount: -2500,
  meta: { kind: 'invoice_return_refund' },
}), true);
assert.strictEqual(isRealInvoiceRefundPayment({
  amount: 0,
  meta: { kind: 'invoice_cancel_refund' },
}), false);

function isCancelledInvoice(inv) {
  if (!inv) return false;
  if (inv.cancelled_at || inv.cancelledAt) return true;
  return isVoidOrFullyReturnedStatus(inv.status);
}

await sequelize.authenticate();
const shopId = await getDefaultShopId();
const invoices = await Invoice.findAll({ where: shopId ? { shop_id: shopId } : {} });
const cancelled = invoices.filter(isCancelledInvoice);
const cancelledIds = cancelled.map((i) => i.id);
const refundRows = cancelledIds.length
  ? await Payment.findAll({ where: { invoice_id: cancelledIds } })
  : [];
const refundsByInvoice = new Map();
for (const p of refundRows) {
  if (!isRealInvoiceRefundPayment(p)) continue;
  const arr = refundsByInvoice.get(p.invoice_id) || [];
  arr.push(p);
  refundsByInvoice.set(p.invoice_id, arr);
}

const stmt = await getErpStatement({
  from: '2000-01-01',
  to: '2099-12-31',
});
const rows = stmt.rows || [];

const withoutRefund = cancelled.filter((inv) => !(refundsByInvoice.get(inv.id) || []).length);
for (const inv of withoutRefund) {
  const hits = rows.filter((r) => r.source_id === inv.id && (r.source_type === 'sale' || r.source_type === 'refund'));
  assert.strictEqual(
    hits.length,
    0,
    'cancelled invoice without a real refund must have zero ERP Statement sale/refund impact',
  );
}

const withRefund = cancelled.filter((inv) => {
  if (String(inv.financial_mode || '').toUpperCase() === 'PRE_ACCOUNTS') return false;
  return (refundsByInvoice.get(inv.id) || []).length > 0;
});
for (const inv of withRefund) {
  const refundHits = rows.filter((r) => r.source_id === inv.id && r.source_type === 'refund' && r.debit > 0);
  assert.ok(refundHits.length > 0, 'cancelled invoice with a real refund must show a refund debit');
}

const recon = rows.find((r) => r.source_type === 'gl_reconciliation');
const preAccountHits = rows.filter((r) => {
  const inv = cancelled.find((i) => i.id === r.source_id);
  return inv && String(inv.financial_mode || '').toUpperCase() === 'PRE_ACCOUNTS';
});
assert.strictEqual(
  preAccountHits.length,
  0,
  'PRE_ACCOUNTS cancelled invoices must not appear in the LIVE ERP Statement',
);

const uncountable = await loadUncountableInvoiceIds(shopId);
const cancelledOrPractice = invoices.filter((inv) => (
  isCancelledInvoice(inv)
  || String(inv.financial_mode || '').toUpperCase() === 'PRE_ACCOUNTS'
  || String(inv.invoice_no || '').toUpperCase().startsWith('TEST-')
));
for (const inv of cancelledOrPractice) {
  assert.ok(uncountable.has(inv.id), `${inv.invoice_no} must be uncountable for Sold Items`);
}
console.log(
  `cancelledInvoiceStatement tests passed (${withoutRefund.length} cancelled without refund = zero impact, ${withRefund.length} with refund debit)`
  + (recon
    ? `; GL reconciliation still present debit=${recon.debit} credit=${recon.credit} (not forced to zero)`
    : '; GL reconciliation row absent (statement and GL already match)'),
);
await sequelize.close();
