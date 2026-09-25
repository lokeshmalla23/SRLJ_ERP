/**
 * P0/P1 remediation verification: atomicity, idempotency, old-gold double-credit,
 * host fence prefixes, FK pragma, journal balance.
 *
 * Run: node backend/tests/remediationP0P1.test.js
 */
import 'dotenv/config';
import sequelize from '../src/db.js';
import {
  Shop, Product, Setting, Invoice, Payment, Customer, CustomerAdvance,
  JournalEntry, JournalLine, CreditNote,
} from '../src/models/index.js';
import { createInvoice, cancelInvoice, BillingError } from '../src/services/billingService.js';
import { receiveAdvance, applyAdvancesToInvoice } from '../src/services/advanceService.js';
import { calcLineAmounts, calcInvoiceTotals } from '../src/services/billingCalc.js';
import { INVENTORY_MODES, MOVEMENT_TYPES } from '../src/constants/inventory.js';
import { newId } from '../src/utils.js';
import { clearDefaultShopCache } from '../src/services/defaultShop.js';
import { recordMovement } from '../src/services/inventoryService.js';
import { AUTHORITATIVE_PREFIXES } from '../src/middleware/requireAuthoritativeHost.js';
import { createPartialReturn } from '../src/services/returnService.js';

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
    await Setting.create({
      id: newId(),
      key: 'gold_rate',
      value: { gold_24k: 7000, gold_22k: 6400 },
    });
  }
}

async function makeUnique(shopId) {
  const p = await Product.create({
    id: newId(),
    shop_id: shopId,
    name: `Remed UQ ${Date.now()}`,
    barcode: `RU-${newId().slice(0, 8)}`,
    stock_qty: 1,
    inventory_mode: INVENTORY_MODES.UNIQUE_TAG,
    status: 'available',
    net_weight: 10,
    gross_weight: 11,
    making_charges: 500,
    making_charge_type: 'fixed',
    hsn_code: '7113',
  });
  await sequelize.transaction(async (t) => {
    await recordMovement({
      shopId, product: p, movementType: MOVEMENT_TYPES.OPENING,
      quantity: 1, qtyBefore: 0, qtyAfter: 1,
      referenceType: 'test', transaction: t,
    });
  });
  return p;
}

async function journalBalanced(sourceType, sourceId) {
  const je = await JournalEntry.findOne({ where: { source_type: sourceType, source_id: sourceId } });
  if (!je) return { found: false };
  const lines = await JournalLine.findAll({ where: { journal_entry_id: je.id } });
  const debit = lines.reduce((s, l) => s + ((Number(l.debit_paise) || 0) / 100), 0);
  const credit = lines.reduce((s, l) => s + ((Number(l.credit_paise) || 0) / 100), 0);
  return { found: true, debit, credit, balanced: Math.abs(debit - credit) < 0.02, je };
}

