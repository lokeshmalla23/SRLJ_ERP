/**
 * Pure metal coin / bulk-pure inventory helpers.
 *
 * coin  → weight_g = grams per piece, stock_qty = piece count, threshold = pieces
 * pure  → weight_g = 0 (identity sentinel), stock_qty = grams on hand, threshold = grams
 */
import { Op } from 'sequelize';
import { PureProduct, Notification } from '../models/index.js';
import { newId, nowIso } from '../utils.js';

export class PureProductError extends Error {
  constructor(message, { status = 400, code = 'PURE_PRODUCT' } = {}) {
    super(message);
    this.name = 'PureProductError';
    this.status = status;
    this.code = code;
  }
}

const METALS = new Set(['gold', 'silver']);
/** biscuit kept as legacy alias → normalized to pure */
const FORMS = new Set(['coin', 'pure', 'biscuit']);

export const PURE_WEIGHT_SENTINEL = 0;

export function isBulkPureForm(formType) {
  const f = String(formType || '').toLowerCase();
  return f === 'pure' || f === 'biscuit';
}

export function normalizeFormType(formType) {
  const f = String(formType || '').trim().toLowerCase();
  if (f === 'biscuit') return 'pure';
  return f;
}

export function formatWeightLabel(weightG) {
  const n = Number(weightG);
  if (!Number.isFinite(n) || n < 0) return '';
  const rounded = Math.round(n * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function buildPureProductName(metal, formType, weightG) {
  const metalLabel = String(metal).toLowerCase() === 'silver' ? 'Silver' : 'Gold';
  if (isBulkPureForm(formType)) {
    return `Pure ${metalLabel}`;
  }
  const wt = formatWeightLabel(weightG);
  return `${wt} g ${metalLabel} Coin`;
}

export function normalizePureProductInput(body = {}) {
  const metal = String(body.metal || '').trim().toLowerCase();
  let formType = normalizeFormType(body.form_type || body.formType);
  const threshold = body.low_stock_threshold != null && body.low_stock_threshold !== ''
    ? Number(body.low_stock_threshold)
    : (body.threshold != null && body.threshold !== '' ? Number(body.threshold) : 0);

  if (!METALS.has(metal)) {
    throw new PureProductError('Metal must be gold or silver', { code: 'INVALID_METAL' });
  }
  if (!FORMS.has(formType) && formType !== 'pure') {
    throw new PureProductError('Type must be coin or pure', { code: 'INVALID_FORM' });
  }
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new PureProductError('Threshold cannot be negative', { code: 'INVALID_THRESHOLD' });
  }

  if (isBulkPureForm(formType)) {
    // Dialog "Weight" = stock on hand in grams → stock_qty
    const stockGrams = Number(
      body.stock_qty != null && body.stock_qty !== ''
        ? body.stock_qty
        : (body.weight_g ?? body.weight ?? body.qty),
    );
    if (!Number.isFinite(stockGrams) || stockGrams < 0) {
      throw new PureProductError('Weight (stock grams) must be zero or positive', { code: 'INVALID_WEIGHT' });
    }
    const name = String(body.name || '').trim() || buildPureProductName(metal, 'pure', stockGrams);
    return {
      metal,
      form_type: 'pure',
      weight_g: PURE_WEIGHT_SENTINEL,
      name,
      stock_qty: Math.round(stockGrams * 1000) / 1000,
      low_stock_threshold: Math.round(threshold * 1000) / 1000,
      notes: body.notes != null ? String(body.notes) : null,
      status: body.status === 'inactive' ? 'inactive' : 'active',
    };
  }

  // Coin
  const weightG = Number(body.weight_g ?? body.weight);
  const stockQty = body.stock_qty != null && body.stock_qty !== ''
    ? Number(body.stock_qty)
    : (body.qty != null && body.qty !== '' ? Number(body.qty) : null);

  if (!Number.isFinite(weightG) || weightG <= 0) {
    throw new PureProductError('Weight must be a positive number (grams per coin)', { code: 'INVALID_WEIGHT' });
  }
  if (stockQty != null && (!Number.isFinite(stockQty) || stockQty < 0)) {
    throw new PureProductError('Quantity cannot be negative', { code: 'INVALID_QTY' });
  }

  const name = String(body.name || '').trim() || buildPureProductName(metal, 'coin', weightG);
  return {
    metal,
    form_type: 'coin',
    weight_g: Math.round(weightG * 1000) / 1000,
    name,
    stock_qty: stockQty == null ? 0 : stockQty,
    low_stock_threshold: threshold,
    notes: body.notes != null ? String(body.notes) : null,
    status: body.status === 'inactive' ? 'inactive' : 'active',
  };
}

export async function listPureProducts({
  shopId,
  metal = null,
  sellableOnly = false,
  includeDeleted = false,
  transaction,
} = {}) {
  const where = {};
  if (shopId) where.shop_id = shopId;
  if (!includeDeleted) where.deleted_at = null;
  if (metal) where.metal = String(metal).toLowerCase();
  if (sellableOnly) {
    where.status = 'active';
    where.stock_qty = { [Op.gt]: 0 };
  }

  return PureProduct.findAll({
    where,
    order: [
      ['metal', 'ASC'],
      ['form_type', 'ASC'],
      ['weight_g', 'ASC'],
    ],
    transaction,
  });
}

async function findDuplicate({ shopId, metal, formType, weightG, excludeId = null, transaction }) {
  const where = {
    shop_id: shopId || null,
    metal,
    form_type: formType,
    deleted_at: null,
  };
  if (isBulkPureForm(formType)) {
    where.form_type = 'pure';
    where.weight_g = PURE_WEIGHT_SENTINEL;
  } else {
    where.weight_g = weightG;
  }
  if (excludeId) where.id = { [Op.ne]: excludeId };
  return PureProduct.findOne({ where, transaction });
}

export async function createPureProduct(body, { shopId, transaction } = {}) {
  const data = normalizePureProductInput(body);

  const existingAny = await PureProduct.findOne({
    where: {
      shop_id: shopId || null,
      metal: data.metal,
      form_type: data.form_type,
      weight_g: data.weight_g,
    },
    transaction,
  });

  if (existingAny && !existingAny.deleted_at) {
    throw new PureProductError(
      `Already exists: ${existingAny.name}. Edit it to update stock.`,
      { status: 409, code: 'DUPLICATE' },
    );
  }
  if (existingAny && existingAny.deleted_at) {
    await existingAny.update({
      ...data,
      deleted_at: null,
      status: 'active',
    }, { transaction });
    return existingAny;
  }

  // Also block soft-deleted biscuit rows colliding with new pure
  if (data.form_type === 'pure') {
    const biscuitLegacy = await PureProduct.findOne({
      where: {
        shop_id: shopId || null,
        metal: data.metal,
        form_type: 'biscuit',
        deleted_at: null,
      },
      transaction,
    });
    if (biscuitLegacy) {
      throw new PureProductError(
        `Already exists: ${biscuitLegacy.name}. Edit it to update stock.`,
        { status: 409, code: 'DUPLICATE' },
      );
    }
  }

  return PureProduct.create({
    id: newId(),
    shop_id: shopId || null,
    ...data,
  }, { transaction });
}

export async function updatePureProduct(id, body, { shopId, transaction } = {}) {
  const row = await PureProduct.findByPk(id, { transaction });
  if (!row || row.deleted_at) {
    throw new PureProductError('Pure product not found', { status: 404, code: 'NOT_FOUND' });
  }
  if (shopId && row.shop_id && row.shop_id !== shopId) {
    throw new PureProductError('Cross-shop pure product rejected', { status: 403, code: 'CROSS_SHOP' });
  }

  const nextMetal = body.metal != null ? String(body.metal).trim().toLowerCase() : row.metal;
  const nextForm = body.form_type != null || body.formType != null
    ? normalizeFormType(body.form_type || body.formType)
    : normalizeFormType(row.form_type);

  // Full normalize when metal/form/weight/qty/threshold present for pure or coin reshape
  const reshaping = body.metal != null
    || body.form_type != null
    || body.formType != null
    || body.weight_g != null
    || body.weight != null
    || body.stock_qty != null
    || body.qty != null
    || body.low_stock_threshold != null
    || body.threshold != null;

  if (reshaping && (isBulkPureForm(nextForm) || isBulkPureForm(row.form_type) || nextForm === 'coin')) {
    const merged = normalizePureProductInput({
      metal: nextMetal,
      form_type: nextForm,
      weight_g: body.weight_g ?? body.weight ?? (isBulkPureForm(nextForm) ? row.stock_qty : row.weight_g),
      stock_qty: isBulkPureForm(nextForm)
        ? (body.stock_qty ?? body.weight_g ?? body.weight ?? row.stock_qty)
        : (body.stock_qty ?? body.qty ?? row.stock_qty),
      low_stock_threshold: body.low_stock_threshold ?? body.threshold ?? row.low_stock_threshold,
      name: body.name,
      notes: body.notes !== undefined ? body.notes : row.notes,
      status: body.status || row.status,
    });

    const dup = await findDuplicate({
      shopId: row.shop_id,
      metal: merged.metal,
      formType: merged.form_type,
      weightG: merged.weight_g,
      excludeId: row.id,
      transaction,
    });
    if (dup) {
      throw new PureProductError(`Already exists: ${dup.name}`, { status: 409, code: 'DUPLICATE' });
    }
    await row.update(merged, { transaction });
    return row;
  }

  const patch = {};
  if (body.stock_qty != null || body.qty != null) {
    const qty = Number(body.stock_qty ?? body.qty);
    if (!Number.isFinite(qty) || qty < 0) {
      throw new PureProductError('Quantity cannot be negative', { code: 'INVALID_QTY' });
    }
    patch.stock_qty = qty;
  }
  if (body.low_stock_threshold != null || body.threshold != null) {
    const thr = Number(body.low_stock_threshold ?? body.threshold);
    if (!Number.isFinite(thr) || thr < 0) {
      throw new PureProductError('Threshold cannot be negative', { code: 'INVALID_THRESHOLD' });
    }
    patch.low_stock_threshold = thr;
  }
  if (body.name != null && String(body.name).trim()) {
    patch.name = String(body.name).trim();
  }
  if (body.notes !== undefined) {
    patch.notes = body.notes == null ? null : String(body.notes);
  }
  if (body.status === 'active' || body.status === 'inactive') {
    patch.status = body.status;
  }

  await row.update(patch, { transaction });
  return row;
}

export async function softDeletePureProduct(id, { shopId, transaction } = {}) {
  const row = await PureProduct.findByPk(id, { transaction });
  if (!row || row.deleted_at) {
    throw new PureProductError('Pure product not found', { status: 404, code: 'NOT_FOUND' });
  }
  if (shopId && row.shop_id && row.shop_id !== shopId) {
    throw new PureProductError('Cross-shop pure product rejected', { status: 403, code: 'CROSS_SHOP' });
  }
  await row.update({ deleted_at: nowIso(), status: 'inactive' }, { transaction });
  return row;
}

/**
 * Low-stock alert when stock_qty <= threshold.
 * Coin: pieces. Pure: grams.
 */
export async function maybePureLowStockNotify(row, transaction) {
  if (!row) return;
  const threshold = Number(row.low_stock_threshold) || 0;
  if (!(threshold > 0)) return;
  const stock = Number(row.stock_qty) || 0;
  if (stock > threshold) return;

  const bulk = isBulkPureForm(row.form_type);
  const unit = bulk ? 'g' : 'pcs';
  const title = `Low Stock: ${row.name}`;
  const message = bulk
    ? `${row.name} is low on stock (${formatWeightLabel(stock)} g remaining, threshold ${formatWeightLabel(threshold)} g).`
    : `${row.name} is low on stock (${stock} pcs remaining, threshold ${threshold}).`;

  const unread = await Notification.findAll({
    where: {
      type: 'low_stock',
      is_read: false,
      ...(row.shop_id ? { shop_id: row.shop_id } : {}),
    },
    transaction,
    limit: 100,
  });
  const existing = unread.find((n) => {
    const raw = n.data;
    const data = typeof raw === 'string'
      ? (() => { try { return JSON.parse(raw); } catch { return {}; } })()
      : (raw || {});
    return data.pure_product_id === row.id;
  });

  const data = {
    pure_product_id: row.id,
    metal: row.metal,
    form_type: row.form_type,
    stock_qty: stock,
    threshold,
    unit,
  };

  if (existing) {
    await existing.update({ title, message, data }, { transaction });
    return;
  }

  await Notification.create({
    id: newId(),
    shop_id: row.shop_id,
    type: 'low_stock',
    title,
    message,
    data,
    is_read: false,
  }, { transaction });
}

/**
 * Decrease stock after sale.
 * Coin: quantity = pieces (integer).
 * Pure: quantity = grams sold (decimal).
 */
export async function decreasePureProductStock({
  pureProductId,
  quantity,
  shopId,
  transaction,
} = {}) {
  const amount = Number(quantity);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PureProductError('Quantity must be a positive number', { code: 'INVALID_QTY' });
  }

  const row = await PureProduct.findByPk(pureProductId, {
    transaction,
    lock: transaction?.LOCK?.UPDATE,
  });
  if (!row || row.deleted_at) {
    throw new PureProductError('Pure product not found', { status: 404, code: 'NOT_FOUND' });
  }
  if (shopId && row.shop_id && row.shop_id !== shopId) {
    throw new PureProductError('Cross-shop pure product rejected', { status: 403, code: 'CROSS_SHOP' });
  }
  if (row.status !== 'active') {
    throw new PureProductError('Pure product is inactive', { code: 'INACTIVE' });
  }

  const bulk = isBulkPureForm(row.form_type);
  if (!bulk && !Number.isInteger(amount)) {
    throw new PureProductError('Coin quantity must be a positive whole number', { code: 'INVALID_QTY' });
  }

  const available = Number(row.stock_qty) || 0;
  const eps = bulk ? 0.0005 : 0;
  if (amount > available + eps) {
    throw new PureProductError(
      bulk
        ? `Only ${formatWeightLabel(available)} g available for ${row.name}`
        : `Only ${available} available for ${row.name}`,
      { status: 409, code: 'INSUFFICIENT_STOCK' },
    );
  }

  const next = Math.max(0, Math.round((available - amount) * 1000) / 1000);
  await row.update({ stock_qty: next }, { transaction });
  row.stock_qty = next;
  await maybePureLowStockNotify(row, transaction);
  return row;
}

/**
 * Restore stock on cancel/return.
 */
export async function increasePureProductStock({
  pureProductId,
  quantity,
  shopId,
  transaction,
} = {}) {
  const amount = Number(quantity);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PureProductError('Quantity must be a positive number', { code: 'INVALID_QTY' });
  }
  const row = await PureProduct.findByPk(pureProductId, {
    transaction,
    lock: transaction?.LOCK?.UPDATE,
  });
  if (!row) {
    throw new PureProductError('Pure product not found', { status: 404, code: 'NOT_FOUND' });
  }
  if (shopId && row.shop_id && row.shop_id !== shopId) {
    throw new PureProductError('Cross-shop pure product rejected', { status: 403, code: 'CROSS_SHOP' });
  }
  const available = Number(row.stock_qty) || 0;
  await row.update({
    stock_qty: Math.round((available + amount) * 1000) / 1000,
    deleted_at: null,
    status: row.status === 'inactive' && !row.deleted_at ? row.status : 'active',
  }, { transaction });
  return row;
}
