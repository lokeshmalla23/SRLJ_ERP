/**
 * Acceptance E2E: Purchase receive → unique tag → POS sale → return.
 * Run: node backend/tests/purchaseTagPosReturn.test.js
 */
import 'dotenv/config';
import sequelize from '../src/db.js';
import '../src/models/index.js';
import { Shop, Product, Purchase, Setting, Invoice, CreditNote } from '../src/models/index.js';
import { createInvoice, cancelInvoice } from '../src/services/billingService.js';
import { createPartialReturn } from '../src/services/returnService.js';
import { calcLineAmounts, calcInvoiceTotals } from '../src/services/billingCalc.js';
import { INVENTORY_MODES } from '../src/constants/inventory.js';
import { newId } from '../src/utils.js';
import { clearDefaultShopCache } from '../src/services/defaultShop.js';
import { recordMovement } from '../src/services/inventoryService.js';
import { MOVEMENT_TYPES } from '../src/constants/inventory.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

const TEST_RATES = { gold_24k: 7000, gold_22k: 6400, gold_18k: 5200, silver: 90 };
const RATE_MAP = { '24K': 7000, '22K': 6400, '18K': 5200, Silver: 90 };

async function ensureGold() {
  const s = await Setting.findOne({ where: { key: 'gold_rate' } });
  if (!s) {
    await Setting.create({
      id: newId(),
      key: 'gold_rate',
      value: { ...TEST_RATES },
    });
  } else {
    await s.update({ value: { ...TEST_RATES } });
  }
}

async function run() {
  await sequelize.authenticate();
  // Ensure new Phase E2E tables exist on local SQLite
  await CreditNote.sync({ alter: false });
  clearDefaultShopCache();
  await ensureGold();
  const shop = await Shop.findOne({ order: [['created_at', 'ASC']] });
  assert(shop, 'shop required');

  console.log('1. Simulate purchase → unique tag product');
  let tag;
  await sequelize.transaction(async (t) => {
    const barcode = `E2E${Date.now().toString().slice(-8)}`;
    tag = await Product.create({
      id: newId(),
      shop_id: shop.id,
      name: `E2E Tag ${Date.now()}`,
      barcode: String(barcode),
      stock_qty: 1,
      inventory_mode: INVENTORY_MODES.UNIQUE_TAG,
      status: 'available',
      net_weight: 10,
      gross_weight: 11,
      making_charges: 500,
      making_charge_type: 'fixed',
      hsn_code: '7113',
      purchase_price: 45000,
    }, { transaction: t });
    await recordMovement({
      shopId: shop.id,
      product: tag,
      quantity: 1,
      movementType: MOVEMENT_TYPES.PURCHASE,
      referenceType: 'purchase',
      referenceId: `e2e-po-${tag.id}`,
      qtyBefore: 0,
      qtyAfter: 1,
      transaction: t,
    });
    await Purchase.create({
      id: newId(),
      shop_id: shop.id,
      po_number: `PO-E2E-${Date.now()}`,
      purchase_date: new Date().toISOString().slice(0, 10),
      purchase_type: 'finished_goods',
      items: [{ description: tag.name, product_id: tag.id, barcode: tag.barcode, quantity: 1 }],
      subtotal: 45000,
      gst_pct: 3,
      gst_amount: 1350,
      grand_total: 46350,
      paid_amount: 46350,
      balance: 0,
      status: 'paid',
    }, { transaction: t });
  });

  await tag.reload();
  assert(tag.status === 'available', 'tag available after purchase');
  assert(tag.inventory_mode === INVENTORY_MODES.UNIQUE_TAG, 'unique_tag mode');

  console.log('2. POS sale of tag');
  const line = calcLineAmounts({
    net_weight: tag.net_weight,
    gross_weight: tag.gross_weight,
    wastage_pct: 0,
    making_charges: tag.making_charges,
    making_charge_type: tag.making_charge_type,
    quantity: 1,
    purity: '22K',
  }, TEST_RATES.gold_24k, RATE_MAP);
  const totals = calcInvoiceTotals({
    lineTotals: [line.line_total],
    discount: 0,
    discountType: 'flat',
    gstPct: 3,
    oldGoldValue: 0,
  });
  const sale = await createInvoice({
    request_id: `e2e-sale-${tag.id}`,
    customer_name: 'E2E Walk-in',
    items: [{
      product_id: tag.id,
      quantity: 1,
      net_weight: tag.net_weight,
      gross_weight: tag.gross_weight,
      making_charges: tag.making_charges,
      making_charge_type: tag.making_charge_type,
      wastage_pct: 0,
      purity: '22K',
    }],
    gst_pct: 3,
    gold_rate: TEST_RATES.gold_24k,
    gold_22k: TEST_RATES.gold_22k,
    gold_18k: TEST_RATES.gold_18k,
    payments: [{ mode: 'cash', amount: totals.grand_total }],
  }, { user: { id: 'e2e', shop_id: shop.id } });

  assert(sale.invoice?.id, 'invoice created');
  await tag.reload();
  assert(tag.status === 'sold', `tag sold after POS (got ${tag.status})`);

  console.log('3. Partial return / credit note restores stock');
  const ret = await createPartialReturn(sale.invoice.id, {
    lines: [{ product_id: tag.id, quantity: 1 }],
    reason: 'E2E return',
    request_id: `e2e-ret-${tag.id}`,
    user: { id: 'e2e' },
  });
  assert(ret.credit_note?.id, 'credit note created');
  await tag.reload();
  assert(tag.status === 'available' || Number(tag.stock_qty) > 0, `tag restored after return (status=${tag.status}, qty=${tag.stock_qty})`);

  console.log('OK purchase → tag → POS → return');
}

run().catch((err) => {
  console.error('FAILED', err);
  process.exit(1);
}).finally(async () => {
  try { await sequelize.close(); } catch { /* */ }
});
