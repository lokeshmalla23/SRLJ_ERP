/**
 * Round-trip test for the Customer Backup (profiles only) feature.
 *
 * Safety: run with SQLITE_PATH pointed at a COPY of the database — this test
 * wipes and rewrites the customers table it is pointed at. It also asserts
 * that product / invoice / vendor rows are never touched (customer-only
 * restore), and that a restore never deletes a customer only present here.
 */
import 'dotenv/config';
import { Op } from 'sequelize';
import sequelize from '../src/db.js';
import { Customer, Product, Invoice, Vendor } from '../src/models/index.js';
import {
  buildCustomerBackup,
  restoreCustomerBackup,
  CUSTOMER_BACKUP_FORMAT,
  CUSTOMER_BACKUP_VERSION,
} from '../src/services/customerBackupService.js';

const storage = sequelize.options.storage || sequelize.config.storage;
if (!String(storage).includes('cust_backup_test')) {
  console.error(`REFUSING TO RUN: storage is "${storage}". Point SQLITE_PATH at a disposable copy.`);
  process.exit(2);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

const normalizePan = (v) => (v ? String(v).trim().toUpperCase() : '');
const normalizeAadhaar = (v) => (v ? String(v).replace(/\D/g, '') : '');
const clean = (v) => (v === undefined ? null : v);

async function otherCounts() {
  const [products, invoices, vendors] = await Promise.all([
    Product.count(), Invoice.count(), Vendor.count(),
  ]);
  return { products, invoices, vendors };
}

const stamp = () => new Date().toISOString();
const blank = (over = {}) => ({
  id: `test-cust-${Math.random().toString(36).slice(2)}`,
  name: 'Test Person',
  mobile: '9000000000',
  shop_id: null,
  version: 1,
  deleted_at: null,
  origin_device_id: null,
  serial_no: null,
  email: null, address: null, gst_number: null, pan_number: null, pan_image: null,
  aadhaar_number: null, dob: null, anniversary: null, tag: 'regular', notes: null,
  total_purchases: 0, loyalty_points: 0,
  created_at: stamp(), updated_at: stamp(),
  ...over,
});

async function wipeCustomers() {
  await Customer.destroy({ where: { id: { [Op.ne]: null } } });
}

// Two customers legitimately sharing one mobile number (family members) —
// mobile is explicitly NOT unique in this ERP, so the restore must never
// merge on mobile alone.
const SHARED_MOBILE = '9876501234';

async function seedSharedMobileRows() {
  const shopId = (await Customer.findOne())?.shop_id ?? null;
  await Customer.create(blank({ id: 'seed-shared-a', name: 'Ramesh Sharma', mobile: SHARED_MOBILE, shop_id: shopId }));
  await Customer.create(blank({ id: 'seed-shared-b', name: 'Sunita Sharma', mobile: SHARED_MOBILE, shop_id: shopId }));
}

// ─── Stage 1 — export shape and size ─────────────────────────────────────────
async function stageExport(backup) {
  assert(backup.format === CUSTOMER_BACKUP_FORMAT, `format is ${backup.format}`);
  assert(backup.version === CUSTOMER_BACKUP_VERSION, `version is ${backup.version}`);
  assert(backup.scope === 'customers', `scope is ${backup.scope}`);
  assert(Array.isArray(backup.customers), 'customers is an array');
  assert(backup.customers.length > 0, 'backup captured no customers');
  assert(backup.counts.customers === backup.customers.length, 'counts.customers mismatch');

  const bytes = Buffer.byteLength(JSON.stringify(backup, null, 2));
  const withImages = backup.customers.filter((c) => c.pan_image);
  const imageBytes = withImages.reduce((n, c) => n + Buffer.byteLength(String(c.pan_image)), 0);
  console.log(`   payload ${(bytes / 1024 / 1024).toFixed(2)} MB | `
    + `${backup.customers.length} customers | pan_image on ${withImages.length} `
    + `(${(imageBytes / 1024 / 1024).toFixed(2)} MB)`);
  assert(bytes < 10 * 1024 * 1024, `payload ${(bytes / 1024 / 1024).toFixed(1)} MB exceeds the 10 MB body limit`);

  // The shared-mobile pair must survive export as two distinct rows.
  const shared = backup.customers.filter((c) => c.mobile === SHARED_MOBILE);
  assert(shared.length >= 2, `expected >=2 rows sharing mobile, got ${shared.length}`);
}

// ─── Stage 2 — fresh machine (all created) ───────────────────────────────────
async function stageFreshRestore(backup) {
  await wipeCustomers();
  const summary = await restoreCustomerBackup(backup, { userId: null });
  assert(summary.customers === backup.customers.length, `processed ${summary.customers}/${backup.customers.length}`);
  assert(summary.created === backup.customers.length, `created ${summary.created}, expected ${backup.customers.length}`);
  assert(summary.updated === 0 && summary.skipped === 0, `fresh restore updated ${summary.updated} skipped ${summary.skipped}`);

  const rows = await Customer.findAll();
  assert(rows.length === backup.customers.length, `row count ${rows.length} != ${backup.customers.length}`);

  const byId = new Map(rows.map((r) => [r.id, r.toJSON()]));
  const missing = backup.customers.filter((s) => !byId.has(s.id));
  assert(missing.length === 0,
    `${missing.length}/${backup.customers.length} ids were not preserved (first: ${missing[0]?.id})`);

  let checked = 0;
  for (const src of backup.customers) {
    const got = byId.get(src.id);
    if (checked++ % 7 !== 0) continue;
    assert(got.name === src.name, `name mismatch for ${src.id}`);
    assert(got.mobile === src.mobile, `mobile mismatch for ${src.id}`);
    assert(clean(got.email) === clean(src.email), `email mismatch for ${src.id}`);
    assert(normalizePan(got.pan_number) === normalizePan(src.pan_number), `pan mismatch for ${src.id}`);
    assert(normalizeAadhaar(got.aadhaar_number) === normalizeAadhaar(src.aadhaar_number), `aadhaar mismatch for ${src.id}`);
    assert(clean(got.tag) === clean(src.tag) || (got.tag === 'regular' && !src.tag), `tag mismatch for ${src.id}`);
    assert(clean(got.notes) === clean(src.notes), `notes mismatch for ${src.id}`);
    assert(Number(got.loyalty_points) === Number(src.loyalty_points ?? 0), `loyalty mismatch for ${src.id}`);
    assert(Number(got.total_purchases) === Number(src.total_purchases ?? 0), `purchases mismatch for ${src.id}`);
    assert(clean(got.shop_id) === clean(src.shop_id) || src.shop_id == null, `shop mismatch for ${src.id}`);
    if (src.created_at) {
      assert(new Date(got.created_at).getTime() === new Date(src.created_at).getTime(),
        `created_at not preserved for ${src.id}`);
    }
  }

  // serial_no ("CUST-001") must be preserved and never duplicated within a shop.
  const serialKeys = rows.filter((r) => r.serial_no != null).map((r) => `${r.shop_id}|${r.serial_no}`);
  assert(new Set(serialKeys).size === serialKeys.length, 'duplicate serial_no within a shop');
  const snapSerials = new Map(backup.customers.filter((c) => c.serial_no != null).map((c) => [c.id, c.serial_no]));
  let preserved = 0;
  for (const r of rows) if (snapSerials.has(r.id) && snapSerials.get(r.id) === r.serial_no) preserved += 1;
  // Every source number must survive: rows WITHOUT a serial number are not
  // allowed to take low numbers away from rows that have one (the export
  // sorts serial_no ASC, so those null-serial rows arrive first).
  assert(preserved === snapSerials.size,
    `only ${preserved}/${snapSerials.size} serial numbers preserved`);
  const nullSerials = backup.customers.filter((c) => c.serial_no == null);
  for (const s of nullSerials) {
    const got = byId.get(s.id);
    if (!got) continue;
    assert(Number(got.serial_no) > Math.max(0, ...snapSerials.values()),
      `null-serial row ${s.id} took number ${got.serial_no} from a source-coded row`);
  }

  // The shared-mobile rows must still be two rows.
  const shared = rows.filter((r) => r.mobile === SHARED_MOBILE);
  assert(shared.length >= 2, `shared mobile collapsed to ${shared.length} row(s)`);
  assert(shared.some((r) => r.name === 'Ramesh Sharma') && shared.some((r) => r.name === 'Sunita Sharma'),
    'shared-mobile customers were merged');

  return { summary, rows };
}

// ─── Stage 3 — restore again (idempotent) ────────────────────────────────────
async function stageIdempotent(backup) {
  const countBefore = await Customer.count();
  const summary = await restoreCustomerBackup(backup, { userId: null });
  assert(summary.created === 0, `re-restore created ${summary.created} duplicate customer(s)`);
  assert(summary.skipped === 0, `re-restore skipped ${summary.skipped} row(s)`);
  assert(summary.updated === backup.customers.length,
    `re-restore updated ${summary.updated}/${backup.customers.length}`);
  assert(await Customer.count() === countBefore, 'row count changed on re-restore');
  return summary;
}

// ─── Stage 4 — merge: never delete, file wins for matches ────────────────────
async function stageMerge(backup) {
  const before = await Customer.count();
  // A customer that exists ONLY on this machine must survive a restore.
  const localOnly = await Customer.create(blank({
    id: 'local-only-customer',
    name: 'Local Only',
    mobile: '9111111111',
    serial_no: null,
  }));
  // And a locally-edited field on a matched customer must be overwritten by the file.
  const victimId = backup.customers[0].id;
  await Customer.update({ notes: 'LOCAL EDIT SHOULD BE OVERWRITTEN' }, { where: { id: victimId } });

  const summary = await restoreCustomerBackup(backup, { userId: null });
  assert(summary.created === 0, `merge created ${summary.created} unexpected customer(s)`);

  const survivors = await Customer.findByPk(localOnly.id);
  assert(survivors, 'customer present only on this machine was deleted');
  assert(survivors.name === 'Local Only', 'local-only customer was modified');

  const restored = await Customer.findByPk(victimId);
  assert(restored, 'matched customer disappeared during merge');
  assert(restored.notes !== 'LOCAL EDIT SHOULD BE OVERWRITTEN',
    'file did not win for a matched customer');

  assert(await Customer.count() === before + 1, `expected ${before + 1} rows after merge`);
}

// ─── Stage 5 — natural key (mobile + name), not mobile alone ─────────────────
async function stageNaturalKey(backup) {
  // Simulate a customer that arrived under a brand-new id but is really the
  // same person: only (mobile + name) can identify it.
  const src = JSON.parse(JSON.stringify(backup.customers[0]));
  src.id = `fresh-uuid-${Math.random().toString(36).slice(2)}`;
  const summary = await restoreCustomerBackup(
    { format: CUSTOMER_BACKUP_FORMAT, version: CUSTOMER_BACKUP_VERSION, scope: 'customers', customers: [src] },
    { userId: null },
  );
  assert(summary.created === 0, `natural-key lookup created a duplicate (${summary.created})`);
  assert(summary.updated === 1, `natural-key lookup updated ${summary.updated}, expected 1`);

  // ...but a DIFFERENT person sharing only the mobile must NOT be matched.
  const other = await Customer.create(blank({
    id: 'mobile-only-impostor',
    name: 'Someone Else Entirely',
    mobile: src.mobile,
    shop_id: src.shop_id,
    serial_no: null,
  }));
  const before = await Customer.count();
  const again = await restoreCustomerBackup(
    { format: CUSTOMER_BACKUP_FORMAT, version: CUSTOMER_BACKUP_VERSION, scope: 'customers', customers: [src] },
    { userId: null },
  );
  assert(again.created === 0, 'restored created a row despite an existing match');
  const impostor = await Customer.findByPk(other.id);
  assert(impostor, 'a customer sharing only the mobile was consumed/merged by the restore');
  assert(impostor.name === 'Someone Else Entirely', 'a customer sharing only the mobile was renamed');
  assert(await Customer.count() === before, 'row count changed');
}

// ─── Stage 6 — PAN / Aadhaar invariants: skip, never create a duplicate ──────
async function stageConflictSkip(backup) {
  const shopId = backup.customers.find((c) => c.shop_id)?.shop_id ?? null;
  const TARGET_PAN = 'ABCPX1234Q';
  const TARGET_AADHAAR = '456712349012';

  await wipeCustomers();
  await Customer.create(blank({
    id: 'pan-holder', name: 'Pan Holder', mobile: '9222222222', shop_id: shopId,
    pan_number: TARGET_PAN, aadhaar_number: TARGET_AADHAAR, serial_no: null,
  }));

  const file = {
    format: CUSTOMER_BACKUP_FORMAT,
    version: CUSTOMER_BACKUP_VERSION,
    scope: 'customers',
    customers: [
      blank({ id: 'src-pan-clash', name: 'Pan Clasher', mobile: '9333333333', shop_id: shopId, pan_number: 'abcpx1234q' }),
      blank({ id: 'src-aadhaar-clash', name: 'Aadhaar Clasher', mobile: '9444444444', shop_id: shopId, aadhaar_number: '4567-1234-9012' }),
      blank({ id: 'src-clean', name: 'Clean Row', mobile: '9555555555', shop_id: shopId }),
    ],
  };

  const summary = await restoreCustomerBackup(file, { userId: null });
  assert(summary.created === 1, `created ${summary.created}, expected only the clean row`);
  assert(summary.skipped === 2, `skipped ${summary.skipped}, expected 2`);
  assert(summary.skip_reasons['duplicate PAN'] === 1, `PAN reason ${JSON.stringify(summary.skip_reasons)}`);
  assert(summary.skip_reasons['duplicate Aadhaar'] === 1, `Aadhaar reason ${JSON.stringify(summary.skip_reasons)}`);

  assert(await Customer.count({ where: { pan_number: TARGET_PAN } }) === 1, 'duplicate PAN was created');
  assert(await Customer.count({ where: { aadhaar_number: TARGET_AADHAAR } }) === 1, 'duplicate Aadhaar was created');
  assert(await Customer.findByPk('pan-holder'), 'the existing PAN holder was modified or deleted');
}

// ─── Stage 7 — validation rejects a non-customer file ────────────────────────
async function stageValidation() {
  for (const bad of [
    null,
    'not an object',
    { format: 'slgt-jewel-erp/inventory-backup', version: 1 },
    { format: CUSTOMER_BACKUP_FORMAT, version: CUSTOMER_BACKUP_VERSION + 99 },
  ]) {
    let threw = null;
    try { await restoreCustomerBackup(bad, { userId: null }); } catch (e) { threw = e; }
    assert(threw, `invalid payload accepted: ${JSON.stringify(bad)?.slice(0, 60)}`);
    assert(threw.code === 'CUSTOMER_BACKUP_INVALID', `wrong code ${threw.code}`);
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────
async function main() {
  const othersBefore = await otherCounts();

  await seedSharedMobileRows();
  const backup = await buildCustomerBackup();

  console.log(`[1/7] export shape + size`);
  await stageExport(backup);

  console.log(`[2/7] fresh-machine restore`);
  const { summary: fresh } = await stageFreshRestore(backup);
  console.log(`       created ${fresh.created} · updated ${fresh.updated} · skipped ${fresh.skipped}`);

  console.log(`[3/7] idempotent re-restore`);
  const again = await stageIdempotent(backup);
  console.log(`       created ${again.created} · updated ${again.updated} · skipped ${again.skipped}`);

  console.log(`[4/7] merge — never delete, file wins`);
  await stageMerge(backup);

  console.log(`[5/7] natural key (mobile + name, not mobile alone)`);
  await stageNaturalKey(backup);

  console.log(`[6/7] PAN / Aadhaar invariants preserved`);
  await stageConflictSkip(backup);

  console.log(`[7/7] invalid payloads rejected`);
  await stageValidation();

  // Restore the rows the earlier stages wiped, so the copy is left sane, then
  // prove nothing outside `customers` moved.
  const finalState = await restoreCustomerBackup(backup, { userId: null });
  assert(finalState.skipped === 0, `final restore skipped ${finalState.skipped}`);
  const othersAfter = await otherCounts();
  assert(JSON.stringify(othersBefore) === JSON.stringify(othersAfter),
    `non-customer tables changed: ${JSON.stringify(othersBefore)} -> ${JSON.stringify(othersAfter)}`);

  console.log('ALL CUSTOMER BACKUP TESTS PASSED');
}

main()
  .then(() => sequelize.close())
  .then(() => { console.log('TEST_EXIT=0'); process.exit(0); })
  .catch(async (err) => {
    console.error(`\nCUSTOMER BACKUP TEST FAILED: ${err.message}`);
    try { await sequelize.close(); } catch { /* ignore */ }
    console.error('TEST_EXIT=1');
    process.exit(1);
  });
