import { parseJsonField } from '../utils.js';
import { D, roundMoney, toMoneyNumber } from '../utils/money.js';

/** Advance to next Monday if date falls on weekend (Sat/Sun). */
export function nextBusinessDay(date) {
  const d = new Date(date);
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() + 2); // Saturday → Monday
  if (day === 0) d.setDate(d.getDate() + 1); // Sunday → Monday
  return d;
}

/** Gold gram schemes (Swarnakala) vs cash bonus schemes (fixed amount / 11+1). */
export function isGoldGramScheme(schemeRow) {
  const json = schemeRow?.toJSON ? schemeRow.toJSON() : schemeRow;
  const type = String(json?.scheme_type || '').toLowerCase();
  const planType = String(json?.plan_type || '').toLowerCase();
  return type === 'swarnakala' || planType === 'weight';
}

/** True when every committed installment has been paid (bonus months do not count). */
export function isSchemeFullyPaid(schemeRow) {
  const json = schemeRow?.toJSON ? schemeRow.toJSON() : schemeRow;
  const payments = parseJsonField(json?.payments, []);
  const list = Array.isArray(payments) ? payments : [];
  const duration = Number(json?.duration_months) || 0;
  const monthly = Number(json?.monthly_amount) || 0;
  const totalPaid = list.reduce((sum, p) => sum + (Number(p?.amount) || 0), 0);
  const target = monthly * duration;
  if (duration > 0 && list.length >= duration) return true;
  if (target > 0 && totalPaid + 0.009 >= target) return true;
  return String(json?.status) === 'matured';
}

/**
 * After the scheme credit is used on a jewellery bill:
 *   all installments paid → completed (collected / matured)
 *   used mid-scheme     → breaked (only paid-to-date was credited)
 */
export function schemeStatusAfterRedemption(schemeRow) {
  return isSchemeFullyPaid(schemeRow) ? 'completed' : 'breaked';
}

/**
 * Redeemable value when applying a scheme against a jewellery bill.
 *
 * Gold (swarnakala): Σ grams_credited × today's gold rate
 * Cash (fixed_amount / 11+1): when fully paid / matured → monthly × (duration + bonus);
 *   otherwise → total paid so far (no bonus on a mid-scheme break).
 */
export function computeSchemeRedeemableValue(schemeRow, { goldRate = 0, bonusMonths } = {}) {
  const json = schemeRow?.toJSON ? schemeRow.toJSON() : schemeRow;
  const payments = parseJsonField(json.payments, []);
  const totalPaid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const monthly = Number(json.monthly_amount) || 0;
  const duration = Number(json.duration_months) || 0;
  const bonus = Number(
    json.bonus_months != null ? json.bonus_months : (bonusMonths != null ? bonusMonths : 0),
  ) || 0;
  const maturityValue = monthly * (duration + bonus);
  const goldMode = isGoldGramScheme(json);

  if (goldMode) {
    let totalGrams = D(0);
    for (const p of payments) {
      const stored = Number(p.grams_credited);
      if (Number.isFinite(stored) && stored > 0) {
        totalGrams = totalGrams.plus(D(stored));
        continue;
      }
      const dayRate = Number(p.gold_rate_at_payment);
      const amt = Number(p.amount) || 0;
      if (dayRate > 0 && amt > 0) {
        totalGrams = totalGrams.plus(D(amt).div(D(dayRate)));
      }
    }
    const gramsNum = Number(totalGrams.toFixed(4));
    const todayRate = Number(goldRate) || 0;
    const goldValue = gramsNum > 0 && todayRate > 0
      ? toMoneyNumber(roundMoney(totalGrams.times(D(todayRate))))
      : totalPaid;

    return {
      credit_type: 'gold',
      grams: gramsNum,
      amount: goldValue,
      total_paid: totalPaid,
      maturity_value: maturityValue,
      label: gramsNum > 0 ? `${gramsNum.toFixed(3)}g gold` : 'Gold savings',
    };
  }

  // Cash saving scheme (e.g. Swarnalakshmi Cash 11+1)
  const matured = isSchemeFullyPaid(json);
  const amount = matured ? Math.max(maturityValue, totalPaid) : totalPaid;
  const bonusAmt = matured ? toMoneyNumber(monthly * bonus) : 0;

  return {
    credit_type: 'amount',
    grams: 0,
    amount: toMoneyNumber(roundMoney(D(amount || 0))),
    total_paid: totalPaid,
    maturity_value: maturityValue,
    bonus_amount: bonusAmt,
    label: matured
      ? `Cash savings + ${bonus} mo bonus`
      : 'Cash savings (bonus after maturity)',
  };
}

/**
 * Derives months_paid, next_due_date, maturity_date, maturity_value for UI/reports.
 */
export function computeSchemeDueInfo(schemeRow) {
  const json = schemeRow?.toJSON ? schemeRow.toJSON() : schemeRow;
  const payments = parseJsonField(json.payments, []);
  const monthsPaid = payments.length;
  const durationMonths = Number(json.duration_months) || 0;
  const bonusMonths = Number(json.bonus_months) || 0;
  const monthsRemaining = Math.max(0, durationMonths - monthsPaid);
  const totalPaid = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const monthly = Number(json.monthly_amount) || 0;
  const targetAmount = monthly * durationMonths;
  const maturityValue = monthly * (durationMonths + bonusMonths);

  const start = new Date(json.start_date);
  const maturityDate = new Date(start);
  // Maturity after paid duration (+ bonus is credit, not extra wait month for due calendar)
  maturityDate.setMonth(maturityDate.getMonth() + durationMonths);

  let nextDueDate = null;
  if (json.status === 'active' && monthsPaid < durationMonths) {
    const rawDue = new Date(start);
    rawDue.setMonth(rawDue.getMonth() + monthsPaid);
    nextDueDate = nextBusinessDay(rawDue);
  }

  return {
    ...json,
    months_paid: monthsPaid,
    months_remaining: monthsRemaining,
    total_paid: totalPaid,
    target_amount: targetAmount,
    maturity_value: maturityValue,
    maturity_date: maturityDate.toISOString().slice(0, 10),
    next_due_date: nextDueDate ? nextDueDate.toISOString().slice(0, 10) : null,
    _next_due_date_obj: nextDueDate,
  };
}
