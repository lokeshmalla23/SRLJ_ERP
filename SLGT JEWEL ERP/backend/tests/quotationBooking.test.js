/**
 * Estimation booking + multi-advance installments.
 * Run: node tests/quotationBooking.test.js
 */
import 'dotenv/config';
import sequelize from '../src/db.js';
import {
  Shop, Product, Setting, Customer, Quotation, CustomerAdvance,
} from '../src/models/index.js';
import {
  bookQuotation,
  addAdvanceToBooking,
  cancelQuotationBooking,
  BookingError,
} from '../src/services/quotationBookingService.js';
import { createInvoice, BillingError } from '../src/services/billingService.js';
import { calcLineAmounts, calcInvoiceTotals } from '../src/services/billingCalc.js';
import { INVENTORY_MODES, MOVEMENT_TYPES } from '../src/constants/inventory.js';
import { newId } from '../src/utils.js';
import { clearDefaultShopCache } from '../src/services/defaultShop.js';
import { recordMovement } from '../src/services/inventoryService.js';
import { ensureDefaultAccounts } from '../src/services/ledgerService.js';
import { markAccountsSetupCompleted } from '../src/services/openingSetupService.js';

const RATE = 7000;
const RATE_MAP = { '24K': 7000, '22K': 6400 };

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function ensureGold() {
  if (process.env.ELECTRON_RUN === '1' || process.env.SQLITE_PATH) {
    const s = await Setting.findOne({ where: { key: 'gold_rate' } });
    if (!s) {
      await Setting.create({
        id: newId(),
        key: 'gold_rate',
        value: { gold_24k: RATE, gold_22k: 6400, gold_18k: 5200 },
      });
    }
    return;
  }
  const s = await Setting.findOne({ where: { key: 'gold_rate' } });
  if (!s) {
    await Setting.create({
      id: newId(),
      key: 'gold_rate',
      value: { gold_24k: RATE, gold_22k: 6400, gold_18k: 5200 },
    });
  } else {
    await s.update({ value: { gold_24k: RATE, gold_22k: 6400, gold_18k: 5200 } });
  }
}

async function shop() {
  clearDefaultShopCache();
  let s = await Shop.findOne();
  if (!s) {
    s = await Shop.create({
      id: newId(),
      name: 'Booking Test Shop',
      code: `BKT-${Date.now().toString(36)}`,
    });
  }
  await ensureDefaultAccounts(s.id);
  return s;
}

async function makeCustomer(shopId) {
  return Customer.create({
    id: newId(),
    shop_id: shopId,
    name: `Book Cust ${Date.now()}`,
    mobile: `9${String(Date.now()).slice(-9)}`,
  });
}

