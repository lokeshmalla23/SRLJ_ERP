/**
 * Sync outbox + idempotent cloud push tests.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import http from 'http';
import express from 'express';
import sequelize from '../src/db.js';
import { Shop, SyncOutbox, SyncProcessedEvent, Invoice } from '../src/models/index.js';
import { createInvoice } from '../src/services/billingService.js';
import { calcLineAmounts, calcInvoiceTotals } from '../src/services/billingCalc.js';
import { Product } from '../src/models/index.js';
import { INVENTORY_MODES, MOVEMENT_TYPES } from '../src/constants/inventory.js';
import { recordMovement } from '../src/services/inventoryService.js';
import { newId } from '../src/utils.js';
import { clearDefaultShopCache } from '../src/services/defaultShop.js';
import { pushEvents } from '../src/controllers/sync.js';
import { Setting } from '../src/models/index.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function makeQty(shopId, stock = 3) {
  const p = await Product.create({
    id: newId(),
    shop_id: shopId,
    name: `Sync Qty ${Date.now()}`,
    barcode: `SQ-${newId().slice(0, 8)}`,
    stock_qty: stock,
    inventory_mode: INVENTORY_MODES.QUANTITY,
    status: 'available',
    net_weight: 10,
    gross_weight: 11,
    making_charges: 500,
    making_charge_type: 'fixed',
  });
  await sequelize.transaction(async (t) => {
    await recordMovement({
      shopId, product: p, movementType: MOVEMENT_TYPES.OPENING,
      quantity: stock, qtyBefore: 0, qtyAfter: stock,
      referenceType: 'test', transaction: t,
    });
  });
  return p;
}

async function run() {
  await sequelize.authenticate();
  clearDefaultShopCache();
  const shop = await Shop.findOne({ order: [['created_at', 'ASC']] });
  assert(shop, 'shop');
  let gold = await Setting.findOne({ where: { key: 'gold_rate' } });
  if (!gold) {
    await Setting.create({
      id: newId(),
      key: 'gold_rate',
      value: { gold_24k: 7000 },
    });
  }

  console.log('1. Invoice creates outbox event in same TX');
  const p = await makeQty(shop.id, 4);
  const line = calcLineAmounts({
    net_weight: 10, gross_weight: 11, wastage_pct: 0,
    making_charges: 500, making_charge_type: 'fixed', stone_charges: 0,
    purity: '22K', quantity: 1,
  }, 7000);
  const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
  const r = await createInvoice({
    items: [{ product_id: p.id, quantity: 1, purity: '22K' }],
    payments: [{ mode: 'cash', amount: totals.grand_total }],
    gold_rate: 7000,
    request_id: randomUUID(),
  });
  const out = await SyncOutbox.findOne({
    where: { entity_id: r.invoice.id, entity_type: 'invoice' },
  });
  assert(out && out.status === 'pending', 'outbox pending');
  console.log('✓ outbox', out.event_id);

  console.log('2. Cloud push idempotent (duplicate event)');
  const ev = {
    event_id: out.event_id,
    entity_type: 'invoice',
    entity_id: r.invoice.id,
    operation: 'create',
    payload: { invoice: r.invoice.toJSON() },
  };
  const fakeRes = () => {
    let statusCode = 200;
    let body = null;
    return {
      status(c) { statusCode = c; return this; },
      json(b) { body = b; return { statusCode, body }; },
    };
  };
  // Use controller via mock req/res
  let ack1;
  await pushEvents(
    { body: { shop_id: shop.id, schema_version: 4, events: [ev] }, headers: {} },
    {
      status(c) { this._s = c; return this; },
      json(b) { ack1 = b; return b; },
    },
    (e) => { throw e; }
  );
  assert(ack1.acked_event_ids.includes(out.event_id), 'acked once');

  let ack2;
  await pushEvents(
    { body: { shop_id: shop.id, schema_version: 4, events: [ev] }, headers: {} },
    {
      status(c) { this._s = c; return this; },
      json(b) { ack2 = b; return b; },
    },
    (e) => { throw e; }
  );
  assert(ack2.acked_event_ids.includes(out.event_id), 'acked twice idempotent');
  const processed = await SyncProcessedEvent.count({ where: { event_id: out.event_id } });
  assert(processed === 1, 'single processed row');
  console.log('✓ duplicate push safe');

  // cleanup test artifacts (keep invoice if shared env — delete outbox + product)
  await SyncOutbox.destroy({ where: { id: out.id } });
  await SyncProcessedEvent.destroy({ where: { event_id: out.event_id } });
  // leave invoice for billing audit or delete
  await Invoice.destroy({ where: { id: r.invoice.id } });
  await Product.destroy({ where: { id: p.id } });

  console.log('\nALL SYNC TESTS PASSED');
  await sequelize.close();
}

run().catch(async (e) => {
  console.error('FAILED', e);
  try { await sequelize.close(); } catch { /* */ }
  process.exit(1);
});
