/**
 * Cashbook + financial statements + manual vouchers (Accounts feature pack).
 */
import { Op } from 'sequelize';
import sequelize from '../db.js';
import {
  CashbookEntry,
  DailyClosing,
  Employee,
  Invoice,
  Scheme,
} from '../models/index.js';
import { newId } from '../utils.js';
import { toMoneyNumber } from '../utils/money.js';
import { getDefaultShopId } from '../services/defaultShop.js';
import { getActiveBillingDate } from '../services/dailyClosingService.js';
import { hydrateInvoiceItems, invoiceItemsOf, invoiceOccurredAt, shopScope } from '../utils/invoiceRead.js';
import {
  postManualVoucher,
  accountBalances,
  ensureDefaultAccounts,
} from '../services/ledgerService.js';
import {
  listPaymentTransfersAndPockets,
  postPaymentTransfer,
} from '../services/paymentTransferService.js';
import { appendEventLog } from '../services/eventLogService.js';
import { buildProductLookup, metalPurityBreakdown, round3 } from '../services/metalClassify.js';
import branchConfig from '../config/branchConfig.js';
import { wantsHiddenBills } from '../utils/invoiceVisibility.js';

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Safe YYYY-MM-DD from Date / ISO / DATEONLY — never throws. */
function localDateKey(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isYmd(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function openingCashForDate(shopId, dateStr) {
  const prev = await DailyClosing.findOne({
    where: { shop_id: shopId, date: { [Op.lt]: dateStr }, status: 'closed' },
    order: [['date', 'DESC']],
  });
  return toMoneyNumber(prev?.closing_cash);
}

// ─── Cashbook ────────────────────────────────────────────────────────────────

export const listCashbook = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const date = req.query.date || localToday();
    const from = req.query.from;
    const to = req.query.to;

    const where = { shop_id: shopId };
    if (from || to) {
      where.date = {};
      if (from) where.date[Op.gte] = from;
      if (to) where.date[Op.lte] = to;
    } else {
      where.date = date;
    }

    const entries = await CashbookEntry.findAll({
      where,
      order: [['date', 'ASC'], ['created_at', 'ASC']],
    });

    const opening = await openingCashForDate(shopId, date);
    let running = opening;
    const rows = entries.map((e) => {
      const amt = toMoneyNumber(e.amount);
      if (e.entry_type === 'in') running = toMoneyNumber(running + amt);
      else running = toMoneyNumber(running - amt);
      return { ...e.toJSON(), running_balance: running };
    });

    const byMode = { cash: { in: 0, out: 0 }, bank: { in: 0, out: 0 }, upi: { in: 0, out: 0 }, card: { in: 0, out: 0 } };
    for (const e of entries) {
      const mode = String(e.mode || 'cash').toLowerCase();
      const bucket = byMode[mode] || (byMode[mode] = { in: 0, out: 0 });
      const amt = toMoneyNumber(e.amount);
      if (e.entry_type === 'in') bucket.in += amt;
      else bucket.out += amt;
    }

    // 14-day net for chart
    const start14 = new Date(date);
    start14.setDate(start14.getDate() - 13);
    const from14 = start14.toISOString().slice(0, 10);
    const recent = await CashbookEntry.findAll({
      where: { shop_id: shopId, date: { [Op.between]: [from14, date] } },
      order: [['date', 'ASC']],
    });
    const netByDay = {};
    for (let i = 0; i < 14; i++) {
      const d = new Date(start14);
      d.setDate(start14.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      netByDay[key] = 0;
    }
    for (const e of recent) {
      const key = e.date;
      if (!(key in netByDay)) continue;
      const amt = toMoneyNumber(e.amount);
      netByDay[key] += e.entry_type === 'in' ? amt : -amt;
    }

    return res.json({
      date,
      opening_cash: opening,
      closing_cash: running,
      entries: rows,
      by_mode: byMode,
      net_by_day: Object.entries(netByDay).map(([d, net]) => ({ date: d, net: toMoneyNumber(net) })),
    });
  } catch (err) {
    next(err);
  }
};

export const createCashbookEntry = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const {
      date: requestedDate,
      entry_type,
      mode = 'cash',
      amount,
      contra = false,
      reference,
      notes,
      linked_expense_id,
      linked_invoice_id,
    } = req.body || {};

    if (!['in', 'out'].includes(entry_type)) {
      await t.rollback();
      return res.status(400).json({ detail: 'entry_type must be in or out' });
    }
    if (amount == null || Number(amount) <= 0) {
      await t.rollback();
      return res.status(400).json({ detail: 'amount must be > 0' });
    }

    const shopId = await getDefaultShopId({ transaction: t });
    // Never default to the real calendar date — the shop's active transaction
    // date, same rule as every other transaction in the app.
    const date = requestedDate || (await getActiveBillingDate({ shopId, transaction: t })).date;
    const entry = await CashbookEntry.create({
      id: newId(),
      shop_id: shopId,
      date,
      entry_type,
      mode: String(mode).toLowerCase(),
      amount: toMoneyNumber(amount),
      contra: Boolean(contra),
      reference: reference || null,
      notes: notes || null,
      linked_expense_id: linked_expense_id || null,
      linked_invoice_id: linked_invoice_id || null,
      created_by: req.user?.id || null,
      origin_device_id: branchConfig.device_id || null,
    }, { transaction: t });

    await appendEventLog({
      eventType: 'CASHBOOK_ENTRY',
      entityType: 'cashbook_entry',
      entityId: entry.id,
      payload: { cashbook_entry: entry.toJSON() },
      originDeviceId: branchConfig.device_id,
      userId: req.user?.id,
      transaction: t,
    });

    await t.commit();
    return res.status(201).json(entry.toJSON());
  } catch (err) {
    await t.rollback().catch(() => {});
    next(err);
  }
};

