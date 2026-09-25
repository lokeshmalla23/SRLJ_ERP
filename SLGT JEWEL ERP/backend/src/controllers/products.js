import { Op, where as sqWhere, fn, col, literal, ValidationError as SequelizeValidationError, UniqueConstraintError } from 'sequelize';
import sequelize, { likeOp } from '../db.js';
import { Product, Category, CatalogItem, InventoryMovement, ShopCounter } from '../models/index.js';
import { newId, parseMultiParam } from '../utils.js';
import {
  stripInventoryFieldsFromProductUpdate,
  recordMovement,
  InventoryError,
  maybeLowStockNotify,
  setDisplayStatus,
  recordProductStatusChange,
} from '../services/inventoryService.js';
import { MOVEMENT_TYPES, INVENTORY_MODES, UNIQUE_ITEM_STATUSES, NOT_IN_STOCK_STATUSES, POS_HELD_STATUSES, productStatusLabel } from '../constants/inventory.js';
import branchConfig from '../config/branchConfig.js';
import { allocateBarcodeNumber, peekNextBarcodeNumber } from '../services/barcodeSequence.js';
import {
  peekNextProductCode,
  isPlaceholderProductCode,
} from '../services/productCodeSequence.js';
import { getDefaultShopId } from '../services/defaultShop.js';
import { getProfitLossMode } from '../services/profitLossMode.js';
import { trayCostPerGram } from '../services/productCost.js';
import { broadcast } from '../services/wsServer.js';
import { toWeightNumber } from '../utils/weight.js';

// Physical weight fields (gross/net/stone/tray/piece) can never be negative —
// toWeightNumber() itself preserves a sign (it's shared with contexts where a
// signed delta is meaningful), so this is the one place product weights are
// floored at 0 before they're ever stored or read back.
function nonNegativeWeight(value) {
  const n = toWeightNumber(value);
  return n < 0 ? 0 : n;
}

/** Plain shop serial used on jewellery tags — e.g. "10001". No RNG-/DIA- prefixes. */
function isSerialTagNumber(value) {
  return /^\d{1,9}$/.test(String(value || '').trim());
}

/** Strip LIKE wildcards so cashier text cannot broaden the POS lookup. */
function likeSafe(value) {
  return String(value || '').replace(/[%_\\]/g, '');
}

function seqValidationDetail(err) {
  if (!(err instanceof SequelizeValidationError) || !err.errors?.length) return null;
  return err.errors
    .map((e) => `${e.path || e.field || 'field'}: ${e.message}`)
    .join('; ');
}

// Empty-string form fields must never reach a FLOAT column — Postgres rejects
// `''` for double precision ("invalid input syntax for type double precision").
const toNullableFloat = (v) => (v === '' || v == null ? null : Number(v));

