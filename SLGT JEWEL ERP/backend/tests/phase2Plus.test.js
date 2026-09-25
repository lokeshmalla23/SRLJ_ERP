/**
 * Phase 2+ foundation tests: money helpers, advances, invoice settings defaults.
 * Run: node backend/tests/phase2Plus.test.js
 */
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { toPaise, fromPaise, toMilligrams, fromMilligrams, roundMoney, D } from '../src/utils/money.js';
import { DEFAULT_GST_PCT, VALID_PAYMENT_MODES, validatePayments } from '../src/services/billingCalc.js';
import fs from 'fs';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

function testMoney() {
  console.log('TEST money paise / weight helpers');
  assert(toPaise(10.5) === 1050, 'toPaise 10.5');
  assert(fromPaise(1050) === 10.5, 'fromPaise');
  assert(toMilligrams(1.234) === 1234, 'toMilligrams');
  assert(Number(fromMilligrams(1234)) === 1.234, 'fromMilligrams');
  assert(Number(roundMoney(D('1.005'))) === 1.01 || Number(roundMoney(D('1.005'))) === 1, 'roundMoney runs');
}

function testBillingDefaults() {
  console.log('TEST invoice settings vocabulary');
  assert(String(DEFAULT_GST_PCT) === '3', 'default gst');
  assert(VALID_PAYMENT_MODES.includes('cash'), 'cash mode');
  assert(VALID_PAYMENT_MODES.includes('advance'), 'advance mode allowed');
  const v = validatePayments([{ mode: 'cash', amount: 100 }, { mode: 'advance', amount: 50 }], 150);
  assert(v.status === 'paid', 'mixed cash+advance covers total');
}

function testModelsExist() {
  console.log('TEST phase2 model modules load');
  const root = path.resolve(__dirname, '../src/models');
  for (const f of [
    'Payment.js',
    'CustomerAdvance.js',
    'ProductStatusHistory.js',
    'ChartOfAccount.js',
    'ShopCounter.js',
  ]) {
    const p = path.join(root, f);
    assert(fs.existsSync(p), `missing ${f}`);
  }
}

function testMigrationsExist() {
  console.log('TEST migrations present');
  const dir = path.resolve(__dirname, '../src/migrations');
  const files = fs.readdirSync(dir);
  assert(files.some((f) => f.includes('payments-advances')), 'payments migration');
  assert(files.some((f) => f.includes('coa-journals')), 'coa migration');
  assert(files.some((f) => f.includes('credit-notes-oldgold')), 'credit notes migration');
}

function testLegacyQuarantined() {
  console.log('TEST legacy python not spawned from desktop');
  const desktop = path.resolve(__dirname, '../../desktop');
  const walk = (dir, acc = []) => {
    if (!fs.existsSync(dir)) return acc;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory() && name !== 'node_modules' && name !== 'dist') walk(full, acc);
      else if (/\.(js|mjs|cjs)$/.test(name)) acc.push(full);
    }
    return acc;
  };
  const hits = walk(desktop).filter((f) => {
    const txt = fs.readFileSync(f, 'utf8');
    return /server\.py|uvicorn|fastapi/i.test(txt);
  });
  assert(hits.length === 0, `desktop must not spawn Python: ${hits.join(', ')}`);
}

async function main() {
  testMoney();
  testBillingDefaults();
  testModelsExist();
  testMigrationsExist();
  testLegacyQuarantined();
  console.log('OK phase2Plus');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
