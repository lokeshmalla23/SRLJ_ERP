import sequelize, { withLock } from '../db.js';
import { Op } from 'sequelize';
import { newId, nowIso, parseJsonField } from '../utils.js';
import { formatINR } from '../utils/formatMoney.js';
import {
  Invoice, Product, Customer, Quotation, Setting, CatalogItem, Category, Employee, Scheme,
  PureProduct,
} from '../models/index.js';
import { allocateInvoiceNumber } from './invoiceSequence.js';
import { roundWeight, toWeightNumber } from '../utils/weight.js';
import {
  applySaleLine,
  applyReturnLine,
  InventoryError,
  decreaseStock,
  increaseStock,
  atomicUpdate,
} from './inventoryService.js';
import { MOVEMENT_TYPES } from '../constants/inventory.js';
import { calcLineAmounts, calcInvoiceTotals, validatePayments, DEFAULT_GST_PCT } from './billingCalc.js';
import { formatInvoiceDescription, normalizeStoneRows, compactStoneNames } from '../../../shared/domain/invoiceLineMetrics.js';
import { D, toMoneyNumber } from '../utils/money.js';
import { appendEventLog, recordOperation, findOperation, awaitCriticalReplicaAck } from './eventLogService.js';
import { appendAuditEvent } from './auditTrailService.js';
import branchConfig from '../config/branchConfig.js';
import { computeSchemeRedeemableValue, schemeStatusAfterRedemption, isSchemeFullyPaid } from './schemeDueService.js';
import { getDefaultShopId } from './defaultShop.js';
import { getOldMetalManualMode } from './oldMetalManualMode.js';
import { isOgExchangeMode, isOsExchangeMode } from '../utils/oldMetal.js';
import { getActiveBillingDate } from './dailyClosingService.js';
import { stampOnTransactionDate, dateOnlyStamp } from '../utils/invoiceRead.js';
import { FINANCIAL_MODE, isPreAccountsRecord, resolveFinancialMode } from './financialMode.js';
import {
  decreasePureProductStock,
  increasePureProductStock,
  PureProductError,
} from './pureProductService.js';

export const REFUND_MODES = ['cash', 'upi', 'card', 'bank_transfer', 'cheque'];

/** Non-cash "refund" modes: the exchanged old metal itself goes back to the customer. */
export const OLD_METAL_REFUND_MODES = ['old_gold_exchange', 'old_silver_exchange'];

/**
 * Old gold / old silver value taken as payment on an invoice (the part of
 * grand_total - balance_due that was settled in metal, not money). Reads the
 * invoice's own payments JSON, falling back to its Payment rows.
 */
export function oldMetalPaidOnInvoice(invoice, paymentRows = []) {
  const out = { old_gold_exchange: 0, old_silver_exchange: 0 };
  const jsonPays = parseJsonField(invoice?.payments, []);
  const pays = Array.isArray(jsonPays) && jsonPays.length
    ? jsonPays
    : (paymentRows || []).filter((p) => {
      const meta = parseJsonField(p?.meta, {}) || {};
      return !String(meta.kind || '').endsWith('_refund');
    });
  for (const p of pays) {
    const amt = toMoneyNumber(Number(p?.amount) || 0);
    if (!(amt > 0)) continue;
    if (isOgExchangeMode(p?.mode)) out.old_gold_exchange = toMoneyNumber(out.old_gold_exchange + amt);
    else if (isOsExchangeMode(p?.mode)) out.old_silver_exchange = toMoneyNumber(out.old_silver_exchange + amt);
  }
  return out;
}

/**
 * Validate a refund breakdown ([{ mode, amount }]) against the amount that
 * actually needs to be physically handed back to the customer. Throws unless
 * the entries sum to exactly that amount (within paise rounding).
 */
export function normalizeRefundBreakdown(refund, refundableAmount) {
  const entries = Array.isArray(refund) ? refund : [];
  const cleaned = [];
  let sum = 0;
  for (const r of entries) {
    const mode = String(r?.mode || '').toLowerCase().trim();
    const amt = toMoneyNumber(Number(r?.amount) || 0);
    if (amt <= 0) continue;
    if (!REFUND_MODES.includes(mode)) {
      throw new BillingError(`Invalid refund mode: ${r?.mode}`, { code: 'INVALID_REFUND_MODE' });
    }
    cleaned.push({ mode, amount: amt });
    sum = toMoneyNumber(sum + amt);
  }
  const refundable = toMoneyNumber(Math.max(0, refundableAmount || 0));
  if (refundable > 0.5 && Math.abs(sum - refundable) > 0.5) {
    throw new BillingError(
      `Refund entered (${formatINR(sum)}) does not match the amount collected on this invoice (${formatINR(refundable)})`,
      { code: 'REFUND_MISMATCH' },
    );
  }
  return cleaned;
}

export class BillingError extends Error {
  constructor(message, { status = 400, code = 'BILLING_ERROR', details = null } = {}) {
    super(message);
    this.name = 'BillingError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Block POS from selling a tag that is held on another customer's booked estimation.
 * Covers unique_tag (status reserved) and quantity lines that only had price lock.
 */
async function assertProductsNotHeldByOtherBooking(productIds, {
  exceptQuotationId = null,
  transaction,
} = {}) {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) return;

  const booked = await Quotation.findAll({
    where: {
      status: 'booked',
      deleted_at: null,
      ...(exceptQuotationId ? { id: { [Op.ne]: exceptQuotationId } } : {}),
    },
    attributes: ['id', 'quote_no', 'items', 'customer_name'],
    transaction,
  });

  for (const q of booked) {
    const qItems = parseJsonField(q.items, []);
    for (const it of qItems) {
      if (it?.product_id && ids.includes(it.product_id)) {
        throw new BillingError(
          `Tag is booked on estimation ${q.quote_no}`
            + (q.customer_name ? ` (${q.customer_name})` : '')
            + ' — cancel that booking or bill it in POS before selling to someone else.',
          { code: 'ITEM_RESERVED', status: 409 },
        );
      }
    }
  }
}

function mapInventoryError(err) {
  // Also match by name/code — ESM can load InventoryError from two module
  // instances, breaking `instanceof` and leaking 500s to the client.
  const isInv = err instanceof InventoryError
    || err?.name === 'InventoryError'
    || [
      'INSUFFICIENT_STOCK', 'ALREADY_SOLD', 'ITEM_RESERVED', 'UNAVAILABLE',
      'UNIQUE_MODE', 'NOT_UNIQUE', 'BARCODE_REQUIRED', 'CROSS_SHOP', 'NOT_SOLD',
    ].includes(err?.code);
  if (!isInv) return null;
  const codeMap = {
    INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
    NOT_SOLD: 'NOT_SOLD',
    ALREADY_SOLD: 'ITEM_ALREADY_SOLD',
    ITEM_RESERVED: 'ITEM_RESERVED',
    BARCODE_REQUIRED: 'BARCODE_REQUIRED',
    CROSS_SHOP: 'CROSS_SHOP',
    NOT_FOUND: 'INVALID_PRODUCT',
    UNIQUE_MODE: 'INVALID_PRODUCT',
    NOT_UNIQUE: 'INVALID_PRODUCT',
    UNAVAILABLE: 'INSUFFICIENT_STOCK',
  };
  return new BillingError(err.message, {
    status: err.status || (err.code === 'INSUFFICIENT_STOCK' || err.code === 'UNAVAILABLE' ? 409 : 400),
    code: codeMap[err.code] || err.code || 'INVENTORY_ERROR',
  });
}

async function loadInvoiceSettings(transaction) {
  const setting = await Setting.findOne({ where: { key: 'invoice' }, transaction });
  let value = setting?.value;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = {}; }
  }
  return value && typeof value === 'object' ? value : {};
}

async function resolveGstPct(inputGst, transaction) {
  if (inputGst != null && inputGst !== '') return Number(inputGst);
  const settings = await loadInvoiceSettings(transaction);
  if (settings.gst_pct != null && settings.gst_pct !== '') return Number(settings.gst_pct);
  // Last resort: configured DEFAULT from billingCalc (shop should set invoice.gst_pct)
  return Number(DEFAULT_GST_PCT);
}

async function assertManagerOverrideIfNeeded(input, totals, transaction) {
  const settings = await loadInvoiceSettings(transaction);
  const maxPct = Number(settings.max_discount_pct_without_override ?? 10);
  const pinConfigured = settings.manager_override_pin != null && String(settings.manager_override_pin).length > 0;
  const subtotal = Number(totals.subtotal) || 0;
  const discount = Number(totals.discount) || 0;
  const discountPct = subtotal > 0 ? (discount / subtotal) * 100 : 0;
  const priceOverride = Boolean(input.price_override || input.requires_manager_override);
  const needsOverride = priceOverride || discountPct > maxPct;
  if (!needsOverride) return;
  if (!pinConfigured) {
    // No PIN configured — allow if user has settings.manage or pos.manage
    return;
  }
  const pin = String(input.manager_pin || '').trim();
  if (!pin || pin !== String(settings.manager_override_pin)) {
    throw new BillingError('Manager PIN required for this discount/override', {
      status: 403,
      code: 'MANAGER_OVERRIDE_REQUIRED',
      details: { max_discount_pct_without_override: maxPct, discount_pct: discountPct },
    });
  }
  // Ensure at least one active manager/owner account exists (PIN belongs to an active staff member)
  const activeManager = await Employee.findOne({
    where: { role: { [Op.in]: ['manager', 'shop_owner'] }, status: 'active' },
    transaction,
  });
  if (!activeManager) {
    throw new BillingError('No active manager account found — override denied', {
      status: 403,
      code: 'MANAGER_OVERRIDE_REQUIRED',
    });
  }
}

async function resolveGoldRate(explicit, transaction) {
  if (explicit != null && explicit !== '') {
    const r = D(explicit);
    if (!r.isFinite() || r.lte(0)) {
      throw new BillingError('Invalid gold rate', { code: 'INVALID_PRODUCT' });
    }
    return toMoneyNumber(r);
  }
  const setting = await Setting.findOne({ where: { key: 'gold_rate' }, transaction });
  const rate = setting?.value?.gold_24k;
  if (rate == null) {
    throw new BillingError('Gold rate not configured', { code: 'INVALID_PRODUCT' });
  }
  return toMoneyNumber(D(rate));
}

async function enrichPurityName(product, transaction) {
  if (product.purity_id) {
    const purity = await CatalogItem.findByPk(product.purity_id, { transaction });
    return purity?.name || purity?.code || null;
  }
  return null;
}

async function enrichPurityCode(product, transaction) {
  if (product.purity_id) {
    const purity = await CatalogItem.findByPk(product.purity_id, { transaction });
    return purity?.code || null;
  }
  return null;
}

async function enrichMetalName(product, transaction) {
  if (product.metal_type_id) {
    const metal = await CatalogItem.findByPk(product.metal_type_id, { transaction });
    return metal?.name || metal?.code || null;
  }
  return null;
}

