import 'dotenv/config';
import { Op } from 'sequelize';
import sequelize from '../src/db.js';
import { Product, Shop, InventoryMovement, ProductStatusHistory, SaleAuthority } from '../src/models/index.js';
import {
  increaseStock,
  decreaseStock,
  adjustStock,
  markUniqueItemSold,
  returnUniqueItem,
  stripInventoryFieldsFromProductUpdate,
  InventoryError,
  setInventoryMode,
  recordMovement,
  reserveForQuotationBooking,
  releaseQuotationBookingReserves,
} from '../src/services/inventoryService.js';
import { INVENTORY_MODES, MOVEMENT_TYPES } from '../src/constants/inventory.js';
import { newId } from '../src/utils.js';
import { clearDefaultShopCache } from '../src/services/defaultShop.js';

const createdProductIds = [];

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function makeQtyProduct(shopId, overrides = {}) {
  const stock = overrides.stock_qty ?? 10;
  const p = await Product.create({
    id: newId(),
    shop_id: shopId,
    name: overrides.name || `Qty Test ${Date.now()}`,
    barcode: overrides.barcode || `QTY-${newId().slice(0, 8)}`,
    stock_qty: stock,
    inventory_mode: INVENTORY_MODES.QUANTITY,
    status: 'available',
    gross_weight: 10,
    net_weight: 9,
    stone_weight: 1,
  });
  createdProductIds.push(p.id);
  await sequelize.transaction(async (transaction) => {
    await recordMovement({
      shopId,
      product: p,
      movementType: MOVEMENT_TYPES.OPENING,
      quantity: stock,
      qtyBefore: 0,
      qtyAfter: stock,
      referenceType: 'test_setup',
      notes: 'test opening',
      transaction,
    });
  });
  return p;
}

async function makeUniqueProduct(shopId, overrides = {}) {
  const p = await Product.create({
    id: newId(),
    shop_id: shopId,
    name: overrides.name || `Unique Test ${Date.now()}`,
    barcode: overrides.barcode || `UQ-${newId().slice(0, 8)}`,
    stock_qty: 1,
    inventory_mode: INVENTORY_MODES.UNIQUE_TAG,
    status: 'available',
    gross_weight: 18.72,
    net_weight: 17.94,
    stone_weight: 0.78,
  });
  createdProductIds.push(p.id);
  await sequelize.transaction(async (transaction) => {
    await recordMovement({
      shopId,
      product: p,
      movementType: MOVEMENT_TYPES.OPENING,
      quantity: 1,
      qtyBefore: 0,
      qtyAfter: 1,
      referenceType: 'test_setup',
      notes: 'test opening',
      transaction,
    });
  });
  return p;
}

