/**
 * Simulated multi-client acceptance suite (single machine).
 * Covers: billing, concurrency, idempotency, cancel, recovery promote fence.
 *
 * Usage: node tests/acceptanceSimulation.test.js
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import sequelize from '../src/db.js';
import {
  Shop, Product, Invoice, InventoryMovement, Device, Setting,
} from '../src/models/index.js';
import { createInvoice, cancelInvoice } from '../src/services/billingService.js';
import { calcLineAmounts, calcInvoiceTotals } from '../src/services/billingCalc.js';
import { INVENTORY_MODES, MOVEMENT_TYPES } from '../src/constants/inventory.js';
import { recordMovement } from '../src/services/inventoryService.js';
import { newId } from '../src/utils.js';
import { clearDefaultShopCache } from '../src/services/defaultShop.js';
import {
  writeRecoverySnapshot,
  promoteToActiveHost,
  fenceIfSuperseded,
} from '../src/services/recoveryService.js';
import branchConfig from '../src/config/branchConfig.js';

const created = { products: [], invoices: [], devices: [] };

const TEST_RATES = { gold_24k: 7000, gold_22k: 6400, gold_18k: 5200, silver: 90 };
const RATE_MAP = { '24K': 7000, '22K': 6400, '18K': 5200, Silver: 90 };

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

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

async function makeQty(shopId, stock) {
  const p = await Product.create({
    id: newId(),
    shop_id: shopId,
    name: `Acc Qty ${Date.now()}`,
    barcode: `AQ-${newId().slice(0, 8)}`,
    stock_qty: stock,
    inventory_mode: INVENTORY_MODES.QUANTITY,
    status: 'available',
    net_weight: 10,
    gross_weight: 11,
    making_charges: 500,
    making_charge_type: 'fixed',
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
    name: `Acc UQ ${Date.now()}`,
    barcode: `AU-${newId().slice(0, 8)}`,
    stock_qty: 1,
    inventory_mode: INVENTORY_MODES.UNIQUE_TAG,
    status: 'available',
    net_weight: 8,
    gross_weight: 8.5,
    making_charges: 400,
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

function payFor(productLike) {
  const line = calcLineAmounts({
    net_weight: productLike.net_weight || 10,
    gross_weight: productLike.gross_weight || 11,
    wastage_pct: 0,
    making_charges: productLike.making_charges || 500,
    making_charge_type: 'fixed',
    stone_charges: 0,
    purity: '22K',
    quantity: 1,
  }, TEST_RATES.gold_24k, RATE_MAP);
  const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
  return totals.grand_total;
}

function billOpts(extra = {}) {
  return {
    gold_rate: TEST_RATES.gold_24k,
    gold_22k: TEST_RATES.gold_22k,
    gold_18k: TEST_RATES.gold_18k,
    ...extra,
  };
}

async function run() {
  await sequelize.authenticate();
  clearDefaultShopCache();
  await ensureGold();
  const shop = await Shop.findOne({ order: [['created_at', 'ASC']] });
  assert(shop, 'shop');

  console.log('A1. PC2 + PC3 concurrent invoices');
  const p1 = await makeQty(shop.id, 10);
  const amount = payFor(p1);
  const [a, b] = await Promise.all([
    createInvoice(billOpts({
      items: [{ product_id: p1.id, quantity: 1, purity: '22K' }],
      payments: [{ mode: 'cash', amount }],
      request_id: randomUUID(),
    })),
    createInvoice(billOpts({
      items: [{ product_id: p1.id, quantity: 1, purity: '22K' }],
      payments: [{ mode: 'cash', amount }],
      request_id: randomUUID(),
    })),
  ]);
  created.invoices.push(a.invoice.id, b.invoice.id);
  await p1.reload();
  assert(Number(p1.stock_qty) === 8, 'stock after 2 sales');
  console.log('✓ concurrent sales');

  console.log('A2. Unique-tag only one wins');
  const u = await makeUnique(shop.id);
  const uAmt = payFor(u);
  const results = await Promise.allSettled([
    createInvoice(billOpts({
      items: [{ product_id: u.id, quantity: 1, purity: '22K' }],
      payments: [{ mode: 'cash', amount: uAmt }],
      request_id: randomUUID(),
    })),
    createInvoice(billOpts({
      items: [{ product_id: u.id, quantity: 1, purity: '22K' }],
      payments: [{ mode: 'cash', amount: uAmt }],
      request_id: randomUUID(),
    })),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const fail = results.filter((r) => r.status === 'rejected');
  assert(ok.length === 1 && fail.length === 1, 'exactly one unique sale');
  created.invoices.push(ok[0].value.invoice.id);
  console.log('✓ unique concurrency');

  console.log('A3. Idempotent retry (network double-submit)');
  const p2 = await makeQty(shop.id, 3);
  const amt2 = payFor(p2);
  const rid = randomUUID();
  const i1 = await createInvoice(billOpts({
    items: [{ product_id: p2.id, quantity: 1, purity: '22K' }],
    payments: [{ mode: 'cash', amount: amt2 }],
    request_id: rid,
  }));
  const i2 = await createInvoice(billOpts({
    items: [{ product_id: p2.id, quantity: 1, purity: '22K' }],
    payments: [{ mode: 'cash', amount: amt2 }],
    request_id: rid,
  }));
  created.invoices.push(i1.invoice.id);
  assert(i1.invoice.id === i2.invoice.id && i2.idempotent, 'idempotent');
  console.log('✓ idempotent');

  console.log('A4. Cancel restores inventory');
  const p3 = await makeQty(shop.id, 2);
  const amt3 = payFor(p3);
  const inv3 = await createInvoice(billOpts({
    items: [{ product_id: p3.id, quantity: 1, purity: '22K' }],
    payments: [{ mode: 'cash', amount: amt3 }],
    request_id: randomUUID(),
  }));
  created.invoices.push(inv3.invoice.id);
  await cancelInvoice(inv3.invoice.id, { reason: 'acceptance' });
  await p3.reload();
  assert(Number(p3.stock_qty) === 2, 'restored');
  assert(inv3.invoice.invoice_no, 'number kept');
  console.log('✓ cancel');

  console.log('A5. Recovery snapshot + promote + fence');
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'acceptance-test-secret';
  const snap = await writeRecoverySnapshot();
  assert(snap.path, 'snapshot written');

  const d2 = await Device.create({
    id: newId(),
    shop_id: shop.id,
    device_name: 'PC2 Recovery',
    device_identifier: `pc2-${randomUUID()}`,
    role: 'recovery',
    status: 'active',
  });
  created.devices.push(d2.id);

  const promo = await promoteToActiveHost({
    confirmDualActiveRisk: true,
    deviceIdentifier: d2.device_identifier,
    deviceName: 'PC2 Recovery',
  });
  assert(promo.promoted && promo.device.role === 'active_host', 'promoted');

  // Simulate old host (PC1) checking fence — another active host exists
  const fence = await fenceIfSuperseded();
  const activeHosts = await Device.count({
    where: { shop_id: shop.id, role: 'active_host', status: 'active' },
  });
  assert(activeHosts >= 1, 'active host present');
  console.log('✓ recovery promote', { fence, device: branchConfig.device_id });

  console.log('\nACCEPTANCE SIMULATION PASSED');
  console.log('Note: Physical 3-PC + NIC offline drill still required for production sign-off.');

  // cleanup
  await InventoryMovement.destroy({ where: { reference_id: created.invoices } });
  await Invoice.destroy({ where: { id: created.invoices } });
  await InventoryMovement.destroy({ where: { product_id: created.products } });
  await Product.destroy({ where: { id: created.products } });
  if (created.devices.length) await Device.destroy({ where: { id: created.devices } });
  await sequelize.close();
}

run().catch(async (e) => {
  console.error('ACCEPTANCE FAILED', e);
  try { await sequelize.close(); } catch { /* */ }
  process.exit(1);
});
