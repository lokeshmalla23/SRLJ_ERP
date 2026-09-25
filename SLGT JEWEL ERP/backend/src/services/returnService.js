/**
 * Partial invoice returns → credit notes + stock restore for selected lines.
 */
import sequelize, { withLock } from '../db.js';
import { Invoice, CreditNote, Product, InventoryMovement } from '../models/index.js';
import { newId } from '../utils.js';
import { applyReturnLine, atomicUpdate, InventoryError } from './inventoryService.js';
import { toWeightNumber } from '../utils/weight.js';
import { BillingError, normalizeRefundBreakdown } from './billingService.js';
import { getActiveBillingDate } from './dailyClosingService.js';
import { stampOnTransactionDate, dateOnlyStamp } from '../utils/invoiceRead.js';
import { toPaise, roundMoney, D, toMoneyNumber, sumMoney } from '../utils/money.js';
import branchConfig from '../config/branchConfig.js';

async function nextCreditNoteNo(shopId, transaction) {
  const year = new Date().getFullYear();
  const prefix = `CN-${year}-`;
  const latest = await CreditNote.findOne({
    where: { shop_id: shopId },
    order: [['created_at', 'DESC']],
    transaction,
  });
  let seq = 1;
  if (latest?.credit_note_no?.startsWith(prefix)) {
    const n = parseInt(latest.credit_note_no.slice(prefix.length), 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/**
 * @param {string} invoiceId
 * @param {{ lines: Array<{ product_id: string, quantity?: number }>, reason?: string, request_id?: string, user?: object }} opts
 */
export async function createPartialReturn(invoiceId, {
  lines = [],
  reason = null,
  request_id = null,
  user = null,
  refund = [],
} = {}) {
  if (!Array.isArray(lines) || !lines.length) {
    throw new BillingError('lines required for partial return', { code: 'EMPTY_RETURN' });
  }

  return sequelize.transaction(async (transaction) => {
    if (request_id) {
      const existing = await CreditNote.findOne({ where: { request_id }, transaction });
      if (existing) return { credit_note: existing, idempotent: true };
    }

    const invoice = await Invoice.findByPk(invoiceId, withLock({}, transaction));
    if (!invoice) throw new BillingError('Invoice not found', { status: 404, code: 'NOT_FOUND' });
    if (invoice.status === 'cancelled' || invoice.cancelled_at) {
      throw new BillingError('Cannot return against cancelled invoice', { code: 'ALREADY_CANCELLED', status: 409 });
    }

    const invItems = Array.isArray(invoice.items) ? invoice.items : [];
    const shopId = invoice.shop_id;
    const returned = [];

    for (const line of lines) {
      const invLine = invItems.find((i) => i.product_id === line.product_id);
      if (!invLine) {
        throw new BillingError(`Product ${line.product_id} not on invoice`, { code: 'INVALID_LINE' });
      }
      const maxQty = parseFloat(invLine.quantity) || 1;
      const qty = Math.min(maxQty, Math.max(0, parseFloat(line.quantity) || maxQty));
      if (!(qty > 0)) continue;

      // For unique_tag items, verify the item has not been re-sold since this invoice.
      // The most recent SALE movement must reference THIS invoice.
      const product = await Product.findByPk(line.product_id, { transaction });
      if (product?.inventory_mode === 'unique_tag') {
        const lastSale = await InventoryMovement.findOne({
          where: { product_id: line.product_id, movement_type: 'sale' },
          order: [['created_at', 'DESC']],
          transaction,
        });
        if (lastSale && lastSale.reference_id !== invoiceId) {
          throw new BillingError(
            `Item "${product.name}" (barcode: ${product.barcode || 'N/A'}) has been re-sold since invoice ${invoice.invoice_no}. Return is not permitted.`,
            { code: 'ITEM_RESOLD', status: 409 },
          );
        }
      }

      try {
        await applyReturnLine({
          shopId,
          productId: line.product_id,
          quantity: qty,
          referenceType: 'credit_note',
          referenceId: invoice.id,
          createdBy: user?.id || null,
          transaction,
        });
      } catch (err) {
        if (err instanceof InventoryError) {
          throw new BillingError(err.message, { status: err.status || 400, code: err.code });
        }
        throw err;
      }

      // Tray line: put the returned weight back on the tray (mirrors
      // cancelInvoice), pro-rated by pieces if only part of the line returns.
      const soldTrayWeight = toWeightNumber(invLine.tray_weight_sold);
      const trayWeightReturned = soldTrayWeight > 0
        ? toWeightNumber(soldTrayWeight * (qty / maxQty))
        : 0;
      if (trayWeightReturned > 0) {
        await atomicUpdate(
          `UPDATE products
           SET tray_total_weight = ROUND(ROUND(COALESCE(tray_total_weight, 0), 3) + :weight, 3),
               gross_weight = ROUND(ROUND(COALESCE(tray_total_weight, 0), 3) + :weight, 3),
               net_weight = ROUND(ROUND(COALESCE(tray_total_weight, 0), 3) + :weight, 3),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = :id AND shop_id = :shopId`,
          { id: line.product_id, weight: trayWeightReturned, shopId },
          transaction,
        );
      }

      const unit = Number(invLine.line_total || invLine.unit_price || 0) / (parseFloat(invLine.quantity) || 1);
      const lineTotal = toMoneyNumber(roundMoney(D(unit).times(qty)));
      returned.push({
        product_id: line.product_id,
        product_name: invLine.product_name || invLine.name,
        quantity: qty,
        line_total: lineTotal,
        hsn_code: invLine.hsn_code || null,
        ...(trayWeightReturned > 0 ? { tray_weight_sold: trayWeightReturned } : {}),
      });
    }

    if (!returned.length) {
      throw new BillingError('No returnable lines', { code: 'EMPTY_RETURN' });
    }

    const subtotal = toMoneyNumber(sumMoney(returned.map((r) => r.line_total)));
    const gstPct = Number(invoice.gst_pct);
    if (!Number.isFinite(gstPct)) {
      throw new BillingError('Invoice missing gst_pct snapshot', { code: 'MISSING_TAX_SNAPSHOT' });
    }
    const gstAmount = toMoneyNumber(roundMoney(D(subtotal).times(gstPct).div(100 + gstPct)));
    // Approximate: treat line_total as tax-inclusive jewellery practice; net = subtotal - gst
    const taxable = toMoneyNumber(roundMoney(D(subtotal).minus(gstAmount)));
    const grand = subtotal;

    // If the invoice still has a balance due, the return just reduces what the
    // customer owes (AR credit) — no cash physically changes hands, so no
    // refund breakdown is required. Only a fully-paid invoice needs one.
    const settleToAr = Number(invoice.balance_due) > 0.001;
    const refundableAmount = settleToAr ? 0 : grand;
    const refundEntries = normalizeRefundBreakdown(refund, refundableAmount);

    const { date: businessDate } = await getActiveBillingDate({ shopId, transaction });
    const creditNote = await CreditNote.create({
      id: newId(),
      shop_id: shopId,
      credit_note_no: await nextCreditNoteNo(shopId, transaction),
      invoice_id: invoice.id,
      customer_id: invoice.customer_id,
      items: returned,
      subtotal: taxable,
      gst_amount: gstAmount,
      grand_total: grand,
      amount_paise: toPaise(grand),
      reason: reason || 'Partial return',
      status: 'posted',
      request_id: request_id || null,
      created_by: user?.id || null,
      business_date: businessDate,
    }, { transaction });

    // Mark invoice partially_returned if not all lines returned
    const allReturned = invItems.every((invLine) => {
      const r = returned.find((x) => x.product_id === invLine.product_id);
      return r && (parseFloat(r.quantity) || 0) >= (parseFloat(invLine.quantity) || 1);
    });
    // returned_at stores only the Transaction date — no time-of-day — same
    // reasoning as cancelled_at in billingService.js's cancelInvoice().
    if (allReturned) {
      await invoice.update({
        status: 'returned',
        returned_at: dateOnlyStamp(businessDate),
        cancel_reason: reason || 'Fully returned via credit note',
      }, { transaction });
    } else {
      await invoice.update({
        status: 'partially_returned',
        returned_at: dateOnlyStamp(businessDate),
      }, { transaction });
    }

    const { postCreditNoteJournal, postCogsReverseJournal } = await import('./ledgerService.js');
    const entryDate = businessDate;
    if (settleToAr || !refundEntries.length) {
      await postCreditNoteJournal({
        shopId,
        creditNoteId: creditNote.id,
        taxableAmount: taxable,
        gstAmount: gstAmount,
        mode: 'cash',
        settleToAr,
        entryDate,
        requestId: request_id ? `${request_id}:jrnl` : `cn-jrnl:${creditNote.id}`,
        userId: user?.id || null,
        transaction,
      });
    } else {
      // Split the journal proportionally across however the refund was
      // actually paid out (cash / UPI / card / bank / cheque).
      for (const r of refundEntries) {
        const share = r.amount / grand;
        await postCreditNoteJournal({
          shopId,
          creditNoteId: creditNote.id,
          taxableAmount: toMoneyNumber(taxable * share),
          gstAmount: toMoneyNumber(gstAmount * share),
          mode: r.mode,
          settleToAr: false,
          entryDate,
          requestId: request_id ? `${request_id}:jrnl:${r.mode}` : `cn-jrnl:${creditNote.id}:${r.mode}`,
          userId: user?.id || null,
          transaction,
        });
      }
    }

    // Record the refund as first-class Payment rows (negative amount) so it
    // flows into Daily Closing's cash/UPI/etc. totals, the ERP Statement, and
    // the customer's party ledger exactly like a normal payment would.
    const { Payment } = await import('../models/index.js');
    for (const r of refundEntries) {
      await Payment.create({
        id: newId(),
        shop_id: shopId,
        invoice_id: invoice.id,
        customer_id: invoice.customer_id,
        mode: r.mode,
        amount: -r.amount,
        status: 'posted',
        paid_at: stampOnTransactionDate(businessDate),
        business_date: businessDate,
        meta: { kind: 'invoice_return_refund', invoice_no: invoice.invoice_no, credit_note_no: creditNote.credit_note_no },
      }, { transaction });
    }

    if (invoice.customer_id) {
      const { Customer } = await import('../models/index.js');
      const customer = await Customer.findByPk(invoice.customer_id, { transaction });
      if (customer) {
        await customer.update({
          total_purchases: toMoneyNumber(Math.max(0, Number(customer.total_purchases || 0) - grand)),
        }, { transaction });
      }
    }

    // Reverse COGS for returned lines
    const { resolveUnitCogs } = await import('./ledgerService.js');
    let cogsBack = 0;
    for (const r of returned) {
      if (!r.product_id) continue;
      const prod = await Product.findByPk(r.product_id, { transaction });
      const resolved = resolveUnitCogs(prod, r);
      cogsBack += resolved.total;
    }
    if (cogsBack > 0) {
      await postCogsReverseJournal({
        shopId,
        sourceId: creditNote.id,
        cogsAmount: toMoneyNumber(cogsBack),
        entryDate: businessDate,
        requestId: request_id ? `${request_id}:cogs` : `cn-cogs:${creditNote.id}`,
        userId: user?.id || null,
        transaction,
      });
    }

    return { credit_note: creditNote, invoice };
  });
}
