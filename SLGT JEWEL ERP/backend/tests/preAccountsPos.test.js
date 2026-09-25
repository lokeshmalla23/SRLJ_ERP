/**
 * node tests/preAccountsPos.test.js
 *
 * PRE_ACCOUNTS / TEST POS: allow billing while Accounts Setup is pending,
 * without touching LIVE stock, GL, or ERP Statement.
 * Does not hardcode invoice numbers, amounts, or company names.
 * Does not mark Accounts Setup complete.
 */
import 'dotenv/config';
import assert from 'assert';
import { randomUUID } from 'crypto';
import sequelize from '../src/db.js';
import { Product, Invoice, InventoryMovement, JournalEntry } from '../src/models/index.js';
import { createInvoice, cancelInvoice } from '../src/services/billingService.js';
import { calcInvoiceTotals, calcLineAmounts } from '../src/services/billingCalc.js';
import { INVENTORY_MODES, MOVEMENT_TYPES } from '../src/constants/inventory.js';
import { newId } from '../src/utils.js';
import { getDefaultShopId } from '../src/services/defaultShop.js';
import { getOpeningSetupStatus } from '../src/services/openingSetupService.js';
import { getErpStatement } from '../src/services/accountsModuleService.js';
import { generalLedger } from '../src/services/accountingControlsService.js';
import {
  FINANCIAL_MODE,
  isPreAccountsRecord,
  resolveFinancialMode,
} from '../src/services/financialMode.js';
import { recordMovement } from '../src/services/inventoryService.js';

const RATE_MAP = { '24K': 7000, '22K': 6400, '18K': 5200, Silver: 90 };

await sequelize.authenticate();
if (sequelize.getDialect() === 'sqlite') {
  const { ensureLocalSqliteSchema } = await import('../src/services/ensureLocalSqliteSchema.js');
  await ensureLocalSqliteSchema();
}

const shopId = await getDefaultShopId();
assert.ok(shopId, 'shop');
const status = await getOpeningSetupStatus(shopId);
const mode = await resolveFinancialMode(shopId);

if (status.accounts_setup_status === 'COMPLETED' || mode === FINANCIAL_MODE.LIVE) {
  console.log('preAccountsPos.test.js: skipped (shop already LIVE)');
  process.exit(0);
}

assert.strictEqual(mode, FINANCIAL_MODE.PRE_ACCOUNTS);

const { Setting } = await import('../src/models/index.js');
const gold = await Setting.findOne({ where: { key: 'gold_rate' } });
if (!gold) {
  await Setting.create({
    id: newId(),
    key: 'gold_rate',
    value: { gold_24k: 7000, gold_22k: 6400, gold_18k: 5200, silver: 90 },
  });
}

const product = await Product.create({
  id: newId(),
  shop_id: shopId,
  name: `PreAcc Qty ${Date.now()}`,
  barcode: `PA-${newId().slice(0, 8)}`,
  stock_qty: 5,
  inventory_mode: INVENTORY_MODES.QUANTITY,
  status: 'available',
  net_weight: 10,
  gross_weight: 11,
  wastage_pct: 0,
  making_charges: 500,
  making_charge_type: 'fixed',
  purity_id: null,
});
await sequelize.transaction(async (t) => {
  await recordMovement({
    shopId,
    product,
    movementType: MOVEMENT_TYPES.OPENING,
    quantity: 5,
    qtyBefore: 0,
    qtyAfter: 5,
    referenceType: 'test',
    transaction: t,
  });
});

const line = calcLineAmounts({
  net_weight: 10,
  gross_weight: 11,
  wastage_pct: 0,
  making_charges: 500,
  making_charge_type: 'fixed',
  stone_charges: 0,
  purity: '22K',
  quantity: 1,
}, 7000, RATE_MAP);
const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });

const result = await createInvoice({
  items: [{ product_id: product.id, quantity: 1, purity: '22K' }],
  payments: [{ mode: 'cash', amount: totals.grand_total }],
  gold_rate: 7000,
  gold_22k: 6400,
  request_id: randomUUID(),
});

const invoice = result.invoice;
assert.ok(invoice?.id, 'invoice created while Accounts Setup pending');
assert.ok(isPreAccountsRecord(invoice), 'invoice classified PRE_ACCOUNTS');
assert.ok(String(invoice.invoice_no || '').startsWith('TEST'), `TEST invoice number, got ${invoice.invoice_no}`);

await product.reload();
assert.strictEqual(Number(product.stock_qty), 5, 'TEST POS must not reduce LIVE stock_qty');

const saleMoves = await InventoryMovement.findAll({
  where: { reference_id: invoice.id, movement_type: 'SALE' },
});
assert.ok(saleMoves.length >= 1, 'test SALE movement recorded');
for (const mv of saleMoves) {
  assert.strictEqual(Number(mv.qty_before), Number(mv.qty_after), 'test movement is reversible (qty unchanged)');
}

const stmt = await getErpStatement({ from: '2000-01-01', to: '2099-12-31' });
const stmtHits = (stmt.rows || []).filter((r) => r.source_id === invoice.id);
assert.strictEqual(stmtHits.length, 0, 'TEST invoice must not appear in LIVE ERP Statement');

const gl = await generalLedger({ shopId, accountCode: '1000', from: '2000-01-01', to: '2099-12-31', limit: 5000 });
const glHits = (gl.lines || gl.rows || []).filter((r) => r.source_id === invoice.id);
assert.strictEqual(glHits.length, 0, 'TEST invoice must not appear in LIVE cash GL');

const testJournals = await JournalEntry.findAll({
  where: { source_id: invoice.id },
});
for (const je of testJournals) {
  assert.ok(isPreAccountsRecord(je), 'journals for TEST invoice stay PRE_ACCOUNTS');
}

await cancelInvoice(invoice.id, {
  reason: 'preAccountsPos.test',
  refund: [{ mode: 'cash', amount: Number(invoice.grand_total) }],
});
const cancelled = await Invoice.findByPk(invoice.id);
assert.ok(cancelled?.cancelled_at || cancelled?.status === 'cancelled', 'TEST invoice can be cancelled');
await product.reload();
assert.strictEqual(Number(product.stock_qty), 5, 'cancelling TEST invoice must not inflate LIVE stock');

const { InvoiceItem, Payment, InventoryMovement: Move } = await import('../src/models/index.js');
await InvoiceItem.destroy({ where: { invoice_id: invoice.id } }).catch(() => 0);
await Payment.destroy({ where: { invoice_id: invoice.id } }).catch(() => 0);
await Move.destroy({ where: { reference_id: invoice.id } }).catch(() => 0);
await Move.destroy({ where: { product_id: product.id } }).catch(() => 0);
await Invoice.destroy({ where: { id: invoice.id } });
await product.destroy();

console.log('preAccountsPos.test.js: ok', {
  shopId,
  invoice_no: invoice.invoice_no,
  financial_mode: invoice.financial_mode,
  stock_qty: 5,
});
process.exit(0);
