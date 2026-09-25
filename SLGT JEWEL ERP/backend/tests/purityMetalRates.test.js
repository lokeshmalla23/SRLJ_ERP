import { calcLineAmounts, purityFactor, resolveLineRate, resolveMetalKind } from '../src/services/billingCalc.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

function almost(a, b, eps = 0.51) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

const GOLD_24K = 7200;
const SILVER_999 = 150;
const SILVER_925 = Math.round((925 / 999) * SILVER_999 * 100) / 100;
const rateMap = {
  '24K': GOLD_24K,
  '22K': Math.round(GOLD_24K * 0.9167),
  Silver: SILVER_925,
  PureSilver: SILVER_999,
};

{
  assert(resolveMetalKind('Gold', '16K') === 'gold', 'gold metal');
  assert(resolveMetalKind('Silver', '925') === 'silver', 'silver metal');
}

{
  const k16 = purityFactor('16K', '16', 'Gold').toNumber();
  assert(almost(k16, 16 / 24, 1e-6), `16K karat factor ${k16}`);
  const f667 = purityFactor('16K', '667', 'Gold').toNumber();
  assert(almost(f667, 667 / 1000, 1e-6), `16K fineness factor ${f667}`);
}

{
  const line = calcLineAmounts({
    net_weight: 1, gross_weight: 1, making_charges: 0, stone_charges: 0,
    purity: '16K', purity_code: '16', metal: 'Gold', quantity: 1,
  }, GOLD_24K, rateMap);
  const expected = GOLD_24K * (16 / 24);
  assert(almost(line.charged_rate, expected), `16K gold rate ${line.charged_rate} expected ${expected}`);
  assert(!almost(line.charged_rate, SILVER_999) && !almost(line.charged_rate, SILVER_925),
    '16K gold must not use silver rates');
}

{
  const byName = calcLineAmounts({
    net_weight: 1, gross_weight: 1, making_charges: 0, stone_charges: 0,
    purity: '16K', metal: 'Gold', quantity: 1,
  }, GOLD_24K, rateMap);
  assert(almost(byName.charged_rate, GOLD_24K * (16 / 24)), `16K from name ${byName.charged_rate}`);
}

{
  const fineness = calcLineAmounts({
    net_weight: 1, gross_weight: 1, making_charges: 0, stone_charges: 0,
    purity: '16K', purity_code: '667', metal: 'Gold', quantity: 1,
  }, GOLD_24K, rateMap);
  assert(almost(fineness.charged_rate, GOLD_24K * 0.667), `16K fineness 667 ${fineness.charged_rate}`);
}

{
  const builtIn = calcLineAmounts({
    net_weight: 1, gross_weight: 1, making_charges: 0, stone_charges: 0,
    purity: '22K', metal: 'Gold', quantity: 1,
  }, GOLD_24K, rateMap);
  assert(almost(builtIn.charged_rate, rateMap['22K']), `22K uses shop 22K rate ${builtIn.charged_rate}`);
}

{
  const sterling = calcLineAmounts({
    net_weight: 1, gross_weight: 1, making_charges: 0, stone_charges: 0,
    purity: 'Sterling 925', purity_code: '925', metal: 'Silver', quantity: 1,
  }, GOLD_24K, rateMap);
  assert(almost(sterling.charged_rate, SILVER_925), `sterling uses 925 rate ${sterling.charged_rate}`);
  assert(!almost(sterling.charged_rate, GOLD_24K * (925 / 1000)), 'silver must not use 24K gold');
}

{
  const custom = calcLineAmounts({
    net_weight: 1, gross_weight: 1, making_charges: 0, stone_charges: 0,
    purity: '800', purity_code: '800', metal: 'Silver', quantity: 1,
  }, GOLD_24K, rateMap);
  const expected = SILVER_999 * (800 / 999);
  assert(almost(custom.charged_rate, expected), `silver 800 ${custom.charged_rate} expected ${expected}`);
}

{
  const rate = resolveLineRate({
    purity: '16K', purity_code: 16, metal: 'Gold',
  }, GOLD_24K, rateMap);
  assert(almost(rate, GOLD_24K * (16 / 24)), `resolveLineRate 16K ${rate}`);
}

console.log('purityMetalRates tests passed');