/** SQLite stores JSONB as TEXT — ensure arrays/objects for the API. */
function parseJsonField(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function normalizeProductJson(p) {
  const row = p && typeof p === 'object' ? p : {};
  return {
    ...row,
    gross_weight: row.gross_weight ?? row.grossWeight,
    net_weight: row.net_weight ?? row.netWeight,
    stone_weight: row.stone_weight ?? row.stoneWeight,
    tray_total_weight: row.tray_total_weight ?? row.trayTotalWeight,
    attribute_values: parseJsonField(row.attribute_values ?? row.attributeValues, {}),
    stone_details: parseJsonField(row.stone_details ?? row.stoneDetails, []),
    collection_ids: parseJsonField(row.collection_ids ?? row.collectionIds, []),
    tag_ids: parseJsonField(row.tag_ids ?? row.tagIds, []),
    stone_type_ids: parseJsonField(row.stone_type_ids ?? row.stoneTypeIds, []),
  };
}

const BARCODE_EXISTS_MESSAGE = (tag) =>
  `This product has already been added. Tag ${tag} cannot be added.`;

const BARCODE_LOCKED_MESSAGE = 'Barcode numbers are auto-generated and cannot be edited.';

/** Shop-scoped tag lookup (barcode or code), including deleted items that still occupy the number. */
async function findProductByTag({ shopId, tag, excludeId = null, transaction }) {
  const value = String(tag || '').trim();
  if (!value || !shopId) return null;
  const where = {
    shop_id: shopId,
    [Op.or]: [{ barcode: value }, { code: value }],
  };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  return Product.findOne({ where, transaction });
}

function barcodeConflictResponse(res, tag) {
  return res.status(409).json({
    detail: BARCODE_EXISTS_MESSAGE(tag),
    code: 'BARCODE_EXISTS',
    barcode: String(tag || ''),
  });
}

function isUniqueTagConstraint(err) {
  const parent = err?.parent || err?.original || err;
  const fields = err?.fields || {};
  const names = Object.keys(fields).map((k) => String(k).toLowerCase());
  if (names.some((n) => n.includes('barcode') || n === 'code')) return true;
  const msg = `${err?.message || ''} ${parent?.message || ''}`.toLowerCase();
  const tagged = msg.includes('barcode') || msg.includes('products_barcode') || /\bcode\b/.test(msg);
  if (err instanceof UniqueConstraintError || err?.name === 'SequelizeUniqueConstraintError') {
    return tagged || names.length === 0;
  }
  const sqlCode = String(parent?.code || '');
  return (sqlCode === 'SQLITE_CONSTRAINT' || sqlCode === '23505') && tagged;
}

/** Only columns that belong on products — strips enrich* names and inventory locks. */
const PRODUCT_EDITABLE_FIELDS = [
  'name', 'category_id', 'subcategory_id',
  'collection_ids', 'tag_ids', 'metal_type_id', 'purity_id', 'stone_type_ids',
  'unit_id', 'attribute_values', 'gross_weight', 'net_weight', 'stone_weight',
  'making_charges', 'making_charge_type', 'wastage_pct', 'hallmark', 'hsn_code',
  'gst_slab', 'purchase_price', 'selling_price', 'low_stock_threshold',
  'description', 'design_no', 'size', 'showcase_location', 'certification',
  'vendor_id', 'stone_details', 'tray_total_weight', 'piece_weight', 'counter_id',
  'purchase_date', 'purchase_cost_per_gram', 'cal_code',
];

function applyPositiveTrayWeight(fields = {}) {
  const tray = Number(fields.tray_total_weight);
  if (!(tray > 0)) return fields;
  const w = nonNegativeWeight(fields.tray_total_weight);
  return { ...fields, gross_weight: w, net_weight: w };
}

function pickProductUpdates(body = {}) {
  const out = {};
  for (const key of PRODUCT_EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) {
      out[key] = body[key];
    }
  }
  for (const key of ['gross_weight', 'net_weight', 'stone_weight', 'tray_total_weight', 'piece_weight']) {
    if (out[key] != null && out[key] !== '') out[key] = nonNegativeWeight(out[key]);
  }
  return applyPositiveTrayWeight(out);
}

function roundProductWeights(p) {
  const out = { ...p };
  for (const key of ['gross_weight', 'net_weight', 'stone_weight', 'tray_total_weight', 'piece_weight']) {
    if (out[key] == null || out[key] === '') continue;
    out[key] = nonNegativeWeight(out[key]);
  }
  return out;
}

export const enrichProduct = async (product) => {
  const p = roundProductWeights(normalizeProductJson(product.toJSON ? product.toJSON() : product));

  const [category, subcategory, metalType, purity, counter, unit] = await Promise.all([
    p.category_id ? Category.findByPk(p.category_id) : null,
    p.subcategory_id ? Category.findByPk(p.subcategory_id) : null,
    p.metal_type_id ? CatalogItem.findByPk(p.metal_type_id) : null,
    p.purity_id ? CatalogItem.findByPk(p.purity_id) : null,
    p.counter_id ? ShopCounter.findByPk(p.counter_id) : null,
    p.unit_id ? CatalogItem.findByPk(p.unit_id) : null,
  ]);

  return {
    ...p,
    category_name: category?.name || null,
    subcategory_name: subcategory?.name || null,
    metal_name: metalType?.name || null,
    purity_name: purity?.name || null,
    purity_code: purity?.code || null,
    counter_name: counter?.name || null,
    unit_code: unit?.code || null,
    unit_name: unit?.name || null,
  };
};

