/**
 * Customer advance liability ledger — receive, apply to invoice, refund.
 */
import sequelize from '../db.js';
import { newId } from '../utils.js';
import {
  CustomerAdvance,
  CustomerAdvanceApplication,
  Customer,
  Payment,
} from '../models/index.js';
import { toPaise, roundMoney, D, toMoneyNumber } from '../utils/money.js';
import { getDefaultShopId } from './defaultShop.js';
import { appendAuditEvent } from './auditTrailService.js';
import { getActiveBillingDate } from './dailyClosingService.js';
import { stampOnTransactionDate } from '../utils/invoiceRead.js';

export class AdvanceError extends Error {
  constructor(message, { status = 400, code = 'ADVANCE_ERROR' } = {}) {
    super(message);
    this.name = 'AdvanceError';
    this.status = status;
    this.code = code;
  }
}

export async function receiveAdvance({
  customerId,
  amount,
  mode = 'cash',
  reference = null,
  requestId = null,
  userId = null,
  shopId = null,
  meta = {},
  transaction: outerTx = null,
}) {
  const amt = toMoneyNumber(roundMoney(D(amount || 0)));
  if (!customerId) throw new AdvanceError('customer_id required');
  if (!(amt > 0)) throw new AdvanceError('amount must be positive');

  const run = async (transaction) => {
    if (requestId) {
      const existing = await CustomerAdvance.findOne({
        where: { request_id: requestId },
        transaction,
      });
      if (existing) return existing;
    }

    const customer = await Customer.findByPk(customerId, { transaction });
    if (!customer) throw new AdvanceError('Customer not found', { status: 404, code: 'NOT_FOUND' });

    const resolvedShopId = shopId || customer.shop_id || await getDefaultShopId({ transaction });
    const { date: businessDate } = await getActiveBillingDate({ shopId: resolvedShopId, transaction });
    const advance = await CustomerAdvance.create({
      id: newId(),
      shop_id: resolvedShopId,
      customer_id: customerId,
      amount: amt,
      amount_paise: toPaise(amt),
      used_amount: 0,
      remaining_amount: amt,
      mode,
      reference,
      status: 'open',
      request_id: requestId || null,
      received_by: userId,
      meta,
      business_date: businessDate,
    }, { transaction });

    await Payment.create({
      id: newId(),
      shop_id: resolvedShopId,
      invoice_id: null,
      customer_id: customerId,
      mode,
      amount: amt,
      amount_paise: toPaise(amt),
      reference: reference || `Advance ${advance.id}`,
      received_by: userId,
      request_id: requestId ? `${requestId}:payment` : null,
      status: 'posted',
      paid_at: stampOnTransactionDate(businessDate),
      business_date: businessDate,
      meta: { kind: 'customer_advance', advance_id: advance.id },
    }, { transaction });

    const { postAdvanceReceivedJournal } = await import('./ledgerService.js');
    await postAdvanceReceivedJournal({
      shopId: resolvedShopId,
      advanceId: advance.id,
      amount: amt,
      mode,
      entryDate: businessDate,
      requestId: requestId ? `${requestId}:jrnl` : null,
      userId,
      transaction,
    });

    await appendAuditEvent({
      eventType: 'ADVANCE_RECEIVED',
      action: 'advance.receive',
      entityType: 'customer_advance',
      entityId: advance.id,
      userId,
      newValue: { customerId, amount: amt, mode },
      transaction,
    });

    return advance;
  };

  if (outerTx) return run(outerTx);
  return sequelize.transaction(run);
}

export async function getCustomerAdvanceBalance(customerId, { transaction } = {}) {
  const rows = await CustomerAdvance.findAll({
    where: { customer_id: customerId, status: 'open' },
    transaction,
  });
  const balance = rows.reduce((sum, r) => sum + (Number(r.remaining_amount) || 0), 0);
  return { balance: toMoneyNumber(roundMoney(D(balance))), advances: rows };
}

/**
 * Apply open advances FIFO to an invoice amount. Returns applications created.
 */
