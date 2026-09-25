import { Op } from 'sequelize';
import sequelize from '../db.js';
import { Invoice, Payment } from '../models/index.js';
import { likeOp } from '../db.js';
import { newId, normalizeJsonFields } from '../utils.js';
import { createInvoice as billingCreateInvoice, cancelInvoice as billingCancelInvoice, BillingError } from '../services/billingService.js';
import { getActiveBillingDate } from '../services/dailyClosingService.js';
import { stampOnTransactionDate } from '../utils/invoiceRead.js';
import { broadcast } from '../services/wsServer.js';
import { formatINR } from '../utils/formatMoney.js';
import { invoiceDateRangeWhere, newestTransactionFirstOrder, newestInvoiceFirstOrder } from '../utils/reportQuery.js';
import { wantsHiddenBills, withNotHidden, isHiddenBill, HIDDEN_INVOICE } from '../utils/invoiceVisibility.js';
import { withLiveFinancialRecords } from '../services/financialMode.js';
import { getDefaultShopId } from '../services/defaultShop.js';

const invoiceJson = (row) => {
  const j = normalizeJsonFields(row?.toJSON ? row.toJSON() : row, {
    items: [],
    payments: [],
  });
  // Sequelize may expose camelCase or snake_case depending on dialect/version
  const created = j.created_at || j.createdAt || null;
  if (created && !j.created_at) j.created_at = created;
  return j;
};

export const listInvoices = async (req, res, next) => {
  try {
    const { q, from_date, to_date, include_hidden, hidden_only, limit } = req.query;
    const and = [];

    const role = String(req.user?.role || '');
    const isOwner = role === 'shop_owner' || role === 'owner' || role === 'super_admin';

    if (hidden_only === '1' || hidden_only === 'true') {
      if (!isOwner) return res.status(403).json({ detail: 'Owner only' });
      and.push(HIDDEN_INVOICE);
    } else if (!wantsHiddenBills({ include_hidden, _role: role })) {
      and.push(withNotHidden({}));
    } else if (!isOwner) {
      return res.status(403).json({ detail: 'Owner only' });
    }

    if (q) {
      and.push({
        [Op.or]: [
          { invoice_no: { [likeOp]: `%${q}%` } },
          { customer_name: { [likeOp]: `%${q}%` } },
          { customer_mobile: { [likeOp]: `%${q}%` } },
          { pan_number: { [likeOp]: `%${q}%` } },
          { aadhaar_number: { [likeOp]: `%${q}%` } },
        ],
      });
    }

    if (from_date || to_date) {
      // Business day (Transaction date), not the real created_at timestamp —
      // see invoiceDateRangeWhere.
      and.push(invoiceDateRangeWhere({ from: from_date, to: to_date }));
    }

    const where = and.length ? { [Op.and]: and } : {};
    const shopId = req.user?.shop_id || await getDefaultShopId();
    const liveWhere = await withLiveFinancialRecords(shopId, where);
    const findOpts = { where: liveWhere, order: newestInvoiceFirstOrder() };
    if (limit != null && limit !== '') {
      const n = Number(limit);
      if (Number.isFinite(n) && n > 0) findOpts.limit = Math.min(n, 500);
    }
    const invoices = await Invoice.findAll(findOpts);
    const rows = invoices.map((i) => invoiceJson(i));
    const includeHidden = wantsHiddenBills({ include_hidden, _role: role });
    if (hidden_only === '1' || hidden_only === 'true') {
      return res.json(rows.filter((r) => isHiddenBill(r)));
    }
    if (!includeHidden) {
      return res.json(rows.filter((r) => !isHiddenBill(r)));
    }
    return res.json(rows);
  } catch (err) {
    next(err);
  }
};

export const getInvoice = async (req, res, next) => {
  try {
    const invoice = await Invoice.findByPk(req.params.id);
    if (!invoice) return res.status(404).json({ detail: 'Invoice not found' });
    const json = invoiceJson(invoice);
    if (isHiddenBill(json) && !wantsHiddenBills({ include_hidden: req.query.include_hidden, _role: req.user?.role })) {
      return res.status(404).json({ detail: 'Invoice not found' });
    }
    return res.json(json);
  } catch (err) {
    next(err);
  }
};

export const createInvoice = async (req, res, next) => {
  try {
    const result = await billingCreateInvoice(req.body, { user: req.user });
    const status = result.idempotent ? 200 : 201;
    if (!result.idempotent) {
      broadcast({ type: 'invoice:created', id: result.invoice.id });
    }
    return res.status(status).json({
      ...invoiceJson(result.invoice),
      _idempotent: result.idempotent || false,
      _server_totals: result.totals || undefined,
    });
  } catch (err) {
    if (err instanceof BillingError || err?.name === 'BillingError') {
      return res.status(err.status || 400).json({
        detail: err.message,
        code: err.code,
        details: err.details || undefined,
      });
    }
    // Inventory/stock errors that escaped instanceof across ESM copies
    if (err?.code === 'INSUFFICIENT_STOCK' || err?.code === 'ITEM_ALREADY_SOLD' || err?.code === 'ITEM_RESERVED') {
      return res.status(err.status || 409).json({
        detail: err.message || 'Stock unavailable',
        code: err.code,
      });
    }
    next(err);
  }
};