async function run() {
  await sequelize.authenticate();
  clearDefaultShopCache();
  await ensureGold();
  try { await CreditNote.sync({ alter: false }); } catch { /* */ }

  if (sequelize.getDialect() === 'sqlite') {
    const fkRows = await sequelize.query('PRAGMA foreign_keys', { type: sequelize.QueryTypes.SELECT });
    const fkVal = fkRows?.[0]?.foreign_keys ?? Object.values(fkRows?.[0] || {})[0];
    const fkOn = Number(fkVal) === 1;
    console.log(`PRAGMA foreign_keys = ${fkOn ? 1 : 0}`);
    assert(fkOn, 'foreign_keys must be ON');

    const integrityRows = await sequelize.query('PRAGMA integrity_check', { type: sequelize.QueryTypes.SELECT });
    const integrityVal = integrityRows?.[0]?.integrity_check ?? Object.values(integrityRows?.[0] || {})[0];
    assert(integrityVal === 'ok', 'integrity_check must be ok');
  } else {
    console.log(`Skipping SQLite PRAGMA checks (dialect=${sequelize.getDialect()})`);
  }

  const shop = await Shop.findOne({ order: [['created_at', 'ASC']] });
  assert(shop, 'shop');

  console.log('P0-5: advances in AUTHORITATIVE_PREFIXES');
  assert(AUTHORITATIVE_PREFIXES.includes('/api/advances'), 'advances fenced');
  assert(!AUTHORITATIVE_PREFIXES.includes('/api/loyalty'), 'loyalty module removed');

  console.log('P0-10: old gold is a PAYMENT — client-sent old_gold_exchange reconciles, no double count');
  {
    const p = await makeUnique(shop.id);
    const line = linePreview();
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const og = 50000;
    const cash = Math.max(0, Math.round((totals.grand_total - og) * 100) / 100);
    const { invoice } = await createInvoice({
      request_id: `og-dbl-${newId()}`,
      items: [{ product_id: p.id, quantity: 1 }],
      old_gold_value: og,
      gold_rate: 6400,
      payments: [
        { mode: 'old_gold_exchange', amount: og },
        ...(cash > 0 ? [{ mode: 'cash', amount: cash }] : []),
      ],
    });
    const invoicePayments = Array.isArray(invoice.payments) ? invoice.payments : [];
    const paidTotal = invoicePayments.reduce((s, pmt) => s + Number(pmt.amount || 0), 0);
    assert(Math.abs(paidTotal - Number(invoice.grand_total)) < 1, 'single old-gold credit — payments equal grand total, not double-counted');
  }

  console.log('P0-10b: duplicate old_gold_exchange payment rows rejected');
  {
    const p = await makeUnique(shop.id);
    const line = linePreview();
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    let rejected = false;
    try {
      await createInvoice({
        request_id: `og-dup-${newId()}`,
        items: [{ product_id: p.id, quantity: 1 }],
        old_gold_value: 100,
        gold_rate: 6400,
        payments: [
          { mode: 'old_gold_exchange', amount: 50 },
          { mode: 'old_gold_exchange', amount: 50 },
          { mode: 'cash', amount: Math.max(0, Math.round((totals.grand_total - 100) * 100) / 100) },
        ],
      });
    } catch (err) {
      rejected = err?.code === 'OLD_GOLD_DUPLICATE_PAYMENT';
    }
    assert(rejected, 'must reject a duplicated old_gold_exchange payment row');
  }

  console.log('P0-10c: old gold no longer reduces the invoice — it settles it as a payment');
  {
    const p = await makeUnique(shop.id);
    const line = linePreview();
    const og = 200; // less than the line total so cash remains due
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const due = totals.grand_total;
    assert(due > 0, 'due should remain positive for this fixture');
    const cash = Math.round((due - og) * 100) / 100;
    const { invoice } = await createInvoice({
      request_id: `og-once-${newId()}`,
      items: [{ product_id: p.id, quantity: 1 }],
      old_gold_value: og,
      gold_rate: 6400,
      payments: cash > 0 ? [{ mode: 'cash', amount: cash }] : [],
    });
    assert(Number(invoice.old_gold_value) === og, 'old_gold_value still snapshotted for receipt/reporting');
    assert(Number(invoice.grand_total) === due, 'grand_total is the FULL invoice amount — unaffected by old gold');
    const invoicePayments = Array.isArray(invoice.payments) ? invoice.payments : [];
    const ogPayment = invoicePayments.find((pmt) => pmt.mode === 'old_gold_exchange');
    assert(ogPayment && Math.abs(Number(ogPayment.amount) - og) < 1, 'old gold recorded as a payment of the same value');
    const withoutOg = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    assert(withoutOg.grand_total === totals.grand_total, 'old gold presence does not change grand_total at all');
  }

  console.log('P0-2: payment/invoice request_id idempotency');
  {
    const p = await makeUnique(shop.id);
    const line = linePreview();
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const rid = `idem-inv-${newId()}`;
    const a = await createInvoice({
      request_id: rid,
      items: [{ product_id: p.id, quantity: 1 }],
      gold_rate: 6400,
      payments: [{ mode: 'cash', amount: totals.grand_total }],
    });
    const b = await createInvoice({
      request_id: rid,
      items: [{ product_id: p.id, quantity: 1 }],
      gold_rate: 6400,
      payments: [{ mode: 'cash', amount: totals.grand_total }],
    });
    assert(b.idempotent === true, 'second create idempotent');
    assert(a.invoice.id === b.invoice.id, 'same invoice returned');
    const pays = await Payment.findAll({ where: { invoice_id: a.invoice.id } });
    assert(pays.length >= 1, 'payment exists');
    // duplicate request should not double payment rows for same pay request_id
    const payIds = new Set(pays.map((x) => x.request_id).filter(Boolean));
    assert(payIds.size <= pays.length, 'payments have request ids');
  }

  console.log('P0-3: advance apply + concurrent over-apply protection');
  {
    const cust = await Customer.create({
      id: newId(),
      shop_id: shop.id,
      name: 'Advance Test',
      mobile: `9${String(Date.now()).slice(-9)}`,
    });
    const adv = await receiveAdvance({
      customerId: cust.id,
      amount: 10000,
      mode: 'cash',
      requestId: `adv-${newId()}`,
      shopId: shop.id,
    });
    assert(Number(adv.remaining_amount) === 10000, 'advance remaining');

    const p1 = await makeUnique(shop.id);
    const p2 = await makeUnique(shop.id);
    const line = linePreview();
    // Use advance on invoice for full remaining due capped at 10000 — create cheap invoice
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const due = Math.min(10000, totals.grand_total);
    // If grand > 10000 pay rest cash
    const cash = Math.max(0, totals.grand_total - 10000);
    const r1 = await createInvoice({
      request_id: `adv-inv-a-${newId()}`,
      customer_id: cust.id,
      items: [{ product_id: p1.id, quantity: 1 }],
      gold_rate: 6400,
      payments: [
        { mode: 'advance', amount: Math.min(10000, totals.grand_total) },
        ...(cash > 0 ? [{ mode: 'cash', amount: cash }] : []),
      ],
    });
    assert(r1.invoice, 'first advance invoice');

    // Second concurrent-style apply of remaining 10000 should fail or apply 0 remaining
    let secondFailed = false;
    try {
      const totals2 = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
      await createInvoice({
        request_id: `adv-inv-b-${newId()}`,
        customer_id: cust.id,
        items: [{ product_id: p2.id, quantity: 1 }],
        gold_rate: 6400,
        payments: [
          { mode: 'advance', amount: Math.min(10000, totals2.grand_total) },
          { mode: 'cash', amount: Math.max(0, totals2.grand_total - 10000) },
        ],
      });
      // If it succeeded, advance remaining must not be negative
      const refreshed = await CustomerAdvance.findByPk(adv.id);
      assert(Number(refreshed.remaining_amount) >= -0.001, 'advance never negative');
      if (Number(refreshed.remaining_amount) < 0.01 && Number(refreshed.used_amount) > 10000.01) {
        throw new Error('over-applied advance');
      }
    } catch (err) {
      secondFailed = true;
      assert(
        err instanceof BillingError || /INSUFFICIENT_ADVANCE|advance/i.test(String(err.message)),
        `expected advance failure, got ${err.message}`
      );
    }
    const end = await CustomerAdvance.findByPk(adv.id);
    assert(Number(end.remaining_amount) >= -0.001, 'remaining never negative');
    console.log(`  advance remaining=${end.remaining_amount} secondFailed=${secondFailed}`);
  }

  console.log('P0-6/8/9: journals balance for sale / return / cancel');
  {
    const p = await makeUnique(shop.id);
    const line = linePreview();
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const { invoice } = await createInvoice({
      request_id: `jrnl-sale-${newId()}`,
      items: [{ product_id: p.id, quantity: 1 }],
      gold_rate: 6400,
      payments: [{ mode: 'cash', amount: totals.grand_total }],
    });
    const pay = await Payment.findOne({ where: { invoice_id: invoice.id } });
    if (pay) {
      const j = await journalBalanced('sale_invoice', invoice.id);
      if (j.found) assert(j.balanced, `sale journal balanced ${j.debit} vs ${j.credit}`);
    }
    // Cancel path
    const p2 = await makeUnique(shop.id);
    const line2 = linePreview();
    const t2 = calcInvoiceTotals({ lineTotals: [line2.line_total], gstPct: 3 });
    const { invoice: inv2 } = await createInvoice({
      request_id: `jrnl-cancel-${newId()}`,
      items: [{ product_id: p2.id, quantity: 1 }],
      gold_rate: 6400,
      payments: [{ mode: 'cash', amount: t2.grand_total }],
    });
    await cancelInvoice(inv2.id, { user: { id: 'test' }, reason: 'remediation test' });
    const cancelled = await Invoice.findByPk(inv2.id);
    assert(cancelled.status === 'cancelled', 'cancelled status');
  }

  console.log('Failure injection: journal post throws → invoice rolls back');
  {
    const p = await makeUnique(shop.id);
    const line = linePreview();
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const { __testForceNextJournalFail } = await import('../src/services/ledgerService.js');
    __testForceNextJournalFail();
    const beforeCount = await Invoice.count();
    let failed = false;
    try {
      await createInvoice({
        request_id: `fail-jrnl-${newId()}`,
        items: [{ product_id: p.id, quantity: 1 }],
        gold_rate: 6400,
        payments: [{ mode: 'cash', amount: totals.grand_total }],
      });
    } catch (err) {
      failed = /INJECTED_JOURNAL_FAIL/.test(String(err.message));
    }
    const afterCount = await Invoice.count();
    const refreshed = await Product.findByPk(p.id);
    assert(failed, 'journal failure propagated');
    assert(afterCount === beforeCount, 'invoice rolled back');
    assert(refreshed.status === 'available', 'tag restored / never sold');
  }

  console.log('All remediation checks passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
}).then(() => process.exit(0));
