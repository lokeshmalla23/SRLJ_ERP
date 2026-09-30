/**
 * Data for the three scheme documents (Creation Print, Statement, Closure
 * Certificate). Assembles only what the ERP actually stores — scheme row,
 * its payments JSON, the linked customer, the enrolling employee
 * (salesperson_id → employees.name/mobile) and the redemption invoice
 * (invoices.scheme_id) — nothing is invented.
 *
 * Lifecycle (existing statuses, unchanged):
 *   active    → collecting installments
 *   matured   → all installments paid, credit not yet used
 *   completed → closed: credit used / collected at maturity
 *   breaked   → closed: credit used before maturity (paid-to-date only)
 *   cancelled → closed (legacy status shown by the UI)
 */
import { Op } from 'sequelize';
import { Customer, Employee, Invoice, Scheme } from '../models/index.js';
import { parseJsonField } from '../utils.js';
import { computeSchemeDueInfo, computeSchemeRedeemableValue, isGoldGramScheme, nextBusinessDay } from './schemeDueService.js';
import { toYmd } from '../utils/financialYear.js';

export const CLOSED_SCHEME_STATUSES = Object.freeze(['completed', 'breaked', 'cancelled']);

const STATUS_LABELS = {
  active: 'Active',
  matured: 'Matured',
  completed: 'Completed',
  breaked: 'Pre-closed (Breaked)',
  cancelled: 'Cancelled',
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function payments(scheme) {
  let value = parseJsonField(scheme?.payments, []);
  if (typeof value === 'string') value = parseJsonField(value, []);
  return Array.isArray(value) ? value : [];
}

function paymentDate(p) {
  return toYmd(p?.business_date) || toYmd(p?.paid_at) || toYmd(p?.recorded_at);
}

function addMonthsYmd(ymd, months) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1 + months, d);
  return toYmd(nextBusinessDay(dt));
}

function closureReason(status, redemption) {
  if (status === 'completed') {
    return redemption?.invoice_no
      ? `All installments paid — scheme value redeemed on invoice ${redemption.invoice_no}`
      : 'All installments paid — scheme value collected at maturity';
  }
  if (status === 'breaked') {
    return redemption?.invoice_no
      ? `Closed before maturity — paid-to-date value redeemed on invoice ${redemption.invoice_no}`
      : 'Closed before maturity — paid-to-date value redeemed';
  }
  if (status === 'cancelled') return 'Scheme cancelled';
  return null;
}