async function enrichCategoryName(product, transaction) {
  if (!product.category_id) return null;
  const category = await Category.findByPk(product.category_id, { transaction });
  return category?.name || null;
}

async function enrichSubcategoryName(product, transaction) {
  if (!product.subcategory_id) return null;
  const sub = await Category.findByPk(product.subcategory_id, { transaction });
  return sub?.name || null;
}

/**
 * Build authoritative line snapshots from DB products + request overrides.
 */
async function buildLineSnapshots(rawItems, { shopId, goldRate, rateMap = {}, transaction }) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new BillingError('Invoice must contain at least one item', { code: 'EMPTY_INVOICE' });
  }

  const snapshots = [];
  for (const raw of rawItems) {
    // Pure metal / bullion: inventory coin/biscuit (qty) or legacy free weight × rate
    const isPureMetal = raw?.line_type === 'pure_metal' || raw?.is_pure_metal === true;
    if (isPureMetal) {
      let weight = Number(raw.net_weight ?? raw.gross_weight ?? 0);
      let qty = raw.quantity == null ? 1 : Number(raw.quantity);
      let pureProductId = raw.pure_product_id || null;
      let displayName = raw.name || raw.product_name || null;
      let unitWeight = null;

      if (pureProductId) {
        const pp = await PureProduct.findByPk(pureProductId, { transaction });
        if (!pp || pp.deleted_at) {
          throw new BillingError('Pure product not found', { code: 'INVALID_PRODUCT' });
        }
        if (pp.shop_id && pp.shop_id !== shopId) {
          throw new BillingError('Cross-shop pure product rejected', { code: 'CROSS_SHOP', status: 403 });
        }
        if (pp.status !== 'active') {
          throw new BillingError('Pure product is inactive', { code: 'INVALID_PRODUCT' });
        }
        const available = Number(pp.stock_qty) || 0;
        const isBulk = String(pp.form_type || '').toLowerCase() === 'pure'
          || String(pp.form_type || '').toLowerCase() === 'biscuit';

        if (isBulk) {
          // Bulk pure: sell by weight (g); stock_qty is grams on hand
          weight = Number(raw.net_weight ?? raw.gross_weight ?? 0);
          if (!Number.isFinite(weight) || weight <= 0) {
            throw new BillingError('Pure metal weight must be a positive number', { code: 'INVALID_WEIGHT' });
          }
          if (weight > available + 0.0005) {
            throw new BillingError(
              `Only ${available} g available for ${pp.name}`,
              { status: 409, code: 'INSUFFICIENT_STOCK' },
            );
          }
          qty = 1;
          unitWeight = null;
          displayName = displayName || pp.name;
          pureProductId = pp.id;
        } else {
          // Coin: sell by piece qty
          if (!Number.isInteger(qty) || qty <= 0) {
            throw new BillingError('Pure product quantity must be a positive whole number', { code: 'INVALID_QUANTITY' });
          }
          if (qty > available) {
            throw new BillingError(
              `Only ${available} available for ${pp.name}`,
              { status: 409, code: 'INSUFFICIENT_STOCK' },
            );
          }
          unitWeight = Number(pp.weight_g) || 0;
          weight = Math.round(unitWeight * qty * 1000) / 1000;
          displayName = displayName || pp.name;
          pureProductId = pp.id;
        }
      }

      if (!Number.isFinite(weight) || weight <= 0) {
        throw new BillingError('Pure metal weight must be a positive number', { code: 'INVALID_WEIGHT' });
      }
      const purityName = raw.purity || raw.purity_name || '24K';
      const metalName = raw.metal || raw.metal_name
        || (String(purityName).toLowerCase().includes('silver') ? 'Silver' : 'Gold');
      const rateExplicit = raw.rate != null && raw.rate !== '' ? Number(raw.rate) : null;
      let unitRate = rateExplicit;
      if (unitRate == null || !Number.isFinite(unitRate) || unitRate <= 0) {
        const key = String(purityName).toLowerCase().includes('silver') ? 'PureSilver' : '24K';
        unitRate = Number(rateMap[key] ?? (key === '24K' ? goldRate : 0)) || 0;
      }
      if (!(unitRate > 0)) {
        throw new BillingError('Pure metal rate is required', { code: 'INVALID_RATE' });
      }
      const metalValue = raw.price_override != null && raw.price_override !== ''
        ? Number(raw.price_override)
        : toMoneyNumber(D(weight).times(unitRate));
      const otherCharges = Number(raw.other_charges ?? raw.making_charges ?? 0) || 0;
      // price_override is the full metal amount for this line — always calc with qty 1
      // so pieces don't multiply the total. Snapshot still stores piece qty for stock.
      const pieceQty = qty > 0 ? qty : 1;
      const lineInput = {
        gross_weight: weight,
        net_weight: weight,
        stone_weight: 0,
        wastage_pct: 0,
        making_charges: otherCharges,
        making_charge_type: 'fixed',
        stone_charges: 0,
        purity: purityName,
        quantity: 1,
        price_override: metalValue,
      };
      let amounts;
      try {
        amounts = calcLineAmounts(lineInput, goldRate, rateMap);
      } catch (err) {
        throw new BillingError(err.message, { code: err.code || 'INVALID_PRODUCT' });
      }
      const resolvedName = displayName
        || (String(purityName).toLowerCase().includes('silver') ? 'Pure Silver' : '24K Gold');
      const pureForm = pureProductId
        ? (unitWeight == null ? 'pure' : 'coin')
        : null;
      const stockDecrement = pureProductId
        ? (pureForm === 'pure' ? weight : pieceQty)
        : null;
      snapshots.push({
        product_id: null,
        pure_product_id: pureProductId,
        pure_form: pureForm,
        pure_stock_decrement: stockDecrement,
        product_name: resolvedName,
        name: resolvedName,
        description: resolvedName,
        code: null,
        barcode: null,
        hsn_code: raw.hsn_code || (String(purityName).toLowerCase().includes('silver') ? '7106' : '7108'),
        metal: metalName,
        metal_name: metalName,
        category_id: null,
        category_name: 'Pure Metal',
        subcategory_id: null,
        subcategory_name: null,
        hallmark: null,
        stones: [],
        purity: purityName,
        quantity: pieceQty,
        unit_weight_g: unitWeight,
        gross_weight: weight,
        net_weight: weight,
        stone_weight: 0,
        wastage_pct: 0,
        making_charges: otherCharges,
        making_charge_type: 'fixed',
        gold_rate: goldRate,
        rate: unitRate,
        is_pure_metal: true,
        line_type: 'pure_metal',
        ...amounts,
        quantity: pieceQty,
        gst_slab: Number(DEFAULT_GST_PCT),
        inventory_mode: pureProductId ? 'quantity' : 'none',
        taxable_amount: amounts.line_total,
        tray_weight_sold: null,
      });
      continue;
    }

    if (!raw?.product_id) {
      throw new BillingError('Each line requires product_id', { code: 'INVALID_PRODUCT' });
    }

    const product = await Product.findByPk(raw.product_id, { transaction });
    if (!product) {
      throw new BillingError(`Product ${raw.product_id} not found`, { code: 'INVALID_PRODUCT' });
    }
    if (product.shop_id && product.shop_id !== shopId) {
      throw new BillingError('Cross-shop product rejected', { code: 'CROSS_SHOP', status: 403 });
    }
    if (product.deleted_at) {
      throw new BillingError('Product is deleted', { code: 'INVALID_PRODUCT' });
    }

    const purityName = raw.purity || raw.purity_name || (await enrichPurityName(product, transaction));
    const purityCode = raw.purity_code ?? (await enrichPurityCode(product, transaction));
    const metalName = raw.metal || raw.metal_name || raw.metal_type || (await enrichMetalName(product, transaction));
    const categoryName = raw.category_name || raw.category || (await enrichCategoryName(product, transaction));
    const subcategoryName = raw.subcategory_name || raw.subcategory || (await enrichSubcategoryName(product, transaction));
    const qty = raw.quantity == null ? 1 : Number(raw.quantity);

    // Tray unit: the weight sold is entered directly in POS and is authoritative
    // for pricing — it is never derived from pieces, and pieces are never
    // derived from it. product.tray_total_weight/stock_qty are the available caps.
      const trayWeightSold = raw.tray_weight_sold != null ? toWeightNumber(raw.tray_weight_sold) : null;
    const isTraySale = trayWeightSold != null;

    if (isTraySale) {
      if (!Number.isFinite(trayWeightSold) || trayWeightSold <= 0) {
        throw new BillingError('Tray weight sold must be a positive number', { code: 'INVALID_TRAY_WEIGHT' });
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new BillingError('Tray pieces sold must be a positive whole number', { code: 'INVALID_QUANTITY' });
      }
      const availableWeight = toWeightNumber(product.tray_total_weight);
      if (trayWeightSold > availableWeight + 0.0005) {
        throw new BillingError(
          `Insufficient tray weight for "${product.name}". Available: ${availableWeight}g, requested: ${trayWeightSold}g`,
          { code: 'INSUFFICIENT_STOCK' },
        );
      }
    }

    const lineInput = {
      // Tray: gross/net weight = the actual weight sold (not the product's
      // stored per-unit weight) — that entered weight prices the whole line.
      gross_weight: isTraySale ? trayWeightSold : (raw.gross_weight ?? product.gross_weight),
      net_weight: isTraySale ? trayWeightSold : (raw.net_weight ?? product.net_weight),
      stone_weight: raw.stone_weight ?? product.stone_weight,
      wastage_pct: raw.wastage_pct ?? product.wastage_pct,
      making_charges: raw.making_charges ?? product.making_charges,
      making_charge_type: raw.making_charge_type ?? product.making_charge_type,
      stone_charges: raw.stone_charges ?? 0,
      purity: purityName,
      purity_code: purityCode,
      metal: metalName,
      metal_name: metalName,
      // Tray: the weight above already represents the total sold, so price it
      // once (qty=1) — the real piece count is restored below, after pricing,
      // for stock deduction / invoice quantity / print. is_tray/tray_pieces_sold
      // let calcLineAmounts multiply flat making + stone charges by pieces sold.
      quantity: isTraySale ? 1 : qty,
      is_tray: isTraySale,
      tray_pieces_sold: isTraySale ? qty : null,
      price_override: raw.price_override,
      // Cashier-entered per-line overrides from the POS breakdown row.
      rate_override: raw.rate_override,
      wastage_amount_override: raw.wastage_amount_override,
      making_amount_override: raw.making_amount_override,
    };

    let amounts;
    try {
      amounts = calcLineAmounts(lineInput, goldRate, rateMap);
    } catch (err) {
      throw new BillingError(err.message, { code: err.code || 'INVALID_PRODUCT' });
    }

    const gstSlab = product.gst_slab != null ? product.gst_slab : Number(DEFAULT_GST_PCT);

    const stonesFromPos = normalizeStoneRows(raw.stones || raw.stone_details);
    const stonesFromProduct = normalizeStoneRows(product.stone_details);
    const stones = stonesFromPos.length ? stonesFromPos : stonesFromProduct;
    const stoneNames = compactStoneNames(stones) || null;
    const hallmark = String(raw.hallmark != null && raw.hallmark !== '' ? raw.hallmark : (product.hallmark || '')).trim() || null;
    const description = formatInvoiceDescription(categoryName, subcategoryName, product.name);

    snapshots.push({
      product_id: product.id,
      product_name: product.name,
      name: product.name,
      description,
      code: product.code || null,
      barcode: product.barcode || null,
      hsn_code: product.hsn_code || null,
      metal: metalName,
      metal_name: metalName,
      category_id: product.category_id || raw.category_id || null,
      category_name: categoryName,
      subcategory_id: product.subcategory_id || raw.subcategory_id || null,
      subcategory_name: subcategoryName,
      purity: purityName,
      purity_code: purityCode,
      hallmark,
      stones,
      stone_names: stoneNames,
      rate: amounts.charged_rate,
      quantity: qty,
      gross_weight: roundWeight(lineInput.gross_weight),
      net_weight: roundWeight(lineInput.net_weight),
      stone_weight: (() => {
        const sw = roundWeight(lineInput.stone_weight);
        if (sw > 0) return sw;
        const derived = roundWeight((Number(lineInput.gross_weight) || 0) - (Number(lineInput.net_weight) || 0));
        return derived > 0.0005 ? derived : 0;
      })(),
      wastage_pct: Number(lineInput.wastage_pct) || 0,
      making_charges: Number(lineInput.making_charges) || 0,
      making_charge_type: lineInput.making_charge_type || 'fixed',
      gold_rate: goldRate,
      ...amounts,
      // calcLineAmounts priced tray lines at quantity=1 (see above) — restore
      // the real piece count now, for stock deduction, invoice display, and print.
      quantity: isTraySale ? qty : amounts.quantity,
      gst_slab: gstSlab,
      inventory_mode: product.inventory_mode,
      taxable_amount: amounts.line_total,
      // Tray unit: weight sold from this tray (reduces tray_total_weight)
      tray_weight_sold: trayWeightSold,
    });
  }

  return snapshots;
}

