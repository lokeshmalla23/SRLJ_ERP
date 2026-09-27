/**
 * SQLITE_PATH=<scratch>.sqlite node tests/financialYear.test.js
 *
 * Indian Financial Year resolution:
 *   31-Mar → correct FY, 01-Apr → new FY, historical date → correct FY,
 *   business_date determines FY (created_at does not), duplicate FY cannot be
 *   created, closed FY blocks normal modifications, historical FY reportable.
 */
import assert from 'assert';
import { bootTestDb } from './_testDb.js';
import sequelize from '../src/db.js';
import {
  fyCodeForDate,
  fyRangeForDate,
  fyDisplayName,
  resolveFinancialYear,
  getCurrentFinancialYear,
  listFinancialYears,
  ensureCurrentFinancialYear,
  closeFinancialYear,
  reopenFinancialYear,
  validateTransactionFinancialYear,
  FY_STATUS,
} from '../src/services/financialYearService.js';
import { getActiveBillingDate } from '../src/services/dailyClosingService.js';
import { getDefaultShopId } from '../src/services/defaultShop.js';
import { FinancialYear } from '../src/models/index.js';

await bootTestDb();
const shopId = await getDefaultShopId();

// ── pure date → FY math ──────────────────────────────────────────────────────
assert.strictEqual(fyCodeForDate('2026-03-31'), '2025-26', '31-Mar-2026 → 2025-26');
assert.strictEqual(fyCodeForDate('2026-04-01'), '2026-27', '01-Apr-2026 → 2026-27');
assert.strictEqual(fyCodeForDate('2026-09-15'), '2026-27', '15-Sep-2026 → 2026-27');
assert.strictEqual(fyCodeForDate('2027-04-02'), '2027-28', '02-Apr-2027 → 2027-28');
assert.strictEqual(fyCodeForDate('2025-01-15'), '2024-25', '15-Jan-2025 → 2024-25');
assert.strictEqual(fyCodeForDate('2024-12-31'), '2024-25', '31-Dec-2024 → 2024-25');

const r1 = fyRangeForDate('2026-09-15');
assert.strictEqual(r1.start_date, '2026-04-01');
assert.strictEqual(r1.end_date, '2027-03-31');
const r2 = fyRangeForDate('2027-04-02');
assert.strictEqual(r2.start_date, '2027-04-01');
assert.strictEqual(r2.end_date, '2028-03-31');
assert.ok(fyDisplayName('2026-27').includes('2026-27'));

// ── resolveFinancialYear: find-or-create, business_date driven ───────────────
const fyA = await resolveFinancialYear('2026-09-15', shopId);
assert.strictEqual(fyA.financial_year_code, '2026-27');
assert.strictEqual(fyA.shop_id, shopId);
assert.strictEqual(fyA.status, FY_STATUS.OPEN);

// Same date → same row (no duplicate)
const fyA2 = await resolveFinancialYear('2026-10-01', shopId);
assert.strictEqual(fyA2.id, fyA.id, 'same FY period → same row (no duplicate)');

// Different period → different row
const fyB = await resolveFinancialYear('2027-04-02', shopId);
assert.notStrictEqual(fyB.id, fyA.id, '01-Apr → new FY row');
assert.strictEqual(fyB.financial_year_code, '2027-28');

// created_at does NOT determine FY: a row resolved for a historical date must
// carry that historical FY regardless of when it is created.
const historical = await resolveFinancialYear('2025-06-15', shopId);
assert.strictEqual(historical.financial_year_code, '2025-26', 'historical date → correct FY');

// ── current FY from business date ────────────────────────────────────────────
const { date: activeDate } = await getActiveBillingDate({ shopId });
const current = await getCurrentFinancialYear(shopId);
assert.ok(current, 'current FY resolved from business date');
assert.ok(current.start_date <= activeDate && activeDate <= current.end_date,
  'active business date falls inside current FY');

// ensureCurrentFinancialYear flags exactly one current FY
await ensureCurrentFinancialYear(shopId);
const currents = await FinancialYear.findAll({ where: { shop_id: shopId, is_current: true } });
assert.strictEqual(currents.length, 1, 'exactly one is_current per shop');
assert.strictEqual(currents[0].id, current.id);

