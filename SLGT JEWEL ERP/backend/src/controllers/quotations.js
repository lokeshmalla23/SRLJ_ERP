import { Op } from 'sequelize';
import sequelize, { likeOp } from '../db.js';
import { Quotation, Invoice, Customer, Product } from '../models/index.js';
import { newId, nowIso, normalizeJsonFields } from '../utils.js';
import { convertQuotation as billingConvertQuotation, BillingError } from '../services/billingService.js';
import {
  bookQuotation,
  addAdvanceToBooking,
  cancelQuotationBooking,
  prepareQuotationForPos,
  enrichBookingPayload,
  expireOverdueBookings,
  findActiveBookingForProduct,
  BookingError,
} from '../services/quotationBookingService.js';
import { invoiceDateRangeWhere, newestTransactionFirstOrder } from '../utils/reportQuery.js';
import { AdvanceError } from '../services/advanceService.js';
import branchConfig from '../config/branchConfig.js';
import { getDefaultShopId } from '../services/defaultShop.js';
import { FINANCIAL_MODE, resolveFinancialMode, withLiveFinancialRecords } from '../services/financialMode.js';
import { allocateQuoteNumber, withQuoteNoRetry } from '../services/quotationSequence.js';

const quotationJson = (row) => {
  const base = normalizeJsonFields(row?.toJSON ? row.toJSON() : row, {
    items: [],
    // Under SQLite, Sequelize's JSONB column can come back as the raw stored
    // JSON string rather than a parsed object — every consumer of old_gold
    // (frontend print/edit code) checks `typeof old_gold === 'object'`, so an
    // un-normalized string here silently makes valid old-gold data disappear.
    old_gold: null,
    old_silver: null,
  });
  return enrichBookingPayload(base);
};

// ─── Valid status transitions ──────────────────────────────────────────────────
const VALID_TRANSITIONS = {
  draft: ['sent', 'accepted', 'expired'],
  sent: ['accepted', 'expired'],
  accepted: ['converted', 'expired'],
  booked: ['converted', 'expired', 'cancelled'],
  converted: [],
  expired: ['expired'],
  cancelled: [],
};