function computeBillGstFromLines(snapshots, totals) {
  // Allocate bill GST across lines by share of subtotal (not after-discount),
  // so Σ line.gst_amount === billGst even when a bill discount is applied.
  const billGst = totals.gst_amount;
  const billSubtotal = totals.subtotal || 0;
  let allocated = D(0);
  return snapshots.map((line, idx) => {
    const isLast = idx === snapshots.length - 1;
    let share;
    if (billSubtotal <= 0) {
      share = 0;
    } else if (isLast) {
      share = toMoneyNumber(D(billGst).minus(allocated));
    } else {
      share = toMoneyNumber(D(billGst).times(D(line.line_total)).div(billSubtotal));
      allocated = allocated.plus(share);
    }
    const cgst = toMoneyNumber(D(share).div(2));
    const sgst = toMoneyNumber(D(share).minus(cgst));
    return {
      ...line,
      gst_pct: totals.gst_pct,
      gst_amount: share,
      cgst_amount: cgst,
      sgst_amount: sgst,
      line_grand: toMoneyNumber(D(line.line_total).plus(share)),
    };
  });
}

/**
 * Create invoice — authoritative billing pipeline.
 */
export async function createInvoice(input, { user = null, transaction: externalTx = null } = {}) {
  let _allocatedInvoiceNo = null; // captured for duplicate-recovery in outer catch
  const run = async (transaction) => {
    const requestId = input.request_id || input.idempotency_key || null;

    // Idempotency: return existing invoice for same request_id + shop
    if (requestId) {
      const existing = await Invoice.findOne(
        withLock({ where: { request_id: requestId } }, transaction),
      );
      if (existing) {
        return { invoice: existing, idempotent: true };
      }
    }

    // Optional: link to estimation/quotation early so booked price locks apply
    let linkedQuotation = null;
    if (input.quotation_id) {
      linkedQuotation = await Quotation.findByPk(input.quotation_id, withLock({}, transaction));
      if (!linkedQuotation || linkedQuotation.deleted_at) {
        throw new BillingError('Estimation not found', { code: 'QUOTATION_NOT_FOUND', status: 404 });
      }
      if (linkedQuotation.status === 'converted') {
        throw new BillingError('Estimation already converted', {
          code: 'QUOTATION_ALREADY_CONVERTED',
          details: { converted_invoice_id: linkedQuotation.converted_invoice_id },
        });
      }
      if (!['draft', 'sent', 'accepted', 'booked'].includes(linkedQuotation.status)) {
        throw new BillingError(
          `Cannot bill estimation with status "${linkedQuotation.status}"`,
          { code: 'QUOTATION_NOT_BILLABLE' },
        );
      }
      // Past-deadline booked estimations must be expired before billing
      if (linkedQuotation.status === 'booked' && linkedQuotation.valid_until) {
        const today = new Date().toISOString().slice(0, 10);
        if (String(linkedQuotation.valid_until).slice(0, 10) < today) {
          throw new BillingError('Estimation booking has expired', {
            code: 'QUOTATION_EXPIRED',
            status: 409,
          });
        }
      }
    }

    const priceLocked = Boolean(
      linkedQuotation
      && (linkedQuotation.price_locked || linkedQuotation.status === 'booked'),
    );

    // Allocate shop via sequence early for shop boundary (also creates sequence row)
    // We need shopId before locking products — resolve from active shop / sequence helper
    // Booked estimations force the locked gold rate (ignore live rate).
    const goldRate = await resolveGoldRate(
      priceLocked && linkedQuotation?.gold_rate != null
        ? linkedQuotation.gold_rate
        : input.gold_rate,
      transaction,
    );

    // Pre-resolve shop from products, or default shop for pure-metal-only invoices
    const productIds = [...new Set(
      (input.items || []).map((i) => i.product_id).filter(Boolean)
    )].sort();
    const hasPureMetal = (input.items || []).some(
      (i) => i?.line_type === 'pure_metal' || i?.is_pure_metal === true,
    );

    let shopId;
    const lockedProducts = [];
    if (productIds.length === 0) {
      if (!hasPureMetal || !(input.items || []).length) {
        throw new BillingError('Invoice must contain at least one item', { code: 'EMPTY_INVOICE' });
      }
      shopId = input.shop_id || user?.shop_id || await getDefaultShopId({ transaction });
      if (!shopId) {
        throw new BillingError('Shop not configured for pure metal sale', { code: 'INVALID_SHOP' });
      }
    } else {
      for (const id of productIds) {
        const p = await Product.findByPk(id, withLock({}, transaction));
        if (!p) throw new BillingError(`Product ${id} not found`, { code: 'INVALID_PRODUCT' });
        lockedProducts.push(p);
      }

      shopId = lockedProducts[0].shop_id;
      for (const p of lockedProducts) {
        if (p.shop_id !== shopId) {
          throw new BillingError('All products must belong to the same shop', { code: 'CROSS_SHOP', status: 403 });
        }
      }
    }

    const financialMode = await resolveFinancialMode(shopId, { transaction });
    const isTestSale = financialMode === FINANCIAL_MODE.PRE_ACCOUNTS;

    let resolvedCustomer = null;
    if (input.customer_id) {
      const customer = await Customer.findByPk(input.customer_id, { transaction });
      if (!customer || customer.deleted_at) {
        throw new BillingError('Customer not found', { code: 'INVALID_PRODUCT' });
      }
      resolvedCustomer = customer;
      if (customer.shop_id && customer.shop_id !== shopId) {
        // Local / single-shop: Neon sync or seed can leave customers on an old shop_id.
        // Heal onto the product shop when this device is the configured branch shop.
        const { isLocalMode } = await import('../db.js');
        const configured = branchConfig.shop_id;
        const sameBranch =
          isLocalMode()
          || !configured
          || configured === shopId
          || configured === customer.shop_id;
        if (sameBranch) {
          await customer.update({ shop_id: shopId }, { transaction });
        } else {
          throw new BillingError('Cross-shop customer rejected', { code: 'CROSS_SHOP', status: 403 });
        }
      }
    }

    // KYC fields captured at billing time (mandatory above the PAN/Aadhaar
    // transaction thresholds) must not belong to another customer — check
    // even though they'll also be checked when we PATCH them onto the
    // customer record afterwards, so the invoice itself never carries a
    // colliding number.
    const billShopScope = shopId ? { shop_id: shopId } : {};
    const billPan = input.pan_number ? String(input.pan_number).trim().toUpperCase() : '';
    if (billPan && billPan !== String(resolvedCustomer?.pan_number || '')) {
      const dupPan = await Customer.findOne({
        where: {
          ...billShopScope,
          pan_number: billPan,
          deleted_at: null,
          ...(resolvedCustomer ? { id: { [Op.ne]: resolvedCustomer.id } } : {}),
        },
        transaction,
      });
      if (dupPan) {
        throw new BillingError('This PAN number is already registered to another customer', {
          status: 409,
          code: 'DUPLICATE_PAN',
          details: {
            existing_id: dupPan.id,
            existing: { id: dupPan.id, name: dupPan.name, mobile: dupPan.mobile, pan_number: dupPan.pan_number, aadhaar_number: dupPan.aadhaar_number },
          },
        });
      }
    }
    const billAadhaar = input.aadhaar_number ? String(input.aadhaar_number).replace(/\D/g, '') : '';
    if (billAadhaar && billAadhaar !== String(resolvedCustomer?.aadhaar_number || '')) {
      const dupAadhaar = await Customer.findOne({
        where: {
          ...billShopScope,
          aadhaar_number: billAadhaar,
          deleted_at: null,
          ...(resolvedCustomer ? { id: { [Op.ne]: resolvedCustomer.id } } : {}),
        },
        transaction,
      });
      if (dupAadhaar) {
        throw new BillingError('This Aadhaar number is already registered to another customer', {
          status: 409,
          code: 'DUPLICATE_AADHAAR',
          details: {
            existing_id: dupAadhaar.id,
            existing: { id: dupAadhaar.id, name: dupAadhaar.name, mobile: dupAadhaar.mobile, pan_number: dupAadhaar.pan_number, aadhaar_number: dupAadhaar.aadhaar_number },
          },
        });
      }
    }

    // Load rate settings as fallback for rates the client did not provide
    const rateSetting = await Setting.findOne({ where: { key: 'gold_rate' }, transaction });
    const sv = rateSetting?.value || {};

    const rateMap = { '24K': goldRate };
    const r22 = Number(input.gold_22k ?? sv.gold_22k) || null;
    const r18 = Number(input.gold_18k ?? sv.gold_18k) || null;
    const rSilver = Number(input.silver_rate ?? sv.silver) || null;
    const rPureSilver = Number(input.pure_silver_rate ?? sv.pure_silver) || null;
    const rPlatinum = Number(input.platinum_rate ?? sv.platinum) || null;
    if (r22 != null) rateMap['22K'] = r22;
    if (r18 != null) rateMap['18K'] = r18;
    if (rSilver != null) rateMap['Silver'] = rSilver;
    if (rPureSilver != null) rateMap['PureSilver'] = rPureSilver;
    if (rPlatinum != null) rateMap.Platinum = rPlatinum;

    // When price-locked, force each line's price_override from the estimation snapshot
    let billItems = input.items || [];
    if (priceLocked && linkedQuotation) {
      const parsedQuoteItems = parseJsonField(linkedQuotation.items, []);
      const quoteItems = Array.isArray(parsedQuoteItems) ? parsedQuoteItems : [];
      const byProduct = new Map(
        quoteItems.filter((it) => it.product_id).map((it) => [it.product_id, it]),
      );
      billItems = billItems.map((raw) => {
        const qit = raw.product_id ? byProduct.get(raw.product_id) : null;
        if (!qit) return raw;
        const lockedPrice = qit.price_override ?? qit.unit_price ?? raw.price_override;
        return {
          ...raw,
          price_override: lockedPrice != null && lockedPrice !== '' ? Number(lockedPrice) : raw.price_override,
        };
      });
    }

    const lineSnapshots = await buildLineSnapshots(billItems, { shopId, goldRate, rateMap, transaction });
    const detailedStone = Boolean(input.detailed_stone_bill);
    const snapshotAddress = String(input.customer_address || resolvedCustomer?.address || '').trim() || null;
    for (const line of lineSnapshots) {
      line.detailed_stone_bill = detailedStone;
      if (snapshotAddress) line.customer_address = snapshotAddress;
    }

    // Old gold: accept computed value or weight × rate from input. The entered
    // rate is already the actual exchange rate — no purity multiplier applied.
    // Manual mode is an admin-controlled per-shop setting, re-read here (never
    // trusted from the client) — when on for a metal, the entered "rate" IS
    // the exchange amount and no weight × rate math runs.
    const oldMetalManual = await getOldMetalManualMode(transaction);
    let oldGoldValue = input.old_gold_value;
    if (input.old_gold && input.old_gold.active) {
      const og = input.old_gold;
      oldGoldValue = oldMetalManual.gold
        ? toMoneyNumber(D(og.rate || 0))
        : toMoneyNumber(D(og.weight || 0).times(D(og.rate || 0)));
    }
    let oldSilverValue = input.old_silver_value;
    if (input.old_silver && input.old_silver.active) {
      const os = input.old_silver;
      oldSilverValue = oldMetalManual.silver
        ? toMoneyNumber(D(os.rate || 0))
        : toMoneyNumber(D(os.weight || 0).times(D(os.rate || 0)));
    }

    // Scheme credit: lock scheme, validate ownership/status, compute redeemable server-side
    let schemeCredit = 0;
    let appliedSchemeId = null;
    let lockedScheme = null;
    if (input.scheme_id) {
      lockedScheme = await Scheme.findByPk(input.scheme_id, withLock({}, transaction));
      if (!lockedScheme) {
        throw new BillingError('Scheme not found', { code: 'SCHEME_NOT_FOUND', status: 404 });
      }
      if (!['active', 'matured'].includes(lockedScheme.status)) {
        throw new BillingError(
          `Scheme cannot be applied (status: ${lockedScheme.status})`,
          { code: 'SCHEME_NOT_REDEEMABLE' },
        );
      }
      if (input.customer_id && lockedScheme.customer_id && lockedScheme.customer_id !== input.customer_id) {
        throw new BillingError('Scheme does not belong to this customer', { code: 'SCHEME_CUSTOMER_MISMATCH' });
      }
      // Grams were stored using 22K day-rate; revalue at today's 22K (fallback 24K)
      const schemeRate = Number(rateMap['22K']) || Number(goldRate) || 0;
      const redeemable = computeSchemeRedeemableValue(lockedScheme, { goldRate: schemeRate });
      const requested = Number(input.scheme_credit);
      schemeCredit = Number.isFinite(requested) && requested > 0
        ? Math.min(requested, redeemable.amount)
        : redeemable.amount;
      if (!(schemeCredit > 0)) {
        throw new BillingError('Scheme has no redeemable value', { code: 'SCHEME_EMPTY' });
      }
      appliedSchemeId = lockedScheme.id;
    }

    const isHidden = Boolean(input.is_hidden);
    // Hidden bills now compute GST the same as a normal bill — only their
    // visibility in reports/accounts differs (until unlocked). "Never allow
    // partial/credit" for hidden bills is unrelated to GST and stays below.
    const resolvedGstPct = await resolveGstPct(input.gst_pct, transaction);
    const totals = calcInvoiceTotals({
      lineTotals: lineSnapshots.map((l) => l.line_total),
      discount: input.discount || 0,
      discountType: input.discount_type || 'flat',
      gstPct: resolvedGstPct,
      oldGoldValue: oldGoldValue || 0,
      oldSilverValue: oldSilverValue || 0,
      schemeCredit: schemeCredit || 0,
      taxType: input.tax_type || input.gst_type || 'intra',
    });

    await assertManagerOverrideIfNeeded(input, totals, transaction);

    const lines = computeBillGstFromLines(lineSnapshots, totals);

    // Old Gold Exchange is a PAYMENT, not an invoice deduction — reconcile the
    // client-sent payment list against the server-authoritative oldGoldValue.
    // Exactly one old_gold_exchange row is allowed; its amount always comes
    // from the server calculation (never trusted from the client), and it
    // carries weight/purity/rate so the invoice/receipt/reprint stay accurate.
    let billPayments = Array.isArray(input.payments) ? input.payments.slice() : [];
    const ogPaymentCount = billPayments.filter(
      (p) => String(p?.mode || '').toLowerCase() === 'old_gold_exchange',
    ).length;
    if (ogPaymentCount > 1) {
      throw new BillingError('Only one Old Gold Exchange payment is allowed per invoice', {
        code: 'OLD_GOLD_DUPLICATE_PAYMENT',
      });
    }
    if (Number(totals.old_gold_value) > 0) {
      billPayments = billPayments.filter((p) => String(p?.mode || '').toLowerCase() !== 'old_gold_exchange');
      billPayments.push({
        mode: 'old_gold_exchange',
        amount: totals.old_gold_value,
        description: 'Old Gold Exchange',
        old_gold: (input.old_gold && input.old_gold.active) ? {
          weight: Number(input.old_gold.weight) || 0,
          purity: input.old_gold.purity || '22K',
          rate: Number(input.old_gold.rate) || 0,
          // Manual mode: "rate" is the exchange amount itself, not a per-gram rate.
          ...(oldMetalManual.gold ? { manual: true } : {}),
        } : undefined,
      });
    } else if (ogPaymentCount > 0) {
      throw new BillingError(
        'Old Gold Exchange payment provided without old gold weight/purity/rate details',
        { code: 'OLD_GOLD_MISSING_DETAILS' },
      );
    }

    const osPaymentCount = billPayments.filter(
      (p) => String(p?.mode || '').toLowerCase() === 'old_silver_exchange',
    ).length;
    if (osPaymentCount > 1) {
      throw new BillingError('Only one Old Silver Exchange payment is allowed per invoice', {
        code: 'OLD_SILVER_DUPLICATE_PAYMENT',
      });
    }
    if (Number(totals.old_silver_value) > 0) {
      billPayments = billPayments.filter((p) => String(p?.mode || '').toLowerCase() !== 'old_silver_exchange');
      billPayments.push({
        mode: 'old_silver_exchange',
        amount: totals.old_silver_value,
        description: 'Old Silver Exchange',
        old_silver: (input.old_silver && input.old_silver.active) ? {
          weight: Number(input.old_silver.weight) || 0,
          purity: input.old_silver.purity || '925',
          rate: Number(input.old_silver.rate) || 0,
          ...(oldMetalManual.silver ? { manual: true } : {}),
        } : undefined,
      });
    } else if (osPaymentCount > 0) {
      throw new BillingError(
        'Old Silver Exchange payment provided without old silver weight/purity/rate details',
        { code: 'OLD_SILVER_MISSING_DETAILS' },
      );
    }

    // Optional: link to estimation/quotation already resolved above (price lock / booking)

    const allowPartial = !isHidden && Boolean(input.allow_partial) && Boolean(input.customer_id);
    let paymentResult;
    try {
      paymentResult = validatePayments(billPayments, totals.grand_total, { allowPartial });
    } catch (err) {
      throw new BillingError(err.message || 'Invalid payment', {
        status: 400,
        code: err.code || 'INVALID_PAYMENT',
        details: err.balance != null ? { balance: err.balance } : undefined,
      });
    }

    const { invoiceNo, sequence: invoiceSerial } = await allocateInvoiceNumber({
      shopId,
      isHidden,
      prefix: isTestSale ? 'TEST' : undefined,
      transaction,
    });
    _allocatedInvoiceNo = invoiceNo;
    const invoiceId = newId();
    const { date: businessDate } = await getActiveBillingDate({ shopId, transaction });
    const occurredAt = stampOnTransactionDate(businessDate);

    // Inventory — skip pure-metal (bullion) lines that have no product. Tray
    // lines are also skipped here: unlike a unique tag, a tray is a shared
    // pool multiple bookings can validly draw from — the atomic weight
    // decrement below (and at booking time) is what actually prevents
    // overselling it, not a blanket "any other booking" block.
    const stockProductIds = lines
      .filter((l) => l?.product_id && !l.is_pure_metal && l.line_type !== 'pure_metal'
        && !(l.tray_weight_sold != null && l.tray_weight_sold > 0))
      .map((l) => l.product_id);
    if (!isTestSale) {
      await assertProductsNotHeldByOtherBooking(stockProductIds, {
        exceptQuotationId: linkedQuotation?.id || null,
        transaction,
      });
    }

    for (const line of lines) {
      if (line.pure_product_id && (line.is_pure_metal || line.line_type === 'pure_metal')) {
        const decrement = line.pure_stock_decrement != null
          ? Number(line.pure_stock_decrement)
          : (line.pure_form === 'pure'
            ? Number(line.net_weight || line.gross_weight || 0)
            : Number(line.quantity) || 1);
        try {
          if (!isTestSale) {
            await decreasePureProductStock({
              pureProductId: line.pure_product_id,
              quantity: decrement,
              shopId,
              transaction,
            });
          }
        } catch (err) {
          if (err instanceof PureProductError) {
            throw new BillingError(err.message, { status: err.status || 400, code: err.code || 'INSUFFICIENT_STOCK' });
          }
          throw err;
        }
        continue;
      }
      if (!line.product_id || line.is_pure_metal || line.line_type === 'pure_metal') {
        continue;
      }

      const isTrayLine = line.tray_weight_sold != null && line.tray_weight_sold > 0;
      // Tray unit already carved out of the pool when this estimation was
      // booked (bookQuotation reserves the weight/pieces the moment the
      // advance is taken) — converting that same booking into an invoice
      // must not decrement the tray a second time.
      const alreadyReservedAtBooking = isTrayLine
        && linkedQuotation
        && linkedQuotation.status === 'booked';
      if (alreadyReservedAtBooking) continue;

      try {
        await applySaleLine({
          shopId,
          productId: line.product_id,
          quantity: line.quantity,
          referenceType: 'invoice',
          referenceId: invoiceId,
          createdBy: user?.id || null,
          originDeviceId: branchConfig.device_id,
          requestId,
          quotationId: linkedQuotation?.id || null,
          affectLiveStock: !isTestSale,
          isHidden,
          occurredAt,
          transaction,
        });
      } catch (err) {
        const mapped = mapInventoryError(err);
        if (mapped) throw mapped;
        throw err;
      }

      // Tray unit: also reduce tray_total_weight by the weight sold — atomic
      // conditional decrement (same guarded-UPDATE pattern decreaseStock uses
      // for pieces), so two concurrent sales on the same tray can't oversell
      // its weight even if both passed the earlier validation check.
      if (isTrayLine && !isTestSale) {
        const soldWt = toWeightNumber(line.tray_weight_sold);
        const changed = await atomicUpdate(
          `UPDATE products
           SET tray_total_weight = ROUND(ROUND(tray_total_weight, 3) - :weight, 3),
               gross_weight = ROUND(ROUND(tray_total_weight, 3) - :weight, 3),
               net_weight = ROUND(ROUND(tray_total_weight, 3) - :weight, 3),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = :id AND ROUND(tray_total_weight, 3) >= :weight`,
          { id: line.product_id, weight: soldWt },
          transaction,
        );
        if (changed === 0) {
          throw new BillingError(
            'Tray weight is no longer available — it may have just been sold at another counter.',
            { status: 409, code: 'INSUFFICIENT_STOCK' },
          );
        }
      }
    }

    let invoice;
    const invoiceAttrs = {
      id: invoiceId,
      shop_id: shopId,
      business_date: businessDate,
      created_at: occurredAt,
      invoice_no: invoiceNo,
      request_id: requestId,
      customer_id: input.customer_id || null,
      customer_name: input.customer_name || null,
      customer_mobile: input.customer_mobile || resolvedCustomer?.mobile || null,
      customer_address: String(input.customer_address || resolvedCustomer?.address || '').trim() || null,
      pan_number: input.pan_number || resolvedCustomer?.pan_number || null,
      aadhaar_number: String(input.aadhaar_number || resolvedCustomer?.aadhaar_number || '').trim() || null,
      detailed_stone_bill: Boolean(input.detailed_stone_bill),
      salesperson_id: input.salesperson_id || null,
      items: lines,
      subtotal: totals.subtotal,
      discount: totals.discount,
      discount_type: totals.discount_type,
      gst_pct: totals.gst_pct,
      gst_amount: totals.gst_amount,
      cgst_amount: totals.cgst_amount,
      sgst_amount: totals.sgst_amount,
      igst_amount: totals.igst_amount || 0,
      tax_type: totals.tax_type || 'intra',
      old_gold_value: totals.old_gold_value,
      old_silver_value: totals.old_silver_value || 0,
      scheme_credit: totals.scheme_credit || 0,
      scheme_id: appliedSchemeId,
      quotation_id: linkedQuotation?.id || null,
      gold_rate: goldRate,
      grand_total: totals.grand_total,
      round_off: totals.round_off,
      payments: paymentResult.payments,
      balance_due: paymentResult.status === 'partial' ? toMoneyNumber(paymentResult.balance) : 0,
      notes: input.notes || null,
      status: paymentResult.status,
      is_hidden: isHidden,
      created_by: user?.id || null,
      counter_id: input.counter_id || null,
      device_id: input.device_id || user?.device_id || branchConfig.device_id || null,
      branch_id: input.branch_id || shopId || null,
      financial_mode: financialMode,
    };
    try {
      invoice = await Invoice.create(invoiceAttrs, { transaction });
    } catch (err) {
      // Pre-migration DBs: persist flag inside items JSON and retry without new columns.
      if (!/no such column|no column named|has no column/i.test(String(err.message || err))) throw err;
      const { customer_address, detailed_stone_bill, aadhaar_number, business_date, ...legacyAttrs } = invoiceAttrs;
      invoice = await Invoice.create(legacyAttrs, { transaction });
      invoice.customer_address = customer_address;
      invoice.detailed_stone_bill = detailed_stone_bill;
      invoice.aadhaar_number = aadhaar_number;
      invoice.business_date = business_date;
    }

    // Dual-write normalized lines (JSON items retained as authoritative snapshot)
    try {
      await sequelize.query(
        `INSERT INTO invoice_items
          (id, shop_id, invoice_id, line_no, product_id, barcode, description, quantity,
           gross_weight, net_weight, rate, making, wastage, tax_pct, tax_amount, amount, hsn_code, snapshot_json, created_at, updated_at)
         VALUES ${lines.map((_, i) =>
           `(:id${i}, :shop_id, :invoice_id, :line_no${i}, :product_id${i}, :barcode${i}, :description${i}, :quantity${i},
            :gross_weight${i}, :net_weight${i}, :rate${i}, :making${i}, :wastage${i}, :tax_pct${i}, :tax_amount${i}, :amount${i}, :hsn_code${i}, :snapshot_json${i}, :now, :now)`
         ).join(', ')}`,
        {
          replacements: lines.reduce((acc, line, i) => {
            acc[`id${i}`] = newId();
            acc[`line_no${i}`] = i + 1;
            acc[`product_id${i}`] = line.product_id || null;
            acc[`barcode${i}`] = line.barcode || null;
            acc[`description${i}`] = line.description || line.product_name || line.name || null;
            acc[`quantity${i}`] = line.quantity || 1;
            acc[`gross_weight${i}`] = line.gross_weight ?? null;
            acc[`net_weight${i}`] = line.net_weight ?? null;
            acc[`rate${i}`] = line.charged_rate ?? line.rate ?? line.unit_price ?? null;
            acc[`making${i}`] = line.making_charges ?? line.making ?? null;
            acc[`wastage${i}`] = line.wastage_pct ?? line.wastage ?? null;
            acc[`tax_pct${i}`] = line.gst_pct ?? totals.gst_pct ?? null;
            acc[`tax_amount${i}`] = line.gst_amount ?? null;
            acc[`amount${i}`] = line.line_total ?? line.amount ?? null;
            acc[`hsn_code${i}`] = line.hsn_code || null;
            acc[`snapshot_json${i}`] = JSON.stringify(line);
            return acc;
          }, { shop_id: shopId, invoice_id: invoiceId, now: occurredAt.toISOString() }),
          transaction,
        }
      );
    } catch (err) {
      // Table may not exist until migration — createInvoice must still succeed if JSON path works;
      // after migration this is required. Fail hard when table exists.
      if (!/no such table|does not exist|no column named|has no column/i.test(String(err.message || err))) {
        throw err;
      }
    }

    if (input.customer_id) {
      const customer = await Customer.findByPk(input.customer_id, {
        ...withLock({}, transaction),
      });
      if (customer) {
        const total = (customer.total_purchases || 0) + totals.grand_total;
        await customer.update({ total_purchases: total }, { transaction });
      }
    }

    // REQUIRED: payment rows + advance apply + accrual journals (same TX — failures roll back invoice)
    const { Payment } = await import('../models/index.js');
    const { toPaise } = await import('../../../shared/domain/money.js');
    const {
      postSaleInvoiceJournal,
      postCogsJournal,
    } = await import('./ledgerService.js');

    let advanceAppliedTotal = 0;
    for (let i = 0; i < (paymentResult.payments || []).length; i += 1) {
      const p = paymentResult.payments[i];
      const amt = Number(p.amount) || 0;
      if (amt <= 0) continue;
      const payReq = requestId ? `${requestId}:pay:${i}` : null;
      if (payReq) {
        const existingPay = await Payment.findOne({ where: { request_id: payReq }, transaction });
        if (existingPay) continue;
      }
      await Payment.create({
        id: newId(),
        shop_id: shopId,
        invoice_id: invoiceId,
        customer_id: input.customer_id || null,
        mode: p.mode || 'cash',
        amount: amt,
        amount_paise: toPaise(amt),
        reference: p.reference || p.description || null,
        received_by: user?.id || null,
        request_id: payReq,
        status: 'posted',
        paid_at: occurredAt,
        created_at: occurredAt,
        business_date: businessDate,
      }, { transaction });

      const mode = String(p.mode || 'cash').toLowerCase();
      if (mode === 'advance') {
        if (!input.customer_id) {
          throw new BillingError('customer_id required for advance payment', { code: 'INVALID_PAYMENT' });
        }
        const { applyAdvancesToInvoice } = await import('./advanceService.js');
        const { bookingAdvanceIds } = await import('./quotationBookingService.js');
        const preferIds = linkedQuotation
          ? bookingAdvanceIds(linkedQuotation)
          : (Array.isArray(input.prefer_advance_ids) ? input.prefer_advance_ids : null);
        const applied = await applyAdvancesToInvoice({
          customerId: input.customer_id,
          invoiceId,
          amount: amt,
          requestId: requestId ? `${requestId}:adv:${i}` : null,
          shopId,
          userId: user?.id,
          preferAdvanceId: linkedQuotation?.advance_id || input.prefer_advance_id || null,
          preferAdvanceIds: preferIds,
          transaction,
        });
        if ((applied.applied || 0) + 0.001 < amt) {
          throw new BillingError(
            `Insufficient advance balance (needed ${formatINR(amt)}, applied ${formatINR(applied.applied || 0)})`,
            { code: 'INSUFFICIENT_ADVANCE' },
          );
        }
        advanceAppliedTotal += amt;
      }
    }

    // REQUIRED when old gold applied: receipt (journal is part of sale_invoice)
    if (totals.old_gold_value > 0) {
      const { OldGoldReceipt } = await import('../models/index.js');
      const og = input.old_gold || {};
      const year = new Date().getFullYear();
      const existingOg = await OldGoldReceipt.findOne({
        where: { invoice_id: invoiceId, metal: 'gold' },
        transaction,
      });
      if (!existingOg) {
        await OldGoldReceipt.create({
          id: newId(),
          shop_id: shopId,
          receipt_no: `OG-${year}-${invoiceId.slice(0, 8)}`,
          customer_id: input.customer_id || null,
          invoice_id: invoiceId,
          metal: 'gold',
          weight_g: Number(og.weight) || 0,
          purity: og.purity || null,
          rate: Number(og.rate) || 0,
          value: totals.old_gold_value,
          value_paise: toPaise(totals.old_gold_value),
          description: og.description || 'Old gold exchange',
          status: 'posted',
          created_by: user?.id || null,
          customer_name: input.customer_name || resolvedCustomer?.name || null,
          customer_phone: input.customer_mobile || resolvedCustomer?.mobile || null,
          invoice_no: invoiceNo,
          invoice_serial: invoiceSerial ?? null,
          business_date: businessDate,
        }, { transaction });
      }
    }

    if (Number(totals.old_silver_value) > 0) {
      const { OldGoldReceipt } = await import('../models/index.js');
      const os = input.old_silver || {};
      const year = new Date().getFullYear();
      const existingOs = await OldGoldReceipt.findOne({
        where: { invoice_id: invoiceId, metal: 'silver' },
        transaction,
      });
      if (!existingOs) {
        await OldGoldReceipt.create({
          id: newId(),
          shop_id: shopId,
          receipt_no: `OS-${year}-${invoiceId.slice(0, 8)}`,
          customer_id: input.customer_id || null,
          invoice_id: invoiceId,
          metal: 'silver',
          weight_g: Number(os.weight) || 0,
          purity: os.purity || null,
          rate: Number(os.rate) || 0,
          value: totals.old_silver_value,
          value_paise: toPaise(totals.old_silver_value),
          description: os.description || 'Old silver exchange',
          status: 'posted',
          created_by: user?.id || null,
          customer_name: input.customer_name || resolvedCustomer?.name || null,
          customer_phone: input.customer_mobile || resolvedCustomer?.mobile || null,
          invoice_no: invoiceNo,
          invoice_serial: invoiceSerial ?? null,
          business_date: businessDate,
        }, { transaction });
      }
    }

    // Apply scheme against bill:
    //   all installments paid → completed (collected / matured)
    //   used mid-scheme       → breaked (credit = paid-to-date only, no bonus)
    if (lockedScheme && appliedSchemeId) {
      const gramsInfo = computeSchemeRedeemableValue(lockedScheme, {
        goldRate: Number(rateMap['22K']) || Number(goldRate) || 0,
      });
      const gramsNote = gramsInfo.grams > 0 ? ` (${Number(gramsInfo.grams).toFixed(3)}g)` : '';
      const nextStatus = schemeStatusAfterRedemption(lockedScheme);
      const kindLabel = nextStatus === 'breaked' ? 'Breaked mid-scheme' : 'Collected at maturity';
      await lockedScheme.update({
        status: nextStatus,
        redeemed_at: nowIso(),
        notes: [
          lockedScheme.notes,
          `${kindLabel} on invoice ${invoiceNo} — credit ${formatINR(totals.scheme_credit || 0)}${gramsNote}`,
        ].filter(Boolean).join('\n'),
      }, { transaction });
    }

    // Link estimation → mark converted (POS loaded quote_no then checked out)
    if (linkedQuotation) {
      await linkedQuotation.update({
        status: 'converted',
        converted_invoice_id: invoiceId,
      }, { transaction });
    }

    // Open estimations (no advance) still pointing at sold ornaments → auto-expire
    if (!isTestSale) {
      const soldProductIds = lines
        .filter((l) => l?.product_id && !l.is_pure_metal && l.line_type !== 'pure_metal')
        .map((l) => l.product_id);
      if (soldProductIds.length) {
        const { expireOpenEstimationsForSoldProducts } = await import('./quotationBookingService.js');
        await expireOpenEstimationsForSoldProducts({
          shopId,
          productIds: soldProductIds,
          invoiceId,
          invoiceNo,
          excludeQuotationId: linkedQuotation?.id || null,
          transaction,
        });
      }
    }

    // Journal entries must land on the same day as the invoice itself — the
    // active business date, not today's real calendar date. Those two only
    // differ when the business day hasn't been closed yet (Daily Closing is
    // behind), which is exactly when this previously caused Day Book/P&L to
    // show the sale under a different date than the invoice's own business_date.
    const entryDate = businessDate;
    const balanceDue = paymentResult.status === 'partial'
      ? toMoneyNumber(paymentResult.balance)
      : 0;

    // Single accrual sale journal (Sales + Output GST + settlements) — failures are fatal
    await postSaleInvoiceJournal({
      shopId,
      invoiceId,
      taxableAmount: totals.after_discount,
      gstAmount: totals.gst_amount,
      roundOff: totals.round_off || 0,
      payments: paymentResult.payments || [],
      advanceApplied: advanceAppliedTotal,
      oldGoldValue: totals.old_gold_value || 0,
      oldSilverValue: totals.old_silver_value || 0,
      schemeCredit: totals.scheme_credit || 0,
      balanceDue,
      entryDate,
      requestId: requestId ? `${requestId}:jrnl-sale` : `sale-jrnl:${invoiceId}`,
      userId: user?.id,
      transaction,
    });

    // COGS: purchase_price preferred; metal estimate fallback when missing
    const { resolveUnitCogs } = await import('./ledgerService.js');
    let cogsTotal = 0;
    const cogsWarnings = [];
    for (const line of lines) {
      if (!line?.product_id) continue;
      const prod = await Product.findByPk(line.product_id, { transaction });
      const resolved = resolveUnitCogs(prod, line);
      if (resolved.total > 0) {
        cogsTotal += resolved.total;
        if (resolved.source === 'metal_estimate') {
          cogsWarnings.push({ product_id: line.product_id, source: 'metal_estimate' });
        }
      } else {
        cogsWarnings.push({ product_id: line.product_id, source: 'none' });
      }
    }
    if (cogsTotal > 0) {
      await postCogsJournal({
        shopId,
        invoiceId,
        cogsAmount: toMoneyNumber(cogsTotal),
        entryDate,
        requestId: requestId ? `${requestId}:jrnl-cogs` : `cogs-jrnl:${invoiceId}`,
        userId: user?.id,
        transaction,
      });
    }
    if (cogsWarnings.length) {
      console.warn(
        `[billing] COGS notes for invoice ${invoiceNo}:`,
        cogsWarnings.map((w) => `${w.product_id}:${w.source}`).join(', '),
      );
    }

    // LAN event log + operation ledger (shop-cluster)
    if (requestId) {
      await recordOperation({
        operationId: requestId,
        operationType: 'invoice.create',
        entityType: 'invoice',
        entityId: invoiceId,
        result: { invoice_id: invoiceId, invoice_no: invoiceNo },
        deviceId: branchConfig.device_id,
        userId: user?.id || null,
        transaction,
      });
    }
    const logEvent = await appendEventLog({
      eventType: 'INVOICE_CREATED',
      entityType: 'invoice',
      entityId: invoiceId,
      operationId: requestId,
      originDeviceId: branchConfig.device_id,
      userId: user?.id || null,
      critical: true,
      payload: {
        invoice: invoice.toJSON(),
        invoice_id: invoiceId,
        invoice_no: invoiceNo,
        grand_total: totals.grand_total,
        gold_rate: goldRate,
        item_count: lines.length,
        customer: input.customer_id
          ? (await Customer.findByPk(input.customer_id, { transaction }))?.toJSON()
          : null,
      },
      transaction,
    });
    // Audit is REQUIRED for financial invoice create
    await appendAuditEvent({
      eventType: 'INVOICE_CREATED',
      action: 'invoice.create',
      entityType: 'invoice',
      entityId: invoiceId,
      userId: user?.id || null,
      deviceId: branchConfig.device_id,
      newValue: { invoice_no: invoiceNo, grand_total: totals.grand_total },
      transaction,
    });

    return {
      invoice,
      idempotent: false,
      totals,
      lines,
      event_seq: logEvent ? Number(logEvent.seq) : null,
    };
  };

  try {
    // Idempotent retry before opening a new TX
    if (input.request_id || input.idempotency_key) {
      const opId = input.request_id || input.idempotency_key;
      const prior = await findOperation(opId);
      if (prior?.entity_id) {
        const existing = await Invoice.findByPk(prior.entity_id);
        if (existing) return { invoice: existing, idempotent: true, event_seq: null };
      }
    }

    let result;
    if (externalTx) result = await run(externalTx);
    else result = await sequelize.transaction(run);

    // Critical replica ACK after durable commit (host path)
    if (result?.event_seq && !result.idempotent && !externalTx) {
      const shopId = result.invoice?.shop_id;
      if (shopId) {
        const ack = await awaitCriticalReplicaAck(shopId, result.event_seq);
        result.replica_ack = ack;
        if (ack.warning) result.warning = ack.warning;
      }
    }
    return result;
  } catch (err) {
    if (err instanceof BillingError) throw err;
    const mapped = mapInventoryError(err);
    if (mapped) throw mapped;
    if (err?.name === 'SequelizeUniqueConstraintError') {
      // Idempotency recovery by request_id
      if (input.request_id || input.idempotency_key) {
        const existing = await Invoice.findOne({
          where: { request_id: input.request_id || input.idempotency_key },
        });
        if (existing) return { invoice: existing, idempotent: true };
      }
      // Recovery by invoice_no (sequence desync after failed factory reset or partial state)
      if (_allocatedInvoiceNo) {
        const existing = await Invoice.findOne({ where: { invoice_no: _allocatedInvoiceNo } });
        if (existing) return { invoice: existing, idempotent: true };
      }
      // Log which constraint fired to help diagnose
      const fields = err?.fields ? JSON.stringify(err.fields) : (err?.parent?.message || '');
      throw new BillingError(
        `Invoice could not be saved — a conflicting record already exists${fields ? ` (${fields})` : ''}. Please try again.`,
        { code: 'DUPLICATE', status: 409 },
      );
    }
    throw err;
  }
}

