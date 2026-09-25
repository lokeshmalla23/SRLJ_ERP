import { Op, fn, col } from 'sequelize';
import sequelize from '../db.js';
import { Purchase, Vendor, Product } from '../models/index.js';
import { newId, normalizeJsonFields, parseJsonField } from '../utils.js';
import { InventoryError } from '../services/inventoryService.js';
import { reversePurchaseStock, BillingError } from '../services/billingService.js';
import { getActiveBillingDate } from '../services/dailyClosingService.js';
import { stampOnTransactionDate } from '../utils/invoiceRead.js';

const purchaseJson = (row) => normalizeJsonFields(row?.toJSON ? row.toJSON() : row, {
  items: [],
  payments: [],
});

// ─── Valid enums ──────────────────────────────────────────────────────────────
const VALID_TYPES   = ['gold_bullion', 'finished_goods', 'stones', 'karigar_work', 'other'];
const VALID_STATUSES = ['draft', 'received', 'partially_paid', 'paid', 'voided'];

// ─── PO number generator ──────────────────────────────────────────────────────
const generatePoNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;

  // Find the highest sequence for this year
  const latest = await Purchase.findOne({
    where: { po_number: { [Op.like]: `${prefix}%` } },
    order: [['po_number', 'DESC']],
  });

  let seq = 1;
  if (latest) {
    const parts = latest.po_number.split('-');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(3, '0')}`;
};

// GET /api/purchases/summary
export const getPurchaseSummary = async (req, res, next) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const [totals, thisMonth] = await Promise.all([
      Purchase.findOne({
        attributes: [
          [fn('COALESCE', fn('SUM', col('grand_total')), 0),  'total_purchases'],
          [fn('COALESCE', fn('SUM', col('paid_amount')),  0), 'total_paid'],
          [fn('COALESCE', fn('SUM', col('balance')),      0), 'total_outstanding'],
        ],
        raw: true,
      }),
      Purchase.findOne({
        where: {
          purchase_date: { [Op.between]: [monthStart, monthEnd] },
        },
        attributes: [
          [fn('COALESCE', fn('SUM', col('grand_total')), 0), 'amount'],
        ],
        raw: true,
      }),
    ]);

    return res.json({
      total_purchases:   parseFloat(totals?.total_purchases   ?? 0),
      total_paid:        parseFloat(totals?.total_paid        ?? 0),
      total_outstanding: parseFloat(totals?.total_outstanding ?? 0),
      this_month:        parseFloat(thisMonth?.amount         ?? 0),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/purchases
export const listPurchases = async (req, res, next) => {
  try {
    const {
      vendor_id,
      status,
      from,
      to,
      from_date,
      to_date,
      purchase_type,
      limit  = 20,
      offset = 0,
    } = req.query;

    // Accept both `from`/`to` and `from_date`/`to_date` — the frontend Purchases
    // page and Reports tab both send the latter, which this endpoint previously
    // silently ignored (date filtering was a no-op for every caller).
    const rangeFrom = from || from_date;
    const rangeTo = to || to_date;

    const where = {};

    if (vendor_id)     where.vendor_id     = vendor_id;
    if (status)        where.status        = status;
    if (purchase_type) where.purchase_type = purchase_type;

    if (rangeFrom || rangeTo) {
      where.purchase_date = {};
      if (rangeFrom) where.purchase_date[Op.gte] = rangeFrom;
      if (rangeTo)   where.purchase_date[Op.lte] = rangeTo;
    }

    const { count, rows } = await Purchase.findAndCountAll({
      where,
      order:  [['created_at', 'DESC']],
      limit:  Math.min(parseInt(limit, 10)  || 20, 200),
      offset: parseInt(offset, 10) || 0,
    });

    return res.json({ total: count, data: rows.map((r) => purchaseJson(r)) });
  } catch (err) {
    next(err);
  }
};

// GET /api/purchases/:id
export const getPurchase = async (req, res, next) => {
  try {
    const purchase = await Purchase.findByPk(req.params.id);
    if (!purchase) return res.status(404).json({ detail: 'Purchase not found' });
    return res.json(purchaseJson(purchase));
  } catch (err) {
    next(err);
  }
};

// POST /api/purchases
export const createPurchase = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const body = req.body || {};
    const {
      vendor_id,
      vendor_name,
      purchase_type = 'finished_goods',
      items: rawItems = [],
      subtotal      = 0,
      gst_amount    = 0,
      grand_total,
      notes,
      status        = 'received',
    } = body;

    // Normalize UI ↔ API field names
    const gst_pct = body.gst_pct != null ? body.gst_pct : (body.gst_percent != null ? body.gst_percent : 0);
    let paid_amount = body.paid_amount;
    if (paid_amount == null && body.initial_payment) {
      paid_amount = typeof body.initial_payment === 'object'
        ? body.initial_payment.amount
        : body.initial_payment;
    }
    paid_amount = paid_amount || 0;
    if (!body.payment_mode && body.initial_payment?.payment_mode) {
      body.payment_mode = body.initial_payment.payment_mode;
    }

    const items = (rawItems || []).map((it) => ({
      ...it,
      quantity: it.quantity != null ? it.quantity : (it.qty != null ? it.qty : 1),
      weight_g: it.weight_g != null ? it.weight_g : it.gross_weight,
      unit_price: it.unit_price != null ? it.unit_price : it.rate_per_g,
    }));

    // ── Validation ────────────────────────────────────────────────────────────
    // The frontend already defaults this to the shop's active transaction date
    // (not the real calendar date), but any other caller shouldn't silently fall
    // back to the real date either — resolve it server-side the same way every
    // other transaction in the app does.
    let purchase_date = body.purchase_date;
    if (!purchase_date) {
      purchase_date = (await getActiveBillingDate({
        shopId: req.user?.shop_id || null,
        transaction: t,
      })).date;
    }
    if (!Array.isArray(items) || items.length === 0) {
      await t.rollback();
      return res.status(400).json({ detail: 'items array is required and must not be empty' });
    }
    if (grand_total === undefined || grand_total === null) {
      await t.rollback();
      return res.status(400).json({ detail: 'grand_total is required' });
    }
    if (!VALID_TYPES.includes(purchase_type)) {
      await t.rollback();
      return res.status(400).json({ detail: `purchase_type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    if (!VALID_STATUSES.includes(status)) {
      await t.rollback();
      return res.status(400).json({ detail: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    // ── Vendor lookup / name resolution ───────────────────────────────────────
    let resolvedVendorName = vendor_name || null;
    if (vendor_id) {
      const vendor = await Vendor.findByPk(vendor_id, { transaction: t });
      if (!vendor) {
        await t.rollback();
        return res.status(400).json({ detail: `Vendor ${vendor_id} not found` });
      }
      resolvedVendorName = resolvedVendorName || vendor.name;
    }

    const shopId = req.user?.shop_id || null;
    const purchaseId = newId();
    // Purchases are a vendor/payment record only — qty and weight on each line
    // are reference text for what was bought, not a stock feed. Actual stock
    // (barcodes, weight, stock_qty) is added separately, one piece at a time,
    // via Catalog / Barcode Manager — never derived from a purchase line.
    const resolvedItems = [...items];

    // ── Compute balance & determine payment status ────────────────────────────
    const paidAmt = parseFloat(paid_amount) || 0;
    const total   = parseFloat(grand_total);
    const balance = Math.max(0, total - paidAmt);

    let computedStatus = status;
    if (paidAmt >= total)     computedStatus = 'paid';
    else if (paidAmt > 0)     computedStatus = 'partially_paid';
    else if (status === 'paid') computedStatus = 'received'; // guard: can't be paid with 0 paid

    // ── Build initial payments array ──────────────────────────────────────────
    const payments = [];
    if (paidAmt > 0) {
      payments.push({
        id:        newId(),
        mode:      req.body.payment_mode || 'cash',
        amount:    paidAmt,
        reference: req.body.payment_reference || null,
        date:      purchase_date,
        paid_at:   stampOnTransactionDate(purchase_date),
        note:      'Initial payment on purchase creation',
      });
    }

    // ── Generate PO number ────────────────────────────────────────────────────
    const po_number = await generatePoNumber();

    const gstAmt = parseFloat(gst_amount) || 0;
    const taxType = String(req.body.tax_type || 'intra').toLowerCase() === 'inter' ? 'inter' : 'intra';
    let cgstAmt = parseFloat(req.body.cgst_amount);
    let sgstAmt = parseFloat(req.body.sgst_amount);
    let igstAmt = parseFloat(req.body.igst_amount);
    if (taxType === 'inter') {
      igstAmt = Number.isFinite(igstAmt) && igstAmt > 0 ? igstAmt : gstAmt;
      cgstAmt = 0;
      sgstAmt = 0;
    } else {
      if (!(Number.isFinite(cgstAmt) && cgstAmt >= 0)) cgstAmt = Math.round((gstAmt / 2) * 100) / 100;
      if (!(Number.isFinite(sgstAmt) && sgstAmt >= 0)) sgstAmt = Math.round((gstAmt - cgstAmt) * 100) / 100;
      igstAmt = 0;
    }

    // ── Create the purchase ───────────────────────────────────────────────────
    const purchase = await Purchase.create({
      id: purchaseId,
      shop_id: shopId,
      po_number,
      vendor_id:     vendor_id || null,
      vendor_name:   resolvedVendorName,
      purchase_date,
      purchase_type,
      items: resolvedItems,
      subtotal:      parseFloat(subtotal)   || 0,
      gst_pct:       parseFloat(gst_pct)    || 0,
      gst_amount:    gstAmt,
      cgst_amount:   cgstAmt,
      sgst_amount:   sgstAmt,
      igst_amount:   igstAmt,
      tax_type:      taxType,
      grand_total:   total,
      paid_amount:   paidAmt,
      balance,
      payments,
      status:        computedStatus,
      notes:         notes || null,
      created_by:    req.user?.id || null,
    }, { transaction: t });

    // ── Update vendor financials ───────────────────────────────────────────────
    if (vendor_id) {
      const vendor = await Vendor.findByPk(vendor_id, { transaction: t });
      if (vendor) {
        await vendor.update({
          total_purchases:    (vendor.total_purchases    || 0) + total,
          outstanding_balance:(vendor.outstanding_balance|| 0) + balance,
        }, { transaction: t });
      }
    }

    if (status !== 'draft' && total > 0) {
      const { postPurchaseJournal } = await import('../services/ledgerService.js');
      const invAmt = parseFloat(subtotal) || Math.max(0, total - (parseFloat(gst_amount) || 0));
      const gstAmt = parseFloat(gst_amount) || 0;
      const firstPay = Array.isArray(payments) && payments[0] ? payments[0] : null;
      await postPurchaseJournal({
        shopId,
        purchaseId,
        inventoryAmount: invAmt,
        gstAmount: gstAmt,
        paidAmount: paidAmt,
        paymentMode: firstPay?.mode || 'cash',
        entryDate: purchase_date || new Date().toISOString().slice(0, 10),
        requestId: `purchase-jrnl:${purchaseId}`,
        userId: req.user?.id || null,
        transaction: t,
      });
    }

    await t.commit();
    return res.status(201).json(purchase.toJSON());
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// PUT /api/purchases/:id
export const updatePurchase = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const purchase = await Purchase.findByPk(req.params.id, { transaction: t });
    if (!purchase) {
      await t.rollback();
      return res.status(404).json({ detail: 'Purchase not found' });
    }
    if (purchase.status === 'paid') {
      await t.rollback();
      return res.status(400).json({ detail: 'Cannot edit a fully paid purchase' });
    }

    const {
      vendor_id,
      vendor_name,
      purchase_date,
      purchase_type,
      items,
      subtotal,
      gst_pct,
      gst_amount,
      grand_total,
      notes,
      status,
    } = req.body;

    // Validate purchase_type if provided
    if (purchase_type && !VALID_TYPES.includes(purchase_type)) {
      await t.rollback();
      return res.status(400).json({ detail: `purchase_type must be one of: ${VALID_TYPES.join(', ')}` });
    }

    // If vendor is changing, revert old vendor balance and apply new one
    const oldGrandTotal = parseFloat(purchase.grand_total) || 0;
    const oldBalance    = parseFloat(purchase.balance)     || 0;
    const newGrandTotal = grand_total !== undefined ? parseFloat(grand_total) : oldGrandTotal;
    const newBalance    = newGrandTotal - (parseFloat(purchase.paid_amount) || 0);

    // Resolve vendor name
    let resolvedVendorName = vendor_name !== undefined ? vendor_name : purchase.vendor_name;
    const newVendorId      = vendor_id  !== undefined ? vendor_id   : purchase.vendor_id;

    if (vendor_id !== undefined && vendor_id !== purchase.vendor_id) {
      // Revert old vendor
      if (purchase.vendor_id) {
        const oldVendor = await Vendor.findByPk(purchase.vendor_id, { transaction: t });
        if (oldVendor) {
          await oldVendor.update({
            total_purchases:    Math.max(0, (oldVendor.total_purchases    || 0) - oldGrandTotal),
            outstanding_balance:Math.max(0, (oldVendor.outstanding_balance|| 0) - oldBalance),
          }, { transaction: t });
        }
      }
      // Apply to new vendor
      if (vendor_id) {
        const newVendor = await Vendor.findByPk(vendor_id, { transaction: t });
        if (!newVendor) {
          await t.rollback();
          return res.status(400).json({ detail: `Vendor ${vendor_id} not found` });
        }
        resolvedVendorName = resolvedVendorName || newVendor.name;
        await newVendor.update({
          total_purchases:    (newVendor.total_purchases    || 0) + newGrandTotal,
          outstanding_balance:(newVendor.outstanding_balance|| 0) + Math.max(0, newBalance),
        }, { transaction: t });
      }
    } else if (grand_total !== undefined && newVendorId) {
      // Same vendor but grand_total changed — adjust the difference
      const vendor = await Vendor.findByPk(newVendorId, { transaction: t });
      if (vendor) {
        const totalDiff   = newGrandTotal - oldGrandTotal;
        const balanceDiff = Math.max(0, newBalance) - oldBalance;
        await vendor.update({
          total_purchases:    (vendor.total_purchases    || 0) + totalDiff,
          outstanding_balance:Math.max(0, (vendor.outstanding_balance|| 0) + balanceDiff),
        }, { transaction: t });
      }
    }

    // Update fields
    const updatedFields = {};
    if (vendor_id    !== undefined) updatedFields.vendor_id     = newVendorId;
    if (resolvedVendorName !== purchase.vendor_name) updatedFields.vendor_name = resolvedVendorName;
    if (purchase_date !== undefined) updatedFields.purchase_date  = purchase_date;
    if (purchase_type !== undefined) updatedFields.purchase_type  = purchase_type;
    if (items         !== undefined) updatedFields.items          = items;
    if (subtotal      !== undefined) updatedFields.subtotal       = parseFloat(subtotal)   || 0;
    if (gst_pct       !== undefined) updatedFields.gst_pct        = parseFloat(gst_pct)    || 0;
    if (gst_amount    !== undefined) updatedFields.gst_amount     = parseFloat(gst_amount) || 0;
    if (grand_total   !== undefined) {
      updatedFields.grand_total = newGrandTotal;
      updatedFields.balance     = Math.max(0, newBalance);
      // Recalculate status
      const paidAmt = parseFloat(purchase.paid_amount) || 0;
      if (paidAmt >= newGrandTotal)      updatedFields.status = 'paid';
      else if (paidAmt > 0)              updatedFields.status = 'partially_paid';
      else                               updatedFields.status = purchase.status === 'paid' ? 'received' : purchase.status;
    }
    if (notes   !== undefined) updatedFields.notes  = notes;
    if (status  !== undefined && !updatedFields.status) {
      if (!VALID_STATUSES.includes(status)) {
        await t.rollback();
        return res.status(400).json({ detail: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      updatedFields.status = status;
    }

    await purchase.update(updatedFields, { transaction: t });
    await t.commit();
    return res.json(purchase.toJSON());
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// POST /api/purchases/:id/payment
export const addPurchasePayment = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const purchase = await Purchase.findByPk(req.params.id, { transaction: t });
    if (!purchase) {
      await t.rollback();
      return res.status(404).json({ detail: 'Purchase not found' });
    }
    if (purchase.status === 'paid') {
      await t.rollback();
      return res.status(400).json({ detail: 'Purchase is already fully paid' });
    }

    // The frontend's Add Payment form sends `payment_mode`/`payment_date`
    // (see frontend/src/pages/Purchases.jsx) — `mode`/`date` are accepted too
    // for any other caller, but payment_mode/payment_date take precedence
    // since that's what actually arrives on the wire from the real form.
    // Without this, the mode the cashier picked was silently discarded
    // (always posted as 'cash' regardless of what was selected) and the
    // transaction date they picked was replaced with today's real date.
    const { mode, payment_mode, amount, reference, date, payment_date, notes } = req.body;
    const resolvedMode = payment_mode || mode || 'cash';
    // Fall back to the shop's active transaction date, never the real calendar
    // date — same rule as every other transaction in the app.
    const resolvedDate = payment_date || date || (await getActiveBillingDate({
      shopId: purchase.shop_id || req.user?.shop_id || null,
      transaction: t,
    })).date;

    if (!amount || parseFloat(amount) <= 0) {
      await t.rollback();
      return res.status(400).json({ detail: 'amount must be a positive number' });
    }

    const paymentAmount = parseFloat(amount);
    const currentBalance = parseFloat(purchase.balance) || 0;

    if (paymentAmount > currentBalance) {
      await t.rollback();
      return res.status(400).json({
        detail: `Payment amount (${paymentAmount}) exceeds outstanding balance (${currentBalance})`,
      });
    }

    const newPayment = {
      id:        newId(),
      mode:      resolvedMode,
      amount:    paymentAmount,
      reference: reference || null,
      notes:     notes || null,
      date:      resolvedDate,
      paid_at:   stampOnTransactionDate(resolvedDate),
    };

    const updatedPayments   = [...parseJsonField(purchase.payments, []), newPayment];
    const newPaidAmount     = (parseFloat(purchase.paid_amount) || 0) + paymentAmount;
    const newBalance        = Math.max(0, (parseFloat(purchase.grand_total) || 0) - newPaidAmount);
    const newStatus         = newBalance === 0 ? 'paid' : 'partially_paid';

    await purchase.update({
      payments:    updatedPayments,
      paid_amount: newPaidAmount,
      balance:     newBalance,
      status:      newStatus,
    }, { transaction: t });

    const { postPurchasePaymentJournal } = await import('../services/ledgerService.js');
    await postPurchasePaymentJournal({
      shopId: purchase.shop_id,
      purchaseId: purchase.id,
      amount: paymentAmount,
      mode: resolvedMode,
      entryDate: newPayment.date,
      requestId: `purchase-pay:${purchase.id}:${newPayment.id}`,
      userId: req.user?.id || null,
      transaction: t,
    });

    // Update vendor outstanding_balance
    if (purchase.vendor_id) {
      const vendor = await Vendor.findByPk(purchase.vendor_id, { transaction: t });
      if (vendor) {
        await vendor.update({
          outstanding_balance: Math.max(0, (vendor.outstanding_balance || 0) - paymentAmount),
        }, { transaction: t });
      }
    }

    await t.commit();
    return res.json(purchase.toJSON());
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// DELETE /api/purchases/:id
export const deletePurchase = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const purchase = await Purchase.findByPk(req.params.id, { transaction: t });
    if (!purchase) {
      await t.rollback();
      return res.status(404).json({ detail: 'Purchase not found' });
    }
    if (purchase.status !== 'draft') {
      await t.rollback();
      return res.status(400).json({ detail: 'Only draft purchases can be deleted' });
    }
    // Purchase.items is JSONB, which Sequelize returns as a raw string on a
    // fresh SQLite read rather than a parsed array — Array.isArray on that
    // string is always false, which used to silently skip the whole
    // reversal below (API reported success, stock was never restored).
    const currentItems = parseJsonField(purchase.items, []);

    // Reverse finished_goods stock with compensating movements (even for draft)
    if (purchase.purchase_type === 'finished_goods' && currentItems.length) {
      const firstPid = currentItems.find((i) => i.product_id)?.product_id;
      const product = firstPid
        ? await Product.findByPk(firstPid, { transaction: t })
        : null;
      const shopId = purchase.shop_id || product?.shop_id;
      if (shopId) {
        try {
          await reversePurchaseStock({
            shopId,
            purchaseId: purchase.id,
            items: currentItems,
            createdBy: req.user?.id || null,
            transaction: t,
          });
        } catch (err) {
          await t.rollback();
          if (err instanceof BillingError || err instanceof InventoryError) {
            return res.status(err.status || 400).json({ detail: err.message, code: err.code });
          }
          throw err;
        }
      }
    }

    // Revert vendor financials if any paid amount was recorded on a draft
    if (purchase.vendor_id) {
      const vendor = await Vendor.findByPk(purchase.vendor_id, { transaction: t });
      if (vendor) {
        const grandTotal = parseFloat(purchase.grand_total) || 0;
        const balance    = parseFloat(purchase.balance)     || 0;
        await vendor.update({
          total_purchases:    Math.max(0, (vendor.total_purchases    || 0) - grandTotal),
          outstanding_balance:Math.max(0, (vendor.outstanding_balance|| 0) - balance),
        }, { transaction: t });
      }
    }

    // Soft-cancel: mark voided instead of hard-delete
    await purchase.update({
      status: 'voided',
      notes: (purchase.notes ? purchase.notes + '\n' : '') + `[VOIDED] Draft cancelled by ${req.user?.id || 'system'} at ${new Date().toISOString()}`,
    }, { transaction: t });
    await t.commit();
    return res.json({ detail: 'Purchase voided', id: purchase.id, stock_reversed: true });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};