export async function getSchemePrintData(schemeId, { goldRate = 0, businessDate = null } = {}) {
  const scheme = await Scheme.findByPk(schemeId);
  if (!scheme) return null;
  const json = scheme.toJSON();
  const list = payments(json);
  const due = computeSchemeDueInfo({ ...json, payments: list });
  const redeemable = computeSchemeRedeemableValue({ ...json, payments: list }, { goldRate });
  const status = String(json.status || 'active').toLowerCase();
  const isClosed = CLOSED_SCHEME_STATUSES.includes(status);
  const goldMode = isGoldGramScheme(json);

  const [customer, salesperson, invoice] = await Promise.all([
    json.customer_id
      ? Customer.findByPk(json.customer_id, { attributes: ['id', 'serial_no', 'name', 'mobile', 'address'] })
      : null,
    json.salesperson_id
      ? Employee.findByPk(json.salesperson_id, { attributes: ['id', 'name', 'mobile', 'employee_code', 'job_title'] })
      : null,
    Invoice.findOne({
      where: { scheme_id: json.id, cancelled_at: { [Op.is]: null } },
      attributes: ['id', 'invoice_no', 'business_date', 'created_at', 'scheme_credit', 'grand_total'],
      order: [['created_at', 'DESC']],
    }),
  ]);

  const redemption = (json.redeemed_at || invoice)
    ? {
      redeemed_at: json.redeemed_at || null,
      redeemed_on: toYmd(invoice?.business_date) || toYmd(json.redeemed_at),
      method: invoice ? 'invoice' : 'manual',
      invoice_no: invoice?.invoice_no || null,
      invoice_date: toYmd(invoice?.business_date) || toYmd(invoice?.created_at),
      scheme_credit: invoice ? round2(invoice.scheme_credit) : null,
      invoice_total: invoice ? round2(invoice.grand_total) : null,
    }
    : null;

  // Installment table: every recorded payment, then (while still collecting)
  // the remaining installments with their due date.
  const today = toYmd(businessDate) || toYmd(new Date());
  const installments = list.map((p, i) => ({
    installment_no: i + 1,
    payment_date: paymentDate(p),
    reference: p.reference || null,
    payment_id: p.id || null,
    amount: round2(p.amount),
    mode: p.mode || null,
    gold_rate: p.gold_rate_at_payment != null ? Number(p.gold_rate_at_payment) : null,
    grams: p.grams_credited != null ? Number(p.grams_credited) : null,
    status: 'Paid',
  }));
  const duration = Number(json.duration_months) || 0;
  if (!isClosed && status !== 'matured') {
    for (let n = list.length; n < duration; n += 1) {
      const dueDate = addMonthsYmd(json.start_date, n);
      installments.push({
        installment_no: n + 1,
        due_date: dueDate,
        payment_date: null,
        reference: null,
        amount: round2(json.monthly_amount),
        mode: null,
        status: dueDate && today && dueDate < today ? 'Overdue' : 'Pending',
      });
    }
  }

  const target = round2((Number(json.monthly_amount) || 0) * duration);
  const totalPaid = round2(redeemable.total_paid);
  const lastPaid = list.map(paymentDate).filter(Boolean).sort().pop() || null;
  const totalGrams = goldMode
    ? Number(list.reduce((s, p) => s + (Number(p.grams_credited) || 0), 0).toFixed(3))
    : null;

  return {
    scheme: {
      id: json.id,
      serial_no: json.serial_no ?? null,
      plan_name: json.plan_name,
      scheme_type: json.scheme_type,
      plan_type: json.plan_type,
      is_gold_scheme: goldMode,
      monthly_amount: round2(json.monthly_amount),
      duration_months: duration,
      bonus_months: Number(json.bonus_months) || 0,
      start_date: toYmd(json.start_date),
      maturity_date: due.maturity_date,
      next_due_date: due.next_due_date,
      status,
      status_label: STATUS_LABELS[status] || status,
      notes: json.notes || null,
      financial_mode: json.financial_mode || null,
      created_at: json.created_at || json.createdAt || null,
    },
    customer: {
      id: json.customer_id || null,
      serial_no: customer?.serial_no ?? null,
      name: json.customer_name || customer?.name || null,
      mobile: json.customer_mobile || customer?.mobile || null,
      address: customer?.address || null,
    },
    enrolled_by: salesperson
      ? {
        id: salesperson.id,
        name: salesperson.name,
        mobile: salesperson.mobile || null,
        employee_code: salesperson.employee_code || null,
        job_title: salesperson.job_title || null,
      }
      : null,
    summary: {
      total_installments: duration,
      paid_installments: list.length,
      pending_installments: isClosed || status === 'matured' ? 0 : Math.max(0, duration - list.length),
      total_amount: target,
      maturity_value: round2(redeemable.maturity_value),
      amount_paid: totalPaid,
      amount_pending: isClosed || status === 'matured' ? 0 : round2(Math.max(0, target - totalPaid)),
      unpaid_at_closure: isClosed ? round2(Math.max(0, target - totalPaid)) : null,
      last_payment_date: lastPaid,
      total_grams: totalGrams,
      redeemable_amount: round2(redeemable.amount),
      redeemable_label: redeemable.label,
      bonus_amount: redeemable.bonus_amount != null ? round2(redeemable.bonus_amount) : null,
    },
    installments,
    redemption,
    lifecycle: {
      status,
      label: STATUS_LABELS[status] || status,
      is_matured: status === 'matured' || ['completed'].includes(status),
      is_redeemed: Boolean(redemption),
      is_closed: isClosed,
      closure_date: isClosed
        ? (redemption?.redeemed_on || toYmd(json.updated_at || json.updatedAt))
        : status === 'matured'
          ? (due.maturity_date || lastPaid)
          : null,
      closure_reason: isClosed
        ? closureReason(status, redemption)
        : status === 'matured'
          ? 'All installments paid — scheme matured'
          : null,
    },
  };
}
