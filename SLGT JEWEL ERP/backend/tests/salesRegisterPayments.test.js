import assert from 'assert';
import { salesRegisterPaymentSplit, sumSalesRegisterTotals } from '../src/utils/salesRegisterPayments.js';

function split(payments, extra = {}) {
  return salesRegisterPaymentSplit({ payments, ...extra });
}

// TEST 1 — CASH
{
  const r = split([{ mode: 'cash', amount: 10000 }]);
  assert.strictEqual(r.cash, 10000);
  assert.strictEqual(r.upi, 0);
  assert.strictEqual(r.bank, 0);
  assert.strictEqual(r.old_metal, 0);
}

// TEST 2 — UPI
{
  const r = split([{ mode: 'upi', amount: 10000 }]);
  assert.strictEqual(r.cash, 0);
  assert.strictEqual(r.upi, 10000);
  assert.strictEqual(r.bank, 0);
  assert.strictEqual(r.old_metal, 0);
}

// TEST 3 — CARD → Bank
{
  const r = split([{ mode: 'card', amount: 10000 }]);
  assert.strictEqual(r.bank, 10000);
  assert.strictEqual(r.cash, 0);
}

// TEST 4 — CHEQUE → Bank
{
  const r = split([{ mode: 'cheque', amount: 10000 }]);
  assert.strictEqual(r.bank, 10000);
}

// TEST 5 — BANK TRANSFER → Bank
{
  const r = split([{ mode: 'bank_transfer', amount: 10000 }]);
  assert.strictEqual(r.bank, 10000);
}

// TEST 6 — SPLIT PAYMENT
{
  const r = split([
    { mode: 'cash', amount: 2000 },
    { mode: 'upi', amount: 3000 },
    { mode: 'card', amount: 5000 },
  ]);
  assert.strictEqual(r.cash, 2000);
  assert.strictEqual(r.upi, 3000);
  assert.strictEqual(r.bank, 5000);
  assert.strictEqual(r.old_metal, 0);
}

// TEST 7 — OLD METAL (payment amount, not weight)
{
  const r = split(
    [{ mode: 'old_gold_exchange', amount: 20000 }, { mode: 'cash', amount: 5000 }],
    { old_gold_value: 20000 },
  );
  assert.strictEqual(r.old_metal, 20000);
  assert.strictEqual(r.cash, 5000);
}

// TEST 8 — SPLIT WITH OLD METAL + bank grouping
{
  const r = split([
    { mode: 'old_gold_exchange', amount: 20000 },
    { mode: 'cash', amount: 5000 },
    { mode: 'upi', amount: 10000 },
    { mode: 'card', amount: 15000 },
  ]);
  assert.strictEqual(r.old_metal, 20000);
  assert.strictEqual(r.cash, 5000);
  assert.strictEqual(r.upi, 10000);
  assert.strictEqual(r.bank, 15000);
}

// Card + cheque + bank transfer collapse into Bank
{
  const r = split([
    { mode: 'cash', amount: 10000 },
    { mode: 'upi', amount: 10000 },
    { mode: 'cheque', amount: 20000 },
    { mode: 'bank_transfer', amount: 10000 },
    { mode: 'old_gold_exchange', amount: 50000 },
  ]);
  assert.strictEqual(r.cash, 10000);
  assert.strictEqual(r.upi, 10000);
  assert.strictEqual(r.bank, 30000);
  assert.strictEqual(r.old_metal, 50000);
}

// Old Metal is the exchange VALUE, never the weight
{
  const r = split(
    [{ mode: 'old_gold_exchange', amount: 1430, old_gold: { weight: 0.1, rate: 14300, purity: '22K' } }],
  );
  assert.strictEqual(r.old_metal, 1430);
}

// Legacy invoice: old_gold_value with no payment row (do not double-count)
{
  const withRow = split(
    [{ mode: 'old_gold_exchange', amount: 60000 }],
    { old_gold_value: 60000 },
  );
  assert.strictEqual(withRow.old_metal, 60000);

  const legacy = split([], { old_gold_value: 60000 });
  assert.strictEqual(legacy.old_metal, 60000);
}

// Do not derive from tax fields
{
  const r = salesRegisterPaymentSplit({
    payments: [{ mode: 'cash', amount: 1000 }],
    cgst_amount: 15,
    sgst_amount: 15,
    igst_amount: 0,
    tax_type: 'intra',
  });
  assert.strictEqual(r.cash, 1000);
  assert.strictEqual(r.bank, 0);
}

// Totals of visible rows
{
  const totals = sumSalesRegisterTotals([
    { taxable: 100, discount: 10, cash: 50, upi: 0, bank: 40, old_metal: 0, grand_total: 90 },
    { taxable: 200, discount: 0, cash: 0, upi: 100, bank: 50, old_metal: 50, grand_total: 200 },
  ]);
  assert.strictEqual(totals.taxable, 300);
  assert.strictEqual(totals.discount, 10);
  assert.strictEqual(totals.cash, 50);
  assert.strictEqual(totals.upi, 100);
  assert.strictEqual(totals.bank, 90);
  assert.strictEqual(totals.old_metal, 50);
  assert.strictEqual(totals.grand_total, 290);
}

console.log('salesRegisterPayments.test.js: all assertions passed');