export const enrichProducts = async (products) => {
  const list = products.map((p) => roundProductWeights(normalizeProductJson(p.toJSON ? p.toJSON() : p)));

  const categoryIds = new Set();
  const catalogIds = new Set();
  const counterIds = new Set();
  for (const p of list) {
    if (p.category_id) categoryIds.add(p.category_id);
    if (p.subcategory_id) categoryIds.add(p.subcategory_id);
    if (p.metal_type_id) catalogIds.add(p.metal_type_id);
    if (p.purity_id) catalogIds.add(p.purity_id);
    if (p.counter_id) counterIds.add(p.counter_id);
    if (p.unit_id) catalogIds.add(p.unit_id);
  }

  const [categories, catalogItems, counters] = await Promise.all([
    categoryIds.size ? Category.findAll({ where: { id: { [Op.in]: [...categoryIds] } } }) : [],
    catalogIds.size ? CatalogItem.findAll({ where: { id: { [Op.in]: [...catalogIds] } } }) : [],
    counterIds.size ? ShopCounter.findAll({ where: { id: { [Op.in]: [...counterIds] } } }) : [],
  ]);
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const catalogNames = new Map(catalogItems.map((c) => [c.id, c.name]));
  const catalogCodes = new Map(catalogItems.map((c) => [c.id, c.code]));
  const counterNames = new Map(counters.map((c) => [c.id, c.name]));

  return list.map((p) => ({
    ...p,
    category_name: categoryNames.get(p.category_id) || null,
    subcategory_name: categoryNames.get(p.subcategory_id) || null,
    metal_name: catalogNames.get(p.metal_type_id) || null,
    purity_name: catalogNames.get(p.purity_id) || null,
    purity_code: catalogCodes.get(p.purity_id) || null,
    counter_name: counterNames.get(p.counter_id) || null,
    unit_code: catalogCodes.get(p.unit_id) || null,
    unit_name: catalogNames.get(p.unit_id) || null,
    status_label: productStatusLabel(p.status),
  }));
};

