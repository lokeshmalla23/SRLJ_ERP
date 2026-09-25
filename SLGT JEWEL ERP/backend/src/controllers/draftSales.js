import { DraftSale } from '../models/index.js';
import { Setting } from '../models/index.js';
import { createInvoice as billingCreateInvoice, BillingError } from '../services/billingService.js';
import { newId } from '../utils.js';

function parsedItems(draft) {
  try {
    return JSON.parse(draft.items);
  } catch {
    return [];
  }
}

function draftJson(row) {
  const plain = row?.toJSON ? row.toJSON() : row;
  return { ...plain, items: parsedItems(plain) };
}

async function loadPricingMode(shopId) {
  try {
    const setting = await Setting.findOne({ where: { key: 'offline' } });
    let value = setting?.value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { value = {}; }
    }
    return (value && value.pricing_mode) ? value.pricing_mode : 'preserve';
  } catch {
    return 'preserve';
  }
}

async function loadCurrentGoldRate() {
  try {
    const setting = await Setting.findOne({ where: { key: 'gold_rate' } });
    let value = setting?.value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { value = {}; }
    }
    return value?.gold_24k ?? null;
  } catch {
    return null;
  }
}

export const createDraft = async (req, res, next) => {
  try {
    const {
      cashier_id = null,
      customer_id = null,
      items = [],
      subtotal = 0,
      discount_amount = 0,
      total = 0,
      quoted_gold_rate = null,
      notes = null,
      pricing_mode,
    } = req.body;

    const resolvedPricingMode = pricing_mode || (await loadPricingMode());

    const draft = await DraftSale.create({
      id: newId(),
      cashier_id,
      customer_id,
      items: JSON.stringify(items),
      subtotal,
      discount_amount,
      total,
      quoted_gold_rate,
      notes,
      pricing_mode: resolvedPricingMode,
      status: 'pending',
      shop_id: req.user?.shop_id || null,
    });

    return res.status(201).json(draftJson(draft));
  } catch (err) {
    next(err);
  }
};

export const listDrafts = async (req, res, next) => {
  try {
    const drafts = await DraftSale.findAll({
      where: {
        status: ['pending', 'conflict'],
        ...(req.user?.shop_id ? { shop_id: req.user.shop_id } : {}),
      },
      order: [['created_at', 'DESC']],
    });
    return res.json(drafts.map(draftJson));
  } catch (err) {
    next(err);
  }
};

export const getDraft = async (req, res, next) => {
  try {
    const draft = await DraftSale.findByPk(req.params.id);
    if (!draft) return res.status(404).json({ detail: 'Draft sale not found' });
    return res.json(draftJson(draft));
  } catch (err) {
    next(err);
  }
};

export const promoteDraft = async (req, res, next) => {
  try {
    const draft = await DraftSale.findByPk(req.params.id);
    if (!draft) return res.status(404).json({ detail: 'Draft sale not found' });
    if (draft.status === 'promoted') {
      return res.status(409).json({ detail: 'Draft already promoted', promoted_invoice_id: draft.promoted_invoice_id });
    }
    if (draft.status === 'cancelled') {
      return res.status(409).json({ detail: 'Draft has been cancelled' });
    }

    const items = parsedItems(draft);
    const pricingMode = draft.pricing_mode || (await loadPricingMode());

    let goldRate = draft.quoted_gold_rate;
    if (pricingMode === 'recalculate') {
      goldRate = await loadCurrentGoldRate();
    }

    const invoicePayload = {
      customer_id: draft.customer_id || null,
      customer_name: 'Walk-in Customer',
      items,
      discount: Number(draft.discount_amount) || 0,
      discount_type: 'flat',
      ...(goldRate != null ? { gold_rate: goldRate } : {}),
      payments: req.body?.payments || [],
    };

    let result;
    try {
      result = await billingCreateInvoice(invoicePayload, { user: req.user });
    } catch (err) {
      if (err instanceof BillingError && (
        err.code === 'INSUFFICIENT_STOCK' ||
        err.code === 'ITEM_ALREADY_SOLD' ||
        err.code === 'ITEM_RESERVED' ||
        err.code === 'INVALID_PRODUCT'
      )) {
        await draft.update({
          status: 'conflict',
          conflict_reason: err.message,
        });
        return res.status(409).json({
          detail: err.message,
          code: err.code,
          conflict_reason: err.message,
          draft: draftJson(draft),
        });
      }
      throw err;
    }

    await draft.update({
      status: 'promoted',
      promoted_invoice_id: result.invoice.id,
      conflict_reason: null,
    });

    return res.json({
      draft: draftJson(draft),
      invoice: result.invoice.toJSON ? result.invoice.toJSON() : result.invoice,
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

export const cancelDraft = async (req, res, next) => {
  try {
    const draft = await DraftSale.findByPk(req.params.id);
    if (!draft) return res.status(404).json({ detail: 'Draft sale not found' });
    if (draft.status === 'promoted') {
      return res.status(409).json({ detail: 'Cannot cancel a promoted draft' });
    }
    await draft.update({ status: 'cancelled' });
    return res.json(draftJson(draft));
  } catch (err) {
    next(err);
  }
};

export const resolveConflict = async (req, res, next) => {
  try {
    const draft = await DraftSale.findByPk(req.params.id);
    if (!draft) return res.status(404).json({ detail: 'Draft sale not found' });
    if (draft.status !== 'conflict') {
      return res.status(409).json({ detail: 'Draft is not in conflict status' });
    }

    const { items, discount_amount, pricing_mode } = req.body;

    await draft.update({
      status: 'pending',
      conflict_reason: null,
      ...(items !== undefined ? { items: JSON.stringify(items) } : {}),
      ...(discount_amount !== undefined ? { discount_amount } : {}),
      ...(pricing_mode !== undefined ? { pricing_mode } : {}),
    });

    return res.json(draftJson(draft));
  } catch (err) {
    next(err);
  }
};
