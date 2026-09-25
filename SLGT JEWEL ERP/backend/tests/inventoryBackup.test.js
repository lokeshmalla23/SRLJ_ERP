/**
 * Round-trip test for the Inventory Backup (stock + catalog) feature.
 *
 * Safety: run with SQLITE_PATH pointed at a COPY of the database — this test
 * wipes and rewrites the inventory tables it is pointed at. It also asserts
 * that Customer/Invoice rows are never touched (inventory-only restore).
 */
import 'dotenv/config';
import { Op } from 'sequelize';
import sequelize from '../src/db.js';
import {
  Product, Category, CatalogItem, Attribute, ShopCounter,
  InventoryMovement, Customer, Invoice,
} from '../src/models/index.js';
import {
  buildInventoryBackup,
  restoreInventoryBackup,
} from '../src/services/inventoryBackupService.js';

const storage = sequelize.options.storage || sequelize.config.storage;
if (!String(storage).includes('inv_backup_test')) {
  console.error(`REFUSING TO RUN: storage is "${storage}". Point SQLITE_PATH at a disposable copy.`);
  process.exit(2);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

const INVENTORY_TABLES = [InventoryMovement, Product, Category, CatalogItem, Attribute, ShopCounter];

async function wipe(models) {
  for (const m of models) await m.destroy({ where: { id: { [Op.ne]: null } } });
}

async function counts() {
  const [products, categories, catalog, attrs, counters, movements] = await Promise.all([
    Product.count(), Category.count(), CatalogItem.count(),
    Attribute.count(), ShopCounter.count(), InventoryMovement.count(),
  ]);
  return { products, categories, catalog_items: catalog, attributes: attrs, shop_counters: counters, inventory_movements: movements };
}

async function categoryName(id) {
  if (!id) return null;
  const c = await Category.findByPk(id);
  return c ? c.name : null;
}

async function catalogName(id) {
  if (!id) return null;
  const c = await CatalogItem.findByPk(id);
  return c ? c.name : null;
}

async function run() {
  console.log(`DB under test: ${storage}`);

  const customersBefore = await Customer.count();
  const invoicesBefore = await Invoice.count();

  // ── 1. Export ─────────────────────────────────────────────────────────────
  console.log('\n1. Export inventory backup');
  const backup = await buildInventoryBackup();
  assert(backup.format === 'slgt-jewel-erp/inventory-backup', 'format marker');
  assert(backup.version === 1, 'version');
  const live = await counts();
  assert(backup.counts.products === live.products, `counts.products ${backup.counts.products} vs ${live.products}`);
  assert(backup.counts.categories === live.categories, 'counts.categories');
  assert(backup.counts.catalog_items === live.catalog_items, 'counts.catalog_items');
  assert(backup.counts.inventory_movements === live.inventory_movements, 'counts.inventory_movements');

  const bytes = Buffer.byteLength(JSON.stringify(backup));
  console.log(`   ${JSON.stringify(backup.counts)}`);
  console.log(`   payload size: ${(bytes / 1024 / 1024).toFixed(2)} MB (express body limit is 10 MB)`);
  assert(bytes < 9.5 * 1024 * 1024, 'payload must fit under the 10 MB body limit');

  // ── 2. Pick a sample product with catalog links + movement history ───────
  console.log('\n2. Capture sample product');
  const sample = await Product.findOne({
    where: { category_id: { [Op.ne]: null } },
    order: [['created_at', 'ASC']],
  });
  assert(sample, 'expected at least one product with a category');
  const sampleMoves = await InventoryMovement.findAll({
    where: { product_id: sample.id },
    order: [['created_at', 'ASC']],
  });
  const before = {
    barcode: sample.barcode,
    name: sample.name,
    stock_qty: sample.stock_qty,
    gross_weight: sample.gross_weight,
    inventory_mode: sample.inventory_mode,
    category: await categoryName(sample.category_id),
    subcategory: await categoryName(sample.subcategory_id),
    metal: await catalogName(sample.metal_type_id),
    purity: await catalogName(sample.purity_id),
    unit: await catalogName(sample.unit_id),
    collection_ids: JSON.stringify(sample.collection_ids || []),
    tag_ids: JSON.stringify(sample.tag_ids || []),
    attribute_values: JSON.stringify(sample.attribute_values || {}),
    moves: sampleMoves.length,
    firstMoveAt: sampleMoves[0] ? new Date(sampleMoves[0].created_at).toISOString() : null,
    firstMoveType: sampleMoves[0]?.movement_type ?? null,
  };
  console.log(`   ${before.name} | stock ${before.stock_qty} | cat=${before.category} metal=${before.metal} purity=${before.purity} | ${before.moves} movements`);

  // ── 3. Simulate catastrophic inventory loss ───────────────────────────────
  console.log('\n3. Wipe ALL inventory tables (simulated data loss)');
  await wipe(INVENTORY_TABLES);
  assert((await counts()).products === 0, 'products wiped');
  assert((await counts()).categories === 0, 'categories wiped');
  assert((await counts()).inventory_movements === 0, 'movements wiped');

  // ── 4. Restore ────────────────────────────────────────────────────────────
  console.log('\n4. Restore from backup file');
  const summary = await restoreInventoryBackup(backup);
  console.log(`   ${JSON.stringify(summary)}`);
  const after = await counts();
  for (const k of Object.keys(live)) {
    assert(after[k] === live[k], `${k}: restored ${after[k]} vs original ${live[k]}`);
  }

  const restored = await Product.findOne({ where: { barcode: before.barcode } });
  assert(restored, 'sample product restored');
  assert(restored.name === before.name, `name ${restored.name} vs ${before.name}`);
  assert(Number(restored.stock_qty) === Number(before.stock_qty), `stock_qty ${restored.stock_qty} vs ${before.stock_qty}`);
  assert(Number(restored.gross_weight) === Number(before.gross_weight), 'gross_weight preserved');
  assert(restored.inventory_mode === before.inventory_mode, 'inventory_mode preserved');
  assert(JSON.stringify(restored.attribute_values || {}) === before.attribute_values, 'attribute_values preserved');
  assert(JSON.stringify(restored.collection_ids || []) === before.collection_ids, 'collection_ids preserved');
  assert(JSON.stringify(restored.tag_ids || []) === before.tag_ids, 'tag_ids preserved');

  assert((await categoryName(restored.category_id)) === before.category, `category name ${await categoryName(restored.category_id)} vs ${before.category}`);
  if (before.subcategory) assert((await categoryName(restored.subcategory_id)) === before.subcategory, 'subcategory name');
  if (before.metal) assert((await catalogName(restored.metal_type_id)) === before.metal, 'metal name');
  if (before.purity) assert((await catalogName(restored.purity_id)) === before.purity, 'purity name');
  if (before.unit) assert((await catalogName(restored.unit_id)) === before.unit, 'unit name');

  const restoredMoves = await InventoryMovement.findAll({
    where: { product_id: restored.id },
    order: [['created_at', 'ASC']],
  });
  assert(restoredMoves.length === before.moves, `movements ${restoredMoves.length} vs ${before.moves}`);
  if (before.firstMoveAt) {
    const at = new Date(restoredMoves[0].created_at).toISOString();
    assert(at === before.firstMoveAt, `movement created_at ${at} vs ${before.firstMoveAt}`);
    assert(restoredMoves[0].movement_type === before.firstMoveType, 'movement type preserved');
  }

  // Inventory-only guarantee
  assert((await Customer.count()) === customersBefore, 'customers untouched');
  assert((await Invoice.count()) === invoicesBefore, 'invoices untouched');
  console.log('   customers + invoices untouched ✔  names/stock/links/movements ✔');

  // ── 5. Idempotency: restoring the same file twice must not duplicate ─────
  console.log('\n5. Restore the same file again (idempotency)');
  const summary2 = await restoreInventoryBackup(backup);
  const after2 = await counts();
  for (const k of Object.keys(live)) {
    assert(after2[k] === live[k], `idempotency — ${k}: ${after2[k]} vs original ${live[k]}`);
  }
  console.log(`   ${JSON.stringify(after2)} — no duplication ✔  (replaced ${summary2.movements_replaced} movement rows)`);

  // ── 6. ID remapping: category already exists under a DIFFERENT id ────────
  console.log('\n6. Restore when the category exists under a new id (remap path)');
  const stale = await Product.findOne({ where: { barcode: before.barcode } });
  const staleCatId = stale.category_id;
  await Category.destroy({ where: { id: staleCatId } });
  const movedCat = await Category.create({
    id: `test-remap-${Date.now()}`,
    shop_id: stale.shop_id,
    name: before.category,
    parent_id: null,
  });
  assert(movedCat.id !== staleCatId, 'replacement category has a different id');
  await restoreInventoryBackup(backup);
  const remapped = await Product.findOne({ where: { barcode: before.barcode } });
  assert(remapped.category_id === movedCat.id,
    `category_id should remap to the existing row (${movedCat.id}), got ${remapped.category_id}`);
  assert((await categoryName(remapped.category_id)) === before.category, 'remapped category name resolves');
  console.log(`   category_id remapped ${staleCatId} → ${movedCat.id} ✔`);

  // ── 7. Rejects foreign / newer files ─────────────────────────────────────
  console.log('\n7. Audit event + rejection of foreign / newer files');
  const { EventLog, ClusterState } = await import('../src/models/index.js');
  const cluster = await ClusterState.findOne();
  const logged = await EventLog.count({ where: { event_type: 'INVENTORY_BACKUP_RESTORED' } });
  if (cluster) {
    assert(logged > 0, 'expected an INVENTORY_BACKUP_RESTORED audit event when cluster state exists');
    console.log(`   audit events written: ${logged} ✔`);
  } else {
    console.log(`   no cluster state — event log skipped (events: ${logged})`);
  }

  for (const bad of [
    { format: 'something-else', version: 1 },
    { format: 'slgt-jewel-erp/inventory-backup', version: 999 },
    null,
    [],
  ]) {
    let code = null;
    try {
      await restoreInventoryBackup(bad);
    } catch (err) {
      code = err.code;
    }
    assert(code === 'INVENTORY_BACKUP_INVALID', `expected INVENTORY_BACKUP_INVALID, got ${code}`);
  }
  console.log('   all invalid inputs rejected with a 400-mapped code ✔');

  assert((await Customer.count()) === customersBefore, 'customers untouched (final)');
  assert((await Invoice.count()) === invoicesBefore, 'invoices untouched (final)');

  console.log('\nALL INVENTORY BACKUP TESTS PASSED');
  await sequelize.close();
}

run().then(() => process.exit(0)).catch(async (err) => {
  console.error('\nFAILED:', err);
  try { await sequelize.close(); } catch { /* ignore */ }
  process.exit(1);
});
