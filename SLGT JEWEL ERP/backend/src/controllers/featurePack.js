/**
 * Jewellery feature-pack APIs: karigar metal, old gold buybook, rates, commission, HUID, GSTR JSON.
 */
import { Op } from 'sequelize';
import sequelize, { likeOp, withLock } from '../db.js';
import {
  MetalIssue,
  OldGoldReceipt,
  OldGoldSale,
  GoldRateHistory,
  BillingRateEvent,
  Employee,
  User,
  Invoice,
  CreditNote,
  Purchase,
  Product,
  Customer,
} from '../models/index.js';
import { newId, parseJsonField } from '../utils.js';
import { toMoneyNumber } from '../utils/money.js';
import { getDefaultShopId } from '../services/defaultShop.js';
import { getActiveBillingDate } from '../services/dailyClosingService.js';
import { invoiceOccurredAt } from '../utils/invoiceRead.js';
import { invoiceDateRangeWhere } from '../utils/reportQuery.js';
import { wantsHiddenBills, loadHiddenInvoiceIds } from '../utils/invoiceVisibility.js';
import { receiptMetalWhere, normalizeReceiptMetal, METAL_GOLD, METAL_SILVER } from '../utils/oldMetal.js';
import { appendAuditEvent } from '../services/auditTrailService.js';
import branchConfig from '../config/branchConfig.js';

/** Receipts eligible to be sold/disposed — not already sold, not returned to a customer. */
const AVAILABLE_OLD_GOLD_STATUSES = ['posted', 'in_stock', 'melted'];

function monthBounds(month) {
  // month = YYYY-MM
  const [y, m] = String(month).split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0, 23, 59, 59, 999);
  return { start, end, y, m };
}

/** Gram totals grouped by purity — only purities that actually have weight. */
function weightsByPurity(rows) {
  const map = {};
  for (const r of rows || []) {
    const p = String(r.purity || '').trim() || 'Unknown';
    map[p] = (map[p] || 0) + (Number(r.weight_g) || 0);
  }
  return Object.entries(map)
    .map(([purity, weight]) => ({
      purity,
      weight: Math.round(weight * 1000) / 1000,
    }))
    .filter((row) => row.weight > 0)
    .sort((a, b) => {
      const na = Number(String(a.purity).match(/(\d+(?:\.\d+)?)/)?.[1] || -1);
      const nb = Number(String(b.purity).match(/(\d+(?:\.\d+)?)/)?.[1] || -1);
      if (na !== nb) return nb - na;
      return String(a.purity).localeCompare(String(b.purity));
    });
}

// ─── Karigar metal ───────────────────────────────────────────────────────────

export const listMetalIssues = async (req, res, next) => {
  try {
    const where = {};
    if (req.query.karigar_vendor_id) where.karigar_vendor_id = req.query.karigar_vendor_id;
    if (req.query.order_id) where.order_id = req.query.order_id;
    const rows = await MetalIssue.findAll({ where, order: [['created_at', 'DESC']], limit: 200 });
    return res.json({ data: rows });
  } catch (err) {
    next(err);
  }
};

export const createMetalIssue = async (req, res, next) => {
  try {
    const {
      order_id, karigar_vendor_id, movement_type, metal_type, purity, weight, scrap_weight, notes,
    } = req.body || {};
    if (!karigar_vendor_id) return res.status(400).json({ detail: 'karigar_vendor_id required' });
    if (!['issue', 'return', 'scrap'].includes(movement_type)) {
      return res.status(400).json({ detail: 'movement_type must be issue|return|scrap' });
    }
    const row = await MetalIssue.create({
      id: newId(),
      order_id: order_id || null,
      karigar_vendor_id,
      movement_type,
      metal_type: metal_type || null,
      purity: purity || null,
      weight: Number(weight) || 0,
      scrap_weight: Number(scrap_weight) || 0,
      notes: notes || null,
      created_by: req.user?.id || null,
      origin_device_id: branchConfig.device_id || null,
    });
    return res.status(201).json(row);
  } catch (err) {
    next(err);
  }
};

export const karigarLedger = async (req, res, next) => {
  try {
    const vendorId = req.params.vendorId;
    const issues = await MetalIssue.findAll({
      where: { karigar_vendor_id: vendorId },
      order: [['created_at', 'ASC']],
    });
    let issued = 0;
    let returned = 0;
    let scrap = 0;
    for (const m of issues) {
      const w = Number(m.weight) || 0;
      if (m.movement_type === 'issue') issued += w;
      else if (m.movement_type === 'return') returned += w;
      else scrap += w + (Number(m.scrap_weight) || 0);
    }
    const purchases = await Purchase.findAll({
      where: { vendor_id: vendorId, purchase_type: 'karigar_work' },
      order: [['created_at', 'DESC']],
      limit: 50,
    });
    const labour = purchases.reduce((s, p) => s + toMoneyNumber(p.grand_total || p.total || 0), 0);
    return res.json({
      vendor_id: vendorId,
      weight: {
        issued: Math.round(issued * 1000) / 1000,
        returned: Math.round(returned * 1000) / 1000,
        scrap: Math.round(scrap * 1000) / 1000,
        balance: Math.round((issued - returned - scrap) * 1000) / 1000,
      },
      labour_payable: toMoneyNumber(labour),
      movements: issues,
      purchases,
    });
  } catch (err) {
    next(err);
  }
};

