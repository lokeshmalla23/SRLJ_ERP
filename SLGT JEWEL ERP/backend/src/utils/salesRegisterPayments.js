/**
 * Sales Accounts Register payment-mode split.
 *
 * Reads the actual POS invoice `payments` JSON (never tax fields).
 *
 * Display buckets:
 *   cash      → cash
 *   upi       → upi
 *   bank      → card + cheque + bank_transfer (+ legacy `bank`)
 *   old_metal  → old_gold_exchange amount (legacy fallback: invoice.old_gold_value)
 *   old_silver → old_silver_exchange amount (legacy fallback: invoice.old_silver_value)
 *
 * Extra modes (advance, unknown) are returned separately so amounts are not
 * silently dropped — they are not shown as Sales Accounts Register columns
 * unless the report UI chooses to.
 */
import { toMoneyNumber } from './money.js';

const BANK_MODES = new Set(['card', 'cheque', 'bank_transfer', 'bank']);
const OLD_METAL_MODES = new Set(['old_gold_exchange', 'old_gold', 'exchange']);
const OLD_SILVER_MODES = new Set(['old_silver_exchange', 'old_silver']);
const ADVANCE_MODES = new Set(['advance', 'customer_advance', 'scheme', 'scheme_credit']);

function normalizeMode(mode) {
  return String(mode || '').toLowerCase().replace(/\s+/g, '_');
}

function paymentListOf(inv) {
  const raw = inv?.payments;
  if (Array.isArray(raw)) return raw;
  return [];
}

export function salesRegisterPaymentSplit(inv) {
  const payments = paymentListOf(inv);
  let cash = 0;
  let upi = 0;
  let bank = 0;
  let oldMetal = 0;
  let oldSilver = 0;
  let advance = 0;
  let other = 0;
  let hasOldMetalPayment = false;
  let hasOldSilverPayment = false;

  for (const p of payments) {
    const mode = normalizeMode(p?.mode);
    const amt = Number(p?.amount) || 0;
    if (!amt) continue;
    if (mode === 'cash') cash += amt;
    else if (mode === 'upi') upi += amt;
    else if (BANK_MODES.has(mode)) bank += amt;
    else if (OLD_METAL_MODES.has(mode)) {
      oldMetal += amt;
      hasOldMetalPayment = true;
    } else if (OLD_SILVER_MODES.has(mode)) {
      oldSilver += amt;
      hasOldSilverPayment = true;
    } else if (ADVANCE_MODES.has(mode)) advance += amt;
    else other += amt;
  }

  // Legacy invoices stored Old Gold Exchange as a grand-total deduction
  // (no payment row). Use the persisted invoice value — never re-rate metal.
  if (!hasOldMetalPayment) {
    oldMetal += Number(inv?.old_gold_value) || 0;
  }
  if (!hasOldSilverPayment) {
    oldSilver += Number(inv?.old_silver_value) || 0;
  }

  return {
    cash: toMoneyNumber(cash),
    upi: toMoneyNumber(upi),
    bank: toMoneyNumber(bank),
    old_metal: toMoneyNumber(oldMetal),
    old_silver: toMoneyNumber(oldSilver),
    advance: toMoneyNumber(advance),
    other: toMoneyNumber(other),
  };
}

export function sumSalesRegisterTotals(rows) {
  const keys = ['taxable', 'discount', 'cash', 'upi', 'bank', 'old_metal', 'old_silver', 'grand_total', 'advance', 'other'];
  const totals = {};
  for (const key of keys) {
    totals[key] = toMoneyNumber((rows || []).reduce((s, r) => s + (Number(r[key]) || 0), 0));
  }
  return totals;
}