// GET /api/quotations/summary
export const getQuotationSummary = async (req, res, next) => {
  try {
    const shopId = req.user?.shop_id || await getDefaultShopId();
    const where = await withLiveFinancialRecords(shopId, { deleted_at: null });
    const rows = await Quotation.findAll({
      attributes: ['status'],
      where,
      raw: true,
    });

    const counts = { draft: 0, sent: 0, accepted: 0, booked: 0, converted: 0, expired: 0, cancelled: 0 };
    for (const row of rows) {
      const s = row.status;
      if (counts[s] !== undefined) counts[s]++;
    }

    const total = rows.length;
    const eligible = counts.accepted + counts.booked + counts.converted;
    const conversion_rate_pct =
      eligible > 0 ? Math.round((counts.converted / eligible) * 100 * 100) / 100 : 0;

    return res.json({
      total,
      draft: counts.draft,
      sent: counts.sent,
      accepted: counts.accepted,
      booked: counts.booked,
      converted: counts.converted,
      expired: counts.expired,
      cancelled: counts.cancelled,
      conversion_rate_pct,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/quotations/active-booking?product_id=… | barcode=…
 * POS uses this before adding a tag — returns who holds the booking.
 */
export const getActiveBookingForProduct = async (req, res, next) => {
  try {
    let productId = req.query.product_id || null;
    const barcode = String(req.query.barcode || req.query.tag || '').trim();
    if (!productId && barcode) {
      const product = await Product.findOne({
        where: {
          deleted_at: null,
          [Op.or]: [{ barcode }, { code: barcode }],
        },
      });
      productId = product?.id || null;
    }
    if (!productId) {
      return res.json({ booked: false });
    }
    const booking = await findActiveBookingForProduct(productId);
    if (!booking) return res.json({ booked: false, product_id: productId });
    return res.json(booking);
  } catch (err) {
    next(err);
  }
};

// GET /api/quotations
export const listQuotations = async (req, res, next) => {
  try {
    // Auto-expire overdue bookings so stock is freed without waiting for POS load
    try {
      await expireOverdueBookings({ limit: 50 });
    } catch {
      /* non-fatal — list still returns */
    }

    const {
      status,
      customer_id,
      search,
      from,
      to,
      limit = 20,
      offset = 0,
    } = req.query;

    const where = { deleted_at: null };

    if (status) {
      where.status = status;
    }

    if (customer_id) {
      where.customer_id = customer_id;
    }

    if (search) {
      where[Op.and] = [
        ...(where[Op.and] || []),
        {
          [Op.or]: [
            { quote_no: { [likeOp]: `%${search}%` } },
            { customer_name: { [likeOp]: `%${search}%` } },
          ],
        },
      ];
    }

    if (from || to) {
      // Business day (Transaction date) once booked; falls back to created_at
      // for drafts, which have no business_date yet — see invoiceDateRangeWhere.
      where[Op.and] = [...(where[Op.and] || []), invoiceDateRangeWhere({ from, to })];
    }

    const shopId = req.user?.shop_id || await getDefaultShopId();
    const liveWhere = await withLiveFinancialRecords(shopId, where);

    const { count: total, rows: data } = await Quotation.findAndCountAll({
      where: liveWhere,
      order: newestTransactionFirstOrder(),
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    return res.json({ total, data: data.map((q) => quotationJson(q)) });
  } catch (err) {
    next(err);
  }
};

// GET /api/quotations/:id
export const getQuotation = async (req, res, next) => {
  try {
    const quotation = await Quotation.findByPk(req.params.id);
    if (!quotation || quotation.deleted_at) return res.status(404).json({ detail: 'Quotation not found' });
    const shopId = req.user?.shop_id || await getDefaultShopId();
    const mode = await resolveFinancialMode(shopId);
    if (
      mode === FINANCIAL_MODE.LIVE
      && (String(quotation.financial_mode || '').toUpperCase() === FINANCIAL_MODE.PRE_ACCOUNTS
        || String(quotation.quote_no || '').toUpperCase().startsWith('TEST-'))
    ) {
      return res.status(404).json({ detail: 'Quotation not found' });
    }
    return res.json(quotationJson(quotation));
  } catch (err) {
    next(err);
  }
};

// GET /api/quotations/by-no/:quoteNo — lookup by human estimation number (QT-YYYY-NNN) or id
export const getQuotationByNo = async (req, res, next) => {
  try {
    const raw = String(req.params.quoteNo || '').trim();
    if (!raw) return res.status(400).json({ detail: 'Estimation number is required' });

    let quotation = await Quotation.findOne({
      where: { deleted_at: null, quote_no: raw },
    });
    if (!quotation) {
      quotation = await Quotation.findByPk(raw);
      if (quotation?.deleted_at) quotation = null;
    }
    if (!quotation) {
      // Case-insensitive fallback for typed quote numbers
      const needle = raw.toLowerCase();
      const recent = await Quotation.findAll({
        where: { deleted_at: null },
        order: [['created_at', 'DESC']],
        limit: 500,
      });
      quotation = recent.find((q) => String(q.quote_no || '').toLowerCase() === needle) || null;
    }
    if (!quotation) return res.status(404).json({ detail: 'Estimation not found' });
    const shopId = req.user?.shop_id || await getDefaultShopId();
    const mode = await resolveFinancialMode(shopId);
    if (
      mode === FINANCIAL_MODE.LIVE
      && (String(quotation.financial_mode || '').toUpperCase() === FINANCIAL_MODE.PRE_ACCOUNTS
        || String(quotation.quote_no || '').toUpperCase().startsWith('TEST-'))
    ) {
      return res.status(404).json({ detail: 'Estimation not found' });
    }
    const prepared = await prepareQuotationForPos(quotation);
    return res.json(prepared || quotationJson(quotation));
  } catch (err) {
    next(err);
  }
};

// POST /api/quotations
export const createQuotation = async (req, res, next) => {
  try {
    const {
      customer_name,
      customer_mobile,
      customer_id,
      customer_email,
      items = [],
      gold_rate,
      subtotal,
      discount,
      discount_type,
      gst_pct,
      gst_amount,
      grand_total,
      valid_until,
      notes,
      terms,
      salesperson_id,
      salesperson_name,
      old_gold,
      old_silver,
    } = req.body;

    if (!customer_name) {
      return res.status(400).json({ detail: 'customer_name is required' });
    }

    const shopId = req.user?.shop_id || branchConfig.shop_id;
    const quotation = await withQuoteNoRetry(async (t) => {
      const financialMode = await resolveFinancialMode(shopId, { transaction: t });
      const quote_no = await allocateQuoteNumber({
        transaction: t,
        testMode: financialMode === FINANCIAL_MODE.PRE_ACCOUNTS,
      });

      return Quotation.create({
        id: newId(),
        shop_id: shopId,
        quote_no,
        customer_id: customer_id || null,
        customer_name,
        customer_mobile: customer_mobile || null,
        customer_email: customer_email || null,
        items,
        gold_rate: gold_rate || 0,
        subtotal: subtotal || 0,
        discount: discount || 0,
        discount_type: discount_type || 'flat',
        gst_pct: gst_pct || 3,
        gst_amount: gst_amount || 0,
        grand_total: grand_total || 0,
        valid_until: valid_until || null,
        status: 'draft',
        notes: notes || null,
        terms: terms || null,
        salesperson_id: salesperson_id || null,
        salesperson_name: salesperson_name || null,
        old_gold: old_gold && old_gold.active ? old_gold : null,
        old_silver: old_silver && old_silver.active ? old_silver : null,
        created_by: req.user?.id || null,
        financial_mode: financialMode,
      }, { transaction: t });
    });

    return res.status(201).json(quotationJson(quotation));
  } catch (err) {
    next(err);
  }
};

// PUT /api/quotations/:id
export const updateQuotation = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const quotation = await Quotation.findByPk(req.params.id, { transaction: t });
    if (!quotation || quotation.deleted_at) {
      await t.rollback();
      return res.status(404).json({ detail: 'Quotation not found' });
    }

    if (!['draft', 'sent'].includes(quotation.status)) {
      await t.rollback();
      return res.status(400).json({
        detail: `Cannot edit a quotation with status "${quotation.status}". Only draft or sent estimations can be edited.`,
      });
    }

    const {
      customer_name,
      customer_mobile,
      customer_id,
      customer_email,
      items,
      gold_rate,
      subtotal,
      discount,
      discount_type,
      gst_pct,
      gst_amount,
      grand_total,
      valid_until,
      notes,
      terms,
      salesperson_id,
      salesperson_name,
      old_gold,
      old_silver,
    } = req.body;

    const updates = {};
    if (customer_name !== undefined) updates.customer_name = customer_name;
    if (customer_mobile !== undefined) updates.customer_mobile = customer_mobile;
    if (customer_id !== undefined) updates.customer_id = customer_id;
    if (customer_email !== undefined) updates.customer_email = customer_email;
    if (items !== undefined) updates.items = items;
    if (gold_rate !== undefined) updates.gold_rate = gold_rate;
    if (subtotal !== undefined) updates.subtotal = subtotal;
    if (discount !== undefined) updates.discount = discount;
    if (discount_type !== undefined) updates.discount_type = discount_type;
    if (gst_pct !== undefined) updates.gst_pct = gst_pct;
    if (gst_amount !== undefined) updates.gst_amount = gst_amount;
    if (grand_total !== undefined) updates.grand_total = grand_total;
    if (valid_until !== undefined) updates.valid_until = valid_until;
    if (notes !== undefined) updates.notes = notes;
    if (terms !== undefined) updates.terms = terms;
    if (salesperson_id !== undefined) updates.salesperson_id = salesperson_id;
    if (salesperson_name !== undefined) updates.salesperson_name = salesperson_name;
    if (old_gold !== undefined) updates.old_gold = old_gold && old_gold.active ? old_gold : null;
    if (old_silver !== undefined) updates.old_silver = old_silver && old_silver.active ? old_silver : null;

    await quotation.update(updates, { transaction: t });

    await t.commit();
    return res.json(quotationJson(quotation));
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// PUT /api/quotations/:id/status
export const updateQuotationStatus = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { status: newStatus } = req.body;

    if (!newStatus) {
      await t.rollback();
      return res.status(400).json({ detail: 'status is required in request body' });
    }

    const validStatuses = ['draft', 'sent', 'accepted', 'booked', 'converted', 'expired', 'cancelled'];
    if (!validStatuses.includes(newStatus)) {
      await t.rollback();
      return res.status(400).json({
        detail: `Invalid status "${newStatus}". Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const quotation = await Quotation.findByPk(req.params.id, { transaction: t });
    if (!quotation || quotation.deleted_at) {
      await t.rollback();
      return res.status(404).json({ detail: 'Quotation not found' });
    }

    const currentStatus = quotation.status;

    if (currentStatus === 'converted' || currentStatus === 'booked') {
      await t.rollback();
      return res.status(400).json({
        detail: currentStatus === 'booked'
          ? 'Use Take advance cancel/book APIs for booked estimations.'
          : 'Cannot change status of a converted quotation.',
      });
    }

    const allowed = [...(VALID_TRANSITIONS[currentStatus] || [])];
    if (!allowed.includes(newStatus)) {
      await t.rollback();
      return res.status(400).json({
        detail: `Invalid transition from "${currentStatus}" to "${newStatus}". Allowed: ${allowed.join(', ') || 'none'}`,
      });
    }

    await quotation.update({ status: newStatus }, { transaction: t });

    await t.commit();
    return res.json(quotationJson(quotation));
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// POST /api/quotations/:id/convert
export const convertQuotation = async (req, res, next) => {
  try {
    const result = await billingConvertQuotation(req.params.id, {
      user: req.user,
      payments: req.body?.payments || null,
      request_id: req.body?.request_id || null,
      gold_rate: req.body?.gold_rate,
    });
    return res.status(result.idempotent ? 200 : 201).json({
      ...result.invoice.toJSON(),
      _idempotent: result.idempotent || false,
    });
  } catch (err) {
    if (err instanceof BillingError) {
      return res.status(err.status || 400).json({
        detail: err.message,
        code: err.code,
        details: err.details || undefined,
      });
    }
    next(err);
  }
};

// POST /api/quotations/:id/book — take advance, lock prices, reserve unique tags
export const bookQuotationAdvance = async (req, res, next) => {
  try {
    const result = await bookQuotation(req.params.id, {
      advanceAmount: req.body?.advance_amount ?? req.body?.amount,
      paymentMode: req.body?.payment_mode || req.body?.mode || 'cash',
      deadlineDays: req.body?.deadline_days ?? 7,
      requestId: req.body?.request_id || null,
      user: req.user,
    });
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof BookingError || err instanceof AdvanceError) {
      return res.status(err.status || 400).json({ detail: err.message, code: err.code });
    }
    // InventoryError
    if (err?.name === 'InventoryError') {
      return res.status(err.status || 400).json({ detail: err.message, code: err.code });
    }
    next(err);
  }
};

// POST /api/quotations/:id/add-advance — extra installment on booked estimation
export const addQuotationAdvanceInstallment = async (req, res, next) => {
  try {
    const result = await addAdvanceToBooking(req.params.id, {
      advanceAmount: req.body?.advance_amount ?? req.body?.amount,
      paymentMode: req.body?.payment_mode || req.body?.mode || 'cash',
      requestId: req.body?.request_id || null,
      user: req.user,
    });
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof BookingError || err instanceof AdvanceError) {
      return res.status(err.status || 400).json({ detail: err.message, code: err.code });
    }
    next(err);
  }
};

// POST /api/quotations/:id/cancel-booking
export const cancelBookedQuotation = async (req, res, next) => {
  try {
    const result = await cancelQuotationBooking(req.params.id, {
      user: req.user,
      reason: req.body?.reason || null,
    });
    return res.json(result);
  } catch (err) {
    if (err instanceof BookingError) {
      return res.status(err.status || 400).json({ detail: err.message, code: err.code });
    }
    next(err);
  }
};

// DELETE /api/quotations/:id — soft delete so the deletion syncs to Neon
export const deleteQuotation = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const quotation = await Quotation.findByPk(req.params.id, { transaction: t });
    if (!quotation || quotation.deleted_at) {
      await t.rollback();
      return res.status(404).json({ detail: 'Quotation not found' });
    }

    if (quotation.status !== 'draft') {
      await t.rollback();
      return res.status(400).json({
        detail: `Cannot delete a quotation with status "${quotation.status}". Only draft quotations can be deleted.`,
      });
    }

    await quotation.update({ deleted_at: nowIso() }, { transaction: t });

    await t.commit();
    return res.json({ detail: 'Quotation deleted successfully' });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};
