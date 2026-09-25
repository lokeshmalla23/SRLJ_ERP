/**
 * Book an estimation: take advance, lock prices, hard-reserve unique tags.
 * Supports multiple advance installments on the same booking until deadline.
 */
import { Op } from 'sequelize';
import sequelize, { withLock } from '../db.js';
import { Quotation, Product } from '../models/index.js';
import { parseJsonField } from '../utils.js';
import { toMoneyNumber, roundMoney, D } from '../utils/money.js';
import { formatINR } from '../utils/formatMoney.js';
import { receiveAdvance, refundAdvance, AdvanceError } from './advanceService.js';
import {
  reserveForQuotationBooking,
  releaseQuotationBookingReserves,
  reserveTrayWeightForBooking,
  restoreTrayWeightForBooking,
  decreaseStock,
  increaseStock,
  InventoryError,
  INVENTORY_MODES,
  MOVEMENT_TYPES,
} from './inventoryService.js';
import { toWeightNumber } from '../utils/weight.js';
import { calcLineAmounts } from './billingCalc.js';
import branchConfig from '../config/branchConfig.js';
import { FINANCIAL_MODE, isPreAccountsRecord, resolveFinancialMode } from './financialMode.js';
import { stampOnTransactionDate, stampOnTransactionDateIso } from '../utils/invoiceRead.js';

// Tray: price the entered weight sold once (qty=1), never the product's full
// tray weight still sitting on gross_weight/net_weight — same substitution
// estimation print, POS, and the estimation's own live total all apply.
function traySubstituted(it) {
  if (!it?.is_tray) return it;
  const trayWeightSold = Number(it.tray_weight_sold) || 0;
  return { ...it, gross_weight: trayWeightSold, net_weight: trayWeightSold, quantity: 1 };
}

export class BookingError extends Error {
  constructor(message, { status = 400, code = 'BOOKING_ERROR' } = {}) {
    super(message);
    this.name = 'BookingError';
    this.status = status;
    this.code = code;
  }
}

