import { D, roundMoney, roundToRupee, toMoneyNumber, sumMoney } from './money.js';
import { computeVaMetrics } from './invoiceLineMetrics.js';

const displayINR = (value) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(toMoneyNumber(value));

/** Purity factors against 24K gold (built-in gold keys only — never used for silver). */
export const PURITY_FACTORS = Object.freeze({
  '24K': '1',
  '22K': '0.9167',
  '18K': '0.75',
  '14K': '0.5833',
});

export const DEFAULT_GST_PCT = '3';
export const VALID_PAYMENT_MODES = Object.freeze([
  'cash', 'upi', 'card', 'bank_transfer', 'cheque', 'old_gold_exchange', 'old_silver_exchange', 'advance',
]);

/**
 * Gold vs silver vs platinum from the product's metal type (authoritative)
 * with a purity-label fallback when metal is missing.
 */
export function resolveMetalKind(metal = '', purity = '') {
  const m = String(metal || '');
  const p = String(purity || '');
  if (/platinum|\bpt\b/i.test(m) || /platinum/i.test(p)) return 'platinum';
  if (/silver/i.test(m)) return 'silver';
  if (/gold/i.test(m)) return 'gold';
  if (/silver|sterling/i.test(p) && !/\d+(\.\d+)?\s*k\b/i.test(p)) return 'silver';
  if (/\d+(\.\d+)?\s*k\b/i.test(p)) return 'gold';
  return 'gold';
}

/** Gold karat 1–24 from labels like "16K" or "18.5K". */
export function parseGoldKarat(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)\s*k\b/i);
  if (!m) return null;
  const k = Number(m[1]);
  if (!Number.isFinite(k) || k < 1 || k > 24) return null;
  return k;
}

/**
 * Maps a purity label to a rateMap key. Metal kind prevents gold 16K / 999
 * fineness from being billed as silver.
 */
export function resolvePurityKey(purity, metalOrKind = null) {
  const p = String(purity || '');
  const kind = (metalOrKind === 'gold' || metalOrKind === 'silver' || metalOrKind === 'platinum')
    ? metalOrKind
    : resolveMetalKind(metalOrKind || '', p);

  if (kind === 'platinum' || /platinum/i.test(p)) return 'Platinum';

  if (kind === 'silver') {
    if (/pure.?silver/i.test(p)) return 'PureSilver';
    if (/\b999\b/.test(p) && !/925|sterling/i.test(p)) return 'PureSilver';
    if (/sterling|\b925\b/i.test(p)) return 'Silver';
    if (/^silver$/i.test(p.trim())) return 'Silver';
    return null;
  }

  if (/\b24\s*k\b/i.test(p) || p.includes('24K')) return '24K';
  if (/\b22\s*k\b/i.test(p) || p.includes('22K')) return '22K';
  if (/\b18\s*k\b/i.test(p) || p.includes('18K')) return '18K';
  if (/\b14\s*k\b/i.test(p) || p.includes('14K')) return '14K';
  return null;
}

/**
 * Gold: code 1–24 = karat (÷ 24 of 24K); code 25–1000 = fineness (÷ 1000 of 24K).
 * Silver: code ÷ 999 of fine silver. Never mix the two metals.
 */
function purityFactorFromCode(code, metalKind, purityLabel) {
  const raw = String(code ?? '').trim();
  const n = Number(raw);

  if (metalKind === 'silver') {
    if (Number.isFinite(n) && n > 0) {
      if (n <= 1) return D(n);
      return D(n).div(999);
    }
    return null;
  }

  if (Number.isFinite(n) && n > 0) {
    if (n <= 1) return D(n);
    if (n <= 24) return D(n).div(24);
    if (n <= 1000) return D(n).div(1000);
  }
  const karat = parseGoldKarat(raw) || parseGoldKarat(purityLabel);
  if (karat) return D(karat).div(24);
  return null;
}

export function purityFactor(label = '', code = null, metal = '') {
  const kind = resolveMetalKind(metal, label);
  const key = resolvePurityKey(label, kind);
  if (kind === 'gold' && key && PURITY_FACTORS[key]) return D(PURITY_FACTORS[key]);
  if (kind === 'silver' && key === 'PureSilver') return D(1);
  if (kind === 'silver' && key === 'Silver') return D(925).div(999);
  const fromCode = purityFactorFromCode(code, kind, label);
  if (fromCode) return fromCode;
  const karat = parseGoldKarat(label);
  if (kind === 'gold' && karat) return D(karat).div(24);
  return D(1);
}