/**
 * Convert quotation using the same createInvoice pipeline (single TX).
 */
export async function convertQuotation(quotationId, options = {}) {
  const { user = null, payments = null, request_id = null, gold_rate = null } = options;

  return sequelize.transaction(async (transaction) => {
    const quotation = await Quotation.findByPk(quotationId, withLock({}, transaction));
    if (!quotation) {
      throw new BillingError('Quotation not found', { status: 404, code: 'INVALID_PRODUCT' });
    }
    if (quotation.status === 'converted') {
      throw new BillingError('Quotation already converted', {
        code: 'QUOTATION_ALREADY_CONVERTED',
        details: { converted_invoice_id: quotation.converted_invoice_id },
      });
    }
    if (!['draft', 'sent', 'accepted', 'booked'].includes(quotation.status)) {
      throw new BillingError(`Cannot convert quotation with status "${quotation.status}"`, {
        code: 'QUOTATION_ALREADY_CONVERTED',
      });
    }

    const items = (quotation.items || [])
      .filter((it) => it.product_id)
      .map((it) => ({
        product_id: it.product_id,
        // Tray: the estimation's own quantity/qty stays 1 (pricing is done on
        // weight sold, not piece count) — the real piece count for making/
        // stone multiplication is tray_pieces_sold, restored here the same
        // way POS's invoice payload does it (see POS.jsx checkout()).
        quantity: it.is_tray ? (it.tray_pieces_sold || 1) : (it.quantity || it.qty || 1),
        gross_weight: it.gross_weight,
        net_weight: it.net_weight,
        stone_weight: it.stone_weight,
        wastage_pct: it.wastage_pct,
        making_charges: it.making_charges,
        making_charge_type: it.making_charge_type,
        stone_charges: it.stone_charges || 0,
        purity: it.purity || it.purity_name,
        price_override: it.price_override ?? it.unit_price,
        // tray_weight_sold (not gross_weight/net_weight, which are only the
        // product's stale defaults on an estimation line) is what tells
        // buildLineSnapshots this is a tray sale and what weight to price.
        ...(it.is_tray ? { tray_weight_sold: it.tray_weight_sold } : {}),
      }));

    if (!items.length) {
      throw new BillingError('Quotation has no product lines', { code: 'EMPTY_INVOICE' });
    }

    const goldRate = await resolveGoldRate(gold_rate ?? quotation.gold_rate, transaction);

    // Match createInvoice rateMap so conversion payment preview === server totals.
    const rateSetting = await Setting.findOne({ where: { key: 'gold_rate' }, transaction });
    const sv = rateSetting?.value || {};
    const rateMap = { '24K': goldRate };
    const r22 = Number(options.gold_22k ?? quotation.gold_22k ?? sv.gold_22k) || null;
    const r18 = Number(options.gold_18k ?? quotation.gold_18k ?? sv.gold_18k) || null;
    const rSilver = Number(options.silver_rate ?? sv.silver) || null;
    const rPureSilver = Number(options.pure_silver_rate ?? sv.pure_silver) || null;
    const rPlatinum = Number(options.platinum_rate ?? quotation.platinum_rate ?? sv.platinum) || null;
    if (r22 != null) rateMap['22K'] = r22;
    if (r18 != null) rateMap['18K'] = r18;
    if (rSilver != null) rateMap['Silver'] = rSilver;
    if (rPureSilver != null) rateMap['PureSilver'] = rPureSilver;
    if (rPlatinum != null) rateMap.Platinum = rPlatinum;

    const productIds = [...new Set(items.map((i) => i.product_id))].sort();
    for (const id of productIds) {
      await Product.findByPk(id, withLock({}, transaction));
    }

    const shopId = (await Product.findByPk(productIds[0], { transaction })).shop_id;
    const lineSnapshots = await buildLineSnapshots(items, { shopId, goldRate, rateMap, transaction });
    const totals = calcInvoiceTotals({
      lineTotals: lineSnapshots.map((l) => l.line_total),
      discount: quotation.discount || 0,
      discountType: quotation.discount_type || 'flat',
      gstPct: quotation.gst_pct != null ? quotation.gst_pct : DEFAULT_GST_PCT,
      oldGoldValue: 0,
    });

    const resolvedPayments = payments && payments.length
      ? payments
      : quotation.status === 'booked' && Number(quotation.advance_paid) > 0
        ? [
            {
              mode: 'advance',
              amount: Number(quotation.advance_paid),
              description: `Booking ${quotation.quote_no}`,
            },
            {
              mode: 'cash',
              amount: Math.max(0, totals.grand_total - Number(quotation.advance_paid)),
              description: 'Balance',
            },
          ].filter((p) => Number(p.amount) > 0.009)
        : [{ mode: 'cash', amount: totals.grand_total, description: 'Quotation conversion' }];

    const { bookingAdvanceIds } = await import('./quotationBookingService.js');
    const result = await createInvoice({
      request_id: request_id || `quote-convert-${quotation.id}`,
      customer_id: quotation.customer_id,
      customer_name: quotation.customer_name,
      customer_mobile: quotation.customer_mobile,
      items,
      discount: quotation.discount || 0,
      discount_type: quotation.discount_type || 'flat',
      gst_pct: quotation.gst_pct != null ? quotation.gst_pct : DEFAULT_GST_PCT,
      gold_rate: goldRate,
      gold_22k: r22,
      gold_18k: r18,
      silver_rate: rSilver,
      pure_silver_rate: rPureSilver,
      platinum_rate: rPlatinum,
      notes: quotation.notes,
      salesperson_id: quotation.salesperson_id || null,
      payments: resolvedPayments,
      quotation_id: quotation.id,
      prefer_advance_id: quotation.advance_id || null,
      prefer_advance_ids: bookingAdvanceIds(quotation),
    }, { user, transaction });

    // createInvoice marks quotation converted when quotation_id is set
    if (quotation.status !== 'converted') {
      await quotation.reload({ transaction });
    }

    return result;
  });
}