async function makeUnique(shopId) {
  const p = await Product.create({
    id: newId(),
    shop_id: shopId,
    name: `Book Tag ${Date.now()}`,
    barcode: `BT-${newId().slice(0, 8)}`,
    stock_qty: 1,
    inventory_mode: INVENTORY_MODES.UNIQUE_TAG,
    status: 'available',
    net_weight: 10,
    gross_weight: 11,
    making_charges: 500,
    making_charge_type: 'fixed',
    purchase_price: 45000,
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

async function makeEstimation({ shopId, customer, product }) {
  const line = calcLineAmounts({
    net_weight: product.net_weight,
    gross_weight: product.gross_weight,
    wastage_pct: 0,
    making_charges: product.making_charges,
    making_charge_type: 'fixed',
    purity: '22K',
    quantity: 1,
  }, RATE, RATE_MAP);
  const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
  return Quotation.create({
    id: newId(),
    shop_id: shopId,
    quote_no: `QT-BOOK-${Date.now()}`,
    customer_id: customer.id,
    customer_name: customer.name,
    customer_mobile: customer.mobile,
    gold_rate: RATE,
    items: [{
      product_id: product.id,
      product_name: product.name,
      barcode: product.barcode,
      quantity: 1,
      net_weight: product.net_weight,
      gross_weight: product.gross_weight,
      making_charges: product.making_charges,
      making_charge_type: 'fixed',
      purity: '22K',
      unit_price: line.unit_price,
      line_total: line.line_total,
      price_override: line.unit_price,
    }],
    subtotal: totals.subtotal,
    gst_pct: 3,
    gst_amount: totals.gst_amount,
    grand_total: totals.grand_total,
    status: 'draft',
  });
}

async function run() {
  console.log('=== Quotation booking + installments ===');
  await sequelize.authenticate();
  // Add installment column if missing (Postgres / SQLite-safe best effort)
  try {
    const dialect = sequelize.getDialect();
    if (dialect === 'postgres') {
      await sequelize.query(
        `ALTER TABLE quotations ADD COLUMN IF NOT EXISTS advance_payments JSONB NOT NULL DEFAULT '[]'::jsonb`,
      );
    } else if (dialect === 'sqlite') {
      const [cols] = await sequelize.query(`PRAGMA table_info(quotations)`);
      const has = (cols || []).some((c) => String(c.name) === 'advance_payments');
      if (!has) {
        await sequelize.query(`ALTER TABLE quotations ADD COLUMN advance_payments TEXT DEFAULT '[]'`);
      }
    }
  } catch (err) {
    console.warn('advance_payments column ensure skipped:', err.message);
  }

  await ensureGold();
  const s = await shop();
  if (process.env.ELECTRON_RUN !== '1' && !process.env.SQLITE_PATH) {
    await markAccountsSetupCompleted(s.id, { source: 'automated_test' });
  }
  const { resolveFinancialMode, FINANCIAL_MODE } = await import('../src/services/financialMode.js');
  const liveMode = await resolveFinancialMode(s.id);
  if (liveMode !== FINANCIAL_MODE.LIVE) {
    console.log('quotationBooking.test.js: skipped (shop is PRE_ACCOUNTS)');
    process.exit(0);
  }
  const customer = await makeCustomer(s.id);
  const product = await makeUnique(s.id);
  const quote = await makeEstimation({ shopId: s.id, customer, product });
  const grand = Number(quote.grand_total);
  assert(grand > 1000, 'estimation total too small');

  const firstAmt = Math.round(grand * 0.2);
  const booked = await bookQuotation(quote.id, {
    advanceAmount: firstAmt,
    paymentMode: 'cash',
    deadlineDays: 10,
    requestId: `t-book-${quote.id}`,
  });
  assert(booked.status === 'booked', 'status booked');
  assert(booked.price_locked === true, 'price locked');
  assert(Number(booked.advance_paid) === firstAmt, `advance_paid=${booked.advance_paid}`);
  assert(booked.installment_count === 1, 'one installment');
  assert(Array.isArray(booked.advance_payments) && booked.advance_payments.length === 1, 'payments list');

  await product.reload();
  assert(product.status === 'estimation', `product estimation, got ${product.status}`);

  // Other sale attempt without matching booking should fail
  let blocked = false;
  try {
    await createInvoice({
      request_id: `t-steal-${quote.id}`,
      customer_id: customer.id,
      items: [{ product_id: product.id, quantity: 1, purity: '22K' }],
      payments: [{ mode: 'cash', amount: grand }],
      gold_rate: RATE,
      gold_22k: 6400,
    }, {});
  } catch (err) {
    blocked = err instanceof BillingError
      || err?.name === 'BillingError'
      || err?.code === 'ITEM_RESERVED'
      || /reserved/i.test(err.message || '');
    assert(blocked, `expected reserved block, got ${err.code || err.message}`);
  }
  assert(blocked, 'other POS sale must be blocked while booked');

  const secondAmt = Math.round(grand * 0.3);
  const topped = await addAdvanceToBooking(quote.id, {
    advanceAmount: secondAmt,
    paymentMode: 'upi',
    requestId: `t-add-${quote.id}`,
  });
  assert(Number(topped.advance_paid) === firstAmt + secondAmt, `cumulative=${topped.advance_paid}`);
  assert(topped.installment_count === 2, 'two installments');
  assert(Number(topped.remaining_amount) === grand - firstAmt - secondAmt
    || Math.abs(Number(topped.remaining_amount) - (grand - firstAmt - secondAmt)) < 0.02,
  `remaining=${topped.remaining_amount}`);

  // Cannot over-pay remaining as advance
  let tooHigh = false;
  try {
    await addAdvanceToBooking(quote.id, {
      advanceAmount: Number(topped.remaining_amount),
      paymentMode: 'cash',
      requestId: `t-over-${quote.id}`,
    });
  } catch (err) {
    tooHigh = err instanceof BookingError && err.code === 'ADVANCE_TOO_HIGH';
  }
  assert(tooHigh, 'full remaining as installment must be rejected');

  // Final POS with cumulative advance
  const due = Number(topped.remaining_amount);
  const inv = await createInvoice({
    request_id: `t-final-${quote.id}`,
    customer_id: customer.id,
    items: [{ product_id: product.id, quantity: 1, purity: '22K', price_override: Number(booked.items[0].price_override) }],
    payments: [
      { mode: 'advance', amount: Number(topped.advance_paid) },
      { mode: 'cash', amount: due },
    ].filter((p) => Number(p.amount) > 0.009),
    gold_rate: RATE,
    gold_22k: 6400,
    quotation_id: quote.id,
    prefer_advance_id: topped.advance_id,
    prefer_advance_ids: topped.advance_ids,
  }, {});
  assert(inv.invoice?.invoice_no || inv.invoice_no, 'invoice created');

  await quote.reload();
  assert(quote.status === 'converted', `quote converted, got ${quote.status}`);
  await product.reload();
  assert(product.status === 'sold' || Number(product.stock_qty) === 0, `sold status=${product.status}`);

  // Cancel path with two installments (fresh booking)
  const product2 = await makeUnique(s.id);
  const quote2 = await makeEstimation({ shopId: s.id, customer, product: product2 });
  const g2 = Number(quote2.grand_total);
  const b2 = await bookQuotation(quote2.id, {
    advanceAmount: Math.round(g2 * 0.15),
    paymentMode: 'cash',
    deadlineDays: 7,
    requestId: `t-book2-${quote2.id}`,
  });
  await addAdvanceToBooking(quote2.id, {
    advanceAmount: Math.round(g2 * 0.1),
    paymentMode: 'card',
    requestId: `t-add2-${quote2.id}`,
  });
  const cancelled = await cancelQuotationBooking(quote2.id, { reason: 'test cancel' });
  assert(cancelled.status === 'cancelled', 'cancelled');
  await product2.reload();
  assert(product2.status === 'available', `released to available, got ${product2.status}`);
  for (const id of b2.advance_ids || [b2.advance_id]) {
    const adv = await CustomerAdvance.findByPk(id);
    // first id may only be installment 1; reload all from cancelled payload
  }
  for (const id of cancelled.advance_ids || []) {
    const adv = await CustomerAdvance.findByPk(id);
    assert(adv && (adv.status === 'refunded' || Number(adv.remaining_amount) <= 0.001),
      `advance ${id} refunded status=${adv?.status}`);
  }

  // Auto-expire open estimation when its unique tag is sold elsewhere
  {
    const product3 = await makeUnique(s.id);
    const cust2 = await makeCustomer(s.id);
    const quote3 = await makeEstimation({ shopId: s.id, customer: cust2, product: product3 });
    assert(quote3.status === 'draft', 'open estimation starts draft');
    const g3 = Number(quote3.grand_total);
    await createInvoice({
      request_id: `t-sell-away-${quote3.id}`,
      customer_id: customer.id,
      items: [{ product_id: product3.id, quantity: 1, purity: '22K' }],
      payments: [{ mode: 'cash', amount: g3 }],
      gold_rate: RATE,
      gold_22k: 6400,
    }, {});
    await quote3.reload();
    assert(quote3.status === 'expired', `open estimation auto-expired, got ${quote3.status}`);
    assert(/Auto-expired/i.test(quote3.notes || ''), 'expiry note recorded');
  }

  console.log('ALL QUOTATION BOOKING TESTS PASSED');
  process.exit(0);
}

run().catch((err) => {
  console.error('BOOKING TEST FAILED', err);
  process.exit(1);
});
