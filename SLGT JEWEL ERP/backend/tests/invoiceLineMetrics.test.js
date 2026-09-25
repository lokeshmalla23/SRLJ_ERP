import { calcLineAmounts, calcInvoiceTotals } from '../src/services/billingCalc.js';
import {
  formatInvoiceDescription,
  computeVaMetrics,
  compactStoneNames,
  normalizeStoneRows,
  isDetailedStoneBill,
} from '../../shared/domain/invoiceLineMetrics.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

function almost(a, b, eps = 0.011) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

function run() {
  console.log('1. Category (Subcategory) description');
  assert(formatInvoiceDescription('Rings', 'Plain', 'Gold Ring') === 'Rings (Plain)', 'rings plain');
  assert(formatInvoiceDescription('Chains', 'Fancy', 'x') === 'Chains (Fancy)', 'chains fancy');
  assert(formatInvoiceDescription('Rings', '', 'Gold Ring') === 'Rings', 'missing subcategory');
  assert(formatInvoiceDescription('Rings', null, 'Gold Ring') === 'Rings', 'null subcategory');
  assert(formatInvoiceDescription('', 'Plain', 'Gold Ring') === 'Plain', 'missing category');
  assert(formatInvoiceDescription('', '', 'Gold CUTS') === 'Gold CUTS', 'fallback name');
  assert(!formatInvoiceDescription('Rings', '', '').includes('()'), 'no empty parens');

  console.log('2. VA grams ROUND_HALF_UP to 3 decimals (precise money, not display grams)');
  const va = computeVaMetrics({ makingAmount: 15000, wastageAmount: 7000, chargedRate: 14650 });
  assert(almost(va.va_amount, 22000), `va_amount ${va.va_amount}`);
  assert(va.va_weight_display === 1.502, `display ${va.va_weight_display}`);
  assert(va.va_weight > 1.5017 && va.va_weight < 1.5018, `precise ${va.va_weight}`);
  // Must NOT use 1.502 × 14650 for money
  const wrong = Math.round(1.502 * 14650 * 100) / 100;
  assert(!almost(va.va_value, wrong) || almost(va.va_value, 22000), 'va_value uses precise weight');
  assert(computeVaMetrics({ makingAmount: 0, wastageAmount: 0, chargedRate: 14650 }).va_weight_display === 0, 'zero VA');
  {
    const r = computeVaMetrics({ makingAmount: 1.23450 * 1000, wastageAmount: 0, chargedRate: 1000 });
    assert(r.va_weight_display === 1.235, `1.23450 → ${r.va_weight_display}`);
  }

  console.log('3. Metal value + product value excluding stones');
  const line = calcLineAmounts({
    net_weight: 9.5,
    gross_weight: 10,
    wastage_pct: 0,
    making_charges: 15000,
    making_charge_type: 'fixed',
    wastage_amount_override: 7000,
    stone_charges: 12500,
    purity: '22K',
    quantity: 1,
  }, 14650, { '22K': 14650 });
  assert(almost(line.metal_value, 9.5 * 14650), `metal ${line.metal_value}`);
  assert(almost(line.product_value_ex_stone, line.metal_value + line.va_value), 'product ex stone = metal + VA');
  assert(almost(line.line_total, line.product_value_ex_stone + line.stone_charges), 'line_total = product + stones');
  assert(line.va_weight_display === 1.502, `line VA display ${line.va_weight_display}`);

  console.log('4. GST calculation UNCHANGED (still on line_total, not on GSTIN presence)');
  const totals = calcInvoiceTotals({
    lineTotals: [line.line_total],
    discount: 0,
    discountType: 'flat',
    gstPct: 3,
  });
  const expectedGst = Math.round(line.line_total * 0.03 * 100) / 100;
  assert(almost(totals.gst_amount, expectedGst) || almost(totals.gst_amount, line.line_total * 0.03), `gst ${totals.gst_amount}`);
  assert(almost(totals.cgst_amount + totals.sgst_amount, totals.gst_amount), 'cgst+sgst = gst');

  console.log('5. Compact stone names + detailed flag default');
  const stones = normalizeStoneRows([
    { stone_type: 'Emerald', count: 2, total_carat: 0.25, price: 4000 },
    { stone_type: 'Ruby', count: 3, total_carat: 0.18, price: 3500 },
    { stone_type: 'Diamond', count: 4, total_carat: 0.20, price: 5000 },
  ]);
  assert(compactStoneNames(stones) === 'Emerald, Ruby, Diamond', compactStoneNames(stones));
  assert(isDetailedStoneBill({}) === false, 'legacy default off');
  assert(isDetailedStoneBill({ detailed_stone_bill: true }) === true, 'on');
  assert(isDetailedStoneBill({ detailed_stone_bill: 0 }) === false, 'sqlite 0');
  assert(isDetailedStoneBill({ detailed_stone_bill: 1 }) === true, 'sqlite 1');

  console.log('6. Mixed metals use their own rates (not a single 22K invoice rate)');
  const gold22 = calcLineAmounts({
    net_weight: 1, gross_weight: 1, making_charges: 0, stone_charges: 0, purity: '22K', quantity: 1,
  }, 16000, { '22K': 14650, '18K': 11950, Silver: 95 });
  const gold18 = calcLineAmounts({
    net_weight: 1, gross_weight: 1, making_charges: 0, stone_charges: 0, purity: '18K', quantity: 1,
  }, 16000, { '22K': 14650, '18K': 11950, Silver: 95 });
  const silver = calcLineAmounts({
    net_weight: 1, gross_weight: 1, making_charges: 0, stone_charges: 0, purity: 'Silver', quantity: 1,
  }, 16000, { '22K': 14650, '18K': 11950, Silver: 95 });
  assert(almost(gold22.charged_rate, 14650), `22K rate ${gold22.charged_rate}`);
  assert(almost(gold18.charged_rate, 11950), `18K rate ${gold18.charged_rate}`);
  assert(almost(silver.charged_rate, 95), `silver rate ${silver.charged_rate}`);

  console.log('invoiceLineMetrics + billingCalc checks passed');
}

run();