export const listProducts = async (req, res, next) => {
  try {
    const {
      q, category_id, subcategory_id, metal_type_id, purity_id, vendor_id, counter_id,
      collection_id, low_stock, status, sellable, available_only,
    } = req.query;
    const where = { deleted_at: null };

    if (q) {
      where[Op.or] = [
        { name: { [likeOp]: `%${q}%` } },
        { code: { [likeOp]: `%${q}%` } },
        { barcode: { [likeOp]: `%${q}%` } },
      ];
    }
    // Multi-select filters send a comma-separated list of ids — a single id
    // still works the same way ({ [Op.in]: [x] } behaves like x === value).
    const categoryIds = parseMultiParam(category_id);
    if (categoryIds) where.category_id = { [Op.in]: categoryIds };
    const subcategoryIds = parseMultiParam(subcategory_id);
    if (subcategoryIds) where.subcategory_id = { [Op.in]: subcategoryIds };
    const metalTypeIds = parseMultiParam(metal_type_id);
    if (metalTypeIds) where.metal_type_id = { [Op.in]: metalTypeIds };
    const purityIds = parseMultiParam(purity_id);
    if (purityIds) where.purity_id = { [Op.in]: purityIds };
    const vendorIds = parseMultiParam(vendor_id);
    if (vendorIds) where.vendor_id = { [Op.in]: vendorIds };
    const counterIds = parseMultiParam(counter_id);
    if (counterIds) where.counter_id = { [Op.in]: counterIds };
    const statuses = parseMultiParam(status);
    if (statuses) where.status = { [Op.in]: statuses };

    // Estimation / POS pickers: only tags that can actually be sold or estimated
    if (sellable === '1' || sellable === 'true' || available_only === '1' || available_only === 'true') {
      where.status = { [Op.notIn]: [...NOT_IN_STOCK_STATUSES] };
      where[Op.and] = [
        ...(Array.isArray(where[Op.and]) ? where[Op.and] : []),
        {
          [Op.or]: [
            // Unique tags: in stock and not sold/reserved/damaged
            {
              inventory_mode: INVENTORY_MODES.UNIQUE_TAG,
              status: { [Op.in]: [UNIQUE_ITEM_STATUSES.AVAILABLE, UNIQUE_ITEM_STATUSES.ON_DISPLAY] },
            },
            // Quantity / tray: positive stock
            {
              inventory_mode: { [Op.ne]: INVENTORY_MODES.UNIQUE_TAG },
              stock_qty: { [Op.gt]: 0 },
              status: { [Op.notIn]: [...NOT_IN_STOCK_STATUSES, ...POS_HELD_STATUSES] },
            },
          ],
        },
      ];
    }

    const products = await Product.findAll({ where, order: [['created_at', 'DESC']] });

    let result = products;

    if (collection_id) {
      result = result.filter((p) => parseJsonField(p.collection_ids, []).includes(collection_id));
    }
    if (low_stock === 'true') {
      // Sub-category threshold: keep products whose sub-category total is at/below threshold
      const subs = await Category.findAll({
        where: { deleted_at: null, parent_id: { [Op.ne]: null } },
        attributes: ['id', 'low_stock_threshold'],
      });
      const thresholds = new Map(
        subs
          .filter((s) => s.low_stock_threshold != null && Number(s.low_stock_threshold) > 0)
          .map((s) => [s.id, Number(s.low_stock_threshold)]),
      );
      const totals = new Map();
      for (const p of result) {
        if (!p.subcategory_id || !thresholds.has(p.subcategory_id)) continue;
        totals.set(p.subcategory_id, (totals.get(p.subcategory_id) || 0) + (parseFloat(p.stock_qty) || 0));
      }
      result = result.filter((p) => {
        const t = thresholds.get(p.subcategory_id);
        if (t == null) return false;
        return (totals.get(p.subcategory_id) || 0) <= t;
      });
    }

    const enriched = await enrichProducts(result);
    return res.json(enriched);
  } catch (err) {
    next(err);
  }
};

/**
 * POS autocomplete: barcode/tag prefix (existing) plus product name contains.
 * Small, bounded result set. Excludes soft-deleted, discontinued, sold and
 * out-of-stock items so only sellable products can be suggested.
 */
export const searchProductsByBarcode = async (req, res, next) => {
  try {
    const raw = String(req.query.q ?? req.query.barcode ?? '').trim();
    const needle = likeSafe(raw.toLowerCase());
    if (!needle) return res.json([]);

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 20);
    const barcodePrefix = `${needle}%`;
    const nameContains = `%${needle}%`;

    const products = await Product.findAll({
      where: {
        [Op.and]: [
          {
            [Op.or]: [
              // Case-insensitive prefix match via lower(barcode) — matches the
              // functional index added in 20260729100002-barcode-search-index.js.
              sqWhere(fn('lower', col('barcode')), { [Op.like]: barcodePrefix }),
              sqWhere(fn('lower', col('code')), { [Op.like]: barcodePrefix }),
              sqWhere(fn('lower', col('name')), { [Op.like]: nameContains }),
            ],
          },
          { deleted_at: null },
          { status: { [Op.notIn]: [...NOT_IN_STOCK_STATUSES, ...POS_HELD_STATUSES] } },
          {
            [Op.or]: [
              // Do not suggest reserved / estimation-held tags for casual POS scan —
              // load the estimation in POS to bill a booking.
              {
                inventory_mode: INVENTORY_MODES.UNIQUE_TAG,
                status: { [Op.in]: [UNIQUE_ITEM_STATUSES.AVAILABLE, UNIQUE_ITEM_STATUSES.ON_DISPLAY] },
              },
              {
                inventory_mode: { [Op.ne]: INVENTORY_MODES.UNIQUE_TAG },
                stock_qty: { [Op.gt]: 0 },
                status: { [Op.notIn]: [...NOT_IN_STOCK_STATUSES, ...POS_HELD_STATUSES] },
              },
            ],
          },
        ],
      },
      order: [
        literal(
          `CASE WHEN lower(barcode) LIKE ${sequelize.escape(barcodePrefix)} THEN 0`
          + ` WHEN lower(code) LIKE ${sequelize.escape(barcodePrefix)} THEN 1`
          + ` ELSE 2 END ASC`,
        ),
        ['barcode', 'ASC'],
      ],
      limit,
    });

    return res.json(await enrichProducts(products));
  } catch (err) {
    next(err);
  }
};

