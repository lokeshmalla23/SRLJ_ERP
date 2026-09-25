import 'dotenv/config';
import { randomUUID } from 'crypto';
import sequelize from '../src/db.js';
import { Product, Shop, Invoice, InventoryMovement, Setting } from '../src/models/index.js';
import { createInvoice, convertQuotation, cancelInvoice, BillingError } from '../src/services/billingService.js';
import { calcInvoiceTotals, calcLineAmounts } from '../src/services/billingCalc.js';
import { INVENTORY_MODES } from '../src/constants/inventory.js';
import { newId } from '../src/utils.js';
import { Quotation } from '../src/models/index.js';
import { clearDefaultShopCache } from '../src/services/defaultShop.js';
import { recordMovement } from '../src/services/inventoryService.js';
import { MOVEMENT_TYPES } from '../src/constants/inventory.js';
import { markAccountsSetupCompleted } from '../src/services/openingSetupService.js';
const created = { products: [], invoices: [], quotations: [] };

const TEST_RATES = { gold_24k: 7000, gold_22k: 6400, gold_18k: 5200, silver: 90 };
const RATE_MAP = { '24K': 7000, '22K': 6400, '18K': 5200, Silver: 90 };

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function ensureGoldRate() {
  // Do NOT mutate shared shop settings when running against Electron/desktop SQLite.
  if (process.env.ELECTRON_RUN === '1' || process.env.SQLITE_PATH) {
    const s = await Setting.findOne({ where: { key: 'gold_rate' } });
    if (!s) {
      await Setting.create({ id: newId(), key: 'gold_rate', value: { ...TEST_RATES } });
    }
    return;
  }
  const s = await Setting.findOne({ where: { key: 'gold_rate' } });
  if (!s) {
    await Setting.create({
      id: newId(),
      key: 'gold_rate',
      value: { ...TEST_RATES },
    });
  } else {
    // Force deterministic rates so payment previews match server rateMap pricing.
    await s.update({ value: { ...TEST_RATES } });
  }
}

async function makeQty(shopId, stock = 5) {
  const p = await Product.create({
    id: newId(),
    shop_id: shopId,
    name: `Bill Qty ${Date.now()}`,
    barcode: `BQ-${newId().slice(0, 8)}`,
    stock_qty: stock,
    inventory_mode: INVENTORY_MODES.QUANTITY,
    status: 'available',
    net_weight: 10,
    gross_weight: 11,
    wastage_pct: 0,
    making_charges: 500,
    making_charge_type: 'fixed',
    purity_id: null,
  });
  created.products.push(p.id);
  await sequelize.transaction(async (t) => {
    await recordMovement({
      shopId, product: p, movementType: MOVEMENT_TYPES.OPENING,
      quantity: stock, qtyBefore: 0, qtyAfter: stock,
      referenceType: 'test', transaction: t,
    });
  });
  return p;
}

async function makeUnique(shopId) {
  const p = await Product.create({
    id: newId(),
    shop_id: shopId,
    name: `Bill UQ ${Date.now()}`,
    barcode: `BU-${newId().slice(0, 8)}`,
    stock_qty: 1,
    inventory_mode: INVENTORY_MODES.UNIQUE_TAG,
    status: 'available',
    net_weight: 18,
    gross_weight: 19,
    making_charges: 1000,
    making_charge_type: 'fixed',
  });
  created.products.push(p.id);
  await sequelize.transaction(async (t) => {
    await recordMovement({
      shopId, product: p, movementType: MOVEMENT_TYPES.OPENING,
      quantity: 1, qtyBefore: 0, qtyAfter: 1,
      referenceType: 'test', transaction: t,
    });
  });
  return p;
}