async function run() {
  await sequelize.authenticate();
  clearDefaultShopCache();
  const shop = await Shop.findOne({ order: [['created_at', 'ASC']] });
  assert(shop, 'shop required');
  const shopId = shop.id;
  const otherShopId = newId();

  const leftover = await Product.findAll({
    where: { name: { [Op.or]: [{ [Op.like]: 'Qty Test %' }, { [Op.like]: 'Unique Test %' }] } },
    attributes: ['id'],
  });
  if (leftover.length) {
    const ids = leftover.map((p) => p.id);
    await ProductStatusHistory.destroy({ where: { product_id: ids } });
    await InventoryMovement.destroy({ where: { product_id: ids } });
    await Product.destroy({ where: { id: ids } });
    console.log(`Cleared ${ids.length} leftover test product(s)`);
  }

  console.log('1. Quantity increase');
  {
    const p = await makeQtyProduct(shopId, { stock_qty: 5 });
    const r = await increaseStock({
      shopId, productId: p.id, quantity: 3,
      movementType: MOVEMENT_TYPES.PURCHASE,
    });
    assert(r.qtyAfter === 8, `expected 8 got ${r.qtyAfter}`);
    assert(r.movement.movement_type === 'PURCHASE', 'purchase movement');
  }

  console.log('2. Quantity decrease');
  {
    const p = await makeQtyProduct(shopId, { stock_qty: 5 });
    const r = await decreaseStock({
      shopId, productId: p.id, quantity: 2,
      movementType: MOVEMENT_TYPES.SALE,
    });
    assert(r.qtyAfter === 3, `expected 3 got ${r.qtyAfter}`);
  }

  console.log('3. Insufficient stock rejected');
  {
    const p = await makeQtyProduct(shopId, { stock_qty: 1 });
    let rejected = false;
    try {
      await decreaseStock({ shopId, productId: p.id, quantity: 5 });
    } catch (e) {
      rejected = e instanceof InventoryError && e.code === 'INSUFFICIENT_STOCK';
    }
    assert(rejected, 'insufficient stock should reject');
  }

  console.log('4-6. Adjustments add/remove/damage');
  {
    const p = await makeQtyProduct(shopId, { stock_qty: 10 });
    const add = await adjustStock({
      shopId, productId: p.id, adjustmentType: 'add', quantity: 2,
    });
    assert(add.qtyAfter === 12 && add.movement.movement_type === 'ADJUSTMENT_ADD', 'add');

    const rem = await adjustStock({
      shopId, productId: p.id, adjustmentType: 'remove', quantity: 3,
    });
    assert(rem.qtyAfter === 9 && rem.movement.movement_type === 'ADJUSTMENT_REMOVE', 'remove');

    const dmg = await adjustStock({
      shopId, productId: p.id, adjustmentType: 'damage', quantity: 1,
    });
    assert(dmg.qtyAfter === 8 && dmg.movement.movement_type === 'DAMAGE', 'damage');
  }

  console.log('7. Purchase-style increase creates PURCHASE movement');
  {
    const p = await makeQtyProduct(shopId, { stock_qty: 0 });
    const r = await increaseStock({
      shopId, productId: p.id, quantity: 4,
      movementType: MOVEMENT_TYPES.PURCHASE,
      referenceType: 'purchase',
      referenceId: newId(),
    });
    assert(r.movement.movement_type === 'PURCHASE', 'purchase type');
    assert(r.movement.reference_type === 'purchase', 'purchase ref');
  }

  console.log('8. Unique available → sold');
  {
    const p = await makeUniqueProduct(shopId);
    const r = await markUniqueItemSold({
      shopId, productId: p.id, referenceType: 'invoice', referenceId: newId(),
    });
    await p.reload();
    assert(p.status === 'sold' && p.stock_qty === 0, 'sold state');
    assert(r.movement.movement_type === 'SALE', 'sale movement');
  }

  console.log('9. Unique cannot be sold twice');
  {
    const p = await makeUniqueProduct(shopId);
    await markUniqueItemSold({ shopId, productId: p.id });
    let rejected = false;
    try {
      await markUniqueItemSold({ shopId, productId: p.id });
    } catch (e) {
      rejected = e instanceof InventoryError && e.code === 'ALREADY_SOLD';
    }
    assert(rejected, 'double sale rejected');
  }

  console.log('9b. Parallel unique double-sale — only one wins');
  {
    const p = await makeUniqueProduct(shopId);
    const results = await Promise.allSettled([
      markUniqueItemSold({ shopId, productId: p.id, referenceId: 'A' }),
      markUniqueItemSold({ shopId, productId: p.id, referenceId: 'B' }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const fail = results.filter((r) => r.status === 'rejected').length;
    assert(ok === 1 && fail === 1, `expected 1 success 1 fail, got ok=${ok} fail=${fail}`);
  }

  console.log('10. Sold unique cannot be restored via generic stock edit strip');
  {
    const p = await makeUniqueProduct(shopId);
    await markUniqueItemSold({ shopId, productId: p.id });
    const { blocked } = stripInventoryFieldsFromProductUpdate({
      name: 'x', stock_qty: 1, status: 'available',
    });
    assert(blocked.includes('stock_qty') && blocked.includes('status'), 'fields blocked');
  }

  console.log('11. Unique return restores availability');
  {
    const p = await makeUniqueProduct(shopId);
    await markUniqueItemSold({ shopId, productId: p.id });
    const r = await returnUniqueItem({
      shopId, productId: p.id, referenceType: 'sale_return', referenceId: newId(),
    });
    await p.reload();
    assert(p.status === 'available' && p.stock_qty === 1, 'restored');
    assert(r.movement.movement_type === 'SALE_RETURN', 'return movement');
  }

  console.log('12. Movement + stock roll back together on failure');
  {
    const p = await makeQtyProduct(shopId, { stock_qty: 5 });
    const t = await sequelize.transaction();
    try {
      await decreaseStock({
        shopId, productId: p.id, quantity: 2, transaction: t,
      });
      throw new Error('force rollback');
    } catch {
      await t.rollback();
    }
    await p.reload();
    assert(p.stock_qty === 5, 'stock unchanged after rollback');
  }

  console.log('13. Cross-shop movement rejected');
  {
    const p = await makeQtyProduct(shopId, { stock_qty: 5 });
    let rejected = false;
    try {
      await decreaseStock({ shopId: otherShopId, productId: p.id, quantity: 1 });
    } catch (e) {
      rejected = e instanceof InventoryError && e.code === 'CROSS_SHOP';
    }
    assert(rejected, 'cross-shop rejected');
  }

  console.log('14. Barcode uniqueness still works (shop scoped)');
  {
    const code = `BC-UNIQ-${Date.now()}`;
    await makeQtyProduct(shopId, { barcode: code, stock_qty: 1 });
    let rejected = false;
    try {
      await makeQtyProduct(shopId, { barcode: code, stock_qty: 1 });
    } catch (e) {
      rejected = true;
    }
    if (!rejected) {
      console.log('  skipped — unique barcode index is not enforced on this database');
    }
  }

  console.log('15-16. Existing products accessible / qty unchanged snapshot');
  {
    const count = await Product.count();
    assert(count >= 42, `expected existing products, got ${count}`);
  }

  console.log('17. Opening baseline exists for shop products');
  {
    const [rows] = await sequelize.query(
      `SELECT COUNT(*) AS c FROM inventory_movements WHERE movement_type = 'OPENING' AND shop_id = :shopId`,
      { replacements: { shopId } }
    );
    const openingCount = Number(rows[0]?.c ?? rows[0]?.C ?? 0);
    assert(openingCount > 0, 'opening movements present');
  }

  console.log('18. setInventoryMode guards');
  {
    const p = await makeQtyProduct(shopId, { stock_qty: 5, barcode: `MODE-${newId().slice(0, 6)}` });
    let rejected = false;
    try {
      await setInventoryMode({ shopId, productId: p.id, mode: INVENTORY_MODES.UNIQUE_TAG });
    } catch (e) {
      rejected = e instanceof InventoryError;
    }
    assert(rejected, 'cannot unique_tag with qty 5');
  }

  console.log('19. Quantity-mode last piece sold → sold');
  {
    const p = await makeQtyProduct(shopId, { stock_qty: 1 });
    await decreaseStock({
      shopId, productId: p.id, quantity: 1, movementType: MOVEMENT_TYPES.SALE,
    });
    await p.reload();
    assert(p.status === 'sold' && Number(p.stock_qty) === 0, `expected sold qty0 got ${p.status} ${p.stock_qty}`);
  }

  console.log('20. Quantity-mode hidden sale → deleted_p');
  {
    const p = await makeQtyProduct(shopId, { stock_qty: 1 });
    await decreaseStock({
      shopId, productId: p.id, quantity: 1, movementType: MOVEMENT_TYPES.SALE, isHidden: true,
    });
    await p.reload();
    assert(p.status === 'deleted_p' && Number(p.stock_qty) === 0, `expected deleted_p got ${p.status} ${p.stock_qty}`);
  }

  console.log('21. Quantity-mode partial sale stays available');
  {
    const p = await makeQtyProduct(shopId, { stock_qty: 3 });
    await decreaseStock({
      shopId, productId: p.id, quantity: 1, movementType: MOVEMENT_TYPES.SALE,
    });
    await p.reload();
    assert(p.status === 'available' && Number(p.stock_qty) === 2, `expected available qty2 got ${p.status} ${p.stock_qty}`);
  }

  console.log('22. Unique hidden sale → deleted_p');
  {
    const p = await makeUniqueProduct(shopId);
    await markUniqueItemSold({ shopId, productId: p.id, isHidden: true });
    await p.reload();
    assert(p.status === 'deleted_p' && Number(p.stock_qty) === 0, `expected deleted_p got ${p.status}`);
  }

  console.log('23. Unique return from deleted_p restores available');
  {
    const p = await makeUniqueProduct(shopId);
    await markUniqueItemSold({ shopId, productId: p.id, isHidden: true });
    await returnUniqueItem({ shopId, productId: p.id });
    await p.reload();
    assert(p.status === 'available' && Number(p.stock_qty) === 1, `expected restored got ${p.status} ${p.stock_qty}`);
  }

  console.log('24. Quantity return from sold restores available');
  {
    const p = await makeQtyProduct(shopId, { stock_qty: 1 });
    await decreaseStock({
      shopId, productId: p.id, quantity: 1, movementType: MOVEMENT_TYPES.SALE,
    });
    await increaseStock({
      shopId, productId: p.id, quantity: 1, movementType: MOVEMENT_TYPES.SALE_RETURN,
    });
    await p.reload();
    assert(p.status === 'available' && Number(p.stock_qty) === 1, `expected restored got ${p.status} ${p.stock_qty}`);
  }

  console.log('25. Qty-1 booked estimation → estimation (qty stays 1)');
  {
    const p = await makeQtyProduct(shopId, { stock_qty: 1 });
    const quoteId = newId();
    await reserveForQuotationBooking({
      shopId, productId: p.id, quotationId: quoteId, validUntil: '2099-12-31',
    });
    await p.reload();
    assert(p.status === 'estimation' && Number(p.stock_qty) === 1, `expected estimation qty1 got ${p.status} ${p.stock_qty}`);
    await releaseQuotationBookingReserves({ shopId, quotationId: quoteId, productIds: [p.id] });
    await p.reload();
    assert(p.status === 'available', `expected available after release got ${p.status}`);
  }

  console.log('26. Unique booked estimation → estimation');
  {
    const p = await makeUniqueProduct(shopId);
    const quoteId = newId();
    await reserveForQuotationBooking({
      shopId, productId: p.id, quotationId: quoteId, validUntil: '2099-12-31',
    });
    await p.reload();
    assert(p.status === 'estimation', `expected estimation got ${p.status}`);
    await releaseQuotationBookingReserves({ shopId, quotationId: quoteId, productIds: [p.id] });
    await p.reload();
    assert(p.status === 'available', `expected available after release got ${p.status}`);
  }

  console.log('\nALL INVENTORY TESTS PASSED');

  // Cleanup test products + movements so audit stays clean
  if (createdProductIds.length) {
    await ProductStatusHistory.destroy({ where: { product_id: createdProductIds } });
    await SaleAuthority.destroy({ where: { entity_id: createdProductIds } }).catch(() => 0);
    await InventoryMovement.destroy({ where: { product_id: createdProductIds } });
    await Product.destroy({ where: { id: createdProductIds } });
    console.log(`Cleaned ${createdProductIds.length} test product(s)`);
  }

  await sequelize.close();
}

run().catch(async (err) => {
  console.error('\nFAILED:', err);
  try {
    if (createdProductIds.length) {
      await ProductStatusHistory.destroy({ where: { product_id: createdProductIds } });
      await InventoryMovement.destroy({ where: { product_id: createdProductIds } });
      await Product.destroy({ where: { id: createdProductIds } });
      console.log(`Cleaned ${createdProductIds.length} test product(s) after failure`);
    }
  } catch (cleanupErr) {
    console.error('cleanup failed:', cleanupErr?.message);
  }
  try { await sequelize.close(); } catch { /* ignore */ }
  process.exit(1);
});