/**
 * Cancel/void an invoice: preserve row + number, restore stock, SALE_RETURN movements.
 * Invoice numbers are never reused.
 */
export async function cancelInvoice(invoiceId, { user = null, reason = null, refund = [] } = {}) {
  return sequelize.transaction(async (transaction) => {
    const invoice = await Invoice.findByPk(invoiceId, withLock({}, transaction));
    if (!invoice) {
      throw new BillingError('Invoice not found', { status: 404, code: 'NOT_FOUND' });
    }
    if (invoice.status === 'cancelled' || invoice.cancelled_at) {
      throw new BillingError('Invoice already cancelled', { code: 'ALREADY_CANCELLED', status: 409 });
    }
    // Money actually collected from the customer — this is what must be
    // physically handed back before the cancellation is allowed to proceed.
    // TEST / PRE_ACCOUNTS bills are samples — cancel must not require a live
    // refund breakdown or post cash/UPI refunds onto the books.
    const collectedAmount = isPreAccountsRecord(invoice)
      ? 0
      : toMoneyNumber(Math.max(0, Number(invoice.grand_total) - Number(invoice.balance_due)));
    // Whatever was settled in old gold / old silver goes back as that metal
    // (the receipts are marked returned below) — never as cash. Only the rest
    // needs a money refund breakdown from the cashier. Server-authoritative:
    // any old-metal rows the client sends are ignored.
    const { Payment: PaymentModel } = await import('../models/index.js');
    const priorPayRows = await PaymentModel.findAll({ where: { invoice_id: invoice.id }, transaction });
    const oldMetalPaid = oldMetalPaidOnInvoice(invoice, priorPayRows);
    let metalLeft = collectedAmount;
    const oldMetalRefunds = [];
    for (const mode of OLD_METAL_REFUND_MODES) {
      const amt = toMoneyNumber(Math.min(oldMetalPaid[mode] || 0, metalLeft));
      if (amt > 0) {
        oldMetalRefunds.push({ mode, amount: amt });
        metalLeft = toMoneyNumber(metalLeft - amt);
      }
    }
    const moneyRefundable = metalLeft;
    const moneyRefundInput = (Array.isArray(refund) ? refund : []).filter(
      (r) => !OLD_METAL_REFUND_MODES.includes(String(r?.mode || '').toLowerCase().trim()),
    );
    const refundEntries = [
      ...normalizeRefundBreakdown(moneyRefundInput, moneyRefundable),
      ...oldMetalRefunds,
    ];
    if (invoice.status === 'returned' || invoice.status === 'partially_returned') {
      throw new BillingError('Stock already restored via return — cannot cancel again', { code: 'ALREADY_RETURNED', status: 409 });
    }

    // Old gold exchanged on this invoice may have already left the shop via a
    // disposal sale to a wholesaler/refiner — if so, it physically can't be
    // handed back to the customer, so the invoice can't be cancelled as-is.
    const { OldGoldReceipt } = await import('../models/index.js');
    const ogReceipts = await OldGoldReceipt.findAll({
      where: { invoice_id: invoice.id },
      transaction,
    });
    const disposed = ogReceipts.find((r) => r.old_gold_sale_id);
    if (disposed) {
      const metal = String(disposed.metal || 'gold').toLowerCase() === 'silver' ? 'silver' : 'gold';
      throw new BillingError(
        metal === 'silver'
          ? 'Cannot cancel: the old silver exchanged on this invoice has already been sold/disposed'
          : 'Cannot cancel: the old gold exchanged on this invoice has already been sold/disposed',
        { code: metal === 'silver' ? 'OLD_SILVER_ALREADY_DISPOSED' : 'OLD_GOLD_ALREADY_DISPOSED', status: 409 },
      );
    }

    const practiceInvoice = isPreAccountsRecord(invoice);
    const shopId = invoice.shop_id;
    // SQLite / odd drivers may return items as a JSON string — never skip restore
    const items = parseJsonField(invoice.items, []);
    if (!Array.isArray(items) || items.length === 0) {
      throw new BillingError(
        'Invoice has no line items to reverse — stock cannot be restored safely',
        { code: 'NO_ITEMS', status: 409 },
      );
    }
    const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))].sort();
    for (const id of productIds) {
      await Product.findByPk(id, withLock({}, transaction));
    }

    const restoreLiveStock = !practiceInvoice;
    if (restoreLiveStock) {
      for (const line of items) {
      if (line?.pure_product_id) {
        const restoreAmt = line.pure_stock_decrement != null
          ? Number(line.pure_stock_decrement)
          : (line.pure_form === 'pure'
            ? Number(line.net_weight || line.gross_weight || 0)
            : parseFloat(line.quantity) || 1);
        try {
          await increasePureProductStock({
            pureProductId: line.pure_product_id,
            quantity: restoreAmt,
            shopId,
            transaction,
          });
        } catch (err) {
          if (err instanceof PureProductError) {
            throw new BillingError(err.message, { status: err.status || 400, code: err.code });
          }
          throw err;
        }
        continue;
      }
      if (!line?.product_id) continue;
      const qty = parseFloat(line.quantity) || 1;
      try {
        await applyReturnLine({
          shopId,
          productId: line.product_id,
          quantity: qty,
          referenceType: 'invoice_cancel',
          referenceId: invoice.id,
          createdBy: user?.id || null,
          transaction,
        });
      } catch (err) {
        const mapped = mapInventoryError(err);
        if (mapped) throw mapped;
        throw err;
      }

      // Mirror sale: restore tray weight when this line sold from a tray
      const trayWt = toWeightNumber(line.tray_weight_sold);
      if (trayWt > 0) {
        await atomicUpdate(
          `UPDATE products
           SET tray_total_weight = ROUND(ROUND(COALESCE(tray_total_weight, 0), 3) + :weight, 3),
               gross_weight = ROUND(ROUND(COALESCE(tray_total_weight, 0), 3) + :weight, 3),
               net_weight = ROUND(ROUND(COALESCE(tray_total_weight, 0), 3) + :weight, 3),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = :id AND shop_id = :shopId`,
          { id: line.product_id, weight: trayWt, shopId },
          transaction,
        );
      }
    }
    }

    // Cancellation stores only the shop's Transaction date — no time-of-day —
    // rather than the real wall clock, so a bill cancelled while Daily
    // Closing hasn't caught up to today still records (and everywhere shows)
    // the transaction date it was cancelled on, not real "now".
    const entryDate = (await getActiveBillingDate({ shopId, transaction })).date;

    await invoice.update({
      status: 'cancelled',
      cancelled_at: dateOnlyStamp(entryDate),
      cancelled_by: user?.id || null,
      cancel_reason: reason || 'Cancelled',
    }, { transaction });

    // The sale_invoice journal reversal below already reverses the GL's Dr
    // 1300 Old Gold Stock line automatically — this just keeps the receipt's
    // own status (and therefore stock-valuation/report queries) consistent
    // with "the gold went back to the customer".
    for (const rec of ogReceipts) {
      await rec.update({ status: 'returned' }, { transaction });
    }

    // Reverse scheme redemption. Early-break (breaked) goes back to active;
    // a fully-paid collection (completed) goes back to matured.
    if (invoice.scheme_id) {
      const scheme = await Scheme.findByPk(invoice.scheme_id, withLock({}, transaction));
      if (scheme && (scheme.status === 'completed' || scheme.status === 'breaked')) {
        const restoredStatus = isSchemeFullyPaid({
          ...((scheme.toJSON && scheme.toJSON()) || scheme),
          status: 'active',
        }) ? 'matured' : 'active';
        await scheme.update({
          status: restoredStatus,
          redeemed_at: null,
          notes: [
            scheme.notes,
            `Redemption reversed — invoice ${invoice.invoice_no} was cancelled on ${new Date().toISOString().slice(0, 10)}`,
          ].filter(Boolean).join('\n'),
        }, { transaction });
      }
    }

    // Restore advances in domain, then reverse all invoice journals (append-only)
    const { Payment, CustomerAdvanceApplication, CustomerAdvance } = await import('../models/index.js');
    const { reverseJournalsForSource } = await import('./ledgerService.js');
    const payRows = await Payment.findAll({ where: { invoice_id: invoice.id }, transaction });
    const hasAdvance = payRows.some((p) => String(p.mode || '').toLowerCase() === 'advance')
      || (Array.isArray(invoice.payments) && invoice.payments.some((p) => String(p.mode || '').toLowerCase() === 'advance'));

    if (hasAdvance) {
      const apps = await CustomerAdvanceApplication.findAll({
        where: { invoice_id: invoice.id },
        transaction,
      });
      for (const app of apps) {
        const adv = await CustomerAdvance.findByPk(app.advance_id, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (adv) {
          const rem = Number(adv.remaining_amount) + Number(app.amount);
          const used = Math.max(0, Number(adv.used_amount) - Number(app.amount));
          await adv.update({
            remaining_amount: rem,
            used_amount: used,
            status: rem > 0.001 ? 'open' : adv.status,
          }, { transaction });
        }
      }
    }

    // Record the refund as first-class Payment rows (negative amount) so it
    // flows into Daily Closing's cash/UPI/etc. totals, the ERP Statement, and
    // the customer's party ledger exactly like a normal payment would.
    // TEST bills never touch live cashbooks or party totals.
    if (!practiceInvoice) {
      for (const r of refundEntries) {
        await Payment.create({
          id: newId(),
          shop_id: shopId,
          invoice_id: invoice.id,
          customer_id: invoice.customer_id,
          mode: r.mode,
          amount: -r.amount,
          status: 'posted',
          paid_at: stampOnTransactionDate(entryDate),
          business_date: entryDate,
          meta: {
            kind: 'invoice_cancel_refund',
            invoice_no: invoice.invoice_no,
            ...(OLD_METAL_REFUND_MODES.includes(r.mode) ? { metal_returned: true } : {}),
          },
        }, { transaction });
      }

      if (invoice.customer_id) {
        const customer = await Customer.findByPk(invoice.customer_id, { transaction });
        if (customer) {
          await customer.update({
            total_purchases: toMoneyNumber(Math.max(0, Number(customer.total_purchases || 0) - Number(invoice.grand_total))),
          }, { transaction });
        }
      }
    }

    await reverseJournalsForSource({
      shopId,
      sourceId: invoice.id,
      sourceTypes: [
        'sale_invoice',
        'sale_cogs',
        'credit_payment',
        'invoice_payment',
        'advance_application',
        'old_gold_application',
        'credit_sale',
      ],
      requestIdPrefix: `cancel-rev:${invoice.id}`,
      userId: user?.id,
      transaction,
      entryDate,
    });

    await invoice.reload({ transaction });
    const opId = `void:${invoice.id}:${invoice.cancelled_at?.toISOString?.() || Date.now()}`;
    await recordOperation({
      operationId: opId,
      operationType: 'invoice.cancel',
      entityType: 'invoice',
      entityId: invoice.id,
      result: { invoice_id: invoice.id, status: 'cancelled' },
      deviceId: branchConfig.device_id,
      userId: user?.id || null,
      transaction,
    });
    await appendEventLog({
      eventType: 'INVOICE_VOIDED',
      entityType: 'invoice',
      entityId: invoice.id,
      operationId: opId,
      originDeviceId: branchConfig.device_id,
      userId: user?.id || null,
      critical: true,
      payload: {
        invoice: invoice.toJSON(),
        reason: reason || 'Cancelled',
      },
      transaction,
    });
    await appendAuditEvent({
      eventType: 'INVOICE_VOIDED',
      action: 'invoice.cancel',
      entityType: 'invoice',
      entityId: invoice.id,
      userId: user?.id || null,
      deviceId: branchConfig.device_id,
      reason: reason || 'Cancelled',
      transaction,
    });

    return { invoice };
  });
}

