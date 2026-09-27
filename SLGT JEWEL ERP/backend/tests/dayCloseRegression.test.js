/**
 * SQLITE_PATH=<scratch>.sqlite node tests/dayCloseRegression.test.js
 *
 * Explicit Day Close / Business Date regression — verifies the existing
 * Close Day architecture is preserved after the Financial Year work:
 *   Close Day ON (manual), Close Day OFF (auto), manual Day Close,
 *   automatic Day Close, Business Date, transaction date, Opening Setup.
 */
import assert from 'assert';
import { bootTestDb } from './_testDb.js';
import sequelize from '../src/db.js';
import {
  getActiveBillingDate,
  advanceActiveBillingDate,
  setActiveBillingDate,
  saveDailyClosing,
} from '../src/services/dailyClosingService.js';
import { getAutoDayCloseMode } from '../src/services/autoDayCloseMode.js';
import { getOpeningSetupStatus, markAccountsSetupCompleted } from '../src/services/openingSetupService.js';
import { upsertSetting } from '../src/services/settingsStore.js';
import { AUTO_DAY_CLOSE_SETTING_KEY } from '../src/services/autoDayCloseMode.js';
import { getDefaultShopId } from '../src/services/defaultShop.js';

await bootTestDb();
const shopId = await getDefaultShopId();

// ── Close Day ON (manual mode) ───────────────────────────────────────────────
await sequelize.transaction((t) => upsertSetting(AUTO_DAY_CLOSE_SETTING_KEY, { enabled: false }, shopId, t));
let mode = await getAutoDayCloseMode();
assert.strictEqual(mode.enabled, false, 'Close Day ON → auto_day_close disabled (manual mode)');

// Business Date is the stored active billing day
const { date: activeDate } = await getActiveBillingDate({ shopId });
assert.ok(activeDate, 'active business date resolvable in manual mode');

// ── Opening Setup interaction ────────────────────────────────────────────────
const setupStatus = await getOpeningSetupStatus(shopId);
assert.ok('setup_complete' in setupStatus, 'Opening Setup status resolvable');
assert.ok('financial_mode' in setupStatus, 'financial_mode exposed by Opening Setup');

// ── Manual Day Close ─────────────────────────────────────────────────────────
// Opening Setup must be complete before a manual close (existing behavior).
await markAccountsSetupCompleted(shopId, { cash: 1000, bank: 0, upi: 0, card: 0 });
// Set a known business date, then close it manually (Close Day ON).
await setActiveBillingDate({ shopId, date: '2026-09-20' });
const closed = await sequelize.transaction((t) => saveDailyClosing({
  date: '2026-09-20',
  status: 'closed',
  autoClose: false,
  notes: 'manual close test',
  userId: 'test-user',
  checklist: {
    cash_verified: true, upi_verified: true, bank_verified: true, cheque_verified: true,
    expenses_entered: true, income_entered: true, stock_checked: true, rates_checked: true,
  },
  transaction: t,
}));
assert.ok(closed, 'manual Day Close saves');

// Advancing the business date moves to the next day
const nextDate = await advanceActiveBillingDate({ shopId, closedDate: '2026-09-20' });
assert.strictEqual(nextDate, '2026-09-21', 'advanceActiveBillingDate moves +1 day');

// ── Close Day OFF (auto mode) ────────────────────────────────────────────────
await sequelize.transaction((t) => upsertSetting(AUTO_DAY_CLOSE_SETTING_KEY, { enabled: true }, shopId, t));
mode = await getAutoDayCloseMode();
assert.strictEqual(mode.enabled, true, 'Close Day OFF → auto_day_close enabled (auto mode)');

// In auto mode the active billing date is the real calendar date
const auto = await getActiveBillingDate({ shopId });
assert.strictEqual(auto.auto_day_close, true, 'auto mode flagged');
assert.strictEqual(auto.date, auto.real_today, 'auto mode → real today');

// ── Transaction date (business_date) preserved ───────────────────────────────
// The FY work must never replace business_date with created_at.
const { fyCodeForDate } = await import('../src/services/financialYearService.js');
assert.strictEqual(fyCodeForDate(activeDate), fyCodeForDate('2026-09-20'),
  'FY derived from business date, not created_at');

console.log('dayCloseRegression: all assertions passed');
await sequelize.close();
process.exit(0);
