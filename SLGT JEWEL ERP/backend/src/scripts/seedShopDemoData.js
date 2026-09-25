/**
 * Production-like demo data → local SQLite (not in-memory, not cloud).
 *
 * Writes into the desktop shop database so you can walk Dashboard, POS,
 * Inventory, Catalog, Customers, Estimations, Orders, Gold Schemes, Reports.
 *
 *   cd crm/backend
 *   node src/scripts/seedShopDemoData.js
 *   node src/scripts/seedShopDemoData.js --force   # replace previous demo rows
 *
 * Quit the ERP completely (tray too) before running if SQLite is locked.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveSqlitePath() {
  if (process.env.SQLITE_PATH && fs.existsSync(process.env.SQLITE_PATH)) {
    return process.env.SQLITE_PATH;
  }
  const appdata = process.env.APPDATA || '';
  const candidates = [
    path.join(appdata, 'jewellery-crm-desktop', 'data', 'jewellery-crm.sqlite'),
    path.join(appdata, 'JewelleryCRM', 'data', 'jewellery-crm.sqlite'),
    path.join(__dirname, '..', '..', 'jewellery-crm.sqlite'),
    path.join(__dirname, '..', '..', '..', 'jewellery-crm.sqlite'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

const sqlitePath = resolveSqlitePath();
process.env.ELECTRON_RUN = '1';
process.env.USE_CLOUD_DB = '0';
process.env.SQLITE_PATH = sqlitePath;
delete process.env.DATABASE_URL;

const FORCE = process.argv.includes('--force');
const MARK = 'DEMO_SEED';

const { default: sequelize } = await import('../db.js');
const { Op } = await import('sequelize');
const {
  Shop, Setting, CatalogItem, Category, ShopCounter, Vendor, Employee, Customer,
  Product, InventoryMovement, ProductStatusHistory, Purchase, PurchaseItem,
  Invoice, InvoiceItem, Payment, Quotation, CustomerAdvance, Scheme, SchemePlan,
  Order, Expense, ExpenseCategory, Campaign, BarcodeSequence, GoldRateHistory,
  OldGoldReceipt, CreditNote, MetalIssue, DailyClosing,
  CashbookEntry, BankAccount, InventoryAdjustment, HsnCode,
} = await import('../models/index.js');
const { newId, nextShopSerial } = await import('../utils.js');
const { ensureSystemCatalogItems } = await import('../services/systemCatalog.js');

const RATES = {
  gold_24k: 13900,
  gold_22k: 12800,
  gold_18k: 11000,
  pure_silver: 293,
  silver: 281,
};

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(11, 20, 0, 0);
  return d;
}
function dateOnlyAgo(n) {
  return daysAgo(n).toISOString().slice(0, 10);
}
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}
function money(n) {
  return Math.round(Number(n) * 100) / 100;
}
function rateForPurity(purity) {
  if (purity === '24K') return RATES.gold_24k;
  if (purity === '18K') return RATES.gold_18k;
  if (purity === '999' || /pure/i.test(purity)) return RATES.pure_silver;
  if (purity === '925' || /silver/i.test(purity)) return RATES.silver;
  return RATES.gold_22k;
}
function priceGold({ net, purity, makingPct = 12 }) {
  const goldValue = money(Number(net) * rateForPurity(purity));
  const making = money(goldValue * makingPct / 100);
  return { goldValue, making, selling: money(goldValue + making) };
}

async function wipeDemo(shopId) {
  const products = await Product.findAll({ where: { shop_id: shopId, description: { [Op.like]: `[${MARK}]%` } } });
  const pids = products.map((p) => p.id);
  const invoices = await Invoice.findAll({ where: { shop_id: shopId, notes: MARK } });
  const iids = invoices.map((i) => i.id);
  const purchases = await Purchase.findAll({ where: { shop_id: shopId, notes: MARK } });
  const poIds = purchases.map((p) => p.id);
  const customers = await Customer.findAll({ where: { shop_id: shopId, notes: MARK } });
  const cids = customers.map((c) => c.id);

  if (iids.length) {
    await InvoiceItem.destroy({ where: { invoice_id: { [Op.in]: iids } } });
    await Payment.destroy({ where: { invoice_id: { [Op.in]: iids } } });
  }
  if (poIds.length) await PurchaseItem.destroy({ where: { purchase_id: { [Op.in]: poIds } } });
  if (pids.length) {
    await InventoryMovement.destroy({ where: { product_id: { [Op.in]: pids } } });
    await ProductStatusHistory.destroy({ where: { product_id: { [Op.in]: pids } } });
  }
  if (cids.length) {
    await CustomerAdvance.destroy({ where: { customer_id: { [Op.in]: cids } } });
    await Scheme.destroy({ where: { customer_id: { [Op.in]: cids } } });
    await Quotation.destroy({ where: { customer_id: { [Op.in]: cids } } });
    await Order.destroy({ where: { customer_id: { [Op.in]: cids } } });
  }

  await Invoice.destroy({ where: { shop_id: shopId, notes: MARK } });
  await Purchase.destroy({ where: { shop_id: shopId, notes: MARK } });
  await Product.destroy({ where: { shop_id: shopId, description: { [Op.like]: `[${MARK}]%` } } });
  await Customer.destroy({ where: { shop_id: shopId, notes: MARK } });
  await Vendor.destroy({ where: { shop_id: shopId, notes: MARK } });
  await Employee.destroy({ where: { shop_id: shopId, notes: MARK } });
  await Expense.destroy({ where: { shop_id: shopId, notes: MARK } });
  await Campaign.destroy({ where: { shop_id: shopId, name: { [Op.like]: 'DEMO %' } } });
  await SchemePlan.destroy({ where: { shop_id: shopId, description: { [Op.like]: `[${MARK}]%` } } });
  await ExpenseCategory.destroy({ where: { shop_id: shopId, description: MARK } });
  await ShopCounter.destroy({ where: { shop_id: shopId, code: { [Op.like]: 'DEMO-%' } } });
  await Category.destroy({ where: { shop_id: shopId, description: MARK } });
  await OldGoldReceipt.destroy({ where: { shop_id: shopId, receipt_no: { [Op.like]: 'DEMO-%' } } });
  await CreditNote.destroy({ where: { shop_id: shopId, credit_note_no: { [Op.like]: 'DEMO-%' } } });
  await MetalIssue.destroy({ where: { shop_id: shopId, notes: MARK } });
  await DailyClosing.destroy({ where: { shop_id: shopId, notes: MARK } });
  await CashbookEntry.destroy({ where: { shop_id: shopId, notes: MARK } });
  await BankAccount.destroy({ where: { shop_id: shopId, notes: MARK } });
  await InventoryAdjustment.destroy({ where: { shop_id: shopId, notes: MARK } });
  await HsnCode.destroy({ where: { shop_id: shopId, description: MARK } });
  console.log('  ✓ Previous demo rows removed');
}

async function catByCode(_shopId, type, code) {
  return CatalogItem.findOne({
    where: { type, code, deleted_at: null },
  });
}

async function run() {
  console.log('SQLite:', sqlitePath);
  if (!fs.existsSync(sqlitePath)) {
    console.error('Database file not found. Open the ERP once so SQLite is created, then re-run.');
    process.exit(1);
  }

  await sequelize.authenticate();
  const shop = await Shop.findOne({ where: { status: 'active' }, order: [['created_at', 'ASC']] });
  if (!shop) {
    console.error('No shop in SQLite. Start the ERP once to seed the owner/shop, then re-run.');
    process.exit(1);
  }
  const shopId = shop.id;
  await ensureSystemCatalogItems(shopId);

  const already = await Setting.findOne({ where: { shop_id: shopId, key: 'demo_seed' } });
  if (already && !FORCE) {
    console.log('Demo data already present. Re-run with --force to replace it.');
    await sequelize.close();
    return;
  }
  if (FORCE) await wipeDemo(shopId);

  const gold = await catByCode(shopId, 'metal_type', 'GOLD');
  const silver = await catByCode(shopId, 'metal_type', 'SILVER');
  const p22 = await catByCode(shopId, 'purity', '22K');
  const p18 = await catByCode(shopId, 'purity', '18K');
  const p24 = await catByCode(shopId, 'purity', '24K');
  const p925 = await catByCode(shopId, 'purity', '925');
  const p999 = await catByCode(shopId, 'purity', '999');
  const unitG = await catByCode(shopId, 'unit', 'g');
  const unitPc = await catByCode(shopId, 'unit', 'pc');

  // Gold rates
  const ratePayload = { ...RATES, updated_at: new Date().toISOString() };
  const rateRow = await Setting.findOne({ where: { shop_id: shopId, key: 'gold_rate' } });
  if (rateRow) await rateRow.update({ value: ratePayload });
  else await Setting.create({ id: newId(), shop_id: shopId, key: 'gold_rate', value: ratePayload });
  await GoldRateHistory.create({
    id: newId(), shop_id: shopId, rates: ratePayload, source: 'demo_seed',
  });

  // Counters
  const counterDefs = [
    { name: 'Rings Counter', code: 'DEMO-RNG' },
    { name: 'Necklace Counter', code: 'DEMO-NCK' },
    { name: 'Earrings Counter', code: 'DEMO-EAR' },
    { name: 'Bangles Counter', code: 'DEMO-BNG' },
    { name: 'Chains Counter', code: 'DEMO-CHN' },
    { name: 'Silver Counter', code: 'DEMO-SLV' },
  ];
  const counters = {};
  for (const c of counterDefs) {
    const row = await ShopCounter.create({
      id: newId(), shop_id: shopId, name: c.name, code: c.code, status: 'active', is_default: c.code === 'DEMO-RNG',
    });
    counters[c.code] = row;
  }

  // Categories
  const tree = [
    { name: 'Rings', prefix: 'RNG', counter: 'DEMO-RNG', metal: gold?.id, making: 12, subs: ['Engagement', 'Daily Wear', 'Bridal'] },
    { name: 'Necklaces', prefix: 'NCK', counter: 'DEMO-NCK', metal: gold?.id, making: 14, subs: ['Bridal', 'Choker', 'Long Chain'] },
    { name: 'Earrings', prefix: 'EAR', counter: 'DEMO-EAR', metal: gold?.id, making: 15, subs: ['Studs', 'Jhumka', 'Danglers'] },
    { name: 'Bangles', prefix: 'BNG', counter: 'DEMO-BNG', metal: gold?.id, making: 10, subs: ['Kada', 'Bridal Set'] },
    { name: 'Chains', prefix: 'CHN', counter: 'DEMO-CHN', metal: gold?.id, making: 8, subs: ['Rope', 'Box'] },
    { name: 'Pendants', prefix: 'PND', counter: 'DEMO-NCK', metal: gold?.id, making: 16, subs: ['Religious', 'Fashion'] },
    { name: 'Silver', prefix: 'SLV', counter: 'DEMO-SLV', metal: silver?.id, making: 40, subs: ['Anklets', 'Pooja'] },
  ];
  const cats = {};
  const subcats = {};
  for (let i = 0; i < tree.length; i++) {
    const t = tree[i];
    const parent = await Category.create({
      id: newId(), shop_id: shopId, name: t.name, parent_id: null, display_order: String(i),
      code_prefix: t.prefix, counter_id: counters[t.counter].id,
      default_metal_type_id: t.metal || null,
      default_making_charge: t.making, default_making_charge_type: 'percentage',
      description: MARK,
    });
    cats[t.name] = parent;
    for (let j = 0; j < t.subs.length; j++) {
      const child = await Category.create({
        id: newId(), shop_id: shopId, name: t.subs[j], parent_id: parent.id, display_order: String(j),
        code_prefix: t.prefix, counter_id: counters[t.counter].id,
        default_metal_type_id: t.metal || null,
        default_making_charge: t.making, default_making_charge_type: 'percentage',
        description: MARK,
      });
      subcats[`${t.name}/${t.subs[j]}`] = child;
    }
  }

  const vendors = [];
  for (const v of [
    { name: 'Meenakshi Gold Refinery', type: 'gold_supplier', mobile: '9848001001', contact_person: 'Suresh', gst_number: '36AABCM1234A1Z5', address: 'Begumpet, Hyderabad' },
    { name: 'Karat Crafts Pvt Ltd', type: 'manufacturer', mobile: '9848001002', contact_person: 'Anjali', gst_number: '36AABCK5678B1Z9', address: 'Secunderabad' },
    { name: 'Raju Karigar Works', type: 'karigar', mobile: '9848001003', contact_person: 'Raju', address: 'Charminar, Hyderabad' },
    { name: 'Silver House Traders', type: 'gold_supplier', mobile: '9848001004', contact_person: 'Imran', address: 'Koti, Hyderabad' },
  ]) {
    vendors.push(await Vendor.create({
      id: newId(), shop_id: shopId, ...v, notes: MARK, status: 'active', credit_days: 15,
    }));
  }

  const employees = [];
  for (const e of [
    { name: 'Akhil', mobile: '9000000001', job_title: 'Sales Executive', employee_code: 'EMP-01', commission_pct: 2 },
    { name: 'Sravani', mobile: '9000000002', job_title: 'Sales Executive', employee_code: 'EMP-02', commission_pct: 2 },
    { name: 'Ravi Kumar', mobile: '9000000003', job_title: 'Counter Incharge', employee_code: 'EMP-03', commission_pct: 1.5 },
    { name: 'Lakshmi', mobile: '9000000004', job_title: 'Billing', employee_code: 'EMP-04', commission_pct: 1 },
  ]) {
    employees.push(await Employee.create({
      id: newId(), shop_id: shopId, ...e, department: 'Showroom', salary: 22000,
      join_date: dateOnlyAgo(200), status: 'active', notes: MARK, commission_on: 'making',
    }));
  }

  const customers = [];
  let nextCustomerSerial = await nextShopSerial(Customer, shopId);
  for (const c of [
    { name: 'Lakshmi Devi', mobile: '9848012345', email: 'lakshmi.d@example.com', address: 'Jubilee Hills, Hyderabad', tag: 'vip', dob: '1988-04-12', anniversary: '2012-11-21' },
    { name: 'Ramesh Kumar', mobile: '9876501122', email: 'ramesh.k@example.com', address: 'Banjara Hills, Hyderabad', tag: 'regular', dob: '1982-09-03' },
    { name: 'Priya Sharma', mobile: '9845003344', email: 'priya.s@example.com', address: 'Kondapur, Hyderabad', tag: 'regular', dob: '1994-02-18', anniversary: '2019-12-08' },
    { name: 'Venkat Reddy', mobile: '9700115566', address: 'Secunderabad', tag: 'wholesale' },
    { name: 'Sunita Agarwal', mobile: '9912337788', email: 'sunita.a@example.com', address: 'Madhapur, Hyderabad', tag: 'vip', dob: '1979-07-25' },
    { name: 'Anil Joshi', mobile: '9885544332', address: 'Gachibowli, Hyderabad', tag: 'regular' },
    { name: 'Meena Iyer', mobile: '9966882211', email: 'meena.i@example.com', address: 'Filmnagar, Hyderabad', tag: 'vip', anniversary: '2008-01-14' },
    { name: 'Kiran Rao', mobile: '9012345678', address: 'Kukatpally, Hyderabad', tag: 'regular' },
    { name: 'Fatima Begum', mobile: '9123456780', address: 'Tolichowki, Hyderabad', tag: 'regular' },
    { name: 'Suresh Babu', mobile: '9345678901', address: 'LB Nagar, Hyderabad', tag: 'regular' },
  ]) {
    customers.push(await Customer.create({
      id: newId(), serial_no: nextCustomerSerial++, shop_id: shopId, ...c, notes: MARK, total_purchases: 0, loyalty_points: 0,
    }));
  }

  const seq = await BarcodeSequence.findByPk(shopId);
  let nextTag = seq?.next_value || 10001;
  if (nextTag < 20001) nextTag = 20001;

  const productSpecs = [
    { name: '22K Floral Necklace', cat: 'Necklaces', sub: 'Bridal', purity: '22K', pid: p22, metal: gold, gw: 22.54, nw: 20.80, sw: 1.74, making: 14, age: 18, vendor: 1, counter: 'DEMO-NCK' },
    { name: '22K Temple Necklace', cat: 'Necklaces', sub: 'Bridal', purity: '22K', pid: p22, metal: gold, gw: 38.20, nw: 36.10, sw: 2.10, making: 14, age: 40, vendor: 1, counter: 'DEMO-NCK' },
    { name: '22K Gold Chain 18in', cat: 'Chains', sub: 'Rope', purity: '22K', pid: p22, metal: gold, gw: 12.05, nw: 11.80, sw: 0.25, making: 8, age: 12, vendor: 0, counter: 'DEMO-CHN' },
    { name: '22K Gold Chain 20in', cat: 'Chains', sub: 'Box', purity: '22K', pid: p22, metal: gold, gw: 16.40, nw: 16.10, sw: 0.30, making: 8, age: 9, vendor: 0, counter: 'DEMO-CHN' },
    { name: '22K Jhumka Earrings', cat: 'Earrings', sub: 'Jhumka', purity: '22K', pid: p22, metal: gold, gw: 8.60, nw: 7.90, sw: 0.70, making: 15, age: 7, vendor: 1, counter: 'DEMO-EAR' },
    { name: '22K Stud Earrings', cat: 'Earrings', sub: 'Studs', purity: '22K', pid: p22, metal: gold, gw: 4.20, nw: 3.95, sw: 0.25, making: 15, age: 5, vendor: 1, counter: 'DEMO-EAR' },
    { name: '22K Bridal Bangle Pair', cat: 'Bangles', sub: 'Bridal Set', purity: '22K', pid: p22, metal: gold, gw: 42.80, nw: 40.50, sw: 2.30, making: 10, age: 25, vendor: 1, counter: 'DEMO-BNG' },
    { name: '22K Kada Bangle', cat: 'Bangles', sub: 'Kada', purity: '22K', pid: p22, metal: gold, gw: 28.15, nw: 27.40, sw: 0.75, making: 10, age: 14, vendor: 2, counter: 'DEMO-BNG' },
    { name: '22K Daily Wear Ring', cat: 'Rings', sub: 'Daily Wear', purity: '22K', pid: p22, metal: gold, gw: 3.85, nw: 3.60, sw: 0.25, making: 12, age: 3, vendor: 1, counter: 'DEMO-RNG' },
    { name: '22K Engagement Ring', cat: 'Rings', sub: 'Engagement', purity: '22K', pid: p22, metal: gold, gw: 5.10, nw: 4.40, sw: 0.70, making: 16, age: 6, vendor: 1, counter: 'DEMO-RNG' },
    { name: '18K Solitaire Ring', cat: 'Rings', sub: 'Engagement', purity: '18K', pid: p18, metal: gold, gw: 4.80, nw: 4.10, sw: 0.70, making: 18, age: 11, vendor: 1, counter: 'DEMO-RNG' },
    { name: '22K Om Pendant', cat: 'Pendants', sub: 'Religious', purity: '22K', pid: p22, metal: gold, gw: 3.20, nw: 3.05, sw: 0.15, making: 16, age: 2, vendor: 2, counter: 'DEMO-NCK' },
    { name: '24K Gold Coin 8g', cat: 'Pendants', sub: 'Religious', purity: '24K', pid: p24, metal: gold, gw: 8.00, nw: 8.00, sw: 0, making: 2, age: 1, vendor: 0, counter: 'DEMO-NCK' },
    { name: '24K Gold Coin 4g', cat: 'Pendants', sub: 'Religious', purity: '24K', pid: p24, metal: gold, gw: 4.00, nw: 4.00, sw: 0, making: 2, age: 4, vendor: 0, counter: 'DEMO-NCK' },
    { name: '22K Dangler Earrings', cat: 'Earrings', sub: 'Danglers', purity: '22K', pid: p22, metal: gold, gw: 6.75, nw: 6.20, sw: 0.55, making: 15, age: 8, vendor: 1, counter: 'DEMO-EAR' },
    { name: '22K Choker Necklace', cat: 'Necklaces', sub: 'Choker', purity: '22K', pid: p22, metal: gold, gw: 18.90, nw: 17.60, sw: 1.30, making: 14, age: 16, vendor: 1, counter: 'DEMO-NCK' },
    { name: '22K Bridal Ring', cat: 'Rings', sub: 'Bridal', purity: '22K', pid: p22, metal: gold, gw: 6.40, nw: 5.85, sw: 0.55, making: 14, age: 21, vendor: 1, counter: 'DEMO-RNG' },
    { name: '18K Fashion Pendant', cat: 'Pendants', sub: 'Fashion', purity: '18K', pid: p18, metal: gold, gw: 2.85, nw: 2.50, sw: 0.35, making: 18, age: 10, vendor: 1, counter: 'DEMO-NCK' },
  ];

  const products = [];
  for (const spec of productSpecs) {
    const tag = String(nextTag++);
    const { selling, making } = priceGold({ net: spec.nw, purity: spec.purity, makingPct: spec.making });
    const created = daysAgo(spec.age);
    const row = await Product.create({
      id: newId(),
      shop_id: shopId,
      name: spec.name,
      code: tag,
      barcode: tag,
      category_id: cats[spec.cat].id,
      subcategory_id: subcats[`${spec.cat}/${spec.sub}`]?.id || null,
      metal_type_id: spec.metal?.id || null,
      purity_id: spec.pid?.id || null,
      unit_id: unitG?.id || null,
      gross_weight: spec.gw,
      net_weight: spec.nw,
      stone_weight: spec.sw,
      making_charges: spec.making,
      making_charge_type: 'percentage',
      wastage_pct: 0,
      hsn_code: spec.purity === '24K' ? '7114' : '7113',
      gst_slab: 3,
      purchase_price: money(selling * 0.88),
      selling_price: selling,
      stock_qty: 1,
      status: 'available',
      inventory_mode: 'unique_tag',
      counter_id: counters[spec.counter].id,
      vendor_id: vendors[spec.vendor].id,
      purchase_date: dateOnlyAgo(spec.age + 4),
      description: `[${MARK}] ${spec.name}`,
      hallmark: spec.purity === '22K' ? 'BIS916' : spec.purity === '24K' ? 'BIS999' : 'BIS750',
      createdAt: created,
      updatedAt: created,
    });
    products.push(row);
    await InventoryMovement.create({
      id: newId(), shop_id: shopId, product_id: row.id, movement_type: 'PURCHASE',
      quantity: 1, gross_weight: spec.gw, net_weight: spec.nw, stone_weight: spec.sw,
      qty_before: 0, qty_after: 1, reference_type: 'purchase', notes: MARK,
      createdAt: created,
    });
    await ProductStatusHistory.create({
      id: newId(), shop_id: shopId, product_id: row.id, from_status: null, to_status: 'available',
      reason: 'Stock in', reference_type: 'purchase', meta: {}, createdAt: created,
    });
  }

  // Silver quantity items (not unique tags)
  const silverSpecs = [
    { name: 'Silver Anklet Pair', cat: 'Silver', sub: 'Anklets', gw: 48, nw: 45, qty: 6, age: 15 },
    { name: 'Silver Pooja Plate', cat: 'Silver', sub: 'Pooja', gw: 85, nw: 82, qty: 4, age: 20 },
    { name: 'Silver Payal Kids', cat: 'Silver', sub: 'Anklets', gw: 18, nw: 17, qty: 8, age: 6 },
  ];
  for (const spec of silverSpecs) {
    const tag = String(nextTag++);
    const created = daysAgo(spec.age);
    const selling = money(spec.nw * RATES.silver + 120);
    const row = await Product.create({
      id: newId(), shop_id: shopId, name: spec.name, code: tag, barcode: tag,
      category_id: cats.Silver.id, subcategory_id: subcats[`${spec.cat}/${spec.sub}`]?.id || null,
      metal_type_id: silver?.id || null, purity_id: p925?.id || null, unit_id: unitPc?.id || null,
      gross_weight: spec.gw, net_weight: spec.nw, stone_weight: 0,
      making_charges: 40, making_charge_type: 'percentage', wastage_pct: 0,
      hsn_code: '7114', gst_slab: 3, purchase_price: money(selling * 0.8), selling_price: selling,
      stock_qty: spec.qty, status: 'available', inventory_mode: 'quantity',
      counter_id: counters['DEMO-SLV'].id, vendor_id: vendors[3].id,
      purchase_date: dateOnlyAgo(spec.age + 3),
      description: `[${MARK}] ${spec.name}`,
      createdAt: created, updatedAt: created,
    });
    products.push(row);
    await InventoryMovement.create({
      id: newId(), shop_id: shopId, product_id: row.id, movement_type: 'PURCHASE',
      quantity: spec.qty, gross_weight: spec.gw * spec.qty, net_weight: spec.nw * spec.qty, stone_weight: 0,
      qty_before: 0, qty_after: spec.qty, reference_type: 'purchase', notes: MARK, createdAt: created,
    });
  }

  if (seq) await seq.update({ next_value: nextTag });
  else await BarcodeSequence.create({ shop_id: shopId, next_value: nextTag });

  const byName = (n) => products.find((p) => p.name === n);

  // Purchases (vendor bills)
  const poItems = [byName('22K Floral Necklace'), byName('22K Gold Chain 18in'), byName('24K Gold Coin 8g')].filter(Boolean);
  const poSub = money(poItems.reduce((s, p) => s + Number(p.purchase_price), 0));
  const poGst = money(poSub * 0.03);
  const purchase = await Purchase.create({
    id: newId(), shop_id: shopId, po_number: 'DEMO-PO-001',
    vendor_id: vendors[0].id, vendor_name: vendors[0].name,
    purchase_date: dateOnlyAgo(18), purchase_type: 'finished_goods',
    items: poItems.map((p) => ({
      product_id: p.id, name: p.name, barcode: p.barcode, quantity: 1,
      weight_g: p.net_weight, rate: p.purchase_price, amount: p.purchase_price,
    })),
    subtotal: poSub, gst_pct: 3, gst_amount: poGst, cgst_amount: money(poGst / 2), sgst_amount: money(poGst / 2),
    grand_total: money(poSub + poGst), paid_amount: money(poSub + poGst), balance: 0,
    payments: [{ mode: 'bank_transfer', amount: money(poSub + poGst) }],
    status: 'paid', notes: MARK,
  });
  for (let i = 0; i < poItems.length; i++) {
    const p = poItems[i];
    await PurchaseItem.create({
      id: newId(), shop_id: shopId, purchase_id: purchase.id, line_no: i + 1,
      product_id: p.id, barcode: p.barcode, description: p.name, quantity: 1,
      weight_g: p.net_weight, rate: p.purchase_price, tax_pct: 3, amount: p.purchase_price,
    });
  }

  function invoiceLine(product, qty = 1) {
    const purity = product.purity_id === p24?.id ? '24K'
      : product.purity_id === p18?.id ? '18K'
        : product.purity_id === p925?.id ? '925' : '22K';
    const rate = rateForPurity(purity);
    const goldValue = money(Number(product.net_weight) * rate);
    const makingPct = Number(product.making_charges) || 12;
    const making = product.making_charge_type === 'percentage'
      ? money(goldValue * makingPct / 100)
      : money(product.making_charges);
    const line_total = money((goldValue + making) * qty);
    return {
      product_id: product.id,
      name: product.name,
      code: product.code,
      barcode: product.barcode,
      purity,
      metal: purity === '925' ? 'Silver' : 'Gold',
      quantity: qty,
      gross_weight: Number(product.gross_weight),
      net_weight: Number(product.net_weight),
      stone_weight: Number(product.stone_weight),
      making_charges: product.making_charges,
      making_charge_type: product.making_charge_type,
      wastage_pct: 0,
      gold_value: goldValue,
      making_amount: making,
      unit_price: money(goldValue + making),
      line_total,
      gold_rate: rate,
      hsn_code: product.hsn_code,
      inventory_mode: product.inventory_mode,
    };
  }

  async function postInvoice({ no, customer, emp, lines, when, mode, oldGold = null }) {
    const subtotal = money(lines.reduce((s, l) => s + l.line_total, 0));
    const gst = money(subtotal * 0.03);
    const grand = money(subtotal + gst);
    // Old Gold Exchange is a payment, not a deduction — grand_total stays the
    // full invoice amount; old gold settles part of it alongside cash/etc.
    const ogValue = oldGold ? money(Number(oldGold.weight) * Number(oldGold.rate)) : 0;
    const due = money(Math.max(0, grand - ogValue));
    const payments = [
      ...(ogValue > 0 ? [{
        mode: 'old_gold_exchange',
        amount: ogValue,
        description: 'Old Gold Exchange',
        old_gold: oldGold ? { weight: oldGold.weight, purity: oldGold.purity, rate: oldGold.rate } : undefined,
      }] : []),
      ...(due > 0 ? [{ mode, amount: due }] : []),
    ];
    const inv = await Invoice.create({
      id: newId(), shop_id: shopId, invoice_no: no,
      customer_id: customer.id, customer_name: customer.name, customer_mobile: customer.mobile,
      salesperson_id: emp.id, items: lines, subtotal, discount: 0, gst_pct: 3,
      gst_amount: gst, cgst_amount: money(gst / 2), sgst_amount: money(gst / 2),
      old_gold_value: ogValue,
      gold_rate: RATES.gold_24k, grand_total: grand, round_off: 0,
      payments, balance_due: 0, status: 'paid',
      notes: MARK, createdAt: when, updatedAt: when,
    });
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await InvoiceItem.create({
        id: newId(), shop_id: shopId, invoice_id: inv.id, line_no: i + 1,
        product_id: l.product_id || null, barcode: l.barcode || null, description: l.name,
        quantity: l.quantity, gross_weight: l.gross_weight, net_weight: l.net_weight,
        rate: l.gold_rate || l.rate, making: l.making_amount || l.making_charges || 0,
        tax_pct: 3, tax_amount: money(l.line_total * 0.03),
        amount: l.line_total, hsn_code: l.hsn_code, snapshot_json: l,
      });
      if (l.inventory_mode === 'unique_tag' && l.product_id) {
        await Product.update(
          { status: 'sold', stock_qty: 0 },
          { where: { id: l.product_id } },
        );
        await InventoryMovement.create({
          id: newId(), shop_id: shopId, product_id: l.product_id, movement_type: 'SALE',
          quantity: -1, gross_weight: -l.gross_weight, net_weight: -l.net_weight, stone_weight: -(l.stone_weight || 0),
          qty_before: 1, qty_after: 0, reference_type: 'invoice', reference_id: inv.id,
          notes: MARK, createdAt: when,
        });
        await ProductStatusHistory.create({
          id: newId(), shop_id: shopId, product_id: l.product_id,
          from_status: 'available', to_status: 'sold', reason: 'POS sale',
          reference_type: 'invoice', reference_id: inv.id, createdAt: when,
        });
      } else if (l.inventory_mode === 'quantity' && l.product_id) {
        const prod = await Product.findByPk(l.product_id);
        const before = Number(prod?.stock_qty) || 0;
        const qty = Number(l.quantity) || 1;
        await prod?.update({ stock_qty: Math.max(0, before - qty) });
        await InventoryMovement.create({
          id: newId(), shop_id: shopId, product_id: l.product_id, movement_type: 'SALE',
          quantity: -qty, gross_weight: -(l.gross_weight || 0) * qty, net_weight: -(l.net_weight || 0) * qty,
          stone_weight: 0, qty_before: before, qty_after: Math.max(0, before - qty),
          reference_type: 'invoice', reference_id: inv.id, notes: MARK, createdAt: when,
        });
      }
    }
    if (ogValue > 0 && oldGold) {
      await OldGoldReceipt.create({
        id: newId(), shop_id: shopId, receipt_no: `DEMO-OG-${no.replace(/\W+/g, '').slice(-6)}`,
        customer_id: customer.id, invoice_id: inv.id,
        weight_g: oldGold.weight, purity: oldGold.purity, rate: oldGold.rate,
        value: ogValue, value_paise: Math.round(ogValue * 100),
        description: oldGold.description || 'Old gold exchange',
        status: 'posted', createdAt: when, updatedAt: when,
      });
    }
    if (ogValue > 0) {
      await Payment.create({
        id: newId(), shop_id: shopId, invoice_id: inv.id, customer_id: customer.id,
        mode: 'old_gold_exchange', amount: ogValue, status: 'posted', paid_at: when, createdAt: when,
      });
    }
    if (due > 0) {
      await Payment.create({
        id: newId(), shop_id: shopId, invoice_id: inv.id, customer_id: customer.id,
        mode, amount: due, status: 'posted', paid_at: when, createdAt: when,
      });
    }
    await customer.update({
      total_purchases: money(Number(customer.total_purchases || 0) + grand),
      loyalty_points: Math.floor((Number(customer.total_purchases || 0) + grand) / 100),
    });
    return inv;
  }

  function pureMetalLine({ name, metal, purity, weight, rate, other = 0, hsn }) {
    const metalValue = money(weight * rate);
    return {
      line_type: 'pure_metal',
      is_pure_metal: true,
      name,
      product_name: name,
      metal,
      purity,
      quantity: 1,
      gross_weight: weight,
      net_weight: weight,
      stone_weight: 0,
      rate,
      gold_rate: rate,
      price_override: metalValue,
      making_charges: other,
      making_amount: other,
      other_charges: other,
      unit_price: money(metalValue + other),
      line_total: money(metalValue + other),
      hsn_code: hsn,
      inventory_mode: 'none',
    };
  }

  const soldA = byName('22K Floral Necklace');
  const soldB = byName('22K Stud Earrings');
  const soldC = byName('22K Gold Chain 18in');
  const soldD = byName('24K Gold Coin 4g');
  const soldE = byName('18K Solitaire Ring');
  const soldF = byName('22K Daily Wear Ring');

  await postInvoice({
    no: 'DEMO-INV-0101', customer: customers[0], emp: employees[0],
    lines: [invoiceLine(soldA), invoiceLine(soldB)], when: daysAgo(0), mode: 'cash',
  });
  await postInvoice({
    no: 'DEMO-INV-0102', customer: customers[1], emp: employees[1],
    lines: [invoiceLine(soldC)], when: daysAgo(0), mode: 'upi',
  });
  await postInvoice({
    no: 'DEMO-INV-0098', customer: customers[2], emp: employees[0],
    lines: [invoiceLine(soldD)], when: daysAgo(6), mode: 'card',
  });
  const invOldGoldJewellery = await postInvoice({
    no: 'DEMO-INV-0094', customer: customers[4], emp: employees[2],
    lines: [invoiceLine(soldE), invoiceLine(soldF)], when: daysAgo(12), mode: 'cash',
  });

  // Jewellery sale with old-gold exchange (POS F6)
  const soldChoker = byName('22K Choker Necklace');
  await postInvoice({
    no: 'DEMO-INV-0103', customer: customers[6], emp: employees[0],
    lines: [invoiceLine(soldChoker)], when: daysAgo(0), mode: 'cash',
    oldGold: { weight: 8.5, purity: '22K', rate: RATES.gold_22k, description: 'Old 22K chain exchange' },
  });

  // Silver jewellery quantity sale
  const silverAnklet = byName('Silver Anklet Pair');
  await postInvoice({
    no: 'DEMO-INV-0104', customer: customers[8], emp: employees[1],
    lines: [invoiceLine(silverAnklet, 1)], when: daysAgo(1), mode: 'upi',
  });

  // Pure gold / silver POS bills (Accounts → Pure Metal)
  await postInvoice({
    no: 'DEMO-INV-PM01', customer: customers[3], emp: employees[2],
    lines: [pureMetalLine({
      name: '24K Gold', metal: 'Gold', purity: '24K', weight: 10, rate: RATES.gold_24k, other: 150, hsn: '7108',
    })],
    when: daysAgo(0), mode: 'bank_transfer',
  });
  await postInvoice({
    no: 'DEMO-INV-PM02', customer: customers[5], emp: employees[0],
    lines: [pureMetalLine({
      name: 'Pure Silver', metal: 'Silver', purity: 'PureSilver', weight: 250, rate: RATES.pure_silver, other: 80, hsn: '7106',
    })],
    when: daysAgo(0), mode: 'cash',
  });
  await postInvoice({
    no: 'DEMO-INV-PM03', customer: customers[9], emp: employees[1],
    lines: [pureMetalLine({
      name: '24K Gold', metal: 'Gold', purity: '24K', weight: 5, rate: RATES.gold_24k, other: 80, hsn: '7108',
    })],
    when: daysAgo(1), mode: 'upi',
  });

  // Estimations
  const estItem = byName('22K Temple Necklace');
  const estLine = invoiceLine(estItem);
  const estSub = estLine.line_total;
  const estGst = money(estSub * 0.03);
  await Quotation.create({
    id: newId(), shop_id: shopId, quote_no: 'QT-2026-101',
    customer_id: customers[6].id, customer_name: customers[6].name, customer_mobile: customers[6].mobile,
    salesperson_id: employees[0].id, items: [estLine],
    gold_rate: RATES.gold_24k, subtotal: estSub, gst_pct: 3, gst_amount: estGst,
    grand_total: money(estSub + estGst), valid_until: dateOnlyAgo(-7),
    status: 'draft', notes: MARK, terms: 'Price valid based on today gold rate.',
  });

  const bookItem = byName('22K Bridal Bangle Pair');
  const bookLine = invoiceLine(bookItem);
  const bookSub = bookLine.line_total;
  const bookGst = money(bookSub * 0.03);
  const bookGrand = money(bookSub + bookGst);
  const advanceAmt = 32000;
  const adv = await CustomerAdvance.create({
    id: newId(), shop_id: shopId, customer_id: customers[0].id,
    amount: advanceAmt, used_amount: 0, remaining_amount: advanceAmt,
    mode: 'cash', status: 'open', reference: 'QT-2026-102 booking',
  });
  await Product.update({ status: 'reserved' }, { where: { id: bookItem.id } });
  await Quotation.create({
    id: newId(), shop_id: shopId, quote_no: 'QT-2026-102',
    customer_id: customers[0].id, customer_name: customers[0].name, customer_mobile: customers[0].mobile,
    salesperson_id: employees[0].id, items: [bookLine],
    gold_rate: RATES.gold_24k, subtotal: bookSub, gst_pct: 3, gst_amount: bookGst,
    grand_total: bookGrand, valid_until: dateOnlyAgo(-14),
    status: 'booked', price_locked: true, advance_paid: advanceAmt, advance_id: adv.id,
    advance_payments: [{ advance_id: adv.id, amount: advanceAmt, mode: 'cash', paid_at: daysAgo(2).toISOString() }],
    booked_at: daysAgo(2), notes: MARK,
  });

  await Quotation.create({
    id: newId(), shop_id: shopId, quote_no: 'QT-2026-103',
    customer_id: customers[5].id, customer_name: customers[5].name, customer_mobile: customers[5].mobile,
    salesperson_id: employees[1].id, items: [invoiceLine(byName('22K Om Pendant'))],
    gold_rate: RATES.gold_24k, subtotal: invoiceLine(byName('22K Om Pendant')).line_total,
    gst_pct: 3, gst_amount: money(invoiceLine(byName('22K Om Pendant')).line_total * 0.03),
    grand_total: money(invoiceLine(byName('22K Om Pendant')).line_total * 1.03),
    valid_until: dateOnlyAgo(-5), status: 'sent', notes: MARK,
  });

  // Scheme plans + enrolments
  const planCash = await SchemePlan.create({
    id: newId(), shop_id: shopId, name: 'Monthly Gold Plan 11+1',
    plan_type: 'amount', duration_months: 11, bonus_months: 1,
    default_monthly_amount: 5000, description: `[${MARK}] 11 months + 1 bonus`, active: true,
  });
  const planGram = await SchemePlan.create({
    id: newId(), shop_id: shopId, name: 'Swarnakala Gram Scheme',
    plan_type: 'weight', duration_months: 11, bonus_months: 1,
    default_monthly_amount: 3000, description: `[${MARK}] grams at day rate`, active: true,
  });

  const schemePays = (count, amount, startMonthsAgo) => Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (count - 1 - i));
    const rate = 12400 + i * 80;
    return {
      id: newId(), amount, mode: i % 2 ? 'upi' : 'cash', paid_at: d.toISOString(),
      gold_rate_at_payment: rate, grams_credited: money(amount / rate),
    };
  });

  await Scheme.create({
    id: newId(), shop_id: shopId, customer_id: customers[0].id,
    customer_name: customers[0].name, customer_mobile: customers[0].mobile,
    plan_name: planCash.name, scheme_type: 'fixed_amount', plan_type: 'amount',
    monthly_amount: 5000, duration_months: 11, bonus_months: 1,
    start_date: monthsAgo(6), status: 'active', salesperson_id: employees[0].id,
    payments: schemePays(6, 5000, 6), notes: MARK,
  });
  await Scheme.create({
    id: newId(), shop_id: shopId, customer_id: customers[1].id,
    customer_name: customers[1].name, customer_mobile: customers[1].mobile,
    plan_name: planGram.name, scheme_type: 'swarnakala', plan_type: 'weight',
    monthly_amount: 3000, duration_months: 11, bonus_months: 1,
    start_date: monthsAgo(4), status: 'active', salesperson_id: employees[1].id,
    payments: schemePays(4, 3000, 4), notes: MARK,
  });
  await Scheme.create({
    id: newId(), shop_id: shopId, customer_id: customers[4].id,
    customer_name: customers[4].name, customer_mobile: customers[4].mobile,
    plan_name: planCash.name, scheme_type: 'fixed_amount', plan_type: 'amount',
    monthly_amount: 10000, duration_months: 11, bonus_months: 1,
    start_date: monthsAgo(11), status: 'matured', salesperson_id: employees[0].id,
    payments: schemePays(11, 10000, 11), notes: MARK,
  });

  const customOrder = await Order.create({
    id: newId(), shop_id: shopId, order_no: 'ORD-2026-011', type: 'custom',
    customer_id: customers[2].id, customer_name: customers[2].name, customer_mobile: customers[2].mobile,
    description: 'Custom 22K mango necklace, temple work, approx 45g',
    metal_type: 'Gold', purity: '22K', estimated_weight: 45, estimated_price: 620000,
    advance_paid: 50000, balance_due: 570000, karigar_name: vendors[2].name,
    karigar_vendor_id: vendors[2].id, delivery_date: dateOnlyAgo(-20),
    status: 'in_progress', priority: 'normal', notes: MARK,
  });
  await Order.create({
    id: newId(), shop_id: shopId, order_no: 'ORD-2026-012', type: 'repair',
    customer_id: customers[7].id, customer_name: customers[7].name, customer_mobile: customers[7].mobile,
    description: 'Resize 22K ring + solder broken hook on chain',
    metal_type: 'Gold', purity: '22K', estimated_weight: 0.4, estimated_price: 1800,
    advance_paid: 0, balance_due: 1800, delivery_date: dateOnlyAgo(-3),
    status: 'ready', priority: 'urgent', notes: MARK,
  });

  await MetalIssue.create({
    id: newId(), shop_id: shopId, order_id: customOrder.id, karigar_vendor_id: vendors[2].id,
    movement_type: 'issue', metal_type: 'Gold', purity: '22K', weight: 48.5, scrap_weight: 0,
    notes: MARK, createdAt: daysAgo(10),
  });
  await MetalIssue.create({
    id: newId(), shop_id: shopId, order_id: customOrder.id, karigar_vendor_id: vendors[2].id,
    movement_type: 'return', metal_type: 'Gold', purity: '22K', weight: 2.1, scrap_weight: 0.4,
    notes: MARK, createdAt: daysAgo(3),
  });

  const expCats = [];
  for (const name of ['Rent', 'Electricity', 'Packaging', 'Staff Tea']) {
    expCats.push(await ExpenseCategory.create({
      id: newId(), shop_id: shopId, name, description: MARK, color: '#B49042',
    }));
  }
  await Expense.create({
    id: newId(), shop_id: shopId, category_id: expCats[0].id, category_name: 'Rent',
    description: 'Showroom rent — August', amount: 85000, payment_mode: 'bank_transfer',
    date: dateOnlyAgo(8), notes: MARK,
  });
  await Expense.create({
    id: newId(), shop_id: shopId, category_id: expCats[1].id, category_name: 'Electricity',
    description: 'TSSPDCL bill', amount: 6200, payment_mode: 'upi',
    date: dateOnlyAgo(3), notes: MARK,
  });
  await Expense.create({
    id: newId(), shop_id: shopId, category_id: expCats[2].id, category_name: 'Packaging',
    description: 'Velvet boxes + carry bags', amount: 1850, payment_mode: 'cash',
    date: dateOnlyAgo(2), notes: MARK,
  });
  await Expense.create({
    id: newId(), shop_id: shopId, category_id: expCats[3].id, category_name: 'Staff Tea',
    description: 'Showroom tea / snacks', amount: 420, payment_mode: 'cash',
    date: dateOnlyAgo(0), notes: MARK,
  });
  await Expense.create({
    id: newId(), shop_id: shopId, category_id: expCats[2].id, category_name: 'Packaging',
    description: 'Hallmark tagging stickers', amount: 780, payment_mode: 'upi',
    date: dateOnlyAgo(5), notes: MARK,
  });

  const petty = await Expense.create({
    id: newId(), shop_id: shopId, category_id: expCats[3].id, category_name: 'Staff Tea',
    description: 'Courier to karigar', amount: 150, payment_mode: 'cash',
    date: dateOnlyAgo(1), notes: MARK,
  });

  // Standalone old-gold buybook (cash purchase, not bill exchange)
  await OldGoldReceipt.create({
    id: newId(), shop_id: shopId, receipt_no: 'DEMO-OG-BUY01',
    customer_id: customers[7].id, invoice_id: null,
    weight_g: 12.35, purity: '22K', rate: RATES.gold_22k,
    value: money(12.35 * RATES.gold_22k), value_paise: Math.round(12.35 * RATES.gold_22k * 100),
    description: 'Cash buy — broken bangle', status: 'in_stock', createdAt: daysAgo(4),
  });
  await OldGoldReceipt.create({
    id: newId(), shop_id: shopId, receipt_no: 'DEMO-OG-BUY02',
    customer_id: customers[9].id, invoice_id: null,
    weight_g: 6.2, purity: '18K', rate: RATES.gold_18k,
    value: money(6.2 * RATES.gold_18k), value_paise: Math.round(6.2 * RATES.gold_18k * 100),
    description: 'Cash buy — old ring', status: 'melted',
    trail_notes: 'Sent to refinery 2 days ago', createdAt: daysAgo(9),
  });
  await OldGoldReceipt.create({
    id: newId(), shop_id: shopId, receipt_no: 'DEMO-OG-BUY03',
    customer_id: customers[1].id, invoice_id: null,
    weight_g: 3.8, purity: '22K', rate: RATES.gold_22k,
    value: money(3.8 * RATES.gold_22k), value_paise: Math.round(3.8 * RATES.gold_22k * 100),
    description: 'Cash buy — small chain', status: 'used',
    trail_notes: 'Used in custom order ORD-2026-011', createdAt: daysAgo(11),
  });

  await CreditNote.create({
    id: newId(), shop_id: shopId, credit_note_no: 'DEMO-CN-001',
    invoice_id: invOldGoldJewellery.id, customer_id: customers[4].id,
    items: [{ name: 'Making charge reverse', amount: 1200 }],
    subtotal: 1200, gst_amount: 36, grand_total: 1236, amount_paise: 123600,
    reason: 'Making overcharged — partial credit', status: 'posted',
  });

  const kidsPayal = byName('Silver Payal Kids');
  if (kidsPayal) {
    const before = Number(kidsPayal.stock_qty) || 0;
    await InventoryAdjustment.create({
      id: newId(), shop_id: shopId, product_id: kidsPayal.id, product_name: kidsPayal.name,
      adjustment_type: 'damage', qty_before: before, qty_change: -1, qty_after: before - 1,
      reason: 'Damaged in display', notes: MARK,
    });
    await kidsPayal.update({ stock_qty: before - 1 });
  }

  await BankAccount.create({
    id: newId(), shop_id: shopId, name: 'HDFC Current', bank_name: 'HDFC Bank',
    account_number: '501000112233', ifsc: 'HDFC0001821', gl_code: '1010',
    opening_balance: 245000, status: 'active', notes: MARK,
  });
  await BankAccount.create({
    id: newId(), shop_id: shopId, name: 'PhonePe UPI', bank_name: 'Yes Bank',
    account_number: 'srinivasa@ybl', ifsc: null, gl_code: '1030',
    opening_balance: 18500, status: 'active', notes: MARK,
  });

  await CashbookEntry.create({
    id: newId(), shop_id: shopId, date: dateOnlyAgo(0), entry_type: 'in', mode: 'cash',
    amount: 25000, reference: 'Till opening', notes: MARK,
  });
  await CashbookEntry.create({
    id: newId(), shop_id: shopId, date: dateOnlyAgo(1), entry_type: 'out', mode: 'cash',
    amount: 150, reference: 'Courier', linked_expense_id: petty.id, notes: MARK, contra: false,
  });
  await CashbookEntry.create({
    id: newId(), shop_id: shopId, date: dateOnlyAgo(0), entry_type: 'in', mode: 'upi',
    amount: 79350, reference: 'DEMO-INV-0102', notes: MARK,
  });

  await DailyClosing.create({
    id: newId(), shop_id: shopId, date: dateOnlyAgo(1),
    opening_cash: 18000, closing_cash: 41250, expected_cash: 41000, variance: 250,
    cash_expenses: 1850, total_sales: 185000, total_expenses: 2650,
    cash_received: 25000, upi_received: 90000, card_received: 0, bank_received: 70000,
    invoice_count: 3, expense_count: 2, status: 'closed', closed_at: daysAgo(1), notes: MARK,
    checklist_json: { cash_counted: true, stock_checked: true },
  });

  for (const h of [
    { code: '7113', description: MARK, gst_pct: 3 },
    { code: '7114', description: MARK, gst_pct: 3 },
    { code: '7108', description: MARK, gst_pct: 3 },
    { code: '7106', description: MARK, gst_pct: 3 },
  ]) {
    const exists = await HsnCode.findOne({ where: { shop_id: shopId, code: h.code } });
    if (!exists) await HsnCode.create({ id: newId(), shop_id: shopId, ...h, is_active: true });
  }

  // Unpaid vendor bill — Purchases → pending payments
  await Purchase.create({
    id: newId(), shop_id: shopId, po_number: 'DEMO-PO-002',
    vendor_id: vendors[1].id, vendor_name: vendors[1].name,
    purchase_date: dateOnlyAgo(5), purchase_type: 'finished_goods',
    items: [{ name: 'Making labour — temple necklace', quantity: 1, amount: 18500 }],
    subtotal: 18500, gst_pct: 3, gst_amount: 555, cgst_amount: 277.5, sgst_amount: 277.5,
    grand_total: 19055, paid_amount: 5000, balance: 14055,
    payments: [{ mode: 'cash', amount: 5000 }],
    status: 'partially_paid', notes: MARK,
  });

  await Campaign.create({
    id: newId(), shop_id: shopId, name: 'DEMO Festival offers',
    type: 'festival', status: 'draft', segment: 'vip',
    message_template: 'Dear {{name}}, Akshaya Tritiya offers are live at Sri Srinivasa Jewellers. Visit us this week.',
    total_recipients: 0, sent_count: 0,
  });

  const demoMeta = {
    at: new Date().toISOString(),
    products: products.length,
    customers: customers.length,
    invoices: 10,
  };
  if (already) await already.update({ value: demoMeta });
  else await Setting.create({ id: newId(), shop_id: shopId, key: 'demo_seed', value: demoMeta });

  console.log('\nDemo data written to SQLite.');
  console.log(`  Counters        ${counterDefs.length}`);
  console.log(`  Products        ${products.length}`);
  console.log(`  Jewellery bills + old-gold exchange + pure gold/silver POS`);
  console.log(`  Old gold buybook, expenses, cashbook, daily close, karigar metal`);
  console.log(`  Estimations, schemes, orders, unpaid purchase`);
  console.log('\nWalk through: POS (jewellery + Pure Gold/Silver + F6 old gold), Accounts (Expenses, Pure Metal, Daily Closing), Reports → Old Gold Buybook.');
  console.log('Quit ERP fully and reopen if it was running.\n');
  await sequelize.close();
}

run().catch(async (err) => {
  console.error('Seed failed:', err.message);
  if (/SQLITE_BUSY|locked/i.test(err.message)) {
    console.error('Quit Jewellery ERP completely (including tray icon), then run this again.');
  }
  try { await sequelize.close(); } catch { /* */ }
  process.exit(1);
});