/**
 * Compensating stock correction when purchase finished_goods qty changes.
 * oldItems/newItems: [{ product_id, quantity }]
 */
// A unique-tag purchase line carries every piece it created in product_ids[]
// (product_id only ever held the first one) — always expand the full array,
// or every piece after the first was silently orphaned on reversal/edit.
function collectUniqueProductIds(item) {
  if (Array.isArray(item.product_ids) && item.product_ids.length) return item.product_ids;
  return [];
}

// Remove one unique-tag piece this purchase created. Only safe while it's
// still untouched (never sold/reserved/displayed/damaged) — otherwise the
// purchase can't be cleanly un-done and the caller must be told why.
async function removeUniquePurchaseProduct({ shopId, productId, purchaseId, referenceType, createdBy, transaction }) {
  const product = await Product.findByPk(productId, { transaction });
  if (!product) return; // already gone — nothing to reverse
  if (product.status !== 'available') {
    throw new BillingError(
      `Cannot reverse this purchase — item "${product.name}" (barcode: ${product.barcode || 'N/A'}) is no longer available (status: ${product.status}). It must be returned/un-sold first.`,
      { status: 409, code: 'ITEM_NOT_REVERSIBLE' },
    );
  }
  const { recordMovement } = await import('./inventoryService.js');
  await recordMovement({
    shopId: product.shop_id || shopId,
    product,
    quantity: -1,
    movementType: MOVEMENT_TYPES.ADJUSTMENT_REMOVE,
    referenceType,
    referenceId: purchaseId,
    qtyBefore: 1,
    qtyAfter: 0,
    createdBy,
    notes: `Purchase ${purchaseId} cancelled/reversed`,
    transaction,
  });
  await product.destroy({ transaction });
}

