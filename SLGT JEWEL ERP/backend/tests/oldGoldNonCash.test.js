/**
 * Old Gold Exchange must be a non-cash settlement in the ERP Statement (it
 * posts Dr 1300 Old Gold Stock in the GL, never Cash/Bank/UPI/Card), so it
 * must never move the passbook's liquid running balance — and the GL
 * reconciliation plug must still catch a genuine mismatch elsewhere.
 *
 * Also covers the new Old Gold Sale/Disposal workflow: gain/loss vs book
 * value, idempotency, double-sale prevention, and invoice-cancellation
 * consistency (receipt status + the new "already disposed" guard).
 *
 * Run: node backend/tests/oldGoldNonCash.test.js
 */
import 'dotenv/config';
import sequelize from '../src/db.js';
import {
  Shop, Product, Setting, OldGoldReceipt, OldGoldSale, JournalEntry, JournalLine, Payment,
} from '../src/models/index.js';
import { createInvoice, cancelInvoice, BillingError } from '../src/services/billingService.js';
import { calcLineAmounts, calcInvoiceTotals } from '../src/services/billingCalc.js';
import { getErpStatement } from '../src/services/accountsModuleService.js';
import { newId } from '../src/utils.js';
import { clearDefaultShopCache } from '../src/services/defaultShop.js';
import {
  createOldGoldSale, cancelOldGoldSale,
} from '../src/controllers/featurePack.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

function linePreview(overrides = {}) {
  return calcLineAmounts({
    net_weight: 10,
    gross_weight: 11,
    wastage_pct: 0,
    making_charges: 500,
    making_charge_type: 'fixed',
    ...overrides,
  }, 6400);
}

async function ensureGold() {
  const s = await Setting.findOne({ where: { key: 'gold_rate' } });
  if (!s) {
    await Setting.create({ id: newId(), key: 'gold_rate', value: { gold_24k: 7000, gold_22k: 6400 } });
  }
}

async function makeUnique(shopId, label) {
  return Product.create({
    id: newId(),
    shop_id: shopId,
    name: `OldGoldTest ${label} ${Date.now()}`,
    barcode: `OGT-${newId().slice(0, 8)}`,
    stock_qty: 1,
    inventory_mode: 'unique_tag',
    status: 'available',
    net_weight: 10,
    gross_weight: 11,
    making_charges: 500,
    making_charge_type: 'fixed',
    hsn_code: '7113',
  });
}