function lineMetalKind(item) {
  return resolveMetalKind(
    item?.metal || item?.metal_name || item?.metal_type || '',
    item?.purity || item?.purity_name || '',
  );
}

function silverFineRate(rateMap = {}) {
  const fine = Number(rateMap.PureSilver);
  if (Number.isFinite(fine) && fine > 0) return D(fine);
  const sterling = Number(rateMap.Silver);
  if (Number.isFinite(sterling) && sterling > 0) return D(sterling).times(999).div(925);
  return null;
}

function goldFineRate(goldRate, rateMap = {}) {
  const r24 = Number(rateMap['24K']);
  if (Number.isFinite(r24) && r24 > 0) return D(r24);
  const g = Number(goldRate);
  if (Number.isFinite(g) && g > 0) return D(g);
  return D(0);
}

function directPurityRate(item, rateMap = {}) {
  const kind = lineMetalKind(item);
  const label = item?.purity || item?.purity_name || '';
  const key = resolvePurityKey(label, kind);
  if (kind === 'platinum') {
    const pt = rateMap.Platinum ?? rateMap.PT950;
    return pt != null ? D(pt) : null;
  }
  if (!key || rateMap[key] == null) return null;
  if (kind === 'silver' && (key === 'Silver' || key === 'PureSilver')) return D(rateMap[key]);
  if (kind === 'gold' && ['24K', '22K', '18K', '14K'].includes(key)) return D(rateMap[key]);
  return null;
}

function resolveRateParts(item, goldRate, rateMap = {}) {
  const kind = lineMetalKind(item);
  const label = item?.purity || item?.purity_name || '';
  const code = item?.purity_code;
  const metal = item?.metal || item?.metal_name || item?.metal_type || '';
  const rawRateOverride = item?.rate_override;
  const rateOverrideNum = rawRateOverride != null && rawRateOverride !== '' ? Number(rawRateOverride) : NaN;
  const useRateOverride = Number.isFinite(rateOverrideNum) && rateOverrideNum > 0;

  if (useRateOverride) return { factor: D(1), effectiveRate: D(rateOverrideNum) };

  const directRate = directPurityRate(item, rateMap);
  if (directRate) return { factor: D(1), effectiveRate: directRate };

  const factor = purityFactor(label, code, metal);
  if (kind === 'silver') {
    return { factor, effectiveRate: silverFineRate(rateMap) ?? D(0) };
  }
  if (kind === 'platinum') {
    return { factor: D(1), effectiveRate: D(rateMap.Platinum ?? rateMap.PT950 ?? 0) };
  }
  return { factor, effectiveRate: goldFineRate(goldRate, rateMap) };
}

/**
 * Effective ₹/g charged for a line (override, built-in rate, or 24K/999 × factor).
 */
export function resolveLineRate(item, goldRate, rateMap = {}) {
  if (Number(item?.rate_override) > 0) return Number(item.rate_override);
  const { factor, effectiveRate } = resolveRateParts(item, goldRate, rateMap);
  const charged = factor.times(effectiveRate);
  if (!charged.isFinite() || charged.lte(0)) return null;
  return Math.round(toMoneyNumber(charged));
}

/**
 * Line calculation — making per_gram uses gross_weight.
 * Shared by cloud (Sequelize) and future desktop (SQLite) repositories.
 */