export const deleteCashbookEntry = async (req, res, next) => {
  try {
    const row = await CashbookEntry.findByPk(req.params.id);
    if (!row) return res.status(404).json({ detail: 'Not found' });
    await row.destroy();
    return res.json({ detail: 'Deleted' });
  } catch (err) {
    next(err);
  }
};

// ─── Financial statements ────────────────────────────────────────────────────

export const getTrialBalance = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const { from, to } = req.query;
    const rows = await accountBalances({ shopId, from, to });
    const totals = rows.reduce(
      (a, r) => ({ debit: a.debit + r.debit, credit: a.credit + r.credit }),
      { debit: 0, credit: 0 },
    );
    return res.json({
      from: from || null,
      to: to || null,
      rows,
      totals: {
        debit: toMoneyNumber(totals.debit),
        credit: toMoneyNumber(totals.credit),
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getProfitAndLoss = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const { from, to } = req.query;
    // Opening vouchers are BS only — exclude from P&L
    const rows = await accountBalances({ shopId, from, to, includeOpening: false });
    const income = rows.filter((r) => r.type === 'income');
    const expense = rows.filter((r) => r.type === 'expense');
    // Income: credit-nature → income amount = credit - debit
    const incomeTotal = toMoneyNumber(income.reduce((s, r) => s + (r.credit - r.debit), 0));
    const expenseTotal = toMoneyNumber(expense.reduce((s, r) => s + (r.debit - r.credit), 0));
    const sales = income.find((r) => r.code === '4000');
    const cogs = expense.find((r) => r.code === '5000');
    const salesAmt = sales ? toMoneyNumber(sales.credit - sales.debit) : 0;
    const cogsAmt = cogs ? toMoneyNumber(cogs.debit - cogs.credit) : 0;
    const grossProfit = toMoneyNumber(salesAmt - cogsAmt);
    return res.json({
      from: from || null,
      to: to || null,
      income: income.map((r) => ({ ...r, amount: toMoneyNumber(r.credit - r.debit) })),
      expense: expense.map((r) => ({ ...r, amount: toMoneyNumber(r.debit - r.credit) })),
      margins: {
        sales: salesAmt,
        cogs: cogsAmt,
        gross_profit: grossProfit,
        gross_margin_pct: salesAmt > 0 ? toMoneyNumber((grossProfit / salesAmt) * 100) : null,
        net_margin_pct: salesAmt > 0
          ? toMoneyNumber(((incomeTotal - expenseTotal) / salesAmt) * 100)
          : null,
      },
      totals: {
        income: incomeTotal,
        expense: expenseTotal,
        net_profit: toMoneyNumber(incomeTotal - expenseTotal),
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getBalanceSheet = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const { to } = req.query;
    const rows = await accountBalances({ shopId, to });
    const assets = rows.filter((r) => r.type === 'asset').map((r) => ({
      ...r,
      amount: toMoneyNumber(r.debit - r.credit),
    }));
    const liabilities = rows.filter((r) => r.type === 'liability').map((r) => ({
      ...r,
      amount: toMoneyNumber(r.credit - r.debit),
    }));
    const equity = rows.filter((r) => r.type === 'equity').map((r) => ({
      ...r,
      amount: toMoneyNumber(r.credit - r.debit),
    }));
    // Retained earnings from income/expense to date
    const income = rows.filter((r) => r.type === 'income');
    const expense = rows.filter((r) => r.type === 'expense');
    const retained = toMoneyNumber(
      income.reduce((s, r) => s + (r.credit - r.debit), 0)
      - expense.reduce((s, r) => s + (r.debit - r.credit), 0),
    );
    if (Math.abs(retained) > 0.001) {
      equity.push({
        code: 'RE',
        name: 'Retained Earnings',
        type: 'equity',
        amount: retained,
      });
    }
    const assetTotal = toMoneyNumber(assets.reduce((s, r) => s + r.amount, 0));
    const liabTotal = toMoneyNumber(liabilities.reduce((s, r) => s + r.amount, 0));
    const equityTotal = toMoneyNumber(equity.reduce((s, r) => s + r.amount, 0));
    return res.json({
      as_of: to || localToday(),
      assets,
      liabilities,
      equity,
      totals: {
        assets: assetTotal,
        liabilities: liabTotal,
        equity: equityTotal,
        liabilities_and_equity: toMoneyNumber(liabTotal + equityTotal),
      },
    });
  } catch (err) {
    next(err);
  }
};

export const createManualVoucher = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const {
      voucher_type = 'journal',
      voucher_no,
      entry_date,
      memo,
      lines,
      request_id,
    } = req.body || {};

    if (!Array.isArray(lines) || lines.length < 2) {
      await t.rollback();
      return res.status(400).json({ detail: 'At least two journal lines required' });
    }

    const shopId = await getDefaultShopId({ transaction: t });
    await ensureDefaultAccounts(shopId, { transaction: t });

    const entry = await postManualVoucher({
      shopId,
      voucherType: voucher_type,
      voucherNo: voucher_no,
      entryDate: entry_date || localToday(),
      memo,
      lines,
      requestId: request_id || req.headers['x-request-id'],
      userId: req.user?.id,
      transaction: t,
    });

    if (entry) {
      await appendEventLog({
        eventType: 'JOURNAL_POSTED',
        entityType: 'journal_entry',
        entityId: entry.id,
        critical: true,
        payload: { journal_entry: entry.toJSON(), voucher_type },
        originDeviceId: branchConfig.device_id,
        userId: req.user?.id,
        transaction: t,
      });
    }

    await t.commit();
    return res.status(201).json(entry ? entry.toJSON() : { detail: 'No entry (zero amount)' });
  } catch (err) {
    await t.rollback().catch(() => {});
    if (err.status) return res.status(err.status).json({ detail: err.message });
    next(err);
  }
};

// ─── Payment transfers (Cash ↔ Bank ↔ UPI ↔ Card) ─────────────────────────────

export const listPaymentTransfers = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const data = await listPaymentTransfersAndPockets({
      shopId,
      date: req.query.date,
      limit: req.query.limit,
    });
    return res.json(data);
  } catch (err) {
    next(err);
  }
};