/**
 * Preview the next sequential barcode number for the "New Product" form.
 * Read-only — does not consume/increment the counter, so opening (or
 * re-opening) the form without saving always shows the same number.
 * createProduct performs the real allocation at save time.
 */
export const nextBarcode = async (req, res, next) => {
  try {
    const barcode = await sequelize.transaction(async (transaction) => {
      return peekNextBarcodeNumber({ transaction });
    });
    return res.json({ barcode });
  } catch (err) {
    next(err);
  }
};

export const getProduct = async (req, res, next) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ detail: 'Product not found' });
    return res.json(await enrichProduct(product));
  } catch (err) {
    next(err);
  }
};

export const getNextProductCode = async (req, res, next) => {
  try {
    const { category_id, prefix } = req.query;
    const shopId = await getDefaultShopId();
    const result = await peekNextProductCode({
      shopId,
      categoryId: category_id || null,
      prefix: prefix || null,
    });
    return res.json(result);
  } catch (err) {
    next(err);
  }
};

export const createProduct = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const {
      name, code, barcode, category_id, subcategory_id, collection_ids, tag_ids,
      metal_type_id, purity_id, stone_type_ids, unit_id, attribute_values,
      gross_weight, net_weight, stone_weight, making_charges, making_charge_type,
      wastage_pct, hallmark, hsn_code, gst_slab, purchase_price, selling_price,
      stock_qty, low_stock_threshold, description, showcase_location,
      inventory_mode, status, design_no, size, stone_details, certification, vendor_id,
      tray_total_weight, piece_weight, counter_id, purchase_date, cal_code,
    } = req.body;

    if (!name) {
      await t.rollback();
      return res.status(400).json({ detail: 'name is required' });
    }

    // Profit & Loss mode (Settings → Application Management): purchase price
    // is mandatory so P&L / COGS valuations are exact.
    const profitLoss = await getProfitLossMode(t);
    if (profitLoss.enabled && !(Number(purchase_price) > 0)) {
      await t.rollback();
      return res.status(400).json({ detail: 'Purchase Price is required (Profit & Loss is enabled)' });
    }

    const shopId = await getDefaultShopId({ transaction: t });

    // Tag = plain serial only (10001, 10002, …). Never category prefixes like RNG-/DIA-.
    // Keep a client-supplied serial from next-barcode; otherwise allocate a new one.
    const candidate = String(barcode || code || '').trim();
    let finalBarcode = isSerialTagNumber(candidate) && !isPlaceholderProductCode(candidate)
      ? candidate
      : await allocateBarcodeNumber({ shopId, transaction: t });
    const finalCode = finalBarcode;

    const existingTag = await findProductByTag({
      shopId,
      tag: finalBarcode,
      transaction: t,
    });
    if (existingTag) {
      await t.rollback();
      return barcodeConflictResponse(res, finalBarcode);
    }

    const mode = inventory_mode || INVENTORY_MODES.QUANTITY;
    if (mode === INVENTORY_MODES.UNIQUE_TAG) {
      if (!finalBarcode || !String(finalBarcode).trim()) {
        await t.rollback();
        return res.status(400).json({ detail: 'unique_tag products require a barcode' });
      }
      const qty = stock_qty == null ? 1 : parseFloat(stock_qty);
      if (qty !== 0 && qty !== 1) {
        await t.rollback();
        return res.status(400).json({ detail: 'unique_tag products must have stock_qty 0 or 1' });
      }
    }

    const initialQty = stock_qty == null ? (mode === INVENTORY_MODES.UNIQUE_TAG ? 1 : 0) : (stock_qty || 0);

    // Tray unit: gross/net weight aren't collected per-piece on the form, so
    // seed them from the tray's own total weight — otherwise they'd start at
    // 0 and stay there (printed tags, POS, Reports) until the first sale
    // touches tray_total_weight and the billing/inventory sync catches up.
    // ProductForm always sends tray_total_weight: 0 for every non-tray
    // product (it's a leftover default on the shared form state, not an
    // omitted field) — so this must check for a genuine positive tray
    // weight, matching isTrayProduct's convention everywhere else in the
    // app, not just "was something sent." Checking `== null || === ''` here
    // treated that harmless 0 as a real tray and wiped out the actual
    // entered gross/net weight on every normal product.
    const resolvedTrayWeight = Number(tray_total_weight) > 0 ? nonNegativeWeight(tray_total_weight) : null;
    const traySeeded = applyPositiveTrayWeight({
      tray_total_weight: resolvedTrayWeight,
      gross_weight: nonNegativeWeight(gross_weight),
      net_weight: nonNegativeWeight(net_weight),
    });

    const product = await Product.create({
      id: newId(),
      name,
      code: finalCode,
      barcode: finalBarcode || null,
      category_id: category_id || null,
      subcategory_id: subcategory_id || null,
      collection_ids: collection_ids || [],
      tag_ids: tag_ids || [],
      metal_type_id: metal_type_id || null,
      purity_id: purity_id || null,
      stone_type_ids: stone_type_ids || [],
      unit_id: unit_id || null,
      attribute_values: attribute_values || {},
      gross_weight: traySeeded.gross_weight,
      net_weight: traySeeded.net_weight,
      stone_weight: nonNegativeWeight(stone_weight),
      making_charges: making_charges || 0,
      making_charge_type: making_charge_type || 'fixed',
      wastage_pct: wastage_pct || 0,
      hallmark: hallmark || null,
      hsn_code: hsn_code || null,
      gst_slab: gst_slab || 3,
      purchase_price: purchase_price || 0,
      selling_price: selling_price || 0,
      stock_qty: initialQty,
      low_stock_threshold: low_stock_threshold || 0,
      description: description || null,
      design_no: design_no || null,
      cal_code: String(cal_code ?? '').trim() || null,
      size: size || null,
      showcase_location: showcase_location || null,
      stone_details: stone_details || [],
      certification: certification || null,
      vendor_id: vendor_id || null,
      counter_id: counter_id || null,
      tray_total_weight: resolvedTrayWeight,
      piece_weight: piece_weight == null || piece_weight === '' ? null : nonNegativeWeight(piece_weight),
      // Tray: purchase_price is the whole tray's amount — fix its per-gram cost
      // now, while tray_total_weight is still the full purchased weight.
      purchase_cost_per_gram: resolvedTrayWeight ? trayCostPerGram(purchase_price, resolvedTrayWeight) : null,
      purchase_date: purchase_date || new Date().toISOString().slice(0, 10),
      inventory_mode: mode,
      status: status || 'available',
      shop_id: shopId,
    }, { transaction: t });

    // Opening movement for initial stock
    if (initialQty !== 0 || mode === INVENTORY_MODES.UNIQUE_TAG) {
      await recordMovement({
        shopId: product.shop_id,
        product,
        movementType: MOVEMENT_TYPES.OPENING,
        quantity: initialQty,
        qtyBefore: 0,
        qtyAfter: initialQty,
        referenceType: 'product_create',
        referenceId: product.id,
        createdBy: req.user?.id || null,
        notes: 'Opening balance on product create',
        transaction: t,
      });
    }

    await recordProductStatusChange({
      shopId: product.shop_id,
      productId: product.id,
      fromStatus: null,
      toStatus: product.status || UNIQUE_ITEM_STATUSES.AVAILABLE,
      reason: 'product_create',
      referenceType: 'product_create',
      referenceId: product.id,
      userId: req.user?.id || null,
      transaction: t,
    });

    // Re-evaluate sub-category low-stock after opening qty lands
    await maybeLowStockNotify(product, initialQty, t);

    await t.commit();
    broadcast({ type: 'product:changed', op: 'create', id: product.id });
    return res.status(201).json(await enrichProduct(product));
  } catch (err) {
    await t.rollback();
    if (err instanceof InventoryError) {
      return res.status(err.status || 400).json({ detail: err.message, code: err.code });
    }
    const seqDetail = seqValidationDetail(err);
    if (seqDetail) {
      return res.status(400).json({ detail: seqDetail });
    }
    if (isUniqueTagConstraint(err)) {
      const tag = String(req.body?.barcode || req.body?.code || '').trim();
      return barcodeConflictResponse(res, tag);
    }
    next(err);
  }
};