// ─── Old gold buybook ────────────────────────────────────────────────────────

export const listOldGoldBuybook = async (req, res, next) => {
  try {
    const where = { ...receiptMetalWhere(METAL_GOLD) };
    if (req.query.status) where.status = req.query.status;
    if (req.query.customer_id) where.customer_id = req.query.customer_id;
    const rows = await OldGoldReceipt.findAll({ where, order: [['created_at', 'DESC']], limit: 200 });
    const includeHidden = wantsHiddenBills({ ...req.query, _role: req.user?.role });
    let visible = rows;
    if (!includeHidden) {
      const shopId = await getDefaultShopId();
      const hiddenIds = await loadHiddenInvoiceIds(shopId);
      visible = rows.filter((r) => !r.invoice_id || !hiddenIds.has(r.invoice_id));
    }
    const byPurity = {};
    for (const r of visible) {
      if (!['posted', 'in_stock'].includes(r.status)) continue;
      const p = r.purity || 'unknown';
      byPurity[p] = (byPurity[p] || 0) + Number(r.weight_g || 0);
    }
    return res.json({
      data: visible,
      stock_by_purity: Object.entries(byPurity).map(([purity, weight]) => ({
        purity,
        weight: Math.round(weight * 1000) / 1000,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// ─── Old gold exchange (invoice-linked, POS/Estimation) ───────────────────────

/**
 * Old Gold Exchange status is derived from the linked invoice's cancellation
 * state, not stored — a single source of truth that can't drift out of sync:
 *   invoice active     -> "exchanged"
 *   invoice cancelled  -> "returned_to_customer"
 * The receipt itself is never deleted or mutated when an invoice is cancelled.
 */
export const listOldGoldExchange = async (req, res, next) => {
  try {
    const {
      from, to, customer_id, customer, phone, purity, status, invoice_no,
      limit, offset, metal,
    } = req.query;

    const where = { invoice_id: { [Op.ne]: null }, ...receiptMetalWhere(metal || METAL_GOLD) };
    if (customer_id) where.customer_id = customer_id;
    if (purity) where.purity = purity;
    if (invoice_no) where.invoice_no = { [likeOp]: `%${invoice_no}%` };
    if (customer) where.customer_name = { [likeOp]: `%${customer}%` };
    if (phone) where.customer_phone = { [likeOp]: `%${phone}%` };

    // Date range is applied in JS against the linked invoice timestamp (not the
    // receipt row's created_at, and never "now"). Receipt.created_at can drift
    // from the POS invoice clock.
    const receipts = await OldGoldReceipt.findAll({ where, order: [['created_at', 'DESC']], limit: 2000 });

    const invoiceIds = [...new Set(receipts.map((r) => r.invoice_id).filter(Boolean))];
    const invoices = invoiceIds.length
      ? await Invoice.findAll({
        where: { id: { [Op.in]: invoiceIds } },
        attributes: ['id', 'invoice_no', 'customer_name', 'customer_mobile', 'cancelled_at', 'created_at', 'business_date', 'is_hidden'],
      })
      : [];
    const includeHidden = wantsHiddenBills({ ...req.query, _role: req.user?.role });
    const invoiceById = new Map(invoices.map((i) => [i.id, i]));
    const visibleReceipts = includeHidden
      ? receipts
      : receipts.filter((r) => {
        const inv = invoiceById.get(r.invoice_id);
        return !(inv && (inv.is_hidden === true || inv.is_hidden === 1));
      });

    const fromBound = from ? new Date(`${from}T00:00:00`) : null;
    const toBound = to ? new Date(`${to}T23:59:59.999`) : null;

    const allRows = visibleReceipts.map((r) => {
      const inv = invoiceById.get(r.invoice_id);
      const cancelled = Boolean(inv?.cancelled_at);
      // Prefer the receipt's OWN business_date (set from the invoice's
      // business_date at creation time — see billingService.js) over the
      // joined invoice's, so this never depends on which attributes happen
      // to be selected on that query; falls back to the invoice's for any
      // older receipt that predates the business_date column.
      const invoiceAt = invoiceOccurredAt(r) || invoiceOccurredAt(inv) || r.created_at;
      return {
        id: r.id,
        invoice_id: r.invoice_id,
        invoice_no: r.invoice_no || inv?.invoice_no || null,
        invoice_serial: r.invoice_serial ?? null,
        customer_id: r.customer_id,
        customer_name: r.customer_name || inv?.customer_name || null,
        customer_phone: r.customer_phone || inv?.customer_mobile || null,
        weight_g: Number(r.weight_g) || 0,
        purity: r.purity || null,
        rate: Number(r.rate) || 0,
        value: Number(r.value) || 0,
        status: cancelled ? 'returned_to_customer' : 'exchanged',
        description: r.description || null,
        created_at: r.created_at,
        invoice_at: invoiceAt,
      };
    }).filter((row) => {
      if (!fromBound && !toBound) return true;
      const at = row.invoice_at ? new Date(row.invoice_at) : null;
      if (!at || Number.isNaN(at.getTime())) return false;
      if (fromBound && at < fromBound) return false;
      if (toBound && at > toBound) return false;
      return true;
    });

    // Dashboard cards + purity chart always represent ACTIVE exchanged gold —
    // returned-to-customer records must never count as currently-held old gold.
    allRows.sort((a, b) => {
      const ta = a.invoice_at ? new Date(a.invoice_at).getTime() : 0;
      const tb = b.invoice_at ? new Date(b.invoice_at).getTime() : 0;
      return tb - ta;
    });

    const activeRows = allRows.filter((r) => r.status === 'exchanged');
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthRows = activeRows.filter((r) => {
      const at = r.invoice_at ? new Date(r.invoice_at) : null;
      return at && at >= monthStart;
    });

    const sumWeight = (rows) => Math.round(rows.reduce((s, r) => s + r.weight_g, 0) * 1000) / 1000;
    const sumValue = (rows) => toMoneyNumber(rows.reduce((s, r) => s + r.value, 0));
    const totalByPurity = weightsByPurity(activeRows);
    const thisMonthByPurity = weightsByPurity(thisMonthRows);

    // Status filter applies only to the listed rows — the table view — not to
    // the always-active dashboard/chart totals above.
    const filteredRows = status ? allRows.filter((r) => r.status === status) : allRows;

    const purityTotalsMap = {};
    for (const r of filteredRows) {
      const p = r.purity;
      if (!p) continue;
      if (!purityTotalsMap[p]) purityTotalsMap[p] = { purity: p, total_weight: 0, total_value: 0 };
      purityTotalsMap[p].total_weight += r.weight_g;
      purityTotalsMap[p].total_value += r.value;
    }
    const purity_totals = Object.values(purityTotalsMap).map((row) => ({
      purity: row.purity,
      total_weight: Math.round(row.total_weight * 1000) / 1000,
      total_value: toMoneyNumber(row.total_value),
    }));

    const pageSize = Math.min(Number(limit) || 100, 2000);
    const pageOffset = Math.max(Number(offset) || 0, 0);
    const pageRows = filteredRows.slice(pageOffset, pageOffset + pageSize);

    return res.json({
      data: pageRows,
      total: filteredRows.length,
      summary: {
        total_weight: sumWeight(activeRows),
        total_value: sumValue(activeRows),
        this_month_weight: sumWeight(thisMonthRows),
        this_month_value: sumValue(thisMonthRows),
        filtered_weight: sumWeight(filteredRows),
        filtered_value: sumValue(filteredRows),
        total_weight_by_purity: totalByPurity,
        this_month_weight_by_purity: thisMonthByPurity,
      },
      purity_distribution: totalByPurity,
      purity_totals,
    });
  } catch (err) {
    next(err);
  }
};

export const createOldGoldBuy = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const {
      customer_id, weight_g, purity, rate, description, status = 'in_stock',
      payment_mode = 'cash',
    } = req.body || {};
    const w = Number(weight_g);
    const r = Number(rate);
    if (!(w > 0) || !(r > 0)) {
      await t.rollback();
      return res.status(400).json({ detail: 'weight_g and rate required' });
    }
    const shopId = await getDefaultShopId({ transaction: t });
    const { date: businessDate } = await getActiveBillingDate({ shopId, transaction: t });
    const value = toMoneyNumber(w * r);
    const receiptId = newId();
    const row = await OldGoldReceipt.create({
      id: receiptId,
      shop_id: shopId,
      receipt_no: `OG-${Date.now().toString(36).toUpperCase()}`,
      customer_id: customer_id || null,
      metal: 'gold',
      invoice_id: null,
      weight_g: w,
      purity: purity || null,
      rate: r,
      value,
      value_paise: Math.round(value * 100),
      description: description || 'Cash buy',
      status,
      created_by: req.user?.id || null,
      business_date: businessDate,
    }, { transaction: t });

    const { postOldGoldPurchaseJournal } = await import('../services/ledgerService.js');
    await postOldGoldPurchaseJournal({
      shopId,
      receiptId,
      amount: value,
      mode: payment_mode,
      entryDate: businessDate,
      requestId: `og-buy:${receiptId}`,
      userId: req.user?.id || null,
      transaction: t,
    });

    await t.commit();
    return res.status(201).json(row);
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

export const updateOldGoldTrail = async (req, res, next) => {
  try {
    const row = await OldGoldReceipt.findByPk(req.params.id);
    if (!row) return res.status(404).json({ detail: 'Not found' });
    const {
      status, trail_notes,
      recovered_weight_g, recovered_purity, process_loss_g,
    } = req.body || {};
    if (row.old_gold_sale_id) {
      return res.status(409).json({ detail: 'This old gold has already been sold/disposed' });
    }
    const updates = {};
    if (status) updates.status = status;
    let notes = trail_notes !== undefined ? trail_notes : row.trail_notes;
    // Melting/assay is a physical transformation, never a monetary event —
    // book value and the 1300 GL balance are untouched here; the recovered
    // detail is recorded as a structured audit line only.
    if (recovered_weight_g !== undefined) {
      const recovered = Number(recovered_weight_g);
      if (!(recovered >= 0) || recovered > Number(row.weight_g)) {
        return res.status(400).json({ detail: 'recovered_weight_g must be between 0 and the receipt weight' });
      }
      const loss = process_loss_g !== undefined
        ? Number(process_loss_g)
        : toMoneyNumber(Number(row.weight_g) - recovered);
      const meltLine = `Melted ${new Date().toISOString()}: recovered ${recovered}g`
        + (recovered_purity ? ` ${recovered_purity}` : '')
        + ` (loss ${loss}g)`;
      notes = [notes, meltLine].filter(Boolean).join('\n');
    }
    if (notes !== row.trail_notes) updates.trail_notes = notes;
    await row.update(updates);
    return res.json(row);
  } catch (err) {
    next(err);
  }
};

// ─── Old gold sale / disposal (to wholesaler/refiner) ────────────────────────

export const listAvailableOldGoldForSale = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const metalKind = normalizeReceiptMetal(req.query.metal || METAL_GOLD);
    const where = {
      shop_id: shopId,
      old_gold_sale_id: null,
      status: { [Op.in]: AVAILABLE_OLD_GOLD_STATUSES },
      ...receiptMetalWhere(metalKind),
    };
    if (req.query.purity) where.purity = req.query.purity;
    let rows = await OldGoldReceipt.findAll({ where, order: [['created_at', 'DESC']], limit: 500 });
    if (!wantsHiddenBills({ ...req.query, _role: req.user?.role })) {
      const hiddenIds = await loadHiddenInvoiceIds(shopId);
      rows = rows.filter((r) => !r.invoice_id || !hiddenIds.has(r.invoice_id));
    }
    return res.json({ data: rows });
  } catch (err) {
    next(err);
  }
};

export const listOldGoldSales = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const metalKind = normalizeReceiptMetal(req.query.metal || METAL_GOLD);
    const where = { shop_id: shopId, ...receiptMetalWhere(metalKind) };
    if (req.query.status) where.status = req.query.status;
    if (req.query.from || req.query.to) {
      where.business_date = {};
      if (req.query.from) where.business_date[Op.gte] = req.query.from;
      if (req.query.to) where.business_date[Op.lte] = req.query.to;
    }
    const rows = await OldGoldSale.findAll({ where, order: [['created_at', 'DESC']], limit: 200 });
    if (!wantsHiddenBills({ ...req.query, _role: req.user?.role })) {
      const hiddenIds = await loadHiddenInvoiceIds(shopId);
      const receiptIdList = [];
      for (const s of rows) {
        const ids = Array.isArray(s.receipt_ids) ? s.receipt_ids : [];
        for (const id of ids) if (id) receiptIdList.push(id);
      }
      const linked = receiptIdList.length
        ? await OldGoldReceipt.findAll({
          where: { id: { [Op.in]: [...new Set(receiptIdList)] } },
          attributes: ['id', 'invoice_id'],
        })
        : [];
      const receiptHidden = new Set(
        linked.filter((r) => r.invoice_id && hiddenIds.has(r.invoice_id)).map((r) => r.id),
      );
      const visible = rows.filter((s) => {
        const ids = Array.isArray(s.receipt_ids) ? s.receipt_ids : [];
        return !ids.some((id) => receiptHidden.has(id));
      });
      return res.json({ data: visible });
    }
    return res.json({ data: rows });
  } catch (err) {
    next(err);
  }
};

export const createOldGoldSale = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const {
      receipt_ids, buyer_name, vendor_id = null, sale_value, payment_mode = 'cash',
      reference_no = null, refining_charges = 0, notes = null,
      request_id = null, metal: metalIn,
    } = req.body || {};
    const metalKind = normalizeReceiptMetal(metalIn || req.query.metal || METAL_GOLD);
    const metalLabel = metalKind === METAL_SILVER ? 'old silver' : 'old gold';

    if (request_id) {
      const existing = await OldGoldSale.findOne({ where: { request_id }, transaction: t });
      if (existing) {
        await t.commit();
        return res.status(200).json(existing);
      }
    }

    const ids = Array.isArray(receipt_ids) ? [...new Set(receipt_ids.filter(Boolean))] : [];
    const saleAmt = Number(sale_value);
    const charges = Number(refining_charges) || 0;
    if (!ids.length) {
      await t.rollback();
      return res.status(400).json({ detail: 'receipt_ids is required' });
    }
    if (!buyer_name || !String(buyer_name).trim()) {
      await t.rollback();
      return res.status(400).json({ detail: 'buyer_name is required' });
    }
    if (!(saleAmt > 0)) {
      await t.rollback();
      return res.status(400).json({ detail: 'sale_value must be greater than 0' });
    }
    if (charges < 0 || charges > saleAmt) {
      await t.rollback();
      return res.status(400).json({ detail: 'refining_charges must be between 0 and sale_value' });
    }

    const shopId = await getDefaultShopId({ transaction: t });

    // Re-check availability under a row lock — the real double-sale guard
    // (the list endpoint's filter is only advisory for the UI).
    const receipts = [];
    for (const id of ids.sort()) {
      const receipt = await OldGoldReceipt.findOne(
        withLock({ where: { id, shop_id: shopId } }, t),
      );
      if (!receipt) {
        await t.rollback();
        return res.status(404).json({ detail: `${metalLabel} receipt not found: ${id}` });
      }
      if (receipt.old_gold_sale_id) {
        await t.rollback();
        return res.status(409).json({ detail: `${metalLabel} receipt already sold: ${receipt.receipt_no || id}` });
      }
      if (normalizeReceiptMetal(receipt.metal) !== metalKind) {
        await t.rollback();
        return res.status(409).json({
          detail: `Receipt ${receipt.receipt_no || id} is ${normalizeReceiptMetal(receipt.metal)}, not ${metalKind}`,
        });
      }
      if (!AVAILABLE_OLD_GOLD_STATUSES.includes(receipt.status)) {
        await t.rollback();
        return res.status(409).json({ detail: `${metalLabel} receipt not available (status: ${receipt.status}): ${receipt.receipt_no || id}` });
      }
      receipts.push(receipt);
    }

    if (!wantsHiddenBills({ ...req.query, ...req.body, _role: req.user?.role })) {
      const hiddenIds = await loadHiddenInvoiceIds(shopId, { transaction: t });
      const hiddenReceipt = receipts.find((r) => r.invoice_id && hiddenIds.has(r.invoice_id));
      if (hiddenReceipt) {
        await t.rollback();
        return res.status(409).json({
          detail: metalKind === METAL_SILVER
            ? 'Old silver from a hidden bill is only available after you unlock hidden bills'
            : 'Old gold from a hidden bill is only available after you unlock hidden bills',
        });
      }
    }

    const grossWeight = toMoneyNumber(receipts.reduce((s, r) => s + (Number(r.weight_g) || 0), 0));
    const bookValue = toMoneyNumber(receipts.reduce((s, r) => s + (Number(r.value) || 0), 0));
    const purities = [...new Set(receipts.map((r) => r.purity).filter(Boolean))];
    const gainLoss = toMoneyNumber(saleAmt - bookValue);

    const { date: businessDate } = await getActiveBillingDate({ shopId, transaction: t });
    const saleId = newId();
    const sale = await OldGoldSale.create({
      id: saleId,
      shop_id: shopId,
      sale_no: `${metalKind === METAL_SILVER ? 'OSS' : 'OGS'}-${Date.now().toString(36).toUpperCase()}`,
      business_date: businessDate,
      buyer_name: String(buyer_name).trim(),
      vendor_id,
      receipt_ids: ids,
      metal: metalKind,
      gross_weight_g: grossWeight,
      purity: purities.length === 1 ? purities[0] : (purities.length ? 'Mixed' : null),
      book_value: bookValue,
      sale_value: toMoneyNumber(saleAmt),
      refining_charges: toMoneyNumber(charges),
      gain_loss_amount: gainLoss,
      payment_mode,
      reference_no,
      notes,
      status: 'posted',
      created_by: req.user?.id || null,
      request_id,
    }, { transaction: t });

    for (const receipt of receipts) {
      await receipt.update({ old_gold_sale_id: saleId, status: 'sold' }, { transaction: t });
    }

    const { postOldGoldSaleJournal } = await import('../services/ledgerService.js');
    await postOldGoldSaleJournal({
      shopId,
      saleId,
      bookValue,
      saleValue: saleAmt,
      refiningCharges: charges,
      mode: payment_mode,
      entryDate: businessDate,
      metal: metalKind,
      requestId: request_id ? `${request_id}:jrnl` : `ogsale-jrnl:${saleId}`,
      userId: req.user?.id || null,
      transaction: t,
    });

    await appendAuditEvent({
      eventType: 'old_gold_sale_created',
      action: 'create',
      entityType: 'old_gold_sale',
      entityId: saleId,
      userId: req.user?.id || null,
      deviceId: branchConfig.device_id,
      newValue: { buyer_name, sale_value: saleAmt, book_value: bookValue, gain_loss: gainLoss, receipt_ids: ids },
      transaction: t,
    });

    await t.commit();
    return res.status(201).json(sale);
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

export const cancelOldGoldSale = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const sale = await OldGoldSale.findByPk(req.params.id, withLock({}, t));
    if (!sale) {
      await t.rollback();
      return res.status(404).json({ detail: 'Not found' });
    }
    if (sale.status === 'cancelled') {
      await t.rollback();
      return res.status(409).json({ detail: 'Already cancelled' });
    }

    const shopId = sale.shop_id;
    const { date: entryDate } = await getActiveBillingDate({ shopId, transaction: t });
    const { reverseJournalsForSource } = await import('../services/ledgerService.js');
    await reverseJournalsForSource({
      shopId,
      sourceId: sale.id,
      sourceTypes: normalizeReceiptMetal(sale.metal) === METAL_SILVER ? ['old_silver_sale'] : ['old_gold_sale'],
      requestIdPrefix: `cancel-ogsale:${sale.id}`,
      userId: req.user?.id || null,
      transaction: t,
      entryDate,
    });

    const ids = Array.isArray(sale.receipt_ids) ? sale.receipt_ids : [];
    for (const id of ids) {
      const receipt = await OldGoldReceipt.findOne(withLock({ where: { id, shop_id: shopId } }, t));
      if (receipt && receipt.old_gold_sale_id === sale.id) {
        await receipt.update({ old_gold_sale_id: null, status: 'in_stock' }, { transaction: t });
      }
    }

    await sale.update({
      status: 'cancelled',
      cancelled_at: new Date(),
      cancelled_by: req.user?.id || null,
      cancel_reason: req.body?.reason || 'Cancelled',
    }, { transaction: t });

    await appendAuditEvent({
      eventType: 'old_gold_sale_cancelled',
      action: 'cancel',
      entityType: 'old_gold_sale',
      entityId: sale.id,
      userId: req.user?.id || null,
      deviceId: branchConfig.device_id,
      oldValue: { status: 'posted' },
      newValue: { status: 'cancelled', reason: req.body?.reason || 'Cancelled' },
      transaction: t,
    });

    await t.commit();
    return res.json(sale);
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// ─── Rate history / audit ────────────────────────────────────────────────────

function rateNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function goldRateSourceLabel(source) {
  const s = String(source || '').toLowerCase().trim();
  if (s === 'dashboard') return 'Dashboard';
  if (s === 'live_manual' || s === 'live_auto' || s === 'online' || s === 'live') return 'Online';
  if (s === 'demo_seed') return 'System';
  return 'Settings';
}

export const listGoldRateHistory = async (req, res, next) => {
  try {
    const rows = await GoldRateHistory.findAll({
      order: [['created_at', 'DESC']],
      limit: Number(req.query.limit) || 50,
    });
    const userIds = [...new Set(rows.map((r) => r.changed_by).filter(Boolean))];
    const [users, employees] = await Promise.all([
      userIds.length
        ? User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ['id', 'name'] })
        : [],
      userIds.length
        ? Employee.findAll({ where: { user_id: { [Op.in]: userIds } }, attributes: ['user_id', 'name'] })
        : [],
    ]);
    const userName = new Map((users || []).map((u) => [u.id, u.name]));
    const employeeName = new Map((employees || []).map((e) => [e.user_id, e.name]));

    const data = rows.map((row) => {
      const json = row.toJSON ? row.toJSON() : row;
      const rates = parseJsonField(json.rates, {}) || {};
      const changedById = json.changed_by || null;
      return {
        id: json.id,
        occurred_at: rates.updated_at || json.created_at,
        created_at: json.created_at,
        gold_24k: rateNumber(rates.gold_24k),
        gold_22k: rateNumber(rates.gold_22k),
        gold_18k: rateNumber(rates.gold_18k),
        pure_silver: rateNumber(rates.pure_silver),
        silver: rateNumber(rates.silver),
        changed_by: employeeName.get(changedById) || userName.get(changedById) || (changedById ? '—' : 'System'),
        source: goldRateSourceLabel(json.source),
      };
    });
    return res.json({ data });
  } catch (err) {
    next(err);
  }
};

export const listBillingRateEvents = async (req, res, next) => {
  try {
    const rows = await BillingRateEvent.findAll({
      order: [['created_at', 'DESC']],
      limit: Number(req.query.limit) || 100,
    });
    return res.json({ data: rows });
  } catch (err) {
    next(err);
  }
};

export const recordBillingRateEvent = async (req, res, next) => {
  try {
    const { event_type, gold_rate, previous_rate, invoice_id, meta } = req.body || {};
    if (!event_type) return res.status(400).json({ detail: 'event_type required' });
    const shopId = await getDefaultShopId();
    const row = await BillingRateEvent.create({
      id: newId(),
      shop_id: shopId,
      event_type,
      gold_rate: gold_rate != null ? Number(gold_rate) : null,
      previous_rate: previous_rate != null ? Number(previous_rate) : null,
      invoice_id: invoice_id || null,
      user_id: req.user?.id || null,
      meta: meta || {},
      origin_device_id: branchConfig.device_id || null,
    });
    return res.status(201).json(row);
  } catch (err) {
    next(err);
  }
};

// ─── Commission ──────────────────────────────────────────────────────────────

export const commissionReport = async (req, res, next) => {
  try {
    const from = req.query.from;
    const to = req.query.to;
    const where = {
      status: { [Op.notIn]: ['cancelled', 'canceled', 'void', 'returned'] },
      // Business day (Transaction date), not the real created_at timestamp —
      // see invoiceDateRangeWhere.
      ...invoiceDateRangeWhere({ from, to }),
    };
    if (req.query.salesperson_id) where.salesperson_id = req.query.salesperson_id;

    const [invoices, employees] = await Promise.all([
      Invoice.findAll({ where, order: [['created_at', 'DESC']] }),
      Employee.findAll({ where: { status: 'active' } }),
    ]);
    const empMap = new Map(employees.map((e) => [e.id, e]));
    // Also map user_id → employee for POS salesperson_id that stores user id
    for (const e of employees) {
      if (e.user_id) empMap.set(e.user_id, e);
    }

    const byEmp = new Map();
    for (const inv of invoices) {
      const sid = inv.salesperson_id;
      if (!sid) continue;
      const emp = empMap.get(sid);
      if (!emp) continue;
      const pct = Number(emp.commission_pct) || 0;
      if (pct <= 0) continue;
      const items = Array.isArray(inv.items) ? inv.items : [];
      let making = 0;
      for (const it of items) {
        making += Number(it.making_amount || it.making_charges || 0) * Number(it.qty || 1);
      }
      const base = emp.commission_on === 'sales'
        ? toMoneyNumber(inv.grand_total)
        : toMoneyNumber(making);
      const commission = toMoneyNumber((base * pct) / 100);
      const key = emp.id;
      if (!byEmp.has(key)) {
        byEmp.set(key, {
          employee_id: emp.id,
          employee_name: emp.name,
          commission_pct: pct,
          commission_on: emp.commission_on || 'making',
          invoice_count: 0,
          base_total: 0,
          commission_total: 0,
          invoices: [],
        });
      }
      const row = byEmp.get(key);
      row.invoice_count += 1;
      row.base_total = toMoneyNumber(row.base_total + base);
      row.commission_total = toMoneyNumber(row.commission_total + commission);
      row.invoices.push({
        id: inv.id,
        invoice_no: inv.invoice_no,
        date: inv.created_at,
        base,
        commission,
      });
    }

    const data = [...byEmp.values()].sort((a, b) => b.commission_total - a.commission_total);
    return res.json({
      from: from || null,
      to: to || null,
      data,
      totals: {
        commission: toMoneyNumber(data.reduce((s, r) => s + r.commission_total, 0)),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── HUID / hallmark ─────────────────────────────────────────────────────────

export const hallmarkReport = async (req, res, next) => {
  try {
    const products = await Product.findAll({
      where: { deleted_at: null },
      attributes: ['id', 'name', 'barcode', 'code', 'hallmark', 'status', 'gross_weight', 'net_weight', 'created_at'],
      order: [['created_at', 'DESC']],
      limit: 5000,
    });

    const withHuid = [];
    const missing = [];
    const byHuid = new Map();
    for (const p of products) {
      const h = String(p.hallmark || '').trim();
      if (!h) {
        missing.push(p);
        continue;
      }
      withHuid.push(p);
      if (!byHuid.has(h)) byHuid.set(h, []);
      byHuid.get(h).push(p);
    }
    const duplicates = [...byHuid.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([huid, list]) => ({ huid, count: list.length, products: list }));

    const q = String(req.query.q || req.query.huid || '').trim().toLowerCase();
    const search = q
      ? products.filter((p) => String(p.hallmark || '').toLowerCase().includes(q)
        || String(p.barcode || '').toLowerCase().includes(q)
        || String(p.name || '').toLowerCase().includes(q))
      : null;

    const soldWith = withHuid.filter((p) => p.status === 'sold');
    const soldWithout = missing.filter((p) => p.status === 'sold');

    return res.json({
      summary: {
        total: products.length,
        with_huid: withHuid.length,
        missing: missing.length,
        duplicate_groups: duplicates.length,
        sold_with_huid: soldWith.length,
        sold_without_huid: soldWithout.length,
      },
      missing: missing.slice(0, 200),
      duplicates,
      sold_without_huid: soldWithout.slice(0, 100),
      search: search ? search.slice(0, 100) : undefined,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GSTR JSON ───────────────────────────────────────────────────────────────

export const gstr1Json = async (req, res, next) => {
  try {
    const month = req.query.month || localMonth();
    const { start, end, y, m } = monthBounds(month);
    const invoices = await Invoice.findAll({
      where: {
        created_at: { [Op.between]: [start, end] },
        status: { [Op.notIn]: ['cancelled', 'canceled', 'void', 'returned'] },
      },
    });
    const creditNotes = await CreditNote.findAll({
      where: { created_at: { [Op.between]: [start, end] } },
    });
    const customers = await Customer.findAll({
      where: { id: { [Op.in]: [...new Set(invoices.map((i) => i.customer_id).filter(Boolean))] } },
    });
    const custMap = new Map(customers.map((c) => [c.id, c]));

    const b2b = [];
    const b2cs = [];
    const b2cl = [];
    const hsnMap = new Map();
    const cdnr = [];

    for (const inv of invoices) {
      const cust = custMap.get(inv.customer_id);
      const gstin = cust?.gstin || cust?.gst_number || null;
      const taxable = toMoneyNumber(inv.subtotal || (Number(inv.grand_total) - Number(inv.gst_amount || 0)));
      const igst = 0;
      const cgst = toMoneyNumber(inv.cgst_amount || (Number(inv.gst_amount || 0) / 2));
      const sgst = toMoneyNumber(inv.sgst_amount || (Number(inv.gst_amount || 0) / 2));
      const val = toMoneyNumber(inv.grand_total);
      const row = {
        inum: inv.invoice_no,
        idt: inv.created_at ? new Date(inv.created_at).toISOString().slice(0, 10) : null,
        val,
        pos: '36',
        rchrg: 'N',
        inv_typ: 'R',
        itms: [{
          num: 1,
          itm_det: {
            txval: taxable,
            rt: Number(inv.gst_pct || 3),
            camt: cgst,
            samt: sgst,
            iamt: igst,
          },
        }],
      };

      if (gstin) {
        b2b.push({ ctin: gstin, inv: [row] });
      } else if (val > 250000) {
        b2cl.push(row);
      } else {
        b2cs.push({
          sply_ty: 'INTRA',
          rt: Number(inv.gst_pct || 3),
          typ: 'OE',
          pos: '36',
          txval: taxable,
          camt: cgst,
          samt: sgst,
          iamt: 0,
        });
      }

      const items = Array.isArray(inv.items) ? inv.items : [];
      for (const it of items) {
        const hsn = String(it.hsn_code || it.hsn || '7113');
        if (!hsnMap.has(hsn)) {
          hsnMap.set(hsn, { hsn_sc: hsn, qty: 0, rt: Number(inv.gst_pct || 3), txval: 0, camt: 0, samt: 0, iamt: 0 });
        }
        const h = hsnMap.get(hsn);
        h.qty += Number(it.qty || 1);
        h.txval += toMoneyNumber(it.taxable || it.subtotal || 0);
      }
    }

    for (const cn of creditNotes) {
      cdnr.push({
        nt_num: cn.credit_note_no,
        nt_dt: cn.created_at ? new Date(cn.created_at).toISOString().slice(0, 10) : null,
        val: toMoneyNumber(cn.grand_total),
        inv_id: cn.invoice_id,
      });
    }

    const payload = {
      gstin: null,
      fp: `${String(m).padStart(2, '0')}${y}`,
      b2b,
      b2cs,
      b2cl,
      cdnr: cdnr.length ? [{ nt: cdnr }] : [],
      hsn: { data: [...hsnMap.values()] },
    };

    if (req.query.download === '1') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="GSTR1_${month}.json"`);
    }
    return res.json(payload);
  } catch (err) {
    next(err);
  }
};

function localMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const gstr3bJson = async (req, res, next) => {
  try {
    const month = req.query.month || localMonth();
    const { start, end, y, m } = monthBounds(month);
    const [invoices, purchases, creditNotes] = await Promise.all([
      Invoice.findAll({
        where: {
          created_at: { [Op.between]: [start, end] },
          status: { [Op.notIn]: ['cancelled', 'canceled', 'void', 'returned'] },
        },
      }),
      Purchase.findAll({
        where: { created_at: { [Op.between]: [start, end] } },
      }),
      CreditNote.findAll({
        where: { created_at: { [Op.between]: [start, end] } },
      }),
    ]);

    const outTax = invoices.reduce((s, i) => s + toMoneyNumber(i.gst_amount), 0);
    const cnTax = creditNotes.reduce((s, c) => s + toMoneyNumber(c.gst_amount), 0);
    const inTax = purchases.reduce((s, p) => s + toMoneyNumber(p.gst_amount || p.tax_amount || 0), 0);
    const taxable = invoices.reduce((s, i) => s + toMoneyNumber(i.subtotal || 0), 0);
    const outward = toMoneyNumber(outTax - cnTax);

    const payload = {
      gstin: null,
      ret_period: `${String(m).padStart(2, '0')}${y}`,
      sup_details: {
        osup_det: {
          txval: taxable,
          iamt: 0,
          camt: toMoneyNumber(outward / 2),
          samt: toMoneyNumber(outward / 2),
          csamt: 0,
        },
      },
      inter_sup: {},
      itc_elg: {
        itc_avl: [{
          ty: 'IMPG',
          iamt: 0,
          camt: toMoneyNumber(inTax / 2),
          samt: toMoneyNumber(inTax / 2),
          csamt: 0,
        }],
      },
      inward_sup: {},
      interest: {},
      tx_pmt: {
        tx_py: [{
          trans_typ: 'Tax Liability',
          iamt: 0,
          camt: toMoneyNumber(Math.max(0, (outward - inTax) / 2)),
          samt: toMoneyNumber(Math.max(0, (outward - inTax) / 2)),
          csamt: 0,
        }],
      },
      _meta: {
        output_tax: outward,
        input_tax: toMoneyNumber(inTax),
        net_liability: toMoneyNumber(outward - inTax),
        invoice_count: invoices.length,
        credit_note_count: creditNotes.length,
        purchase_count: purchases.length,
      },
    };

    if (req.query.download === '1') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="GSTR3B_${month}.json"`);
    }
    return res.json(payload);
  } catch (err) {
    next(err);
  }
};