export function calcLineAmounts(item, goldRate, rateMap = {}) {
  const gw = D(item.gross_weight);
  const nw = D(item.net_weight);
  const { factor, effectiveRate } = resolveRateParts(item, goldRate, rateMap);

  const goldValue = roundMoney(nw.times(factor).times(effectiveRate));

  // Wastage/making overrides — cashier-entered absolute ₹ amounts (POS
  // breakdown edits) replace the percentage/type-based computation below.
  const rawWastageOverride = item.wastage_amount_override;
  const wastageOverrideNum = rawWastageOverride != null && rawWastageOverride !== '' ? Number(rawWastageOverride) : NaN;
  const wastageAmt = Number.isFinite(wastageOverrideNum)
    ? roundMoney(D(wastageOverrideNum))
    : roundMoney(goldValue.times(D(item.wastage_pct || 0)).div(100));

  // Tray items: a flat making charge and all stone charges are entered as a
  // per-piece cost on the product — multiply by the pieces actually sold.
  // per_gram/percentage making already scale correctly via the weight sold
  // (which for a tray line is the total weight sold, priced at quantity=1 —
  // see billingService.js/POS.jsx), so they're left untouched.
  const trayPieces = item.is_tray && Number(item.tray_pieces_sold) > 0
    ? D(item.tray_pieces_sold)
    : D(1);

  const rawMakingOverride = item.making_amount_override;
  const makingOverrideNum = rawMakingOverride != null && rawMakingOverride !== '' ? Number(rawMakingOverride) : NaN;
  let making;
  if (Number.isFinite(makingOverrideNum)) {
    making = roundMoney(D(makingOverrideNum));
  } else if (item.making_charge_type === 'per_gram') {
    making = roundMoney(gw.times(D(item.making_charges || 0)));
  } else if (item.making_charge_type === 'percentage') {
    making = roundMoney(goldValue.times(D(item.making_charges || 0)).div(100));
  } else {
    making = roundMoney(D(item.making_charges || 0).times(trayPieces));
  }

  const stone = roundMoney(D(item.stone_charges || 0).times(trayPieces));
  const computedBase = roundMoney(goldValue.plus(wastageAmt).plus(making).plus(stone));

  // Treat blank / zero override as "use computed" so bad booked locks (price_override: 0)
  // don't zero out weighted jewellery lines.
  const rawOverride = item.price_override;
  const overrideNum = rawOverride != null && rawOverride !== '' ? Number(rawOverride) : NaN;
  const useOverride = Number.isFinite(overrideNum) && overrideNum > 0;
  const unitBase = useOverride ? roundMoney(D(overrideNum)) : computedBase;

  const qty = D(item.quantity || 1);
  if (!qty.isFinite() || qty.lte(0)) {
    throw Object.assign(new Error('Line quantity must be positive'), { code: 'INVALID_QUANTITY' });
  }

  const lineTotal = roundMoney(unitBase.times(qty));
  const chargedRate = factor.times(effectiveRate);
  const va = computeVaMetrics({
    makingAmount: making,
    wastageAmount: wastageAmt,
    chargedRate,
  });
  const productValueExStone = roundMoney(goldValue.plus(wastageAmt).plus(making));

  return {
    gold_value: toMoneyNumber(goldValue),
    metal_value: toMoneyNumber(goldValue),
    wastage_amount: toMoneyNumber(wastageAmt),
    making_amount: toMoneyNumber(making),
    stone_charges: toMoneyNumber(stone),
    charged_rate: toMoneyNumber(chargedRate),
    ...va,
    product_value_ex_stone: toMoneyNumber(productValueExStone),
    unit_price: toMoneyNumber(unitBase),
    quantity: qty.toNumber(),
    line_total: toMoneyNumber(lineTotal),
    computed_base: toMoneyNumber(computedBase),
  };
}

/**
 * Old Gold Exchange value = weight × rate/g. The entered rate is already the
 * actual exchange rate for that gold — no purity multiplier is applied on top.
 *
 * Manual mode (admin-controlled, per shop): the "rate" field is instead the
 * exchange amount itself, typed directly by the cashier — weight and purity
 * are still captured for the receipt/report, but no weight × rate math runs.
 */
export function calcOldGoldValue({ weight, rate, manual = false }) {
  if (manual) {
    if (!rate) return 0;
    return toMoneyNumber(D(rate));
  }
  if (!weight || !rate) return 0;
  return toMoneyNumber(D(weight).times(D(rate)));
}

/**
 * Bill-level totals. GST on after-discount; scheme credit reduces grand.
 * Old Gold Exchange is a PAYMENT, not a deduction — oldGoldValue is validated
 * and returned (for the invoice snapshot / receipt / reporting) but never
 * subtracted from grand_total. It settles the invoice alongside cash/UPI/etc.
 * CGST/SGST: half with remainder on SGST.
 */
