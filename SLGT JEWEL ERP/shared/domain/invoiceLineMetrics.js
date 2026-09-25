import { D, roundMoney, toMoneyNumber, toWeightNumber } from './money.js';

/** Invoice Description = Category (Subcategory), with safe fallbacks. */
export function formatInvoiceDescription(categoryName, subcategoryName, fallback = '') {
  const cat = String(categoryName || '').trim();
  const sub = String(subcategoryName || '').trim();
  if (cat && sub) return `${cat} (${sub})`;
  if (cat) return cat;
  if (sub) return sub;
  return String(fallback || '').trim();
}

/**
 * VA Amount = making + wastage.
 * VA Weight = VA Amount / charged metal rate (precise).
 * Display weight is ROUND_HALF_UP to 3 decimals.
 * Monetary VA value uses the precise weight, not the rounded display grams.
 */
export function computeVaMetrics({ makingAmount = 0, wastageAmount = 0, chargedRate = 0 } = {}) {
  const vaAmount = roundMoney(D(makingAmount).plus(D(wastageAmount)));
  const rate = D(chargedRate);
  if (!vaAmount.isFinite() || vaAmount.lte(0) || !rate.isFinite() || rate.lte(0)) {
    return {
      va_amount: toMoneyNumber(vaAmount.isFinite() ? vaAmount : 0),
      va_weight: 0,
      va_weight_display: 0,
      va_value: toMoneyNumber(vaAmount.isFinite() ? vaAmount : 0),
    };
  }
  const vaWeightPrecise = vaAmount.div(rate);
  return {
    va_amount: toMoneyNumber(vaAmount),
    va_weight: vaWeightPrecise.toNumber(),
    va_weight_display: toWeightNumber(vaWeightPrecise),
    va_value: toMoneyNumber(roundMoney(vaWeightPrecise.times(rate))),
  };
}

export function normalizeStoneRows(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  if (!Array.isArray(list)) return [];
  return list.map((s) => ({
    stone_type: String(s?.stone_type || s?.name || '').trim(),
    count: Number(s?.count ?? s?.qty ?? s?.quantity) || 0,
    total_carat: Number(s?.total_carat ?? s?.weight ?? s?.carat) || 0,
    price: Number(s?.price ?? s?.amount ?? s?.charged_amount) || 0,
  })).filter((s) => s.stone_type || s.price > 0 || s.count > 0 || s.total_carat > 0);
}

export function compactStoneNames(stones) {
  const names = [...new Set((stones || []).map((s) => s.stone_type).filter(Boolean))];
  return names.join(', ');
}

/** Per-invoice flag. Missing/legacy records default to compact (off). */
export function isDetailedStoneBill(invoice) {
  const v = invoice?.detailed_stone_bill
    ?? (Array.isArray(invoice?.items) ? invoice.items[0]?.detailed_stone_bill : undefined);
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}
