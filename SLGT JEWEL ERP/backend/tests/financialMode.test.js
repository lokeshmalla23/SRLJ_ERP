/**
 * node tests/financialMode.test.js
 *
 * Generic PRE_ACCOUNTS vs LIVE classification. Does not hardcode invoice
 * numbers, amounts, or company names. Does not mark Accounts Setup complete.
 */
import assert from 'assert';
import sequelize from '../src/db.js';
import { Invoice, Payment, Product, InventoryMovement } from '../src/models/index.js';
import { getErpStatement } from '../src/services/accountsModuleService.js';
import { getDefaultShopId } from '../src/services/defaultShop.js';
import { getOpeningSetupStatus } from '../src/services/openingSetupService.js';
import {
  FINANCIAL_MODE,
  backfillFinancialModes,
  isPreAccountsRecord,
  isLiveFinancialRecord,
  resolveFinancialMode,
} from '../src/services/financialMode.js';
import { isVoidOrFullyReturnedStatus } from '../src/utils/invoiceVisibility.js';

assert.strictEqual(isPreAccountsRecord({ financial_mode: 'PRE_ACCOUNTS' }), true);
assert.strictEqual(isPreAccountsRecord({ financial_mode: 'LIVE' }), false);
assert.strictEqual(isLiveFinancialRecord({ financial_mode: 'PRE_ACCOUNTS' }), false);
assert.strictEqual(isLiveFinancialRecord({ financial_mode: 'LIVE' }), true);
assert.strictEqual(isLiveFinancialRecord({ is_opening: true, financial_mode: 'PRE_ACCOUNTS' }), true);
assert.ok(!Product.rawAttributes.financial_mode, 'inventory Product must not carry financial_mode');
assert.ok(!InventoryMovement.rawAttributes.financial_mode, 'InventoryMovement must not carry financial_mode');
assert.ok(Invoice.rawAttributes.financial_mode, 'Invoice must carry financial_mode');

await sequelize.authenticate();
if (sequelize.getDialect() === 'sqlite') {
  const { ensureLocalSqliteSchema } = await import('../src/services/ensureLocalSqliteSchema.js');
  await ensureLocalSqliteSchema();
}
const backfill = await backfillFinancialModes(sequelize);
assert.ok(backfill.shops >= 0);

const shopId = await getDefaultShopId();
const status = await getOpeningSetupStatus(shopId);
const mode = await resolveFinancialMode(shopId);

if (status.accounts_setup_status === 'PENDING' || !status.setup_complete) {
  assert.strictEqual(mode, FINANCIAL_MODE.PRE_ACCOUNTS);
  assert.strictEqual(status.financial_mode, FINANCIAL_MODE.PRE_ACCOUNTS);
  assert.ok(!status.accounts_go_live_at);
} else {
  assert.strictEqual(mode, FINANCIAL_MODE.LIVE);
  assert.strictEqual(status.financial_mode, FINANCIAL_MODE.LIVE);
}

const invoices = await Invoice.findAll({ where: shopId ? { shop_id: shopId } : {} });
const stmt = await getErpStatement({ from: '2000-01-01', to: '2099-12-31' });
const rows = stmt.rows || [];

const preAccounts = invoices.filter((inv) => isPreAccountsRecord(inv));
for (const inv of preAccounts) {
  const hits = rows.filter((r) => r.source_id === inv.id
    && ['sale', 'refund', 'old_gold_exchange'].includes(r.source_type));
  assert.strictEqual(
    hits.length,
    0,
    'PRE_ACCOUNTS invoice must not appear in the LIVE ERP Statement',
  );
}

const cancelledPre = preAccounts.filter((inv) => inv.cancelled_at || isVoidOrFullyReturnedStatus(inv.status));
for (const inv of cancelledPre) {
  const recon = rows.filter((r) => r.source_type === 'gl_reconciliation');
  const hits = rows.filter((r) => r.source_id === inv.id);
  assert.strictEqual(hits.length, 0, 'cancelled PRE_ACCOUNTS invoice must have zero LIVE statement rows');
  void recon;
}

const liveInvoices = invoices.filter((inv) => !isPreAccountsRecord(inv));
void liveInvoices;
void Payment;

console.log('financialMode.test.js: ok', {
  shopId,
  accounts_setup_status: status.accounts_setup_status,
  financial_mode: status.financial_mode,
  invoices: invoices.length,
  pre_accounts: preAccounts.length,
  cancelled_pre_accounts: cancelledPre.length,
  statement_rows: rows.length,
  gl_reconciliation: rows.some((r) => r.source_type === 'gl_reconciliation'),
  backfill_notes: backfill.notes || [],
});