export async function reconcilePurchaseStock({
  shopId,
  purchaseId,
  oldItems = [],
  newItems = [],
  createdBy = null,
  transaction,
} = {}) {
  if (!transaction) throw new BillingError('reconcilePurchaseStock requires transaction', { status: 500 });

  // Quantity-mode lines (a single product_id backed by a stock_qty counter).
  const oldMap = new Map();
  for (const it of oldItems) {
    if (!it.product_id || collectUniqueProductIds(it).length) continue;
    oldMap.set(it.product_id, (oldMap.get(it.product_id) || 0) + (parseFloat(it.quantity) || 1));
  }
  const newMap = new Map();
  for (const it of newItems) {
    if (!it.product_id || collectUniqueProductIds(it).length) continue;
    newMap.set(it.product_id, (newMap.get(it.product_id) || 0) + (parseFloat(it.quantity) || 1));
  }

  const productIds = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort();
  for (const productId of productIds) {
    const before = oldMap.get(productId) || 0;
    const after = newMap.get(productId) || 0;
    const delta = after - before;
    if (Math.abs(delta) < 1e-9) continue;

    if (delta > 0) {
      await increaseStock({
        shopId,
        productId,
        quantity: delta,
        movementType: MOVEMENT_TYPES.PURCHASE,
        referenceType: 'purchase_correction',
        referenceId: purchaseId,
        createdBy,
        notes: `Purchase ${purchaseId} qty correction +${delta}`,
        transaction,
      });
    } else {
      await decreaseStock({
        shopId,
        productId,
        quantity: Math.abs(delta),
        movementType: MOVEMENT_TYPES.ADJUSTMENT_REMOVE,
        referenceType: 'purchase_correction',
        referenceId: purchaseId,
        createdBy,
        notes: `Purchase ${purchaseId} qty correction ${delta}`,
        transaction,
      });
    }
  }

  // Unique-tag lines — each id is a distinct physical piece (0 or 1), not a
  // counter. A piece dropped from the new item list is being un-received;
  // this endpoint has no way to mint brand-new tagged pieces (that requires
  // barcode allocation, done only at purchase creation), so a piece that's
  // newly added here is rejected rather than silently ignored.
  const oldUniqueIds = new Set(oldItems.flatMap(collectUniqueProductIds));
  const newUniqueIds = new Set(newItems.flatMap(collectUniqueProductIds));
  const added = [...newUniqueIds].filter((id) => !oldUniqueIds.has(id));
  if (added.length) {
    throw new BillingError(
      'Adding new tagged pieces to an existing purchase is not supported — create a new purchase for them instead.',
      { status: 400, code: 'UNIQUE_ADD_UNSUPPORTED' },
    );
  }
  const removed = [...oldUniqueIds].filter((id) => !newUniqueIds.has(id));
  for (const productId of removed) {
    await removeUniquePurchaseProduct({
      shopId, productId, purchaseId, referenceType: 'purchase_correction', createdBy, transaction,
    });
  }
}