export const createPaymentTransfer = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const shopId = await getDefaultShopId({ transaction: t });
    const result = await postPaymentTransfer({
      shopId,
      fromMode: req.body?.from_mode,
      toMode: req.body?.to_mode,
      amount: req.body?.amount,
      date: req.body?.date,
      notes: req.body?.notes,
      userId: req.user?.id,
      transaction: t,
    });
    await t.commit();
    return res.status(201).json(result);
  } catch (err) {
    await t.rollback().catch(() => {});
    if (err.status) return res.status(err.status).json({ detail: err.message });
    next(err);
  }
};

// ─── Employee sales (Accounts) ───────────────────────────────────────────────

/**
 * GET /api/accounts/employee-sales?from&to&employee_id?
 * Summary of sales attributed to each salesperson in the date range.
 * With employee_id: invoice-level detail for that employee.
 */
export const employeeSales = async (req, res, next) => {
  try {
    let from = req.query.from || localToday();
    let to = req.query.to || localToday();
    if (!isYmd(from)) from = localToday();
    if (!isYmd(to)) to = localToday();
    if (from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }
    const employeeId = req.query.employee_id || null;
    const shopId = req.user?.shop_id || await getDefaultShopId();

    const dayStart = new Date(`${from}T00:00:00`);
    const dayEnd = new Date(`${to}T23:59:59.999`);

    const invWhere = {
      [Op.and]: [
        shopScope(shopId),
        // Filter by the invoice's active business day (Transaction date), not
        // its real created_at timestamp — those two only diverge when Daily
        // Closing hasn't caught up to the real calendar date yet, and older
        // rows without a business_date fall back to created_at.
        {
          [Op.or]: [
            { business_date: { [Op.between]: [from, to] } },
            { business_date: null, created_at: { [Op.between]: [dayStart, dayEnd] } },
          ],
        },
        { status: { [Op.notIn]: ['cancelled', 'canceled', 'void', 'returned'] } },
        { salesperson_id: { [Op.ne]: null } },
        ...(wantsHiddenBills({ ...req.query, _role: req.user?.role })
          ? []
          : [{ [Op.or]: [{ is_hidden: false }, { is_hidden: null }] }]),
      ],
    };
    if (employeeId) {
      // POS may store employee id or linked user id
      const empRow = await Employee.findByPk(employeeId);
      const ids = [employeeId];
      if (empRow?.user_id) ids.push(empRow.user_id);
      invWhere[Op.and].push({ salesperson_id: { [Op.in]: ids } });
    }

    const schemeWhere = {
      [Op.and]: [
        ...(shopId ? [{ shop_id: shopId }] : []),
        { start_date: { [Op.between]: [from, to] } },
        { salesperson_id: { [Op.ne]: null } },
        { deleted_at: null },
        { status: { [Op.ne]: 'cancelled' } },
      ],
    };
    if (employeeId) {
      const empRow = await Employee.findByPk(employeeId);
      const ids = [employeeId];
      if (empRow?.user_id) ids.push(empRow.user_id);
      schemeWhere[Op.and].push({ salesperson_id: { [Op.in]: ids } });
    }

    const [invoices, employees, schemes] = await Promise.all([
      Invoice.findAll({
        where: invWhere,
        order: [['created_at', 'DESC']],
        attributes: [
          'id', 'invoice_no', 'customer_name', 'customer_mobile', 'salesperson_id',
          'grand_total', 'gst_amount', 'subtotal', 'discount', 'payments',
          'status', 'created_at', 'business_date', 'items',
        ],
      }),
      Employee.findAll({
        where: { status: 'active' },
        attributes: ['id', 'name', 'user_id', 'job_title', 'mobile'],
      }),
      Scheme.findAll({
        where: schemeWhere,
        attributes: [
          'id', 'customer_name', 'customer_mobile', 'plan_name', 'scheme_type',
          'monthly_amount', 'duration_months', 'start_date', 'status',
          'salesperson_id', 'created_at',
        ],
        order: [['start_date', 'DESC']],
      }),
    ]);

    await hydrateInvoiceItems(invoices);

    // Gold / silver sold weights per purity — same classifier the Dashboard's
    // gold cards and purity pie use, so both screens agree on the numbers.
    const productLookup = await buildProductLookup(invoices);
    const metalBreakdown = metalPurityBreakdown(invoices, productLookup);

    const empById = new Map();
    for (const e of employees) {
      empById.set(e.id, e);
      if (e.user_id) empById.set(e.user_id, e);
    }

    const resolveEmp = (sid) => empById.get(sid) || null;

    if (employeeId) {
      const emp = resolveEmp(employeeId) || await Employee.findByPk(employeeId);
      const rows = invoices.map((inv) => {
        const items = invoiceItemsOf(inv);
        return {
          id: inv.id,
          invoice_no: inv.invoice_no,
          date: localDateKey(invoiceOccurredAt(inv) || inv.created_at) || from,
          customer_name: inv.customer_name || 'Walk-in',
          customer_mobile: inv.customer_mobile || null,
          item_count: items.length,
          subtotal: toMoneyNumber(inv.subtotal),
          discount: toMoneyNumber(inv.discount),
          gst_amount: toMoneyNumber(inv.gst_amount),
          grand_total: toMoneyNumber(inv.grand_total),
          status: inv.status,
        };
      });
      const schemeRows = schemes.map((s) => ({
        id: s.id,
        date: s.start_date || localDateKey(s.created_at) || from,
        customer_name: s.customer_name || '—',
        customer_mobile: s.customer_mobile || null,
        plan_name: s.plan_name,
        scheme_type: s.scheme_type,
        monthly_amount: toMoneyNumber(s.monthly_amount),
        duration_months: s.duration_months,
        status: s.status,
      }));
      const totals = rows.reduce(
        (a, r) => ({
          invoice_count: a.invoice_count + 1,
          sales: toMoneyNumber(a.sales + r.grand_total),
          gst: toMoneyNumber(a.gst + r.gst_amount),
        }),
        { invoice_count: 0, sales: 0, gst: 0 },
      );

      const byDay = {};
      for (const r of rows) {
        const key = r.date || from;
        byDay[key] = toMoneyNumber((byDay[key] || 0) + r.grand_total);
      }
      const trend = Object.entries(byDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, sales]) => ({ date, sales }));

      return res.json({
        from,
        to,
        employee: emp
          ? { id: emp.id, name: emp.name, job_title: emp.job_title, mobile: emp.mobile }
          : { id: employeeId, name: 'Unknown' },
        totals: {
          ...totals,
          scheme_count: schemeRows.length,
          avg_ticket: totals.invoice_count
            ? toMoneyNumber(totals.sales / totals.invoice_count)
            : 0,
        },
        trend,
        invoices: rows,
        schemes: schemeRows,
        // One card per metal sold by this employee, purity table underneath.
        metals: metalBreakdown.metals,
        unclassified: metalBreakdown.unclassified,
      });
    }

    // Summary by employee
    const buckets = new Map();

    for (const inv of invoices) {
      const emp = resolveEmp(inv.salesperson_id);
      const key = emp?.id || inv.salesperson_id || '_unknown';
      if (!buckets.has(key)) {
        buckets.set(key, {
          employee_id: emp?.id || inv.salesperson_id,
          employee_name: emp?.name || 'Unassigned',
          job_title: emp?.job_title || null,
          invoice_count: 0,
          scheme_count: 0,
          sales: 0,
          gst: 0,
          gold_gross: 0,
          gold_net: 0,
          silver_gross: 0,
          silver_net: 0,
        });
      }
      const b = buckets.get(key);
      b.invoice_count += 1;
      b.sales = toMoneyNumber(b.sales + toMoneyNumber(inv.grand_total));
      b.gst = toMoneyNumber(b.gst + toMoneyNumber(inv.gst_amount));
      const weights = metalBreakdown.byInvoice.get(inv.id);
      if (weights) {
        b.gold_gross = round3(b.gold_gross + weights.gold.gross);
        b.gold_net = round3(b.gold_net + weights.gold.net);
        b.silver_gross = round3(b.silver_gross + weights.silver.gross);
        b.silver_net = round3(b.silver_net + weights.silver.net);
      }
    }

    for (const s of schemes) {
      const emp = resolveEmp(s.salesperson_id);
      const key = emp?.id || s.salesperson_id || '_unknown';
      if (!buckets.has(key)) {
        buckets.set(key, {
          employee_id: emp?.id || s.salesperson_id,
          employee_name: emp?.name || 'Unassigned',
          job_title: emp?.job_title || null,
          invoice_count: 0,
          scheme_count: 0,
          sales: 0,
          gst: 0,
          gold_gross: 0,
          gold_net: 0,
          silver_gross: 0,
          silver_net: 0,
        });
      }
      buckets.get(key).scheme_count += 1;
    }

    const data = [...buckets.values()]
      .map((b) => ({
        ...b,
        avg_ticket: b.invoice_count ? toMoneyNumber(b.sales / b.invoice_count) : 0,
      }))
      .sort((a, b) => b.sales - a.sales || b.scheme_count - a.scheme_count);

    const byDay = {};
    for (const inv of invoices) {
      const key = localDateKey(inv.created_at);
      if (!key) continue;
      byDay[key] = toMoneyNumber((byDay[key] || 0) + toMoneyNumber(inv.grand_total));
    }
    const trend = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, sales]) => ({ date, sales }));

    const totals = data.reduce(
      (a, r) => ({
        invoice_count: a.invoice_count + r.invoice_count,
        scheme_count: a.scheme_count + r.scheme_count,
        sales: toMoneyNumber(a.sales + r.sales),
        gst: toMoneyNumber(a.gst + r.gst),
        employees: a.employees + 1,
        gold_gross: round3(a.gold_gross + r.gold_gross),
        gold_net: round3(a.gold_net + r.gold_net),
        silver_gross: round3(a.silver_gross + r.silver_gross),
        silver_net: round3(a.silver_net + r.silver_net),
      }),
      {
        invoice_count: 0, scheme_count: 0, sales: 0, gst: 0, employees: 0,
        gold_gross: 0, gold_net: 0, silver_gross: 0, silver_net: 0,
      },
    );

    return res.json({
      from,
      to,
      totals,
      trend,
      data,
      pie: data.map((d) => ({ name: d.employee_name, value: d.sales })),
      // Weight we could not call gold or silver (no metal/purity/name on the
      // line). Shown as a muted note so gold + silver never silently under-add.
      unclassified: metalBreakdown.unclassified,
    });
  } catch (err) {
    next(err);
  }
};