export const updateProduct = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const product = await Product.findByPk(req.params.id, { transaction: t });
    if (!product) {
      await t.rollback();
      return res.status(404).json({ detail: 'Product not found' });
    }

    const requestedBarcode = req.body?.barcode != null ? String(req.body.barcode).trim() : '';
    const requestedCode = req.body?.code != null ? String(req.body.code).trim() : '';
    const currentBarcode = String(product.barcode || '').trim();
    const currentCode = String(product.code || '').trim();
    if (
      (requestedBarcode && requestedBarcode !== currentBarcode)
      || (requestedCode && requestedCode !== currentCode)
    ) {
      await t.rollback();
      const attempted = (requestedBarcode && requestedBarcode !== currentBarcode)
        ? requestedBarcode
        : requestedCode;
      const clash = await findProductByTag({
        shopId: product.shop_id,
        tag: attempted,
        excludeId: product.id,
      });
      if (clash) {
        return barcodeConflictResponse(res, attempted);
      }
      return res.status(400).json({
        detail: BARCODE_LOCKED_MESSAGE,
        code: 'BARCODE_LOCKED',
      });
    }

    const editable = pickProductUpdates(req.body);
    // Quantity-mode stock can be edited on the product form; unique_tag stock stays ledger-protected
    const allowStockQty = !NOT_IN_STOCK_STATUSES.includes(product.status)
      && (product.inventory_mode === INVENTORY_MODES.QUANTITY
        || product.inventory_mode === 'quantity');
    if (allowStockQty && req.body.stock_qty !== undefined) {
      editable.stock_qty = req.body.stock_qty;
    }
    const { safeUpdates, blocked } = stripInventoryFieldsFromProductUpdate(editable, { allowStockQty });

    // Tray per-gram cost is edited directly (never re-derived from
    // purchase_price here — after sales tray_total_weight is only what's
    // left, so dividing by it would inflate the rate). Non-trays never carry one.
    const nextTrayWeight = Object.prototype.hasOwnProperty.call(safeUpdates, 'tray_total_weight')
      ? Number(safeUpdates.tray_total_weight)
      : Number(product.tray_total_weight);
    if (!(nextTrayWeight > 0)) {
      if (product.purchase_cost_per_gram != null || 'purchase_cost_per_gram' in safeUpdates) {
        safeUpdates.purchase_cost_per_gram = null;
      }
    } else if ('purchase_cost_per_gram' in safeUpdates) {
      const perGram = Number(safeUpdates.purchase_cost_per_gram);
      safeUpdates.purchase_cost_per_gram = perGram > 0 ? Math.round(perGram * 10000) / 10000 : null;
    }
    if ('cal_code' in safeUpdates) {
      safeUpdates.cal_code = String(safeUpdates.cal_code ?? '').trim() || null;
    }

    // Sold / hidden-sold / deleted tags: never restore via generic edit
    if (NOT_IN_STOCK_STATUSES.includes(product.status)
      && (req.body.status === 'available' || req.body.stock_qty != null)) {
      await t.rollback();
      return res.status(400).json({
        detail: 'Sold or deleted items cannot be restored via product edit. Use an explicit sale return.',
        code: 'SOLD_LOCKED',
        blocked_fields: blocked,
      });
    }

    if (Object.keys(safeUpdates).length === 0) {
      await t.rollback();
      if (blocked.length > 0) {
        return res.status(400).json({
          detail: 'Inventory fields (stock_qty, status, inventory_mode) cannot be changed via product edit. Use stock adjustments / inventory APIs.',
          code: 'INVENTORY_PROTECTED',
          blocked_fields: blocked,
        });
      }
      return res.status(400).json({ detail: 'No updatable product fields provided' });
    }

    // Bump version + ISO updated_at so Neon pull LWW won't clobber this edit
    const nextVersion = Number(product.version || 1) + 1;
    const updatedAt = new Date();
    await product.update({
      ...safeUpdates,
      version: nextVersion,
      updated_at: updatedAt,
    }, { transaction: t });
    await product.reload({ transaction: t });

    const snap = product.toJSON();
    snap.updated_at = updatedAt.toISOString();
    snap.version = nextVersion;

    await t.commit();
    broadcast({ type: 'product:changed', op: 'update', id: product.id });
    const enriched = await enrichProduct(product);
    if (blocked.length) {
      enriched._inventory_fields_ignored = blocked;
    }
    return res.json(enriched);
  } catch (err) {
    await t.rollback();
    if (err instanceof InventoryError) {
      return res.status(err.status || 400).json({ detail: err.message, code: err.code });
    }
    const seqDetail = seqValidationDetail(err);
    if (seqDetail) {
      return res.status(400).json({ detail: seqDetail });
    }
    if (isUniqueTagConstraint(err)) {
      const tag = String(req.body?.barcode || req.body?.code || '').trim();
      return barcodeConflictResponse(res, tag);
    }
    next(err);
  }
};