export async function applyAdvancesToInvoice({
  customerId,
  invoiceId,
  amount,
  requestId = null,
  shopId = null,
  userId = null,
  preferAdvanceId = null,
  preferAdvanceIds = null,
  transaction: outerTx = null,
}) {
  const need = toMoneyNumber(roundMoney(D(amount || 0)));
  if (!(need > 0)) return { applied: 0, applications: [] };
  if (!customerId || !invoiceId) {
    throw new AdvanceError('customer_id and invoice_id required');
  }

  const run = async (transaction) => {
    if (requestId) {
      const existing = await CustomerAdvanceApplication.findOne({
        where: { request_id: requestId },
        transaction,
      });
      if (existing) {
        return { applied: Number(existing.amount), applications: [existing], idempotent: true };
      }
    }

    const advances = await CustomerAdvance.findAll({
      where: { customer_id: customerId, status: 'open' },
      order: [['created_at', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    const preferred = new Set(
      [
        ...(Array.isArray(preferAdvanceIds) ? preferAdvanceIds : []),
        preferAdvanceId,
      ].filter(Boolean),
    );
    if (preferred.size) {
      advances.sort((a, b) => {
        const ap = preferred.has(a.id) ? 0 : 1;
        const bp = preferred.has(b.id) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return new Date(a.created_at) - new Date(b.created_at);
      });
    }

    let remaining = need;
    const applications = [];
    const resolvedShopId = shopId || advances[0]?.shop_id || await getDefaultShopId({ transaction });

    for (const adv of advances) {
      if (remaining <= 0) break;
      const avail = Number(adv.remaining_amount) || 0;
      if (avail <= 0) continue;
      const take = Math.min(avail, remaining);
      const used = toMoneyNumber(roundMoney(D((Number(adv.used_amount) || 0) + take)));
      const rem = toMoneyNumber(roundMoney(D(avail - take)));
      await adv.update({
        used_amount: used,
        remaining_amount: rem,
        status: rem <= 0.001 ? 'applied' : 'open',
      }, { transaction });

      const app = await CustomerAdvanceApplication.create({
        id: newId(),
        shop_id: resolvedShopId,
        advance_id: adv.id,
        invoice_id: invoiceId,
        amount: take,
        amount_paise: toPaise(take),
        request_id: requestId && applications.length === 0 ? requestId : (requestId ? `${requestId}:${adv.id}` : null),
        meta: { applied_by: userId },
      }, { transaction });
      applications.push(app);
      remaining = toMoneyNumber(roundMoney(D(remaining - take)));
    }

    const applied = toMoneyNumber(roundMoney(D(need - remaining)));
    return { applied, applications, remaining_to_cover: remaining };
  };

  if (outerTx) return run(outerTx);
  return sequelize.transaction(run);
}

export async function listAdvances({ customerId, status, limit = 50 } = {}) {
  const where = {};
  if (customerId) where.customer_id = customerId;
  if (status) where.status = status;
  return CustomerAdvance.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: Math.min(Number(limit) || 50, 200),
  });
}

/**
 * Refund / revoke unused advance balance (cash returned to customer).
 * Partially applied advances refund only the remaining amount.
 */
export async function refundAdvance({
  advanceId,
  mode = null,
  reason = null,
  requestId = null,
  userId = null,
  transaction: outerTx = null,
} = {}) {
  if (!advanceId) throw new AdvanceError('advanceId required');

  const run = async (transaction) => {
    if (requestId) {
      const existingPay = await Payment.findOne({
        where: { request_id: `${requestId}:refund-payment` },
        transaction,
      });
      if (existingPay) {
        const adv = await CustomerAdvance.findByPk(advanceId, { transaction });
        if (adv) return adv;
      }
    }

    const advance = await CustomerAdvance.findByPk(advanceId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!advance) throw new AdvanceError('Advance not found', { status: 404, code: 'NOT_FOUND' });
    if (advance.status === 'refunded') return advance;
    if (!['open', 'applied'].includes(advance.status)) {
      throw new AdvanceError(`Cannot refund advance with status "${advance.status}"`, {
        code: 'INVALID_STATUS',
        status: 409,
      });
    }

    const remaining = toMoneyNumber(roundMoney(D(advance.remaining_amount || 0)));
    if (!(remaining > 0.001)) {
      // Fully applied to an invoice — nothing left to revoke
      await advance.update({
        status: advance.status === 'open' ? 'applied' : advance.status,
        meta: {
          ...(advance.meta || {}),
          refund_skipped: 'nothing_remaining',
          refund_reason: reason,
        },
      }, { transaction });
      return advance;
    }

    const refundMode = mode || advance.mode || 'cash';
    const shopId = advance.shop_id;
    const { date: businessDate } = await getActiveBillingDate({ shopId, transaction });

    await Payment.create({
      id: newId(),
      shop_id: shopId,
      invoice_id: null,
      customer_id: advance.customer_id,
      mode: refundMode,
      amount: -remaining,
      amount_paise: -toPaise(remaining),
      reference: reason || `Advance refund ${advance.id}`,
      received_by: userId,
      request_id: requestId ? `${requestId}:refund-payment` : null,
      status: 'posted',
      paid_at: stampOnTransactionDate(businessDate),
      business_date: businessDate,
      meta: { kind: 'customer_advance_refund', advance_id: advance.id },
    }, { transaction });

    const { postAdvanceRefundJournal } = await import('./ledgerService.js');
    await postAdvanceRefundJournal({
      shopId,
      advanceId: advance.id,
      amount: remaining,
      mode: refundMode,
      entryDate: businessDate,
      requestId: requestId ? `${requestId}:jrnl-refund` : null,
      userId,
      transaction,
    });

    await advance.update({
      remaining_amount: 0,
      status: 'refunded',
      meta: {
        ...(advance.meta || {}),
        refunded_at: new Date().toISOString(),
        refund_amount: remaining,
        refund_reason: reason,
        refunded_by: userId,
      },
    }, { transaction });

    await appendAuditEvent({
      eventType: 'ADVANCE_REFUNDED',
      action: 'advance.refund',
      entityType: 'customer_advance',
      entityId: advance.id,
      userId,
      newValue: { amount: remaining, mode: refundMode, reason },
      transaction,
    });

    return advance;
  };

  if (outerTx) return run(outerTx);
  return sequelize.transaction(run);
}
