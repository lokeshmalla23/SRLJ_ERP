/**
 * SQLITE_PATH=<scratch>.sqlite node tests/profitLossGate.test.js
 *
 * Application Management → Profit & Loss is the single gate for every
 * client-facing profitability figure: ON → P&L works, OFF → refused and not
 * computed, ON again → returns. Underlying COGS posting is untouched.
 */
import assert from 'assert';
import { bootTestDb, mockRes } from './_testDb.js';
import sequelize from '../src/db.js';
import { upsertSetting } from '../src/services/settingsStore.js';
import { PROFIT_LOSS_SETTING_KEY } from '../src/services/profitLossMode.js';
import { requireProfitLossEnabled } from '../src/middleware/requireProfitLoss.js';
import { getAccountsDashboard } from '../src/services/accountsModuleService.js';
import { getDefaultShopId } from '../src/services/defaultShop.js';

await bootTestDb();
const shopId = await getDefaultShopId();

async function setPl(enabled) {
  await sequelize.transaction((t) => upsertSetting(PROFIT_LOSS_SETTING_KEY, { enabled }, shopId, t));
}
async function gate() {
  const res = mockRes();
  let passed = false;
  await requireProfitLossEnabled({}, res, () => { passed = true; });
  return { passed, res };
}

// ON
await setPl(true);
let g = await gate();
assert.strictEqual(g.passed, true, 'P&L ON → /pnl and /balance-sheet allowed');
let dash = await getAccountsDashboard({});
assert.ok('gross_profit' in dash.kpis && 'net_profit' in dash.kpis, 'P&L ON → dashboard profit KPIs present');

// OFF
await setPl(false);
g = await gate();
assert.strictEqual(g.passed, false, 'P&L OFF → refused');
assert.strictEqual(g.res.statusCode, 403);
assert.strictEqual(g.res.body.code, 'PROFIT_LOSS_DISABLED');
dash = await getAccountsDashboard({});
assert.ok(!('gross_profit' in dash.kpis) && !('net_profit' in dash.kpis), 'P&L OFF → no profit KPIs computed');
assert.ok('cash_in_hand' in dash.kpis, 'P&L OFF → non-profit KPIs still served');

// ON again
await setPl(true);
g = await gate();
assert.strictEqual(g.passed, true, 'P&L ON again → allowed');
dash = await getAccountsDashboard({});
assert.ok('net_profit' in dash.kpis, 'P&L ON again → profit KPIs return');

// Default (no setting) is OFF
await sequelize.query(`DELETE FROM settings WHERE key = '${PROFIT_LOSS_SETTING_KEY}'`);
g = await gate();
assert.strictEqual(g.passed, false, 'unconfigured → OFF');

console.log('profitLossGate: all assertions passed');
await sequelize.close();