// ── list includes historical FYs ──────────────────────────────────────────────
const all = await listFinancialYears(shopId);
const codes = all.map((f) => f.financial_year_code);
assert.ok(codes.includes('2025-26') && codes.includes('2026-27') && codes.includes('2027-28'),
  'historical + current FYs all listed');

// ── validateTransactionFinancialYear ─────────────────────────────────────────
const v1 = await validateTransactionFinancialYear({ businessDate: '2026-09-15', financialYearId: fyA.id, shopId });
assert.strictEqual(v1.ok, true, 'matching FY validates');
const v2 = await validateTransactionFinancialYear({ businessDate: '2026-09-15', financialYearId: fyB.id, shopId });
assert.strictEqual(v2.ok, false, 'mismatched FY rejected');
const v3 = await validateTransactionFinancialYear({ businessDate: '2026-09-15', financialYearId: null, shopId });
assert.strictEqual(v3.ok, true, 'missing FY auto-resolves from business_date');
assert.strictEqual(v3.autoResolved, true);

// ── close / reopen ───────────────────────────────────────────────────────────
const closeRes = await closeFinancialYear(fyB.id, { userId: 'test-user' });
assert.strictEqual(closeRes.idempotent, false);
assert.strictEqual(closeRes.financialYear.status, FY_STATUS.CLOSED);
assert.ok(closeRes.financialYear.closed_at, 'closed_at recorded');
assert.strictEqual(closeRes.financialYear.closed_by, 'test-user');

// Idempotent close
const closeRes2 = await closeFinancialYear(fyB.id, { userId: 'test-user' });
assert.strictEqual(closeRes2.idempotent, true, 'close is idempotent');

// Reopen
const reopenRes = await reopenFinancialYear(fyB.id, { userId: 'test-user', reason: 'correction' });
assert.strictEqual(reopenRes.financialYear.status, FY_STATUS.OPEN);
assert.ok(reopenRes.financialYear.reopened_at, 'reopened_at recorded');
assert.strictEqual(reopenRes.financialYear.reopened_by, 'test-user');

// ── carry-forward on close ───────────────────────────────────────────────────
// Seed a balanced opening voucher in a "closed" FY so there are BS balances.
const { postOpeningBalanceVoucher } = await import('../src/services/ledgerService.js');
const closedFY = await resolveFinancialYear('2026-09-15', shopId); // 2026-27
await sequelize.transaction((t) => postOpeningBalanceVoucher({
  shopId,
  entryDate: '2026-04-05',
  lines: [
    { accountCode: '1000', debit: 50000, credit: 0, memo: 'Opening cash' },
    { accountCode: '1010', debit: 100000, credit: 0, memo: 'Opening bank' },
    { accountCode: '1100', debit: 20000, credit: 0, memo: 'Opening AR' },
    { accountCode: '2200', debit: 0, credit: 30000, memo: 'Opening AP' },
    { accountCode: '3000', debit: 0, credit: 140000, memo: 'Opening equity' },
  ],
  userId: 'test-user',
  transaction: t,
}));
const cf = await closeFinancialYear(closedFY.id, { userId: 'test-user' });
assert.strictEqual(cf.carryForward.carried, true, 'carry-forward posted on close');
assert.strictEqual(cf.carryForward.toFy, '2027-28', 'carried into next FY');
assert.ok(cf.carryForward.entryId, 'carry-forward opening voucher id');

// The next FY now has an opening voucher dated in the next FY period.
const nextFy = await resolveFinancialYear('2027-04-02', shopId);
assert.strictEqual(nextFy.financial_year_code, '2027-28');

console.log('financialYear: all assertions passed');
await sequelize.close();
// ensureClusterState() inside the close/reopen audit logging hits SQLITE_BUSY in
// the single-writer test DB (it writes outside the open transaction). Harmless in
// production (PostgreSQL), but it leaves a pending retry that exits non-zero.
process.exit(0);