/**
 * Reverse finished_goods purchase stock (cancellation/void).
 */
export async function reversePurchaseStock({
  shopId,
  purchaseId,
  items = [],
  createdBy = null,
  transaction,
} = {}) {
  if (!transaction) throw new BillingError('reversePurchaseStock requires transaction', { status: 500 });

  const quantityModeQty = new Map();
  const uniqueProductIds = new Set();
  for (const item of items) {
    const uniqueIds = collectUniqueProductIds(item);
    if (uniqueIds.length) {
      uniqueIds.forEach((id) => uniqueProductIds.add(id));
      continue;
    }
    if (!item.product_id) continue;
    const qty = parseFloat(item.quantity) || 1;
    quantityModeQty.set(item.product_id, (quantityModeQty.get(item.product_id) || 0) + qty);
  }

  for (const productId of uniqueProductIds) {
    await removeUniquePurchaseProduct({
      shopId, productId, purchaseId, referenceType: 'purchase_cancel', createdBy, transaction,
    });
  }

  for (const [productId, qty] of quantityModeQty.entries()) {
    if (qty <= 0) continue;
    await decreaseStock({
      shopId,
      productId,
      quantity: qty,
      movementType: MOVEMENT_TYPES.ADJUSTMENT_REMOVE,
      referenceType: 'purchase_cancel',
      referenceId: purchaseId,
      createdBy,
      notes: `Purchase ${purchaseId} cancelled/reversed`,
      transaction,
    });
  }
}