export function calcInvoiceTotals({
  lineTotals,
  discount = 0,
  discountType = 'flat',
  gstPct = DEFAULT_GST_PCT,
  oldGoldValue = 0,
  oldSilverValue = 0,
  schemeCredit = 0,
  /** When true (POS preview), clamp bad discount instead of throwing */
  softDiscount = false,
  /** intra = CGST+SGST | inter = full IGST */
  taxType = 'intra',
}) {
  const subtotal = roundMoney(sumMoney(lineTotals));

  let discountAmt = D(0);
  if (discountType === 'pct') {
    discountAmt = roundMoney(subtotal.times(D(discount || 0)).div(100));
  } else {
    discountAmt = roundMoney(D(discount || 0));
  }
  if (discountAmt.lt(0)) {
    if (softDiscount) discountAmt = D(0);
    else throw Object.assign(new Error('Discount cannot be negative'), { code: 'INVALID_DISCOUNT' });
  }
  if (discountAmt.gt(subtotal)) {
    if (softDiscount) discountAmt = subtotal;
    else throw Object.assign(new Error('Discount cannot exceed subtotal'), { code: 'INVALID_DISCOUNT' });
  }

  const afterDisc = subtotal.minus(discountAmt).lt(0) ? D(0) : roundMoney(subtotal.minus(discountAmt));

  // Use nullish coalesce — gstPct 0 must stay 0 (Hidden Bill / non-GST)
  const gstRate = D(gstPct ?? DEFAULT_GST_PCT);
  const gstAmount = roundMoney(afterDisc.times(gstRate).div(100));
  const inter = String(taxType || 'intra').toLowerCase() === 'inter'
    || String(taxType || '').toLowerCase() === 'igst';
  let cgst = D(0);
  let sgst = D(0);
  let igst = D(0);
  if (inter) {
    igst = gstAmount;
  } else {
    cgst = roundMoney(gstAmount.div(2));
    sgst = roundMoney(gstAmount.minus(cgst));
  }

  const oldGold = roundMoney(D(oldGoldValue || 0));
  if (oldGold.lt(0)) {
    if (!softDiscount) {
      throw Object.assign(new Error('Old gold value cannot be negative'), { code: 'INVALID_PAYMENT' });
    }
  }

  const oldGoldSafe = oldGold.lt(0) ? D(0) : oldGold;
  const oldSilver = roundMoney(D(oldSilverValue || 0));
  if (oldSilver.lt(0) && !softDiscount) {
    throw Object.assign(new Error('Old silver value cannot be negative'), { code: 'INVALID_PAYMENT' });
  }
  const oldSilverSafe = oldSilver.lt(0) ? D(0) : oldSilver;
  const schemeRaw = roundMoney(D(schemeCredit || 0));
  if (schemeRaw.lt(0) && !softDiscount) {
    throw Object.assign(new Error('Scheme credit cannot be negative'), { code: 'INVALID_PAYMENT' });
  }
  const schemeSafe = schemeRaw.lt(0) ? D(0) : schemeRaw;

  // Old Gold Exchange is a payment (settled via `payments`), so it does NOT
  // reduce grand_total — only discount (already applied above) and scheme
  // credit shape the payable amount.
  let preRoundGrand = afterDisc.plus(gstAmount).minus(schemeSafe);
  if (preRoundGrand.lt(0)) preRoundGrand = D(0);
  preRoundGrand = roundMoney(preRoundGrand);

  // Final payable is rounded to the nearest whole rupee; round_off is the delta applied.
  const roundedGrand = roundToRupee(preRoundGrand);
  const roundOff = roundMoney(roundedGrand.minus(preRoundGrand));

  return {
    subtotal: toMoneyNumber(subtotal),
    discount: toMoneyNumber(discountAmt),
    discount_type: discountType === 'pct' ? 'pct' : 'flat',
    after_discount: toMoneyNumber(afterDisc),
    gst_pct: toMoneyNumber(gstRate),
    gst_amount: toMoneyNumber(gstAmount),
    cgst_amount: toMoneyNumber(cgst),
    sgst_amount: toMoneyNumber(sgst),
    igst_amount: toMoneyNumber(igst),
    tax_type: inter ? 'inter' : 'intra',
    old_gold_value: toMoneyNumber(oldGoldSafe),
    old_silver_value: toMoneyNumber(oldSilverSafe),
    scheme_credit: toMoneyNumber(schemeSafe),
    grand_total: toMoneyNumber(roundedGrand),
    round_off: toMoneyNumber(roundOff),
  };
}