export const setProductDisplayStatus = async (req, res, next) => {
  try {
    const onDisplay = Boolean(req.body?.on_display);
    const { product, unchanged } = await setDisplayStatus({
      shopId: req.user?.shop_id,
      productId: req.params.id,
      onDisplay,
      createdBy: req.user?.id || null,
    });
    if (!unchanged) broadcast({ type: 'product:changed', op: 'update', id: product.id });
    return res.json(await enrichProduct(product));
  } catch (err) {
    if (err instanceof InventoryError) {
      return res.status(err.status || 400).json({ detail: err.message, code: err.code });
    }
    next(err);
  }
};

export const deleteProduct = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const product = await Product.findByPk(req.params.id, { transaction: t });
    if (!product) {
      await t.rollback();
      return res.status(404).json({ detail: 'Product not found' });
    }

    // Block delete if product has any financial movements
    const financialMovements = await InventoryMovement.count({
      where: {
        product_id: req.params.id,
        movement_type: { [Op.in]: ['SALE', 'PURCHASE', 'SALE_RETURN', 'ADJUSTMENT_ADD', 'ADJUSTMENT_REMOVE', 'DAMAGE'] },
      },
      transaction: t,
    });

    if (financialMovements > 0) {
      await t.rollback();
      return res.status(409).json({
        detail: 'Product has financial history and cannot be deleted.',
        code: 'PRODUCT_HAS_HISTORY',
        movement_count: financialMovements,
      });
    }

    const fromStatus = product.status;
    // Keep barcode + code so Tag History / Item Movement can still look the tag up.
    await product.update({
      status: UNIQUE_ITEM_STATUSES.DELETED,
      deleted_at: new Date(),
      stock_qty: 0,
    }, { transaction: t });

    await recordProductStatusChange({
      shopId: product.shop_id,
      productId: product.id,
      fromStatus,
      toStatus: UNIQUE_ITEM_STATUSES.DELETED,
      reason: 'inventory_delete',
      referenceType: 'product_delete',
      referenceId: product.id,
      userId: req.user?.id || null,
      transaction: t,
    });

    await t.commit();
    broadcast({ type: 'product:changed', op: 'delete', id: product.id });
    return res.json({ detail: 'Product deleted', id: product.id });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};