async function makeTray(shopId, { stockQty = 20, totalWeight = 100, makingCharges = 200 } = {}) {
  const p = await Product.create({
    id: newId(),
    shop_id: shopId,
    name: `Bill Tray ${Date.now()}`,
    barcode: `BT-${newId().slice(0, 8)}`,
    stock_qty: stockQty,
    tray_total_weight: totalWeight,
    inventory_mode: INVENTORY_MODES.QUANTITY,
    status: 'available',
    net_weight: 0,
    gross_weight: 0,
    wastage_pct: 0,
    making_charges: makingCharges,
    making_charge_type: 'fixed',
    purity_id: null,
  });
  created.products.push(p.id);
  await sequelize.transaction(async (t) => {
    await recordMovement({
      shopId, product: p, movementType: MOVEMENT_TYPES.OPENING,
      quantity: stockQty, qtyBefore: 0, qtyAfter: stockQty,
      referenceType: 'test', transaction: t,
    });
  });
  return p;
}

async function payFull(grand) {
  return [{ mode: 'cash', amount: grand }];
}

async function run() {
  await sequelize.authenticate();
  clearDefaultShopCache();
  await ensureGoldRate();
  const shop = await Shop.findOne({ order: [['created_at', 'ASC']] });
  assert(shop, 'shop');
  if (process.env.ELECTRON_RUN !== '1' && !process.env.SQLITE_PATH) {
    await markAccountsSetupCompleted(shop.id, { source: 'automated_test' });
  }
  const { resolveFinancialMode, FINANCIAL_MODE } = await import('../src/services/financialMode.js');
  const liveMode = await resolveFinancialMode(shop.id);
  if (liveMode !== FINANCIAL_MODE.LIVE) {
    console.log('billingService.test.js: skipped (shop is PRE_ACCOUNTS — see preAccountsPos.test.js)');
    process.exit(0);
  }

  console.log('1-2. Normal quantity sale + SALE movement');
  {
    const p = await makeQty(shop.id, 5);
    // Preview totals with fixed making so we know payment
    const line = calcLineAmounts({
      net_weight: 10, gross_weight: 11, wastage_pct: 0,
      making_charges: 500, making_charge_type: 'fixed', stone_charges: 0,
      purity: '22K', quantity: 2,
    }, 7000, RATE_MAP);
    const totals = calcInvoiceTotals({
      lineTotals: [line.line_total], discount: 0, discountType: 'flat', gstPct: 3,
    });
    const result = await createInvoice({
      items: [{ product_id: p.id, quantity: 2, purity: '22K' }],
      payments: await payFull(totals.grand_total),
      gold_rate: 7000, gold_22k: 6400,
      request_id: randomUUID(),
    });
    created.invoices.push(result.invoice.id);
    await p.reload();
    assert(Number(p.stock_qty) === 3, `stock 3 got ${p.stock_qty}`);
    const moves = await InventoryMovement.count({
      where: { reference_id: result.invoice.id, movement_type: 'SALE' },
    });
    assert(moves === 1, 'sale movement');
  }

  console.log('3. Insufficient stock rejected');
  {
    const p = await makeQty(shop.id, 1);
    let rejected = false;
    try {
      const line = calcLineAmounts({
        net_weight: 10, gross_weight: 11, wastage_pct: 0,
        making_charges: 500, making_charge_type: 'fixed', stone_charges: 0,
        purity: '22K', quantity: 5,
      }, 7000, RATE_MAP);
      const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
      await createInvoice({
        items: [{ product_id: p.id, quantity: 5, purity: '22K' }],
        payments: [{ mode: 'cash', amount: totals.grand_total }],
        gold_rate: 7000, gold_22k: 6400,
      });
    } catch (e) {
      rejected = e instanceof BillingError && e.code === 'INSUFFICIENT_STOCK';
    }
    assert(rejected, 'insufficient');
  }

  console.log('4. Quantity concurrency — stock 1, two sales');
  {
    const p = await makeQty(shop.id, 1);
    const line = calcLineAmounts({
      net_weight: 10, gross_weight: 11, wastage_pct: 0,
      making_charges: 500, making_charge_type: 'fixed', stone_charges: 0,
      purity: '22K', quantity: 1,
    }, 7000, RATE_MAP);
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const payload = {
      items: [{ product_id: p.id, quantity: 1, purity: '22K' }],
      payments: [{ mode: 'cash', amount: totals.grand_total }],
      gold_rate: 7000, gold_22k: 6400,
    };
    const results = await Promise.allSettled([
      createInvoice({ ...payload, request_id: randomUUID() }),
      createInvoice({ ...payload, request_id: randomUUID() }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const fail = results.filter((r) => r.status === 'rejected');
    assert(ok.length === 1 && fail.length === 1, `qty concurrency ok=${ok.length} fail=${fail.length}`);
    ok.forEach((r) => created.invoices.push(r.value.invoice.id));
  }

  console.log('5-6. Unique sale + concurrency');
  {
    const p = await makeUnique(shop.id);
    const line = calcLineAmounts({
      net_weight: 18, gross_weight: 19, wastage_pct: 0,
      making_charges: 1000, making_charge_type: 'fixed', stone_charges: 0,
      purity: '22K', quantity: 1,
    }, 7000, RATE_MAP);
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const r1 = await createInvoice({
      items: [{ product_id: p.id, quantity: 1, purity: '22K' }],
      payments: [{ mode: 'cash', amount: totals.grand_total }],
      gold_rate: 7000, gold_22k: 6400,
      request_id: randomUUID(),
    });
    created.invoices.push(r1.invoice.id);
    await p.reload();
    assert(p.status === 'sold', 'sold');

    const p2 = await makeUnique(shop.id);
    const line2 = calcLineAmounts({
      net_weight: 18, gross_weight: 19, wastage_pct: 0,
      making_charges: 1000, making_charge_type: 'fixed', stone_charges: 0,
      purity: '22K', quantity: 1,
    }, 7000, RATE_MAP);
    const totals2 = calcInvoiceTotals({ lineTotals: [line2.line_total], gstPct: 3 });
    const payload = {
      items: [{ product_id: p2.id, quantity: 1, purity: '22K' }],
      payments: [{ mode: 'cash', amount: totals2.grand_total }],
      gold_rate: 7000, gold_22k: 6400,
    };
    const results = await Promise.allSettled([
      createInvoice({ ...payload, request_id: randomUUID() }),
      createInvoice({ ...payload, request_id: randomUUID() }),
    ]);
    assert(
      results.filter((r) => r.status === 'fulfilled').length === 1
      && results.filter((r) => r.status === 'rejected').length === 1,
      'unique concurrency'
    );
    results.filter((r) => r.status === 'fulfilled').forEach((r) => created.invoices.push(r.value.invoice.id));
  }

  console.log('7-10. Server totals / GST / ignore client manipulation');
  {
    const p = await makeQty(shop.id, 3);
    const line = calcLineAmounts({
      net_weight: 10, gross_weight: 11, wastage_pct: 0,
      making_charges: 500, making_charge_type: 'fixed', stone_charges: 0,
      purity: '22K', quantity: 1,
    }, 7000, RATE_MAP);
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const result = await createInvoice({
      items: [{ product_id: p.id, quantity: 1, purity: '22K' }],
      payments: [{ mode: 'cash', amount: totals.grand_total }],
      gold_rate: 7000, gold_22k: 6400,
      // Manipulated client values — must be ignored
      subtotal: 1,
      gst_amount: 999999,
      grand_total: 1,
      request_id: randomUUID(),
    });
    created.invoices.push(result.invoice.id);
    assert(Number(result.invoice.grand_total) === totals.grand_total, 'server grand wins');
    assert(Number(result.invoice.gst_pct) === 3, 'gst pct');
    assert(Number(result.invoice.cgst_amount) + Number(result.invoice.sgst_amount) === Number(result.invoice.gst_amount)
      || Math.abs(Number(result.invoice.cgst_amount) + Number(result.invoice.sgst_amount) - Number(result.invoice.gst_amount)) < 0.02,
      'cgst+sgst');
  }

  console.log('11-14. Payments validation');
  {
    const p = await makeQty(shop.id, 2);
    const line = calcLineAmounts({
      net_weight: 10, gross_weight: 11, wastage_pct: 0,
      making_charges: 500, making_charge_type: 'fixed', stone_charges: 0,
      purity: '22K', quantity: 1,
    }, 7000, RATE_MAP);
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const half = Number((totals.grand_total / 2).toFixed(2));
    const rest = Number((totals.grand_total - half).toFixed(2));
    const r = await createInvoice({
      items: [{ product_id: p.id, quantity: 1, purity: '22K' }],
      payments: [
        { mode: 'cash', amount: half },
        { mode: 'upi', amount: rest },
      ],
      gold_rate: 7000, gold_22k: 6400,
      request_id: randomUUID(),
    });
    created.invoices.push(r.invoice.id);
    assert(r.invoice.payments.length === 2, 'split');

    let bad = false;
    try {
      await createInvoice({
        items: [{ product_id: p.id, quantity: 1, purity: '22K' }],
        payments: [{ mode: 'cash', amount: -5 }],
        gold_rate: 7000, gold_22k: 6400,
      });
    } catch (e) { bad = e.code === 'INVALID_PAYMENT'; }
    assert(bad, 'negative payment');

    bad = false;
    try {
      await createInvoice({
        items: [{ product_id: p.id, quantity: 1, purity: '22K' }],
        payments: [{ mode: 'bitcoin', amount: totals.grand_total }],
        gold_rate: 7000, gold_22k: 6400,
      });
    } catch (e) { bad = e.code === 'INVALID_PAYMENT'; }
    assert(bad, 'bad mode');

    bad = false;
    try {
      await createInvoice({
        items: [{ product_id: p.id, quantity: 1, purity: '22K' }],
        payments: [{ mode: 'cash', amount: 1 }],
        gold_rate: 7000, gold_22k: 6400,
      });
    } catch (e) { bad = e.code === 'INVALID_PAYMENT'; }
    assert(bad, 'underpay');
  }

  console.log('15-16. Discount + empty invoice');
  {
    let bad = false;
    try {
      await createInvoice({ items: [], payments: [{ mode: 'cash', amount: 1 }], gold_rate: 7000, gold_22k: 6400 });
    } catch (e) { bad = e.code === 'EMPTY_INVOICE'; }
    assert(bad, 'empty');

    const p = await makeQty(shop.id, 2);
    const line = calcLineAmounts({
      net_weight: 10, gross_weight: 11, wastage_pct: 0,
      making_charges: 500, making_charge_type: 'fixed', stone_charges: 0,
      purity: '22K', quantity: 1,
    }, 7000, RATE_MAP);
    bad = false;
    try {
      const totals = calcInvoiceTotals({
        lineTotals: [line.line_total], discount: line.line_total + 100, discountType: 'flat', gstPct: 3,
      });
      await createInvoice({
        items: [{ product_id: p.id, quantity: 1, purity: '22K' }],
        discount: line.line_total + 100,
        payments: [{ mode: 'cash', amount: totals.grand_total }],
        gold_rate: 7000, gold_22k: 6400,
      });
    } catch (e) { bad = e.code === 'INVALID_DISCOUNT'; }
    assert(bad, 'over discount');
  }

  console.log('17. Idempotent retry');
  {
    const p = await makeQty(shop.id, 3);
    const line = calcLineAmounts({
      net_weight: 10, gross_weight: 11, wastage_pct: 0,
      making_charges: 500, making_charge_type: 'fixed', stone_charges: 0,
      purity: '22K', quantity: 1,
    }, 7000, RATE_MAP);
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const rid = randomUUID();
    const a = await createInvoice({
      items: [{ product_id: p.id, quantity: 1, purity: '22K' }],
      payments: [{ mode: 'cash', amount: totals.grand_total }],
      gold_rate: 7000, gold_22k: 6400,
      request_id: rid,
    });
    const b = await createInvoice({
      items: [{ product_id: p.id, quantity: 1, purity: '22K' }],
      payments: [{ mode: 'cash', amount: totals.grand_total }],
      gold_rate: 7000, gold_22k: 6400,
      request_id: rid,
    });
    created.invoices.push(a.invoice.id);
    assert(a.invoice.id === b.invoice.id && b.idempotent === true, 'idempotent');
    await p.reload();
    assert(Number(p.stock_qty) === 2, 'stock only once');
  }

  console.log('19-21. Quotation convert + duplicate');
  {
    const p = await makeQty(shop.id, 4);
    const q = await Quotation.create({
      id: newId(),
      shop_id: shop.id,
      quote_no: `QT-TEST-${Date.now()}`,
      customer_name: 'Test',
      items: [{
        product_id: p.id, quantity: 1, net_weight: 10, gross_weight: 11,
        making_charges: 500, making_charge_type: 'fixed', purity: '22K',
      }],
      gold_rate: 7000, gold_22k: 6400,
      subtotal: 0,
      discount: 0,
      gst_pct: 3,
      gst_amount: 0,
      grand_total: 0,
      status: 'accepted',
    });
    created.quotations.push(q.id);
    const r = await convertQuotation(q.id);
    created.invoices.push(r.invoice.id);
    await p.reload();
    assert(Number(p.stock_qty) === 3, 'quote convert stock');
    const moves = await InventoryMovement.count({
      where: { reference_id: r.invoice.id, movement_type: 'SALE' },
    });
    assert(moves >= 1, 'quote sale movement');

    let dup = false;
    try { await convertQuotation(q.id); } catch (e) {
      dup = e.code === 'QUOTATION_ALREADY_CONVERTED';
    }
    assert(dup, 'duplicate convert');
  }

  console.log('26. Snapshot survives product rename');
  {
    const p = await makeQty(shop.id, 2);
    const line = calcLineAmounts({
      net_weight: 10, gross_weight: 11, wastage_pct: 0,
      making_charges: 500, making_charge_type: 'fixed', stone_charges: 0,
      purity: '22K', quantity: 1,
    }, 7000, RATE_MAP);
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const r = await createInvoice({
      items: [{ product_id: p.id, quantity: 1, purity: '22K' }],
      payments: [{ mode: 'cash', amount: totals.grand_total }],
      gold_rate: 7000, gold_22k: 6400,
      request_id: randomUUID(),
    });
    created.invoices.push(r.invoice.id);
    const snapName = r.invoice.items[0].product_name;
    await p.update({ name: 'RENAMED PRODUCT XYZ' });
    const inv = await Invoice.findByPk(r.invoice.id);
    assert(inv.items[0].product_name === snapName, 'snapshot name');
    assert(inv.items[0].product_name !== 'RENAMED PRODUCT XYZ', 'not live name');
  }

  console.log('27. Invoice cancel restores stock + SALE_RETURN');
  {
    const p = await makeQty(shop.id, 4);
    const line = calcLineAmounts({
      net_weight: 10, gross_weight: 11, wastage_pct: 0,
      making_charges: 500, making_charge_type: 'fixed', stone_charges: 0,
      purity: '22K', quantity: 1,
    }, 7000, RATE_MAP);
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const r = await createInvoice({
      items: [{ product_id: p.id, quantity: 1, purity: '22K' }],
      payments: [{ mode: 'cash', amount: totals.grand_total }],
      gold_rate: 7000, gold_22k: 6400,
      request_id: randomUUID(),
    });
    created.invoices.push(r.invoice.id);
    const c = await cancelInvoice(r.invoice.id, { reason: 'test cancel' });
    assert(c.invoice.status === 'cancelled', 'cancelled status');
    assert(c.invoice.invoice_no === r.invoice.invoice_no, 'number preserved');
    await p.reload();
    assert(Number(p.stock_qty) === 4, 'stock restored');
    const returns = await InventoryMovement.count({
      where: { reference_id: r.invoice.id, movement_type: 'SALE_RETURN' },
    });
    assert(returns >= 1, 'sale return movement');
    let dup = false;
    try { await cancelInvoice(r.invoice.id); } catch (e) {
      dup = e.code === 'ALREADY_CANCELLED';
    }
    assert(dup, 'double cancel rejected');
  }

  console.log('28. Tray — pieces/weight independent, priced from weight sold, stock deducted');
  {
    const p = await makeTray(shop.id, { stockQty: 20, totalWeight: 100, makingCharges: 200 });
    const expectedGold = 25 * 7000;
    const expectedBase = expectedGold + 200;
    const expectedGst = Number((expectedBase * 0.03).toFixed(2));
    const expectedGrand = expectedBase + expectedGst;
    const result = await createInvoice({
      items: [{ product_id: p.id, quantity: 5, tray_weight_sold: 25 }],
      payments: [{ mode: 'cash', amount: expectedGrand }],
      gold_rate: 7000, gold_22k: 6400,
      gst_pct: 3,
      request_id: randomUUID(),
    });
    created.invoices.push(result.invoice.id);
    const line = result.invoice.items[0];
    assert(Number(line.quantity) === 5, `tray quantity should be pieces sold (5), got ${line.quantity}`);
    assert(Math.abs(Number(line.gold_value) - expectedGold) < 0.02, `tray gold value ${line.gold_value} expected ${expectedGold} (must use weight sold, not weight×pieces)`);
    assert(Math.abs(Number(line.net_weight) - 25) < 0.001, `tray net_weight should be weight sold (25), got ${line.net_weight}`);
    assert(Math.abs(Number(result.invoice.grand_total) - expectedGrand) < 0.02, `tray grand total ${result.invoice.grand_total} expected ${expectedGrand}`);
    await p.reload();
    assert(Number(p.stock_qty) === 15, `tray pieces stock should be 15, got ${p.stock_qty}`);
    assert(Math.abs(Number(p.tray_total_weight) - 75) < 0.001, `tray weight should be 75, got ${p.tray_total_weight}`);
  }

  console.log('29. Tray — excess pieces rejected (25 requested, 20 available)');
  {
    const p = await makeTray(shop.id, { stockQty: 20, totalWeight: 100, makingCharges: 200 });
    // Pieces validation only fires during stock deduction (after totals/payment
    // are checked) — pay the exact amount so the flow gets that far.
    const base = 50 * 7000 + 200;
    const grand = base + Number((base * 0.03).toFixed(2));
    let rejected = false;
    try {
      await createInvoice({
        items: [{ product_id: p.id, quantity: 25, tray_weight_sold: 50 }],
        payments: [{ mode: 'cash', amount: grand }],
        gold_rate: 7000, gold_22k: 6400,
        gst_pct: 3,
      });
    } catch (e) {
      rejected = e instanceof BillingError && e.code === 'INSUFFICIENT_STOCK';
    }
    assert(rejected, 'tray excess pieces rejected');
    await p.reload();
    assert(Number(p.stock_qty) === 20, 'tray pieces unchanged after rejected excess-pieces sale');
    assert(Math.abs(Number(p.tray_total_weight) - 100) < 0.001, 'tray weight unchanged after rejected excess-pieces sale');
  }

  console.log('30. Tray — excess weight rejected (110g requested, 100g available)');
  {
    const p = await makeTray(shop.id, { stockQty: 20, totalWeight: 100 });
    let rejected = false;
    try {
      await createInvoice({
        items: [{ product_id: p.id, quantity: 5, tray_weight_sold: 110 }],
        payments: [{ mode: 'cash', amount: 999999 }],
        gold_rate: 7000, gold_22k: 6400,
        gst_pct: 3,
      });
    } catch (e) {
      rejected = e instanceof BillingError && e.code === 'INSUFFICIENT_STOCK';
    }
    assert(rejected, 'tray excess weight rejected');
    await p.reload();
    assert(Number(p.stock_qty) === 20, 'tray pieces unchanged after rejected excess-weight sale');
    assert(Math.abs(Number(p.tray_total_weight) - 100) < 0.001, 'tray weight unchanged after rejected excess-weight sale');
  }

  console.log('31. Tray — uneven decimal weight (3 pcs / 14.7g), not derived from piece count');
  {
    const p = await makeTray(shop.id, { stockQty: 20, totalWeight: 100, makingCharges: 150 });
    const expectedGold = 14.7 * 7000;
    const expectedBase = expectedGold + 150;
    const expectedGst = Number((expectedBase * 0.03).toFixed(2));
    const expectedGrand = expectedBase + expectedGst;
    const result = await createInvoice({
      items: [{ product_id: p.id, quantity: 3, tray_weight_sold: 14.7 }],
      payments: [{ mode: 'cash', amount: expectedGrand }],
      gold_rate: 7000, gold_22k: 6400,
      gst_pct: 3,
      request_id: randomUUID(),
    });
    created.invoices.push(result.invoice.id);
    assert(Math.abs(Number(result.invoice.items[0].gold_value) - expectedGold) < 0.02, 'tray decimal weight gold value');
    await p.reload();
    assert(Number(p.stock_qty) === 17, `tray decimal pieces should be 17, got ${p.stock_qty}`);
    assert(Math.abs(Number(p.tray_total_weight) - 85.3) < 0.001, `tray decimal weight should be 85.3, got ${p.tray_total_weight}`);
  }

  console.log('32b. Tray — remaining weight is 3 decimals after 9.425 − 2.456 (no IEEE leftover)');
  {
    const p = await makeTray(shop.id, { stockQty: 40, totalWeight: 9.425, makingCharges: 0 });
    const sold = 2.456;
    const expectedRemain = 6.969;
    const expectedGold = sold * 7000;
    const expectedGst = Number((expectedGold * 0.03).toFixed(2));
    const expectedGrand = expectedGold + expectedGst;
    const result = await createInvoice({
      items: [{ product_id: p.id, quantity: 2, tray_weight_sold: sold }],
      payments: [{ mode: 'cash', amount: expectedGrand }],
      gold_rate: 7000, gold_22k: 6400,
      gst_pct: 3,
      request_id: randomUUID(),
    });
    created.invoices.push(result.invoice.id);
    await p.reload();
    const remain = Number(p.tray_total_weight);
    assert(Math.abs(remain - expectedRemain) < 0.0005, `tray remain should be ${expectedRemain}, got ${remain}`);
    const { toWeightNumber } = await import('../src/utils/weight.js');
    assert(toWeightNumber(remain) === expectedRemain, `canonical remain should be ${expectedRemain}, got ${toWeightNumber(remain)}`);
  }

  console.log('32. Tray — non-positive weight rejected');
  {
    const p = await makeTray(shop.id, { stockQty: 20, totalWeight: 100 });
    let rejected = false;
    try {
      await createInvoice({
        items: [{ product_id: p.id, quantity: 2, tray_weight_sold: 0 }],
        payments: [{ mode: 'cash', amount: 999999 }],
        gold_rate: 7000, gold_22k: 6400,
        gst_pct: 3,
      });
    } catch (e) {
      rejected = e instanceof BillingError && e.code === 'INVALID_TRAY_WEIGHT';
    }
    assert(rejected, 'tray zero weight rejected');
  }

  console.log('\nALL BILLING TESTS PASSED');

  // cleanup
  if (created.invoices.length) {
    await InventoryMovement.destroy({ where: { reference_id: created.invoices } });
    await Invoice.destroy({ where: { id: created.invoices } });
  }
  if (created.quotations.length) {
    await Quotation.destroy({ where: { id: created.quotations } });
  }
  if (created.products.length) {
    await InventoryMovement.destroy({ where: { product_id: created.products } });
    await Product.destroy({ where: { id: created.products } });
  }
  await sequelize.close();
}

run().catch(async (err) => {
  console.error('FAILED', err);
  try { await sequelize.close(); } catch { /* */ }
  process.exit(1);
});