export function validatePayments(payments, grandTotal, { allowPartial = false } = {}) {
  if (!Array.isArray(payments)) {
    throw Object.assign(new Error('payments must be an array'), { code: 'INVALID_PAYMENT' });
  }

  const cleaned = [];
  for (const p of payments) {
    if (!p || p.amount == null || p.amount === '') continue;
    const amount = D(p.amount);
    if (!amount.isFinite() || amount.isNaN()) {
      throw Object.assign(new Error('Payment amount must be numeric'), { code: 'INVALID_PAYMENT' });
    }
    if (amount.lte(0)) {
      throw Object.assign(new Error('Payment amount must be positive'), { code: 'INVALID_PAYMENT' });
    }
    const mode = String(p.mode || '').toLowerCase();
    if (!VALID_PAYMENT_MODES.includes(mode)) {
      throw Object.assign(new Error(`Invalid payment mode: ${p.mode}`), { code: 'INVALID_PAYMENT' });
    }
    cleaned.push({
      mode,
      amount: toMoneyNumber(amount),
      description: p.description || p.note || null,
      // Old Gold Exchange carries its weight/purity/rate so invoices, receipts,
      // and reprints can show the exchange details without a separate lookup.
      ...(mode === 'old_gold_exchange' && p.old_gold ? { old_gold: p.old_gold } : {}),
      ...(mode === 'old_silver_exchange' && p.old_silver ? { old_silver: p.old_silver } : {}),
    });
  }

  const paid = roundMoney(sumMoney(cleaned.map((p) => p.amount)));
  const grand = roundMoney(D(grandTotal));
  const balance = roundMoney(grand.minus(paid));

  const oldGoldPayment = cleaned.find((p) => p.mode === 'old_gold_exchange');
  if (oldGoldPayment && D(oldGoldPayment.amount).minus(grand).gt(D('0.50'))) {
    throw Object.assign(
      new Error(`Old Gold Exchange (${displayINR(oldGoldPayment.amount)}) exceeds the invoice total (${displayINR(grand)})`),
      { code: 'OLD_GOLD_EXCEEDS_TOTAL', balance: toMoneyNumber(balance) },
    );
  }
  const oldSilverPayment = cleaned.find((p) => p.mode === 'old_silver_exchange');
  if (oldSilverPayment && D(oldSilverPayment.amount).minus(grand).gt(D('0.50'))) {
    throw Object.assign(
      new Error(`Old Silver Exchange (${displayINR(oldSilverPayment.amount)}) exceeds the invoice total (${displayINR(grand)})`),
      { code: 'OLD_SILVER_EXCEEDS_TOTAL', balance: toMoneyNumber(balance) },
    );
  }
  const exchangeSum = D(oldGoldPayment?.amount || 0).plus(oldSilverPayment?.amount || 0);
  if (exchangeSum.minus(grand).gt(D('0.50'))) {
    throw Object.assign(
      new Error(`Old Gold + Old Silver Exchange (${displayINR(exchangeSum)}) exceeds the invoice total (${displayINR(grand)})`),
      { code: 'OLD_METAL_EXCEEDS_TOTAL', balance: toMoneyNumber(balance) },
    );
  }

  if (paid.minus(grand).gt(D('0.50'))) {
    throw Object.assign(
      new Error(`Payment ${displayINR(paid)} exceeds grand total ${displayINR(grand)}`),
      { code: 'INVALID_PAYMENT', balance: toMoneyNumber(balance) },
    );
  }
  if (!allowPartial && grand.minus(paid).gt(D('0.50'))) {
    throw Object.assign(
      new Error(`Payment total ${displayINR(paid)} does not cover grand total ${displayINR(grand)} (balance ${displayINR(balance)})`),
      { code: 'INVALID_PAYMENT', balance: toMoneyNumber(balance) },
    );
  }

  return {
    payments: cleaned,
    paid_total: toMoneyNumber(paid),
    balance: toMoneyNumber(balance),
    status: balance.abs().lte(D('0.50')) ? 'paid' : 'partial',
  };
}
