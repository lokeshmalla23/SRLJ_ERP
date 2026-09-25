/**
 * Multi-PC LAN concurrency / security hardening tests (P0).
 * Run: node backend/tests/lanP0Hardening.test.js
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import sequelize from '../src/db.js';
import '../src/models/index.js';
import { Product, Shop, Invoice, SaleAuthority, Setting } from '../src/models/index.js';
import { createInvoice, BillingError } from '../src/services/billingService.js';
import { calcLineAmounts, calcInvoiceTotals } from '../src/services/billingCalc.js';
import {
  decreaseStock,
  reserveUniqueItem,
  releaseUniqueItem,
  markUniqueItemSold,
  InventoryError,
} from '../src/services/inventoryService.js';
import { INVENTORY_MODES } from '../src/constants/inventory.js';
import { newId } from '../src/utils.js';
import { clearDefaultShopCache } from '../src/services/defaultShop.js';
import { ensureLanSharedSecret, getLanSharedSecret } from '../src/services/lanSecretService.js';

const created = { products: [], shops: [] };

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

function payForProduct(product, quantity = 1) {
  const line = calcLineAmounts({
    net_weight: product.net_weight,
    gross_weight: product.gross_weight,
    wastage_pct: 0,
    making_charges: product.making_charges,
    making_charge_type: product.making_charge_type,
    stone_charges: 0,
    purity: '22K',
    quantity,
  }, 7000);
  const totals = calcInvoiceTotals({
    lineTotals: [line.line_total],
    discount: 0,
    discountType: 'flat',
    gstPct: 3,
  });
  return [{ mode: 'cash', amount: totals.grand_total }];
}

async function shop() {
  clearDefaultShopCache();
  let s = await Shop.findOne({ order: [['created_at', 'ASC']] });
  if (!s) {
    s = await Shop.create({
      id: newId(),
      name: 'P0 Test Shop',
      code: 'P0',
      invoice_prefix: 'P0',
      status: 'active',
      settings: {},
    });
    created.shops.push(s.id);
  }
  // gold rate
  const rate = await Setting.findOne({ where: { key: 'gold_rate' } });
  if (!rate) {
    await Setting.create({
      id: newId(),
      key: 'gold_rate',
      value: { gold_24k: 7000, gold_22k: 6400 },
    });
  }
  return s;
}

async function makeQty(shopId, stock = 1) {
  const p = await Product.create({
    id: newId(),
    shop_id: shopId,
    name: `P0 Qty ${Date.now()}`,
    barcode: `PQ-${newId().slice(0, 8)}`,
    stock_qty: stock,
    inventory_mode: INVENTORY_MODES.QUANTITY,
    status: 'available',
    net_weight: 1,
    gross_weight: 1,
    making_charges: 100,
    making_charge_type: 'fixed',
  });
  created.products.push(p.id);
  return p;
}

async function makeUnique(shopId) {
  const p = await Product.create({
    id: newId(),
    shop_id: shopId,
    name: `P0 Tag ${Date.now()}`,
    barcode: `TAG-${newId().slice(0, 8)}`,
    stock_qty: 1,
    inventory_mode: INVENTORY_MODES.UNIQUE_TAG,
    status: 'available',
    net_weight: 5.812,
    gross_weight: 6,
    making_charges: 500,
    making_charge_type: 'fixed',
  });
  created.products.push(p.id);
  return p;
}

async function createInvoiceRetry(payload, attempts = 20) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await createInvoice(payload);
    } catch (err) {
      lastErr = err;
      const busy = /SQLITE_BUSY|database is locked|SequelizeTimeoutError/i.test(
        `${err?.name || ''} ${err?.message || err}`,
      );
      if (!busy) throw err;
      await new Promise((r) => setTimeout(r, 80 * (i + 1)));
    }
  }
  throw lastErr;
}

async function test1_atomicStockRace() {
  console.log('TEST 1 — qty stock=1 double-sale rejected (atomic WHERE stock_qty >= ?)');
  const s = await shop();
  const p = await makeQty(s.id, 1);
  const pay = payForProduct(p, 1);

  await createInvoiceRetry({
    request_id: randomUUID(),
    items: [{ product_id: p.id, quantity: 1, purity: '22K' }],
    payments: pay,
    customer_name: 'A',
    gold_rate: 7000,
  });
  let invoiceRejected = false;
  try {
    await createInvoiceRetry({
      request_id: randomUUID(),
      items: [{ product_id: p.id, quantity: 1, purity: '22K' }],
      payments: pay,
      customer_name: 'B',
      gold_rate: 7000,
    });
  } catch (err) {
    invoiceRejected = (err instanceof BillingError && err.code === 'INSUFFICIENT_STOCK')
      || (err instanceof InventoryError && err.code === 'INSUFFICIENT_STOCK')
      || /no longer available|Insufficient stock/i.test(String(err?.message || ''));
  }
  assert(invoiceRejected, 'second invoice must be rejected with stock conflict');
  await p.reload();
  assert(Number(p.stock_qty) === 0, `stock must be 0, got ${p.stock_qty}`);
  assert(Number(p.stock_qty) >= 0, 'stock must never go negative');
  console.log('  OK');
}

async function test2_uniqueReserveConflict() {
  console.log('TEST 2 — unique reserve conflict');
  const s = await shop();
  const p = await makeUnique(s.id);
  const a = await reserveUniqueItem({
    shopId: s.id, productId: p.id, requestId: randomUUID(), deviceId: 'pc2',
  });
  assert(a.granted, 'pc2 should reserve');
  let rejected = false;
  try {
    await reserveUniqueItem({
      shopId: s.id, productId: p.id, requestId: randomUUID(), deviceId: 'pc3',
    });
  } catch (e) {
    rejected = e instanceof InventoryError && e.code === 'ITEM_RESERVED';
  }
  assert(rejected, 'pc3 must be rejected');
  await p.reload();
  assert(p.status === 'reserved', `status reserved, got ${p.status}`);
  console.log('  OK');
}

async function test3_reservationExpiry() {
  console.log('TEST 3 — reservation TTL expiry');
  const s = await shop();
  const p = await makeUnique(s.id);
  const req = randomUUID();
  await reserveUniqueItem({
    shopId: s.id, productId: p.id, requestId: req, deviceId: 'pc2', ttlSeconds: 0,
  });
  // Force expire
  await SaleAuthority.update(
    { expires_at: new Date(Date.now() - 1000) },
    { where: { entity_id: p.id, status: 'GRANTED' } },
  );
  const again = await reserveUniqueItem({
    shopId: s.id, productId: p.id, requestId: randomUUID(), deviceId: 'pc3',
  });
  assert(again.granted, 'pc3 should reserve after expiry');
  console.log('  OK');
}

async function test4_soldBlocksFuture() {
  console.log('TEST 4 — sold blocks future reserve/sale');
  const s = await shop();
  const p = await makeUnique(s.id);
  const req = randomUUID();
  await reserveUniqueItem({ shopId: s.id, productId: p.id, requestId: req, deviceId: 'pc2' });
  await markUniqueItemSold({
    shopId: s.id, productId: p.id, requestId: req, referenceType: 'invoice', referenceId: newId(),
  });
  await p.reload();
  assert(p.status === 'sold', 'must be sold');
  let blocked = false;
  try {
    await reserveUniqueItem({ shopId: s.id, productId: p.id, requestId: randomUUID(), deviceId: 'pc3' });
  } catch (e) {
    blocked = true;
  }
  assert(blocked, 'reserve after sold must fail');
  console.log('  OK');
}

async function test5_idempotentRetry() {
  console.log('TEST 5 — lost response + same request_id');
  const s = await shop();
  const p = await makeQty(s.id, 5);
  const requestId = randomUUID();
  const payload = {
    request_id: requestId,
    items: [{ product_id: p.id, quantity: 1, purity: '22K' }],
    payments: payForProduct(p, 1),
    customer_name: 'Retry',
    gold_rate: 7000,
  };
  const first = await createInvoiceRetry(payload);
  const second = await createInvoiceRetry(payload);
  assert(second.idempotent === true, 'second must be idempotent');
  assert(first.invoice.id === second.invoice.id, 'same invoice id');
  await p.reload();
  assert(Number(p.stock_qty) === 4, `stock reduced once, got ${p.stock_qty}`);
  const count = await Invoice.count({ where: { request_id: requestId } });
  assert(count === 1, 'only one invoice');
  console.log('  OK');
}

async function test6_concurrentSameRequestId() {
  console.log('TEST 6 — simultaneous same request_id');
  const s = await shop();
  const p = await makeQty(s.id, 5);
  const requestId = randomUUID();
  const payload = {
    request_id: requestId,
    items: [{ product_id: p.id, quantity: 1, purity: '22K' }],
    payments: payForProduct(p, 1),
    customer_name: 'Race',
    gold_rate: 7000,
  };
  const results = await Promise.allSettled([
    createInvoiceRetry(payload),
    createInvoiceRetry(payload),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  assert(fulfilled.length >= 1, 'at least one success');
  const ids = new Set(fulfilled.map((r) => r.invoice.id));
  // Rejected may be unique constraint that resolved to same invoice on retry path
  for (const r of results) {
    if (r.status === 'rejected') {
      // acceptable if unique race bubbled — verify DB still single
    }
  }
  const count = await Invoice.count({ where: { request_id: requestId } });
  assert(count === 1, `exactly one invoice, got ${count}`);
  await p.reload();
  assert(Number(p.stock_qty) === 4, `stock once, got ${p.stock_qty}`);
  assert(ids.size === 1 || fulfilled.every((f) => f.invoice.id === fulfilled[0].invoice.id), 'same invoice');
  console.log('  OK');
}

async function test7_differentItemsParallel() {
  console.log('TEST 7 — different items (no false stock conflicts)');
  const s = await shop();
  const a = await makeQty(s.id, 3);
  const b = await makeQty(s.id, 3);
  // Sequential on SQLite single-writer; multi-PC Host uses WAL + busy_timeout across processes
  const ra = await createInvoiceRetry({
    request_id: randomUUID(),
    items: [{ product_id: a.id, quantity: 1, purity: '22K' }],
    payments: payForProduct(a, 1),
    customer_name: 'X',
    gold_rate: 7000,
  });
  const rb = await createInvoiceRetry({
    request_id: randomUUID(),
    items: [{ product_id: b.id, quantity: 1, purity: '22K' }],
    payments: payForProduct(b, 1),
    customer_name: 'Y',
    gold_rate: 7000,
  });
  assert(ra.invoice.id !== rb.invoice.id, 'two invoices');
  await a.reload();
  await b.reload();
  assert(Number(a.stock_qty) === 2 && Number(b.stock_qty) === 2, 'both decremented');
  console.log('  OK');
}

async function testAtomicDecreaseDirect() {
  console.log('TEST atomic decreaseStock helper');
  const s = await shop();
  const p = await makeQty(s.id, 1);
  await decreaseStock({ shopId: s.id, productId: p.id, quantity: 1 });
  let failed = false;
  try {
    await decreaseStock({ shopId: s.id, productId: p.id, quantity: 1 });
  } catch (e) {
    failed = e instanceof InventoryError && e.status === 409;
  }
  assert(failed, 'second decrease must 409');
  await p.reload();
  assert(Number(p.stock_qty) === 0, 'stock 0');
  console.log('  OK');
}

async function testLanSecret() {
  console.log('TEST LAN secret ensure');
  const s = await shop();
  const a = await ensureLanSharedSecret(s.id);
  const b = await ensureLanSharedSecret(s.id);
  assert(a === b, 'stable secret');
  assert(a.length >= 32, 'length');
  const got = await getLanSharedSecret(s.id);
  assert(got === a, 'get matches');
  console.log('  OK');
}

async function cleanup() {
  for (const id of created.products) {
    try {
      await SaleAuthority.destroy({ where: { entity_id: id } });
      await Product.destroy({ where: { id } });
    } catch { /* */ }
  }
}

async function main() {
  await sequelize.authenticate();
  // Fresh SQLite test DB — create tables
  await sequelize.sync({ force: false });
  try {
    await testLanSecret();
    await testAtomicDecreaseDirect();
    await test1_atomicStockRace();
    await test2_uniqueReserveConflict();
    await test3_reservationExpiry();
    await test4_soldBlocksFuture();
    await test5_idempotentRetry();
    await test6_concurrentSameRequestId();
    await test7_differentItemsParallel();
    console.log('\nAll LAN P0 hardening tests passed.');
  } finally {
    await cleanup();
    await sequelize.close();
  }
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