export const cancelInvoice = async (req, res, next) => {
  try {
    const result = await billingCancelInvoice(req.params.id, {
      user: req.user,
      reason: req.body?.reason || req.body?.cancel_reason || null,
      refund: req.body?.refund || [],
    });
    broadcast({ type: 'invoice:cancelled', id: result.invoice.id });
    broadcast({ type: 'product:changed', op: 'stock_restore', invoice_id: result.invoice.id });
    return res.json(invoiceJson(result.invoice));
  } catch (err) {
    if (err instanceof BillingError || err?.name === 'BillingError') {
      return res.status(err.status || 400).json({
        detail: err.message,
        code: err.code,
        details: err.details || undefined,
      });
    }
    if (err?.code === 'INSUFFICIENT_STOCK' || err?.code === 'ITEM_ALREADY_SOLD' || err?.code === 'ITEM_RESERVED' || err?.code === 'NOT_SOLD' || err?.code === 'NO_ITEMS') {
      return res.status(err.status || 409).json({
        detail: err.message || 'Stock unavailable',
        code: err.code,
      });
    }
    next(err);
  }
};

// POST /invoices/:id/payment — collect an outstanding balance payment
export const collectPayment = async (req, res, next) => {
  try {
    const invoice = await Invoice.findByPk(req.params.id);
    if (!invoice) return res.status(404).json({ detail: 'Invoice not found' });

    const balanceDue = Number(invoice.balance_due) || 0;
    if (balanceDue <= 0) return res.status(400).json({ detail: 'No outstanding balance on this invoice' });

    const { amount, mode, reference } = req.body;
    const amt = Number(amount) || 0;
    if (amt <= 0) return res.status(400).json({ detail: 'Amount must be positive' });
    if (amt > balanceDue + 0.5) return res.status(400).json({ detail: `Amount ${formatINR(amt)} exceeds balance due ${formatINR(balanceDue)}` });

    const validModes = ['cash', 'upi', 'card', 'bank_transfer', 'cheque'];
    const payMode = String(mode || 'cash').toLowerCase();
    if (!validModes.includes(payMode)) return res.status(400).json({ detail: `Invalid payment mode: ${mode}` });

    const newBalance = Math.max(0, Math.round((balanceDue - amt) * 100) / 100);
    const newStatus = newBalance <= 0.5 ? 'paid' : 'partial';

    await sequelize.transaction(async (transaction) => {
      const { toPaise } = await import('../../../shared/domain/money.js');
      const { date: businessDate } = await getActiveBillingDate({ shopId: invoice.shop_id, transaction });

      await Payment.create({
        id: newId(),
        shop_id: invoice.shop_id,
        invoice_id: invoice.id,
        customer_id: invoice.customer_id || null,
        mode: payMode,
        amount: amt,
        amount_paise: toPaise(amt),
        reference: reference || null,
        received_by: req.user?.id || null,
        status: 'posted',
        paid_at: stampOnTransactionDate(businessDate),
        business_date: businessDate,
      }, { transaction });

      const updatedPayments = [...(invoice.payments || []), { mode: payMode, amount: amt, description: reference || null }];
      await invoice.update({
        balance_due: newBalance,
        status: newStatus,
        payments: updatedPayments,
      }, { transaction });

      const { postCreditPaymentJournal } = await import('../services/ledgerService.js');
      await postCreditPaymentJournal({
        shopId: invoice.shop_id,
        invoiceId: invoice.id,
        amount: amt,
        mode: payMode,
        userId: req.user?.id,
        transaction,
      });
    });

    const updated = await Invoice.findByPk(invoice.id);
    return res.json(invoiceJson(updated));
  } catch (err) {
    next(err);
  }
};

// GET /customers/:customerId/outstanding — invoices with balance_due > 0
export const customerOutstanding = async (req, res, next) => {
  try {
    const invWhere = wantsHiddenBills({ ...req.query, _role: req.user?.role })
      ? {
        customer_id: req.params.customerId,
        balance_due: { [Op.gt]: 0 },
        cancelled_at: null,
      }
      : withNotHidden({
        customer_id: req.params.customerId,
        balance_due: { [Op.gt]: 0 },
        cancelled_at: null,
      });
    const invoices = await Invoice.findAll({
      where: invWhere,
      order: newestTransactionFirstOrder(),
    });
    const data = invoices.map((i) => invoiceJson(i));
    const totalOutstanding = data.reduce((s, i) => s + (Number(i.balance_due) || 0), 0);
    return res.json({ data, total_outstanding: Math.round(totalOutstanding * 100) / 100 });
  } catch (err) {
    next(err);
  }
};
