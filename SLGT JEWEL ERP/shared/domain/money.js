import Decimal from 'decimal.js';

/** Authoritative money math — 2 decimal places (paise), ROUND_HALF_UP */
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export const MONEY_SCALE = 2;
export const PAYMENT_TOLERANCE = new Decimal('0.50');

/** Integer paise helpers — prefer for new financial persistence. */
export function toPaise(value) {
  return roundMoney(value).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function fromPaise(paise) {
  return toMoneyNumber(D(paise || 0).div(100));
}

/** Weight: store grams at 3 decimal places (milligram precision). */
export const WEIGHT_SCALE = 3;

export function roundWeight(value) {
  return D(value).toDecimalPlaces(WEIGHT_SCALE, Decimal.ROUND_HALF_UP);
}

export function toWeightNumber(value) {
  return roundWeight(value).toNumber();
}

export function toMilligrams(grams) {
  return roundWeight(grams).times(1000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function fromMilligrams(mg) {
  return toWeightNumber(D(mg || 0).div(1000));
}

export function D(value) {
  if (value instanceof Decimal) return value;
  if (value == null || value === '') return new Decimal(0);
  try {
    return new Decimal(value);
  } catch {
    return new Decimal(NaN);
  }
}

export function isValidMoney(value) {
  const d = D(value);
  return d.isFinite() && !d.isNaN();
}

export function roundMoney(value) {
  return D(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

/** Round to the nearest whole rupee (0 decimal places), ROUND_HALF_UP. */
export function roundToRupee(value) {
  return D(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

export function toMoneyNumber(value) {
  return roundMoney(value).toNumber();
}

export function toMoneyString(value) {
  return roundMoney(value).toFixed(MONEY_SCALE);
}

export function sumMoney(values) {
  return values.reduce((acc, v) => acc.plus(D(v)), new Decimal(0));
}

export function nearlyEqual(a, b, tolerance = PAYMENT_TOLERANCE) {
  return roundMoney(a).minus(roundMoney(b)).abs().lte(D(tolerance));
}

/** Coerce DECIMAL/string/number safely for aggregates */
export function asMoney(value) {
  return toMoneyNumber(value);
}

export { Decimal };
