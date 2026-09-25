import { D, roundMoney, roundToRupee, toMoneyNumber, sumMoney } from '@/lib/money';
import { fmtINR } from '@/lib/format';

export {
  PURITY_FACTORS,
  resolveMetalKind,
  parseGoldKarat,
  resolvePurityKey,
  purityFactor,
  resolveLineRate,
  calcLineAmounts,
  calcOldGoldValue,
} from '@crm/domain/billing';

/**
 * Old Gold Exchange purity suggestions — a label only (no multiplier is
 * applied to the exchange value). Selectable via datalist AND freely typed,
 * shared by POS and Estimation so both offer the same list.
 */
export const OLD_GOLD_PURITY_SUGGESTIONS = Object.freeze(['24K', '22K', '20K', '18.5K', '18K', '14K', '916', '750']);
export const OLD_SILVER_PURITY_SUGGESTIONS = Object.freeze(['999', '925', '900', '800', '70%']);

export const DEFAULT_GST_PCT = '3';
export const VALID_PAYMENT_MODES = Object.freeze([
  'cash', 'upi', 'card', 'bank_transfer', 'cheque', 'old_gold_exchange', 'old_silver_exchange',
]);

export function calcInvoiceTotals({
  lineTotals,
  discount = 0,
  discountType = 'flat',
  gstPct = DEFAULT_GST_PCT,
  oldGoldValue = 0,
  oldSilverValue = 0,
  schemeCredit = 0,
  softDiscount = true,
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
  if (inter) igst = gstAmount;
  else {
    cgst = roundMoney(gstAmount.div(2));
    sgst = roundMoney(gstAmount.minus(cgst));
  }

  const oldGoldSafe = D(oldGoldValue || 0).lt(0) ? D(0) : roundMoney(D(oldGoldValue || 0));
  const oldSilverSafe = D(oldSilverValue || 0).lt(0) ? D(0) : roundMoney(D(oldSilverValue || 0));
  const schemeSafe = D(schemeCredit || 0).lt(0) ? D(0) : roundMoney(D(schemeCredit || 0));
  // Old Gold Exchange is a payment (settled via `payments`), not a deduction —
  // it does not reduce grand_total. Only discount and scheme credit do.
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

export function validatePayments(payments, grandTotal) {
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
      new Error(`Old Gold Exchange (${fmtINR(oldGoldPayment.amount)}) exceeds the invoice total (${fmtINR(grand)})`),
      { code: 'OLD_GOLD_EXCEEDS_TOTAL', balance: toMoneyNumber(balance) },
    );
  }
  const oldSilverPayment = cleaned.find((p) => p.mode === 'old_silver_exchange');
  if (oldSilverPayment && D(oldSilverPayment.amount).minus(grand).gt(D('0.50'))) {
    throw Object.assign(
      new Error(`Old Silver Exchange (${fmtINR(oldSilverPayment.amount)}) exceeds the invoice total (${fmtINR(grand)})`),
      { code: 'OLD_SILVER_EXCEEDS_TOTAL', balance: toMoneyNumber(balance) },
    );
  }
  const exchangeSum = D(oldGoldPayment?.amount || 0).plus(oldSilverPayment?.amount || 0);
  if (exchangeSum.minus(grand).gt(D('0.50'))) {
    throw Object.assign(
      new Error(`Old Gold + Old Silver Exchange (${fmtINR(exchangeSum)}) exceeds the invoice total (${fmtINR(grand)})`),
      { code: 'OLD_METAL_EXCEEDS_TOTAL', balance: toMoneyNumber(balance) },
    );
  }

  if (paid.minus(grand).gt(D('0.50'))) {
    throw Object.assign(
      new Error(`Payment ${fmtINR(paid)} exceeds grand total ${fmtINR(grand)}`),
      { code: 'INVALID_PAYMENT', balance: toMoneyNumber(balance) },
    );
  }
  if (grand.minus(paid).gt(D('0.50'))) {
    throw Object.assign(
      new Error(`Payment total ${fmtINR(paid)} does not cover grand total ${fmtINR(grand)} (balance ${fmtINR(balance)})`),
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
