import { Op } from 'sequelize';
import { Scheme } from '../../models/index.js';
import { toMoneyNumber } from '../../utils/money.js';
import { parsePagination, paginatedResult } from '../../utils/reportQuery.js';
import { computeSchemeDueInfo } from '../../services/schemeDueService.js';
import { parseJsonField } from '../../utils.js';
import { invoiceOccurredAt } from '../../utils/invoiceRead.js';

const OVERDUE_GRACE_DAYS = 15;

// GET /api/reports/schemes/list — paginated, with the derived fields
// (months_paid, months_remaining, next_due_date, maturity_date, maturity_value)
// the old Reports.jsx Schemes tab expected but /api/schemes never returned.
export const listSchemesReport = async (req, res, next) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    const { limit, offset } = parsePagination(req.query);
    const { count, rows } = await Scheme.findAndCountAll({ where, order: [['created_at', 'DESC']], limit, offset });
    const data = rows.map((s) => {
      const { _next_due_date_obj, ...rest } = computeSchemeDueInfo(s);
      return rest;
    });
    return res.json(paginatedResult(count, data));
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/schemes/upcoming-maturity?days=30
export const upcomingMaturity = async (req, res, next) => {
  try {
    const withinDays = Math.max(parseInt(req.query.days, 10) || 30, 1);
    const { limit, offset } = parsePagination(req.query);
    const schemes = await Scheme.findAll({ where: { status: 'active' } });
    const now = new Date();
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + withinDays);

    const data = schemes
      .map((s) => { const { _next_due_date_obj, ...rest } = computeSchemeDueInfo(s); return rest; })
      .filter((s) => new Date(s.maturity_date) >= now && new Date(s.maturity_date) <= horizon)
      .sort((a, b) => new Date(a.maturity_date) - new Date(b.maturity_date));

    return res.json(paginatedResult(data.length, data.slice(offset, offset + limit)));
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/schemes/missed-installments — active schemes with at least
// one installment past due (same "due" definition as /schemes/payments-due).
export const missedInstallments = async (req, res, next) => {
  try {
    const { limit, offset } = parsePagination(req.query);
    const schemes = await Scheme.findAll({ where: { status: 'active' } });
    const today = new Date();
    const data = schemes
      .map((s) => computeSchemeDueInfo(s))
      .filter((s) => s._next_due_date_obj != null && s._next_due_date_obj <= today)
      .map(({ _next_due_date_obj, ...rest }) => ({ ...rest, days_overdue: Math.floor((today - _next_due_date_obj) / 86400000) }));
    data.sort((a, b) => b.days_overdue - a.days_overdue);
    return res.json(paginatedResult(data.length, data.slice(offset, offset + limit)));
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/schemes/overdue — missed installments beyond a grace period
export const overdueInstallments = async (req, res, next) => {
  try {
    const { limit, offset } = parsePagination(req.query);
    const schemes = await Scheme.findAll({ where: { status: 'active' } });
    const today = new Date();
    const data = schemes
      .map((s) => computeSchemeDueInfo(s))
      .map((s) => ({
        ...s,
        days_overdue: s._next_due_date_obj ? Math.floor((today - s._next_due_date_obj) / 86400000) : null,
      }))
      .filter((s) => s.days_overdue != null && s.days_overdue >= OVERDUE_GRACE_DAYS)
      .map(({ _next_due_date_obj, ...rest }) => rest);
    data.sort((a, b) => b.days_overdue - a.days_overdue);
    return res.json(paginatedResult(data.length, data.slice(offset, offset + limit)));
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/schemes/collection — payments actually collected in a date range
export const collectionReport = async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if (to) to.setHours(23, 59, 59, 999);

    const schemes = await Scheme.findAll();
    const rows = [];
    for (const s of schemes) {
      const payments = parseJsonField(s.payments, []);
      for (const p of payments) {
        const paidAt = invoiceOccurredAt(p) || new Date(p.paid_at);
        if (!paidAt || Number.isNaN(paidAt.getTime())) continue;
        if (from && paidAt < from) continue;
        if (to && paidAt > to) continue;
        rows.push({
          scheme_id: s.id,
          customer_name: s.customer_name,
          plan_name: s.plan_name,
          amount: Number(p.amount) || 0,
          mode: p.mode,
          paid_at: p.paid_at,
        });
      }
    }
    rows.sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at));
    return res.json({
      data: rows,
      totals: { count: rows.length, amount: toMoneyNumber(rows.reduce((sum, r) => sum + r.amount, 0)) },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/schemes/:id/ledger
export const schemeLedger = async (req, res, next) => {
  try {
    const scheme = await Scheme.findByPk(req.params.id);
    if (!scheme) return res.status(404).json({ detail: 'Scheme not found' });
    const info = computeSchemeDueInfo(scheme);
    const payments = parseJsonField(scheme.payments, []);
    let runningTotal = 0;
    const data = payments.map((p, i) => {
      runningTotal += Number(p.amount) || 0;
      return { installment_no: i + 1, amount: Number(p.amount) || 0, mode: p.mode, paid_at: p.paid_at, running_total: toMoneyNumber(runningTotal) };
    });
    const { _next_due_date_obj, ...scheme_summary } = info;
    return res.json({ scheme: scheme_summary, data });
  } catch (err) {
    next(err);
  }
};