/** SQLite stores JSONB as TEXT — always normalize quotation line items to an array. */
function quotationItems(quotation) {
  const raw = quotation?.items;
  const parsed = parseJsonField(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

function quotationAdvancePayments(quotation) {
  const parsed = parseJsonField(quotation?.advance_payments, []);
  if (Array.isArray(parsed) && parsed.length) return parsed;
  // Legacy single advance_id row
  if (quotation?.advance_id && Number(quotation.advance_paid) > 0) {
    return [{
      advance_id: quotation.advance_id,
      amount: toMoneyNumber(roundMoney(D(quotation.advance_paid))),
      mode: 'cash',
      paid_at: quotation.booked_at || null,
      reference: `Booking ${quotation.quote_no || ''}`.trim(),
    }];
  }
  return [];
}

/** Reverse of the tray reserve in bookQuotation() — booking cancelled/expired, give the weight/pieces back. */
async function restoreTrayItemsForQuotation(quotation, { transaction } = {}) {
  const items = quotationItems(quotation);
  const trayItems = items.filter((it) => it.is_tray && Number(it.tray_weight_sold) > 0);
  for (const it of trayItems) {
    const weight = toWeightNumber(it.tray_weight_sold);
    const pieces = Number(it.tray_pieces_sold) || 1;
    await restoreTrayWeightForBooking({ shopId: quotation.shop_id, productId: it.product_id, weight, transaction });
    await increaseStock({
      shopId: quotation.shop_id,
      productId: it.product_id,
      quantity: pieces,
      movementType: MOVEMENT_TYPES.BOOKING_RELEASE,
      referenceType: 'quotation',
      referenceId: quotation.id,
      transaction,
    });
  }
}

export function bookingAdvanceIds(quotation) {
  const ids = quotationAdvancePayments(quotation)
    .map((p) => p.advance_id)
    .filter(Boolean);
  if (quotation?.advance_id && !ids.includes(quotation.advance_id)) {
    ids.unshift(quotation.advance_id);
  }
  return [...new Set(ids)];
}

function addDaysDateOnly(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + Math.max(1, Number(days) || 7));
  return d.toISOString().slice(0, 10);
}

function enrichBookingPayload(quotation) {
  const raw = quotation.toJSON ? quotation.toJSON() : { ...quotation };
  // Under SQLite, Sequelize's JSONB columns can come back as the raw stored
  // JSON string rather than a parsed object/array — this is the payload POS
  // reads when loading a booked estimation (scan Est No / F2), and it checks
  // `old_gold.active` / iterates `items`, so an un-normalized string here
  // silently makes both disappear from the bill.
  const json = {
    ...raw,
    items: parseJsonField(raw.items, []),
    old_gold: parseJsonField(raw.old_gold, null),
    old_silver: parseJsonField(raw.old_silver, null),
  };
  const payments = quotationAdvancePayments(json);
  const grand = toMoneyNumber(roundMoney(D(json.grand_total || 0)));
  const advance = toMoneyNumber(roundMoney(D(json.advance_paid || 0)));
  return {
    ...json,
    advance_payments: payments,
    advance_ids: bookingAdvanceIds(json),
    remaining_amount: toMoneyNumber(roundMoney(D(grand - advance))),
    installment_count: payments.length,
  };
}

async function expireIfPastDeadline(quotation, { transaction } = {}) {
  if (quotation.status !== 'booked' || !quotation.valid_until) return quotation;
  const today = new Date().toISOString().slice(0, 10);
  if (String(quotation.valid_until).slice(0, 10) >= today) return quotation;

  const items = quotationItems(quotation);
  const productIds = items.map((it) => it.product_id).filter(Boolean);
  // TEST bookings never reserved live stock — restoring would inflate LIVE qty.
  if (!isPreAccountsRecord(quotation)) {
    await releaseQuotationBookingReserves({
      shopId: quotation.shop_id,
      quotationId: quotation.id,
      productIds,
      transaction,
    });
    await restoreTrayItemsForQuotation(quotation, { transaction });
  }

  // Deadline passed + customer did not complete billing:
  // - Products unfrozen (available for new estimation / sale)
  // - Estimation marked expired (cannot bill at locked rate anymore)
  // - Advance stays as open customer credit (shop still owes them — use on another bill or refund manually)
  await quotation.update({
    status: 'expired',
    price_locked: false,
    notes: [
      quotation.notes,
      `Booking expired on ${today}. Stock released. Advance kept as customer credit.`,
    ].filter(Boolean).join('\n'),
  }, { transaction });
  return quotation;
}

/**
 * Take advance against an estimation and hard-hold unique tags until deadline.
 */
export async function bookQuotation(quotationId, {
  advanceAmount,
  paymentMode = 'cash',
  deadlineDays = 7,
  requestId = null,
  user = null,
} = {}) {
  const amt = toMoneyNumber(roundMoney(D(advanceAmount || 0)));
  if (!(amt > 0)) throw new BookingError('advance_amount must be positive');

  return sequelize.transaction(async (transaction) => {
    const quotation = await Quotation.findByPk(quotationId, withLock({}, transaction));
    if (!quotation || quotation.deleted_at) {
      throw new BookingError('Estimation not found', { status: 404, code: 'NOT_FOUND' });
    }
    if (['booked', 'converted', 'expired', 'cancelled'].includes(quotation.status)) {
      throw new BookingError(
        `Cannot book estimation with status "${quotation.status}"`,
        { status: 409, code: 'INVALID_STATUS' },
      );
    }
    if (!quotation.customer_id) {
      throw new BookingError('Customer is required to take an advance booking', {
        code: 'CUSTOMER_REQUIRED',
      });
    }

    const items = quotationItems(quotation);
    if (!items.length) throw new BookingError('Estimation has no items', { code: 'EMPTY' });

    const grand = toMoneyNumber(roundMoney(D(quotation.grand_total || 0)));
    if (!(grand > 0)) throw new BookingError('Estimation total must be positive');
    if (amt >= grand) {
      throw new BookingError('Advance must be less than the estimation total — use full billing in POS instead', {
        code: 'ADVANCE_TOO_HIGH',
      });
    }

    const productIds = [...new Set(items.map((it) => it.product_id).filter(Boolean))];
    if (!productIds.length) {
      throw new BookingError('Estimation lines must reference products', {
        code: 'NO_PRODUCTS',
      });
    }

    const products = await Product.findAll({
      where: { id: productIds },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (products.length !== productIds.length) {
      throw new BookingError('One or more products on this estimation were not found', {
        code: 'PRODUCT_MISSING',
        status: 404,
      });
    }

    const validUntil = addDaysDateOnly(deadlineDays);
    const shopId = quotation.shop_id || products[0].shop_id || branchConfig.shop_id;
    const financialMode = await resolveFinancialMode(shopId, { transaction });
    const isTestBooking = financialMode === FINANCIAL_MODE.PRE_ACCOUNTS
      || isPreAccountsRecord(quotation);

    // Lock estimation gold rate + real line prices (never freeze missing prices as 0)
    const lockedGoldRate = Number(quotation.gold_rate) || 0;
    if (!(lockedGoldRate > 0)) {
      throw new BookingError('Estimation gold rate is missing — save the estimation with a rate before booking', {
        code: 'NO_GOLD_RATE',
      });
    }
    // Build purity rateMap so 22K items lock at 22K rate (not 24K × factor twice)
    let rateMap = {};
    try {
      const { Setting } = await import('../models/index.js');
      const gr = await Setting.findOne({ where: { key: 'gold_rate' }, transaction });
      const v = gr?.value || {};
      if (v.gold_24k != null) rateMap['24K'] = Number(v.gold_24k);
      if (v.gold_22k != null) rateMap['22K'] = Number(v.gold_22k);
      if (v.gold_18k != null) rateMap['18K'] = Number(v.gold_18k);
      if (v.silver != null) rateMap.Silver = Number(v.silver);
      if (v.pure_silver != null) rateMap.PureSilver = Number(v.pure_silver);
    } catch { /* settings optional */ }
    if (!(rateMap['24K'] > 0)) rateMap['24K'] = lockedGoldRate;
    if (!(rateMap['22K'] > 0) && lockedGoldRate > 0) {
      rateMap['22K'] = Math.round(lockedGoldRate * 0.9167 * 100) / 100;
    }

    const lockedItems = items.map((it) => {
      let unit = Number(it.price_override ?? it.unit_price ?? it.line_total ?? 0);
      if (!(unit > 0)) {
        try {
          const amounts = calcLineAmounts(traySubstituted(it), lockedGoldRate, rateMap);
          unit = Number(amounts.unit_price) || 0;
        } catch {
          unit = 0;
        }
      }
      if (!(unit > 0)) {
        throw new BookingError(
          `Cannot lock price for "${it.product_name || it.name || 'item'}" — check weight and gold rate`,
          { code: 'PRICE_LOCK_FAILED' },
        );
      }
      const qty = Number(it.quantity || it.qty || 1) || 1;
      return {
        ...it,
        price_override: toMoneyNumber(roundMoney(D(unit))),
        unit_price: toMoneyNumber(roundMoney(D(unit))),
        line_total: toMoneyNumber(roundMoney(D(unit).times(qty))),
        gold_rate_locked: lockedGoldRate,
        gold_22k_locked: rateMap['22K'] || null,
      };
    });

    // Hard-hold only unique tagged pieces; quantity/tray lines still get price lock + advance.
    // PRE_ACCOUNTS / TEST bookings must not consume LIVE inventory.
    if (!isTestBooking) {
      for (const p of products) {
        await reserveForQuotationBooking({
          shopId,
          productId: p.id,
          quotationId: quotation.id,
          validUntil,
          createdBy: user?.id || null,
          transaction,
        });
      }

      // Tray unit: carve the sold weight/pieces out of the tray now — otherwise
      // the full tray still shows as available to the next customer's estimation
      // even though this weight was just promised on this booking.
      const trayItems = items.filter((it) => it.is_tray && Number(it.tray_weight_sold) > 0);
      for (const it of trayItems) {
        const weight = toWeightNumber(it.tray_weight_sold);
        const pieces = Number(it.tray_pieces_sold) || 1;
        try {
          await reserveTrayWeightForBooking({ shopId, productId: it.product_id, weight, transaction });
          await decreaseStock({
            shopId,
            productId: it.product_id,
            quantity: pieces,
            movementType: MOVEMENT_TYPES.BOOKING_RESERVE,
            referenceType: 'quotation',
            referenceId: quotation.id,
            createdBy: user?.id || null,
            transaction,
          });
        } catch (err) {
          if (err instanceof InventoryError) {
            throw new BookingError(err.message, { status: err.status || 409, code: err.code || 'INSUFFICIENT_STOCK' });
          }
          throw err;
        }
      }
    }

    let advance;
    try {
      advance = await receiveAdvance({
        customerId: quotation.customer_id,
        amount: amt,
        mode: paymentMode || 'cash',
        reference: `Booking ${quotation.quote_no} #1`,
        requestId: requestId || `quote-book:${quotation.id}:${amt}`,
        userId: user?.id || null,
        shopId,
        meta: {
          quotation_id: quotation.id,
          quote_no: quotation.quote_no,
          kind: 'estimation_booking',
          installment_no: 1,
          gold_rate_locked: lockedGoldRate,
          gold_22k_locked: rateMap['22K'] || null,
        },
        transaction,
      });
    } catch (err) {
      if (err instanceof AdvanceError) {
        throw new BookingError(err.message, { status: err.status || 400, code: err.code });
      }
      throw err;
    }

    const paymentRow = {
      advance_id: advance.id,
      amount: amt,
      mode: paymentMode || 'cash',
      paid_at: stampOnTransactionDateIso(advance.business_date),
      business_date: advance.business_date,
      reference: `Booking ${quotation.quote_no} #1`,
      installment_no: 1,
    };

    const rate22 = rateMap['22K'] || Math.round(lockedGoldRate * 0.9167 * 100) / 100;
    await quotation.update({
      items: lockedItems,
      gold_rate: lockedGoldRate,
      status: 'booked',
      price_locked: true,
      advance_paid: amt,
      advance_id: advance.id,
      advance_payments: [paymentRow],
      booked_at: stampOnTransactionDate(advance.business_date),
      business_date: advance.business_date,
      valid_until: validUntil,
      financial_mode: quotation.financial_mode || financialMode,
      terms: quotation.terms
        || `22K gold rate locked at ${formatINR(rate22)}/g (24K basis ${formatINR(lockedGoldRate)}/g). Advance ${formatINR(amt)} paid. Balance due by ${validUntil}.`,
    }, { transaction });

    await quotation.reload({ transaction });
    return enrichBookingPayload(quotation);
  });
}

/**
 * Add another advance installment on an already-booked estimation.
 * Tag stays reserved; deadline unchanged; cumulative advance must stay below grand total.
 */
export async function addAdvanceToBooking(quotationId, {
  advanceAmount,
  paymentMode = 'cash',
  requestId = null,
  user = null,
} = {}) {
  const amt = toMoneyNumber(roundMoney(D(advanceAmount || 0)));
  if (!(amt > 0)) throw new BookingError('advance_amount must be positive');

  return sequelize.transaction(async (transaction) => {
    const quotation = await Quotation.findByPk(quotationId, withLock({}, transaction));
    if (!quotation || quotation.deleted_at) {
      throw new BookingError('Estimation not found', { status: 404, code: 'NOT_FOUND' });
    }

    const maybeExpired = await expireIfPastDeadline(quotation, { transaction });
    if (maybeExpired.status !== 'booked') {
      throw new BookingError(
        maybeExpired.status === 'expired'
          ? 'Booking deadline has passed — stock was released. Create a new estimation to book again.'
          : `Cannot add advance to estimation with status "${maybeExpired.status}"`,
        { status: 409, code: maybeExpired.status === 'expired' ? 'BOOKING_EXPIRED' : 'INVALID_STATUS' },
      );
    }

    if (!quotation.customer_id) {
      throw new BookingError('Customer is required', { code: 'CUSTOMER_REQUIRED' });
    }

    const grand = toMoneyNumber(roundMoney(D(quotation.grand_total || 0)));
    const paidSoFar = toMoneyNumber(roundMoney(D(quotation.advance_paid || 0)));
    const remaining = toMoneyNumber(roundMoney(D(grand - paidSoFar)));
    if (!(remaining > 0.009)) {
      throw new BookingError('No remaining balance on this booking — collect final payment in POS', {
        code: 'NOTHING_DUE',
      });
    }
    if (amt >= remaining) {
      throw new BookingError(
        `Advance installment must leave a POS balance — remaining is ${formatINR(remaining)}. Pay the final amount in POS.`,
        { code: 'ADVANCE_TOO_HIGH' },
      );
    }

    const prior = quotationAdvancePayments(quotation);
    const installmentNo = prior.length + 1;
    const shopId = quotation.shop_id || branchConfig.shop_id;

    let advance;
    try {
      advance = await receiveAdvance({
        customerId: quotation.customer_id,
        amount: amt,
        mode: paymentMode || 'cash',
        reference: `Booking ${quotation.quote_no} #${installmentNo}`,
        requestId: requestId || `quote-book-add:${quotation.id}:${installmentNo}:${amt}`,
        userId: user?.id || null,
        shopId,
        meta: {
          quotation_id: quotation.id,
          quote_no: quotation.quote_no,
          kind: 'estimation_booking_installment',
          installment_no: installmentNo,
        },
        transaction,
      });
    } catch (err) {
      if (err instanceof AdvanceError) {
        throw new BookingError(err.message, { status: err.status || 400, code: err.code });
      }
      throw err;
    }

    const paymentRow = {
      advance_id: advance.id,
      amount: amt,
      mode: paymentMode || 'cash',
      paid_at: stampOnTransactionDateIso(advance.business_date),
      business_date: advance.business_date,
      reference: `Booking ${quotation.quote_no} #${installmentNo}`,
      installment_no: installmentNo,
    };
    const nextPayments = [...prior, paymentRow];
    const newTotal = toMoneyNumber(roundMoney(D(paidSoFar + amt)));

    await quotation.update({
      advance_paid: newTotal,
      advance_payments: nextPayments,
      // Keep first advance_id as primary; list carries all IDs
      advance_id: quotation.advance_id || advance.id,
      terms: [
        quotation.terms,
        `Installment #${installmentNo}: ${formatINR(amt)} via ${paymentMode || 'cash'} (total advance ${formatINR(newTotal)}).`,
      ].filter(Boolean).join('\n'),
    }, { transaction });

    await quotation.reload({ transaction });
    return enrichBookingPayload(quotation);
  });
}

export async function cancelQuotationBooking(quotationId, { user = null, reason = null } = {}) {
  return sequelize.transaction(async (transaction) => {
    const quotation = await Quotation.findByPk(quotationId, withLock({}, transaction));
    if (!quotation || quotation.deleted_at) {
      throw new BookingError('Estimation not found', { status: 404, code: 'NOT_FOUND' });
    }
    if (quotation.status !== 'booked') {
      throw new BookingError(`Only booked estimations can be cancelled (status: ${quotation.status})`, {
        code: 'INVALID_STATUS',
        status: 409,
      });
    }

    const items = quotationItems(quotation);
    const productIds = items.map((it) => it.product_id).filter(Boolean);
    if (!isPreAccountsRecord(quotation)) {
      await releaseQuotationBookingReserves({
        shopId: quotation.shop_id,
        quotationId: quotation.id,
        productIds,
        transaction,
      });
      await restoreTrayItemsForQuotation(quotation, { transaction });
    }

    // Refund every unused installment linked to this booking
    const advanceIds = bookingAdvanceIds(quotation);
    for (const advanceId of advanceIds) {
      try {
        await refundAdvance({
          advanceId,
          reason: reason || `Estimation ${quotation.quote_no} cancelled`,
          requestId: `quote-cancel-refund:${quotation.id}:${advanceId}`,
          userId: user?.id || null,
          transaction,
        });
      } catch (err) {
        if (err instanceof AdvanceError) {
          throw new BookingError(err.message, { status: err.status || 400, code: err.code });
        }
        throw err;
      }
    }

    await quotation.update({
      status: 'cancelled',
      price_locked: false,
      notes: [
        quotation.notes,
        reason
          ? `Booking cancelled: ${reason}. Advance refunded (${advanceIds.length} installment(s)). Stock released.`
          : `Booking cancelled. Advance refunded (${advanceIds.length} installment(s)). Stock released.`,
      ].filter(Boolean).join('\n'),
    }, { transaction });

    await quotation.reload({ transaction });
    return enrichBookingPayload(quotation);
  });
}

/** Expire overdue booked estimations (stock release + keep advance as credit). */
export async function expireOverdueBookings({ limit = 100 } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = await Quotation.findAll({
    where: {
      status: 'booked',
      valid_until: { [Op.lt]: today },
      deleted_at: null,
    },
    order: [['valid_until', 'ASC']],
    limit: Math.min(Number(limit) || 100, 500),
  });
  const results = [];
  for (const q of overdue) {
    const updated = await prepareQuotationForPos(q);
    if (updated) results.push(updated);
  }
  return results;
}

/** Enrich GET payloads; auto-expire past-deadline bookings. */
export async function prepareQuotationForPos(quotation) {
  return sequelize.transaction(async (transaction) => {
    const locked = await Quotation.findByPk(quotation.id, withLock({}, transaction));
    if (!locked) return null;
    const updated = await expireIfPastDeadline(locked, { transaction });
    return enrichBookingPayload(updated);
  });
}

export { enrichBookingPayload, expireIfPastDeadline, quotationAdvancePayments };

/**
 * When ornaments are sold outside an open estimation, auto-expire that estimation
 * so staff don't try to bill a sold tag later.
 * - Unique tags: expire as soon as the piece is sold
 * - Quantity/tray: expire only when stock hits zero
 * Does NOT touch booked estimations (those hold the tag until deadline/cancel).
 */
export async function expireOpenEstimationsForSoldProducts({
  shopId = null,
  productIds = [],
  invoiceId = null,
  invoiceNo = null,
  excludeQuotationId = null,
  transaction = null,
} = {}) {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) return [];

  const where = {
    deleted_at: null,
    status: { [Op.in]: ['draft', 'sent', 'accepted'] },
  };
  if (shopId) where.shop_id = shopId;
  if (excludeQuotationId) where.id = { [Op.ne]: excludeQuotationId };

  const open = await Quotation.findAll({ where, transaction });
  if (!open.length) return [];

  const products = await Product.findAll({
    where: { id: ids },
    transaction,
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const soldOutIds = new Set();
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) continue;
    const qty = Number(p.stock_qty) || 0;
    const uniqueSold = p.inventory_mode === INVENTORY_MODES.UNIQUE_TAG
      && (p.status === 'sold' || p.status === 'deleted_p' || p.status === 'deleted' || qty <= 0);
    const qtyGone = p.inventory_mode !== INVENTORY_MODES.UNIQUE_TAG && qty <= 0;
    if (uniqueSold || qtyGone) soldOutIds.add(id);
  }
  if (!soldOutIds.size) return [];

  const expired = [];
  const ref = invoiceNo || invoiceId || 'sale';
  const note = `Auto-expired: ornament sold on invoice ${ref}. Create a new estimation if the customer still wants to buy.`;

  for (const q of open) {
    const items = quotationItems(q);
    const hit = items.some((it) => it.product_id && soldOutIds.has(it.product_id));
    if (!hit) continue;
    await q.update({
      status: 'expired',
      price_locked: false,
      notes: [q.notes, note].filter(Boolean).join('\n'),
    }, { transaction });
    await q.reload({ transaction });
    expired.push(enrichBookingPayload(q));
  }
  return expired;
}

/**
 * Look up an active booked estimation that holds this product (unique tag or line).
 * Used by POS to warn cashiers before adding a booked ornament to another bill.
 *
 * Tray items are excluded from this lookup on purpose: unlike a single unique
 * tag, a tray is a shared pool a booking only carves a slice out of (see
 * bookQuotation's reserveTrayWeightForBooking) — the remaining weight is
 * already correctly reflected on the product itself, so a booking here must
 * never fully lock the tray out from other customers.
 */
export async function findActiveBookingForProduct(productId) {
  if (!productId) return null;

  const booked = await Quotation.findAll({
    where: {
      status: 'booked',
      deleted_at: null,
    },
    order: [['booked_at', 'DESC']],
    limit: 200,
  });

  for (const q of booked) {
    // Soft-expire past deadline so POS does not block on stale bookings
    const maybe = await expireIfPastDeadline(q);
    if (maybe.status !== 'booked') continue;

    const items = quotationItems(maybe);
    const hit = items.find((it) => it?.product_id === productId && !it.is_tray);
    if (!hit) continue;

    const enriched = enrichBookingPayload(maybe);
    return {
      booked: true,
      quotation_id: enriched.id,
      quote_no: enriched.quote_no,
      customer_id: enriched.customer_id,
      customer_name: enriched.customer_name || 'Customer',
      customer_mobile: enriched.customer_mobile || null,
      valid_until: enriched.valid_until,
      advance_paid: enriched.advance_paid,
      remaining_amount: enriched.remaining_amount,
      installment_count: enriched.installment_count || 0,
      product_id: productId,
      product_name: hit.product_name || hit.name || null,
      barcode: hit.barcode || null,
    };
  }
  return null;
}

/**
 * Customer booking ledger — locked tags + installment history for 360 view.
 */
export async function buildCustomerBookingLedger(customerId, { limit = 30 } = {}) {
  const { Product } = await import('../models/index.js');
  const quotations = await Quotation.findAll({
    where: {
      customer_id: customerId,
      deleted_at: null,
      status: { [Op.in]: ['booked', 'converted', 'expired', 'cancelled'] },
    },
    order: [['booked_at', 'DESC'], ['created_at', 'DESC']],
    limit: Math.min(Number(limit) || 30, 100),
  });

  const rows = [];
  for (const q of quotations) {
    const enriched = enrichBookingPayload(q);
    if (!(Number(enriched.advance_paid) > 0) && enriched.status !== 'booked') continue;

    const items = quotationItems(q);
    const productIds = [...new Set(items.map((it) => it.product_id).filter(Boolean))];
    const products = productIds.length
      ? await Product.findAll({ where: { id: productIds } })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));

    rows.push({
      quotation_id: enriched.id,
      quote_no: enriched.quote_no,
      status: enriched.status,
      booked_at: enriched.booked_at,
      business_date: enriched.business_date,
      valid_until: enriched.valid_until,
      gold_rate: enriched.gold_rate,
      price_locked: Boolean(enriched.price_locked),
      grand_total: toMoneyNumber(roundMoney(D(enriched.grand_total || 0))),
      advance_paid: toMoneyNumber(roundMoney(D(enriched.advance_paid || 0))),
      remaining_amount: enriched.remaining_amount,
      installment_count: enriched.installment_count || 0,
      payments: quotationAdvancePayments(enriched),
      products: items.map((it) => {
        const p = it.product_id ? byId.get(it.product_id) : null;
        return {
          product_id: it.product_id || null,
          name: it.product_name || it.name || p?.name || 'Item',
          barcode: it.barcode || p?.barcode || null,
          net_weight: Number(it.net_weight ?? p?.net_weight) || 0,
          purity: it.purity || it.purity_name || null,
          status: p?.status || (enriched.status === 'booked' ? 'estimation' : null),
          locked: enriched.status === 'booked' && (p?.status === 'estimation' || p?.status === 'reserved' || Boolean(enriched.price_locked)),
        };
      }),
    });
  }
  return rows;
}