async function journalTotals(sourceType, sourceId) {
  const je = await JournalEntry.findOne({ where: { source_type: sourceType, source_id: sourceId } });
  if (!je) return { found: false };
  const lines = await JournalLine.findAll({ where: { journal_entry_id: je.id } });
  const debit = lines.reduce((s, l) => s + ((Number(l.debit_paise) || 0) / 100), 0);
  const credit = lines.reduce((s, l) => s + ((Number(l.credit_paise) || 0) / 100), 0);
  const byAccount = new Map();
  for (const l of lines) {
    const cur = byAccount.get(l.account_id) || { debit: 0, credit: 0 };
    cur.debit += (Number(l.debit_paise) || 0) / 100;
    cur.credit += (Number(l.credit_paise) || 0) / 100;
    byAccount.set(l.account_id, cur);
  }
  return { found: true, debit, credit, balanced: Math.abs(debit - credit) < 0.02, je, lines };
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function callController(fn, req) {
  const res = mockRes();
  let thrown = null;
  await fn(req, res, (err) => { thrown = err; });
  if (thrown) throw thrown;
  return res;
}

async function run() {
  await sequelize.authenticate();
  clearDefaultShopCache();
  await ensureGold();
  // Local/SQLite dev DBs skip migrations at boot; pick up new columns/tables
  // for this standalone script the same way remediationP0P1.test.js does.
  try { await OldGoldReceipt.sync({ alter: false }); } catch { /* already current */ }
  try { await OldGoldSale.sync({ alter: false }); } catch { /* already current */ }

  const shop = await Shop.findOne({ order: [['created_at', 'ASC']] });
  assert(shop, 'shop');
  const today = new Date().toISOString().slice(0, 10);

  console.log('T1: old gold exchange is tagged non-cash and never moves the liquid running balance');
  let ogReceiptId;
  let ogInvoiceId;
  {
    const p = await makeUnique(shop.id, 'T1');
    const line = linePreview();
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const og = 2800;
    const remaining = Math.max(0, Math.round((totals.grand_total - og) * 100) / 100);
    const cash = Math.round(remaining * 0.6 * 100) / 100;
    const upi = Math.round((remaining - cash) * 100) / 100;
    const { invoice } = await createInvoice({
      request_id: `og-noncash-${newId()}`,
      items: [{ product_id: p.id, quantity: 1 }],
      old_gold_value: og,
      gold_rate: 6400,
      payments: [
        { mode: 'old_gold_exchange', amount: og },
        ...(cash > 0 ? [{ mode: 'cash', amount: cash }] : []),
        ...(upi > 0 ? [{ mode: 'upi', amount: upi }] : []),
      ],
    });
    ogInvoiceId = invoice.id;
    const receipt = await OldGoldReceipt.findOne({ where: { invoice_id: invoice.id } });
    assert(receipt, 'OldGoldReceipt created for the invoice');
    ogReceiptId = receipt.id;

    const stmt = await getErpStatement({ from: '2000-01-01', to: '2099-12-31' });
    const ogRow = stmt.rows.find((r) => r.source_type === 'old_gold_exchange' && r.source_id === receipt.id);
    assert(ogRow, 'old gold exchange row present in ERP Statement');
    assert(ogRow.settlement_type === 'non_cash', 'old gold row classified non_cash');
    assert(ogRow.affects_liquid_balance === false, 'old gold row must not affect liquid balance');
    assert(Number(ogRow.credit) === og, 'old gold row still shows its full value for display');

    const saleRows = stmt.rows.filter((r) => r.source_type === 'sale' && r.source_id === invoice.id);
    assert(saleRows.length > 0, 'liquid tender rows present for the same invoice');
    for (const r of saleRows) {
      assert(r.affects_liquid_balance !== false, 'cash/UPI tender rows remain liquid');
    }

    // General, dataset-independent invariant: ANY non-cash row (this one, or
    // any other already in the DB) must leave the running balance unchanged.
    const chronological = [...stmt.rows].reverse();
    let prevBalance = null;
    for (const r of chronological) {
      if (prevBalance !== null && r.affects_liquid_balance === false) {
        assert(Math.abs(Number(r.balance) - prevBalance) < 0.01, `non-cash row ${r.id} must not move the running balance`);
      }
      prevBalance = Number(r.balance);
    }
  }

  console.log('T2: a real GL/passbook mismatch still produces (and clears) a reconciliation row');
  {
    const before = await getErpStatement({ from: today, to: today });
    const reconBefore = before.rows.find((r) => r.source_type === 'gl_reconciliation');
    const gapBefore = reconBefore ? (Number(reconBefore.credit) - Number(reconBefore.debit)) : 0;

    const probeAmount = 7;
    const voucherNo = `test-recon-probe-${newId()}`;
    const { postManualVoucher, reverseJournalsForSource } = await import('../src/services/ledgerService.js');
    await sequelize.transaction((t) => postManualVoucher({
      shopId: shop.id,
      entryDate: today,
      memo: 'TEST: intentional reconciliation probe (auto-reversed below)',
      voucherNo,
      lines: [
        { accountCode: '1000', debit: probeAmount },
        { accountCode: '3100', credit: probeAmount },
      ],
      requestId: voucherNo,
      transaction: t,
    }));

    const after = await getErpStatement({ from: today, to: today });
    const reconAfter = after.rows.find((r) => r.source_type === 'gl_reconciliation');
    assert(reconAfter, 'reconciliation row appears once GL and passbook genuinely diverge');
    const gapAfter = Number(reconAfter.credit) - Number(reconAfter.debit);
    assert(Math.abs((gapAfter - gapBefore) - probeAmount) < 0.01, 'reconciliation gap grows by exactly the injected mismatch');

    // Clean up — reverse the probe so this test doesn't leave a permanent drift.
    await sequelize.transaction((t) => reverseJournalsForSource({
      shopId: shop.id,
      sourceId: voucherNo,
      sourceTypes: ['voucher_journal'],
      requestIdPrefix: 'test-recon-probe-rev',
      entryDate: today,
      transaction: t,
    }));
    const restored = await getErpStatement({ from: today, to: today });
    const reconRestored = restored.rows.find((r) => r.source_type === 'gl_reconciliation');
    const gapRestored = reconRestored ? (Number(reconRestored.credit) - Number(reconRestored.debit)) : 0;
    assert(Math.abs(gapRestored - gapBefore) < 0.01, 'reconciliation returns to baseline once the mismatch is resolved');
  }

  const user = { id: `test-user-${newId().slice(0, 6)}` };

  async function makeReceipt(weightG, rate, status = 'in_stock') {
    const value = Math.round(weightG * rate * 100) / 100;
    return OldGoldReceipt.create({
      id: newId(),
      shop_id: shop.id,
      receipt_no: `OGT-${newId().slice(0, 10)}`,
      customer_id: null,
      invoice_id: null,
      weight_g: weightG,
      purity: '22K',
      rate,
      value,
      value_paise: Math.round(value * 100),
      description: 'test fixture',
      status,
      business_date: today,
    });
  }

  console.log('T3: Old Gold Sale gain, idempotency, and double-sale prevention');
  let gainSaleId;
  let gainReceiptId;
  {
    const receipt = await makeReceipt(2, 1400); // book value 2800
    gainReceiptId = receipt.id;
    const rid = `ogsale-gain-${newId()}`;
    const req1 = { body: { receipt_ids: [receipt.id], buyer_name: 'Test Refinery', sale_value: 3000, payment_mode: 'bank', request_id: rid }, user, query: {}, params: {} };
    const res1 = await callController(createOldGoldSale, req1);
    assert(res1.statusCode === 201, 'first sale created');
    gainSaleId = res1.body.id;
    assert(Math.abs(Number(res1.body.gain_loss_amount) - 200) < 0.01, 'gain = sale_value - book_value = 200');

    const res2 = await callController(createOldGoldSale, { ...req1 });
    assert(res2.body.id === gainSaleId, 'same request_id is idempotent — same sale row returned');
    const count = await OldGoldSale.count({ where: { request_id: rid } });
    assert(count === 1, 'idempotent retry does not create a duplicate OldGoldSale row');

    const jt = await journalTotals('old_gold_sale', gainSaleId);
    assert(jt.found && jt.balanced, 'old_gold_sale journal is balanced');
    assert(Math.abs(jt.debit - 3000) < 0.01, 'total debit = bank 3000 (no charges)');
    assert(Math.abs(jt.credit - 3000) < 0.01, 'total credit = stock 2800 + gain 200');

    const dup = await callController(createOldGoldSale, {
      body: { receipt_ids: [receipt.id], buyer_name: 'Another Buyer', sale_value: 1000, payment_mode: 'cash' },
      user, query: {}, params: {},
    });
    assert(dup.statusCode === 409, 'selling an already-sold receipt is rejected');
  }

  console.log('T4: Old Gold Sale loss, and refining charges do not affect gain/loss vs book value');
  {
    const lossReceipt = await makeReceipt(2, 1400); // book value 2800
    const rid = `ogsale-loss-${newId()}`;
    const res = await callController(createOldGoldSale, {
      body: { receipt_ids: [lossReceipt.id], buyer_name: 'Test Refinery', sale_value: 2500, payment_mode: 'cash', request_id: rid },
      user, query: {}, params: {},
    });
    assert(res.statusCode === 201, 'loss sale created');
    assert(Math.abs(Number(res.body.gain_loss_amount) + 300) < 0.01, 'loss = sale_value - book_value = -300');
    const jt = await journalTotals('old_gold_sale', res.body.id);
    assert(jt.balanced && Math.abs(jt.debit - 2800) < 0.01 && Math.abs(jt.credit - 2800) < 0.01, 'Dr Cash 2500 + Dr Loss 300 == Cr Old Gold Stock 2800');

    const chargesReceipt = await makeReceipt(2, 1400); // book value 2800
    const rid2 = `ogsale-charges-${newId()}`;
    const res2 = await callController(createOldGoldSale, {
      body: { receipt_ids: [chargesReceipt.id], buyer_name: 'Test Refinery', sale_value: 3000, payment_mode: 'cash', refining_charges: 100, request_id: rid2 },
      user, query: {}, params: {},
    });
    assert(res2.statusCode === 201, 'sale with refining charges created');
    assert(Math.abs(Number(res2.body.gain_loss_amount) - 200) < 0.01, 'gain is still measured against book value only (charges do not change it)');
    const jt2 = await journalTotals('old_gold_sale', res2.body.id);
    assert(jt2.balanced && Math.abs(jt2.debit - 3000) < 0.01, 'Dr Cash 2900 + Dr Expense 100 == Cr Stock 2800 + Cr Gain 200');
  }

  console.log('T5: cancelling an Old Gold Sale reverses the journal and returns the gold to stock');
  {
    await callController(cancelOldGoldSale, { params: { id: gainSaleId }, body: {}, user, query: {} });
    const receipt = await OldGoldReceipt.findByPk(gainReceiptId);
    assert(receipt.old_gold_sale_id === null, 'receipt un-linked from the cancelled sale');
    assert(receipt.status === 'in_stock', 'receipt returned to in_stock and sellable again');
    const rev = await journalTotals('reverse_old_gold_sale', gainSaleId);
    assert(rev.found && rev.balanced, 'reversal journal posted and balanced');
  }

  console.log('T6: invoice cancellation marks the linked old gold receipt "returned"');
  {
    const p = await makeUnique(shop.id, 'T6');
    const line = linePreview();
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const og = 300;
    const cash = Math.max(0, Math.round((totals.grand_total - og) * 100) / 100);
    const { invoice } = await createInvoice({
      request_id: `og-cancel-${newId()}`,
      items: [{ product_id: p.id, quantity: 1 }],
      old_gold_value: og,
      gold_rate: 6400,
      payments: [{ mode: 'old_gold_exchange', amount: og }, ...(cash > 0 ? [{ mode: 'cash', amount: cash }] : [])],
    });
    // The old gold goes back as metal, so only the money part needs a refund
    // breakdown; the server records the old gold return itself.
    const collected = Number(invoice.grand_total) - Number(invoice.balance_due);
    const moneyPart = Math.round((collected - og) * 100) / 100;

    let mismatch = false;
    try {
      await cancelInvoice(invoice.id, { user, reason: 'full cash', refund: [{ mode: 'cash', amount: collected }] });
    } catch (err) {
      mismatch = err instanceof BillingError && err.code === 'REFUND_MISMATCH';
    }
    assert(mismatch, 'refunding the old gold value in cash is rejected');

    await cancelInvoice(invoice.id, {
      user,
      reason: 'test cancel',
      refund: moneyPart > 0 ? [{ mode: 'cash', amount: moneyPart }] : [],
    });
    const receipt = await OldGoldReceipt.findOne({ where: { invoice_id: invoice.id } });
    assert(receipt.status === 'returned', 'receipt marked returned once its invoice is cancelled');

    const refunds = (await Payment.findAll({ where: { invoice_id: invoice.id } }))
      .filter((r) => r.meta?.kind === 'invoice_cancel_refund');
    const ogBack = refunds.filter((r) => r.mode === 'old_gold_exchange');
    const cashBack = refunds.filter((r) => r.mode === 'cash');
    assert(ogBack.length === 1 && Math.abs(Number(ogBack[0].amount) + og) < 0.01, 'old gold return recorded as a non-cash refund row');
    assert(ogBack[0].meta?.metal_returned === true, 'old gold refund row flagged metal_returned');
    const cashOut = cashBack.reduce((s, r) => s + Math.abs(Number(r.amount)), 0);
    assert(Math.abs(cashOut - moneyPart) < 0.01, 'only the money part is refunded in cash');
  }

  console.log('T7: cancelling an invoice is blocked once its old gold has already been disposed');
  {
    const p = await makeUnique(shop.id, 'T7');
    const line = linePreview();
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const og = 300;
    const cash = Math.max(0, Math.round((totals.grand_total - og) * 100) / 100);
    const { invoice } = await createInvoice({
      request_id: `og-disposed-${newId()}`,
      items: [{ product_id: p.id, quantity: 1 }],
      old_gold_value: og,
      gold_rate: 6400,
      payments: [{ mode: 'old_gold_exchange', amount: og }, ...(cash > 0 ? [{ mode: 'cash', amount: cash }] : [])],
    });
    const receipt = await OldGoldReceipt.findOne({ where: { invoice_id: invoice.id } });
    await callController(createOldGoldSale, {
      body: { receipt_ids: [receipt.id], buyer_name: 'Test Refinery', sale_value: Number(receipt.value), payment_mode: 'cash' },
      user, query: {}, params: {},
    });
    let rejected = false;
    const moneyPart = Math.round((Number(invoice.grand_total) - Number(invoice.balance_due) - og) * 100) / 100;
    try {
      await cancelInvoice(invoice.id, {
        user,
        reason: 'should be blocked',
        refund: moneyPart > 0 ? [{ mode: 'cash', amount: moneyPart }] : [],
      });
    } catch (err) {
      rejected = err instanceof BillingError && err.code === 'OLD_GOLD_ALREADY_DISPOSED';
    }
    assert(rejected, 'cancellation is rejected once the old gold has been sold onward');
  }

  console.log('ALL OLD GOLD NON-CASH / DISPOSAL TESTS PASSED');
  console.log(`(fixtures: invoice ${ogInvoiceId}, receipt ${ogReceiptId})`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
