import { Op, fn, col, literal } from 'sequelize';
import {
  Product, Category, CatalogItem, ShopCounter, Vendor, User,
  InventoryMovement, ProductStatusHistory, InvoiceItem, Invoice,
} from '../../models/index.js';
import { toMoneyNumber } from '../../utils/money.js';
import { toWeightNumber } from '../../utils/weight.js';
import { isWeightCostedTray, stockCostValue } from '../../services/productCost.js';
import { parsePagination, parseDateRange, invoiceDateRangeWhere, paginatedResult } from '../../utils/reportQuery.js';
import { parseMultiParam } from '../../utils.js';
import { withNotHiddenInvoiceItems, wantsHiddenBills, loadHiddenInvoiceIds } from '../../utils/invoiceVisibility.js';
import { invoiceOccurredAt, modelValue, parseOccurredAt } from '../../utils/invoiceRead.js';
import { NOT_IN_STOCK_STATUSES, productStatusLabel } from '../../constants/inventory.js';

/** In stock = not sold/deleted and qty remaining (matches Inventory "In Stock" tab). */
const IN_STOCK = {
  deleted_at: null,
  status: { [Op.notIn]: [...NOT_IN_STOCK_STATUSES] },
  stock_qty: { [Op.gt]: 0 },
};

/**
 * The user-entered stock-entry date (Product.purchase_date, set from the New Product
 * form or a vendor Purchase's own purchase_date) is the date reports should filter/
 * display by — falling back to created_at only for older rows that never got one.
 */
function stockEntryDateCondition(query) {
  const dateWhere = parseDateRange(query);
  if (!dateWhere.created_at) return null;
  const range = dateWhere.created_at;
  return {
    [Op.or]: [
      { purchase_date: range },
      { purchase_date: null, created_at: range },
    ],
  };
}

/** Prefer purchase_date (DATEONLY); fall back to created timestamp (Sequelize may emit createdAt). */
function resolveStockInDate(p) {
  if (p?.purchase_date) return p.purchase_date;
  return p?.created_at || p?.createdAt || null;
}

/** Parse DATEONLY (YYYY-MM-DD) as local calendar date to avoid UTC day-shift. */
function parseLocalDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `{ [Op.in]: [...] }` works identically to plain equality for a single-element array. */
function multiWhere(raw) {
  const arr = parseMultiParam(raw);
  return arr ? { [Op.in]: arr } : null;
}

function isoTimestamp(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
  const parsed = parseOccurredAt(raw);
  return parsed ? parsed.toISOString() : null;
}

function rowCreatedAt(row) {
  return isoTimestamp(modelValue(row, 'created_at', 'createdAt'));
}

function isHiddenStatusHistory(row) {
  const reason = String(row.reason || '').toLowerCase();
  if (reason === 'hidden_sale') return true;
  if (String(row.to_status || '').toLowerCase() === 'deleted_p') return true;
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  return Boolean(meta.hidden_sale);
}

function isHiddenMovement(row, hiddenInvoiceIds) {
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  if (meta.hidden_sale) return true;
  if (row.reference_id && hiddenInvoiceIds?.has(row.reference_id)) return true;
  return false;
}

function eventTimestamp(row, invoiceOccurredById) {
  const refId = row.reference_id;
  if (refId && invoiceOccurredById.has(refId)) return invoiceOccurredById.get(refId);
  return rowCreatedAt(row);
}

async function loadInvoiceOccurredMap(referenceIds) {
  const ids = [...new Set((referenceIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const invoices = await Invoice.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: ['id', 'business_date', 'created_at'],
  });
  const map = new Map();
  for (const inv of invoices) {
    const occurred = invoiceOccurredAt(inv);
    map.set(inv.id, occurred ? occurred.toISOString() : rowCreatedAt(inv));
  }
  return map;
}

/** Invoices in the Transaction-date window — never the insert clock on invoice_items. */
async function invoicesInBusinessDateRange(query, shopId) {
  const dateWhere = invoiceDateRangeWhere(query);
  const and = Object.keys(dateWhere).length ? [dateWhere] : [];
  if (shopId) and.push({ [Op.or]: [{ shop_id: shopId }, { shop_id: null }] });
  return Invoice.findAll({
    where: and.length ? { [Op.and]: and } : {},
    attributes: ['id', 'business_date', 'created_at'],
  });
}

function hiddenStatusHistoryWhere(hiddenInvoiceIds) {
  const and = [
    { to_status: { [Op.ne]: 'deleted_p' } },
    {
      [Op.or]: [
        { reason: { [Op.is]: null } },
        { reason: { [Op.ne]: 'hidden_sale' } },
      ],
    },
  ];
  if (hiddenInvoiceIds?.size) {
    and.push({
      [Op.or]: [
        { reference_id: { [Op.is]: null } },
        { reference_id: { [Op.notIn]: [...hiddenInvoiceIds] } },
      ],
    });
  }
  return { [Op.and]: and };
}

function publicProductStatus(product, includeHidden, lastVisibleStatus) {
  if (includeHidden || String(product.status || '').toLowerCase() !== 'deleted_p') {
    return { status: product.status, status_label: productStatusLabel(product.status) };
  }
  const status = lastVisibleStatus || 'available';
  return { status, status_label: productStatusLabel(status) };
}

function baseProductWhere(query) {
  const where = { deleted_at: null };
  const categoryIds = multiWhere(query.category_id);
  if (categoryIds) where.category_id = categoryIds;
  const subcategoryIds = multiWhere(query.subcategory_id);
  if (subcategoryIds) where.subcategory_id = subcategoryIds;
  const counterIds = multiWhere(query.counter_id);
  if (counterIds) where.counter_id = counterIds;
  const purityIds = multiWhere(query.purity_id);
  if (purityIds) where.purity_id = purityIds;
  const vendorIds = multiWhere(query.vendor_id);
  if (vendorIds) where.vendor_id = vendorIds;
  const metalTypeIds = multiWhere(query.metal_type_id);
  if (metalTypeIds) where.metal_type_id = metalTypeIds;
  const statuses = multiWhere(query.status);
  if (statuses) where.status = statuses;
  else Object.assign(where, { status: IN_STOCK.status });
  // Always exclude zero-qty / sold-out rows from inventory stock reports.
  where.stock_qty = IN_STOCK.stock_qty;
  const stockDateCond = stockEntryDateCondition(query);
  if (stockDateCond) where[Op.and] = [...(where[Op.and] || []), stockDateCond];
  if (query.q) {
    where[Op.or] = [
      { name: { [Op.like]: `%${query.q}%` } },
      { barcode: { [Op.like]: `%${query.q}%` } },
      { code: { [Op.like]: `%${query.q}%` } },
    ];
  }
  return where;
}

/** Tray unit: gross/net weight aren't collected per-piece — the tray's own
 * pooled weight (already reduced by every sale) is the real figure. */
function isTrayProduct(p) {
  return Number(p?.tray_total_weight) > 0;
}

/** Weight to count for one product row — tray's pooled weight as-is, else per-piece × pieces in stock. */
function weightTotal(p, field, pcs) {
  if (isTrayProduct(p)) return Number(p.tray_total_weight) || 0;
  return (Number(p[field]) || 0) * pcs;
}

/** Stone weight has no tray-pool equivalent (trays are plain, un-set stones) —
 * just per-piece × pieces, same scaling rule minus the tray substitution. */
function qtyWeightTotal(p, field, pcs) {
  return (Number(p[field]) || 0) * pcs;
}

/** SQL-side equivalent of weightTotal, for raw SUM() aggregates — same rule:
 * tray's own pooled weight, else per-piece weight × pieces (1 for unique tags). */
function weightSumSql(fieldCol) {
  return literal(
    `SUM(CASE WHEN COALESCE(tray_total_weight, 0) > 0 THEN tray_total_weight `
    + `ELSE ${fieldCol} * (CASE WHEN inventory_mode = 'unique_tag' THEN 1 ELSE COALESCE(stock_qty, 0) END) END)`,
  );
}

/** SQL-side equivalent of qtyWeightTotal — per-piece × pieces, no tray substitution. */
function qtyWeightSumSql(fieldCol) {
  return literal(
    `SUM(${fieldCol} * (CASE WHEN inventory_mode = 'unique_tag' THEN 1 ELSE COALESCE(stock_qty, 0) END))`,
  );
}

async function lookupNames(model, ids) {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return new Map();
  const rows = await model.findAll({ where: { id: { [Op.in]: clean } } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function enrichRows(products) {
  const list = products.map((p) => (p.toJSON ? p.toJSON() : p));
  const [categories, subcats, purities, counters, vendors] = await Promise.all([
    lookupNames(Category, list.map((p) => p.category_id)),
    lookupNames(Category, list.map((p) => p.subcategory_id)),
    lookupNames(CatalogItem, list.map((p) => p.purity_id)),
    lookupNames(ShopCounter, list.map((p) => p.counter_id)),
    lookupNames(Vendor, list.map((p) => p.vendor_id)),
  ]);
  return list.map((p) => {
    const createdAt = p.created_at || p.createdAt || null;
    const purchaseDate = p.purchase_date || null;
    const stockIn = purchaseDate || createdAt;
    return {
      ...p,
      created_at: createdAt,
      createdAt,
      purchase_date: purchaseDate,
      category_name: categories.get(p.category_id) || null,
      subcategory_name: subcats.get(p.subcategory_id) || null,
      purity_name: purities.get(p.purity_id) || null,
      counter_name: counters.get(p.counter_id) || null,
      vendor_name: vendors.get(p.vendor_id) || null,
      stock_in_date: stockIn instanceof Date ? stockIn.toISOString() : stockIn,
    };
  });
}

const SORT_COLUMNS = new Set([
  'created_at', 'name', 'barcode', 'gross_weight', 'net_weight', 'stone_weight', 'stock_qty',
]);

// GET /api/reports/inventory/stock-check
export const stockCheck = async (req, res, next) => {
  try {
    const where = baseProductWhere(req.query);
    const { limit, offset } = parsePagination(req.query, { maxLimit: 5000 });
    const sortBy = SORT_COLUMNS.has(req.query.sort_by) ? req.query.sort_by : 'created_at';
    const sortDir = req.query.sort_dir === 'asc' ? 'ASC' : 'DESC';

    const [{ count, rows }, aggregate] = await Promise.all([
      Product.findAndCountAll({ where, order: [[sortBy, sortDir]], limit, offset }),
      Product.findOne({
        where,
        attributes: [
          [fn('COUNT', col('id')), 'items'],
          [fn('COALESCE', weightSumSql('gross_weight'), 0), 'gross_weight'],
          [fn('COALESCE', qtyWeightSumSql('stone_weight'), 0), 'stone_weight'],
          [fn('COALESCE', weightSumSql('net_weight'), 0), 'net_weight'],
        ],
        raw: true,
      }),
    ]);

    const data = await enrichRows(rows);
    return res.json({
      ...paginatedResult(count, data),
      totals: {
        items: Number(aggregate?.items) || 0,
        gross_weight: toWeightNumber(aggregate?.gross_weight),
        stone_weight: toWeightNumber(aggregate?.stone_weight),
        net_weight: toWeightNumber(aggregate?.net_weight),
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/inventory/category-stock
export const categoryStock = async (req, res, next) => {
  try {
    const where = baseProductWhere(req.query);
    const products = await Product.findAll({ where: { ...where, category_id: { [Op.ne]: null } } });
    const byCategory = new Map();
    for (const p of products) {
      const key = p.category_id;
      const qty = Number(p.stock_qty) || 0;
      const pcs = p.inventory_mode === 'unique_tag' ? 1 : qty;
      const bucket = byCategory.get(key) || { id: key, items: 0, pieces: 0, gross_weight: 0, stone_weight: 0, net_weight: 0, stock_value: 0 };
      bucket.items += 1;
      bucket.pieces += pcs;
      bucket.gross_weight += weightTotal(p, 'gross_weight', pcs);
      bucket.stone_weight += qtyWeightTotal(p, 'stone_weight', pcs);
      bucket.net_weight += weightTotal(p, 'net_weight', pcs);
      bucket.stock_value += (Number(p.selling_price) || 0) * (p.inventory_mode === 'unique_tag' ? 1 : Math.max(qty, 0));
      byCategory.set(key, bucket);
    }
    const names = await lookupNames(Category, [...byCategory.keys()]);
    const data = [...byCategory.values()]
      .map((r) => ({
        ...r,
        category_name: names.get(r.id) || 'Uncategorised',
        gross_weight: toWeightNumber(r.gross_weight),
        stone_weight: toWeightNumber(r.stone_weight),
        net_weight: toWeightNumber(r.net_weight),
        stock_value: toMoneyNumber(r.stock_value),
      }))
      .sort((a, b) => b.stock_value - a.stock_value);
    return res.json({ data });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/inventory/counter-stock
export const counterStock = async (req, res, next) => {
  try {
    const where = baseProductWhere(req.query);
    const products = await Product.findAll({ where: { ...where, counter_id: { [Op.ne]: null } } });
    const byCounter = new Map();
    for (const p of products) {
      const key = p.counter_id;
      const qty = Number(p.stock_qty) || 0;
      const pcs = p.inventory_mode === 'unique_tag' ? 1 : qty;
      const bucket = byCounter.get(key) || { id: key, items: 0, pieces: 0, gross_weight: 0, stone_weight: 0, net_weight: 0, stock_value: 0 };
      bucket.items += 1;
      bucket.pieces += pcs;
      bucket.gross_weight += weightTotal(p, 'gross_weight', pcs);
      bucket.stone_weight += qtyWeightTotal(p, 'stone_weight', pcs);
      bucket.net_weight += weightTotal(p, 'net_weight', pcs);
      bucket.stock_value += (Number(p.selling_price) || 0) * (p.inventory_mode === 'unique_tag' ? 1 : Math.max(qty, 0));
      byCounter.set(key, bucket);
    }
    const names = await lookupNames(ShopCounter, [...byCounter.keys()]);
    const data = [...byCounter.values()]
      .map((r) => ({
        ...r,
        counter_name: names.get(r.id) || 'Unassigned',
        gross_weight: toWeightNumber(r.gross_weight),
        stone_weight: toWeightNumber(r.stone_weight),
        net_weight: toWeightNumber(r.net_weight),
        stock_value: toMoneyNumber(r.stock_value),
      }))
      .sort((a, b) => b.stock_value - a.stock_value);
    return res.json({ data });
  } catch (err) {
    next(err);
  }
};

const HHMM = /^\d{2}:\d{2}$/;

// GET /api/reports/inventory/today-stock-added
export const todaysStockAdded = async (req, res, next) => {
  try {
    const day = req.query.date || new Date().toISOString().slice(0, 10);
    const fromTime = HHMM.test(req.query.from_time || '') ? req.query.from_time : '00:00';
    const toTime = HHMM.test(req.query.to_time || '') ? req.query.to_time : '23:59';
    const hasTimeFilter = fromTime !== '00:00' || toTime !== '23:59';
    const start = new Date(`${day}T${fromTime}:00.000Z`);
    const end = new Date(`${day}T${toTime}:59.999Z`);
    const { limit, offset } = parsePagination(req.query);

    // purchase_date has no time component, so once a time-of-day window is
    // requested it can only be checked against created_at (the real insert
    // timestamp) — otherwise a DATEONLY value compared to an hour-narrowed
    // range would silently stop matching. Full-day requests (the default)
    // keep the original purchase_date-first, created_at-fallback behavior.
    const where = hasTimeFilter
      ? { deleted_at: null, created_at: { [Op.gte]: start, [Op.lte]: end } }
      : {
        deleted_at: null,
        [Op.or]: [
          { purchase_date: { [Op.gte]: start, [Op.lte]: end } },
          { purchase_date: null, created_at: { [Op.gte]: start, [Op.lte]: end } },
        ],
      };

    const [{ count, rows }, aggregate, categoryRows] = await Promise.all([
      Product.findAndCountAll({ where, order: [['created_at', 'DESC']], limit, offset }),
      Product.findOne({
        where,
        attributes: [
          [fn('COUNT', col('id')), 'items'],
          [fn('COALESCE', weightSumSql('gross_weight'), 0), 'gross_weight'],
          [fn('COALESCE', qtyWeightSumSql('stone_weight'), 0), 'stone_weight'],
          [fn('COALESCE', weightSumSql('net_weight'), 0), 'net_weight'],
        ],
        raw: true,
      }),
      Product.findAll({
        where,
        attributes: [
          'category_id',
          [fn('COUNT', col('id')), 'items'],
          [fn('COALESCE', weightSumSql('gross_weight'), 0), 'gross_weight'],
          [fn('COALESCE', qtyWeightSumSql('stone_weight'), 0), 'stone_weight'],
          [fn('COALESCE', weightSumSql('net_weight'), 0), 'net_weight'],
        ],
        group: ['category_id'],
        raw: true,
      }),
    ]);

    const data = await enrichRows(rows);
    const productIds = data.map((p) => p.id);
    const historyRows = productIds.length
      ? await ProductStatusHistory.findAll({
        where: { product_id: { [Op.in]: productIds }, reference_type: 'purchase', from_status: null },
      })
      : [];
    const creatorByProduct = new Map(historyRows.map((h) => [h.product_id, h.user_id]));
    const userIds = [...new Set(historyRows.map((h) => h.user_id).filter(Boolean))];
    const users = userIds.length ? await User.findAll({ where: { id: { [Op.in]: userIds } } }) : [];
    const userNames = new Map(users.map((u) => [u.id, u.name]));

    const categoryNames = await lookupNames(Category, categoryRows.map((c) => c.category_id));
    const categoryTotals = categoryRows
      .map((c) => ({
        category_id: c.category_id || null,
        category_name: c.category_id ? (categoryNames.get(c.category_id) || 'Unknown Category') : 'Uncategorized',
        items: Number(c.items) || 0,
        gross_weight: toWeightNumber(c.gross_weight),
        stone_weight: toWeightNumber(c.stone_weight),
        net_weight: toWeightNumber(c.net_weight),
      }))
      .sort((a, b) => a.category_name.localeCompare(b.category_name));

    return res.json({
      ...paginatedResult(count, data.map((p) => ({
        ...p,
        added_by: userNames.get(creatorByProduct.get(p.id)) || null,
        time_added: p.created_at,
      }))),
      totals: {
        items: Number(aggregate?.items) || 0,
        gross_weight: toWeightNumber(aggregate?.gross_weight),
        stone_weight: toWeightNumber(aggregate?.stone_weight),
        net_weight: toWeightNumber(aggregate?.net_weight),
      },
      category_totals: categoryTotals,
    });
  } catch (err) {
    next(err);
  }
};

const AGE_BUCKETS = [
  { key: '0-30', min: 0, max: 30 },
  { key: '31-60', min: 31, max: 60 },
  { key: '61-90', min: 61, max: 90 },
  { key: '91-180', min: 91, max: 180 },
  { key: '180+', min: 181, max: Infinity },
];
const DEAD_STOCK_BUCKETS = [30, 60, 90, 180, 365];

function daysBetween(from, to = new Date()) {
  return Math.floor((to.getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24));
}

// GET /api/reports/inventory/dead-stock — no SALE movement (or never sold) for N+ days
export const deadStock = async (req, res, next) => {
  try {
    const minDays = Math.max(parseInt(req.query.min_days, 10) || 30, 0);
    const { limit, offset } = parsePagination(req.query);
    const where = baseProductWhere(req.query);
    const products = await Product.findAll({ where });
    if (products.length === 0) return res.json({ total: 0, data: [], totals: { items: 0 } });

    const lastSales = await InventoryMovement.findAll({
      where: { product_id: { [Op.in]: products.map((p) => p.id) }, movement_type: 'SALE' },
      attributes: ['product_id', [fn('MAX', col('created_at')), 'last_sale_at']],
      group: ['product_id'],
      raw: true,
    });
    const lastSaleMap = new Map(lastSales.map((r) => [r.product_id, r.last_sale_at]));

    const now = new Date();
    const enriched = (await enrichRows(products)).map((p) => {
      const lastSaleAt = lastSaleMap.get(p.id);
      const referenceDate = lastSaleAt || resolveStockInDate(p);
      const daysUnsold = daysBetween(referenceDate, now);
      return { ...p, days_unsold: daysUnsold, current_value: toMoneyNumber((Number(p.selling_price) || 0) * (p.inventory_mode === 'unique_tag' ? 1 : Math.max(Number(p.stock_qty) || 0, 0))) };
    }).filter((p) => p.days_unsold >= minDays);

    enriched.sort((a, b) => b.days_unsold - a.days_unsold);
    return res.json({
      total: enriched.length,
      data: enriched.slice(offset, offset + limit),
      totals: {
        items: enriched.length,
        current_value: toMoneyNumber(enriched.reduce((s, p) => s + p.current_value, 0)),
      },
      buckets: DEAD_STOCK_BUCKETS,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/inventory/fast-moving — ranked by quantity sold (invoice_items ledger)
export const fastMovingStock = async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const invoices = await invoicesInBusinessDateRange(req.query, req.user?.shop_id);
    const invoiceIds = invoices.map((i) => i.id);
    if (!invoiceIds.length) return res.json({ data: [] });
    const where = await withNotHiddenInvoiceItems(
      { ...req.query, _role: req.user?.role },
      { invoice_id: { [Op.in]: invoiceIds } },
      { shopId: req.user?.shop_id },
    );
    const rows = await InvoiceItem.findAll({
      where,
      attributes: [
        [fn('COALESCE', col('product_id'), col('barcode')), 'key'],
        [fn('MAX', col('description')), 'product_name'],
        [fn('COALESCE', fn('SUM', col('quantity')), 0), 'quantity_sold'],
        [fn('COALESCE', fn('SUM', col('amount')), 0), 'revenue'],
      ],
      group: [[fn('COALESCE', col('product_id'), col('barcode'))]],
      order: [[fn('SUM', col('quantity')), 'DESC']],
      limit,
      raw: true,
    });

    const productIds = rows.map((r) => r.key).filter(Boolean);
    const products = productIds.length ? await Product.findAll({ where: { id: { [Op.in]: productIds } } }) : [];
    const categoryIds = [...new Set(products.map((p) => p.category_id).filter(Boolean))];
    const categoryNames = await lookupNames(Category, categoryIds);
    const productMap = new Map(products.map((p) => [p.id, p]));

    return res.json({
      data: rows.map((r, i) => {
        const qty = Number(r.quantity_sold) || 0;
        const revenue = toMoneyNumber(r.revenue);
        const product = productMap.get(r.key);
        return {
          rank: i + 1,
          product_id: r.key,
          product_name: product?.name || r.product_name || 'Unknown item',
          category_name: product ? categoryNames.get(product.category_id) || null : null,
          quantity_sold: qty,
          revenue,
          avg_selling_price: qty > 0 ? toMoneyNumber(revenue / qty) : 0,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/inventory/sold-items — line-item detail of every tag sold (invoice_items ledger)
export const soldItems = async (req, res, next) => {
  try {
    const { limit, offset } = parsePagination(req.query);
    const invoices = await invoicesInBusinessDateRange(req.query, req.user?.shop_id);
    const invoiceById = new Map(invoices.map((i) => [i.id, i]));
    const invoiceIds = invoices.map((i) => i.id);
    if (!invoiceIds.length) {
      return res.json({ ...paginatedResult(0, []), totals: { items: 0, sold_value: 0 } });
    }
    const filters = { invoice_id: { [Op.in]: invoiceIds } };

    if (req.query.category_id || req.query.subcategory_id || req.query.metal_type_id) {
      const productWhere = { deleted_at: null };
      const categoryIds = parseMultiParam(req.query.category_id);
      if (categoryIds) productWhere.category_id = { [Op.in]: categoryIds };
      const subcategoryIds = parseMultiParam(req.query.subcategory_id);
      if (subcategoryIds) productWhere.subcategory_id = { [Op.in]: subcategoryIds };
      const metalTypeIds = parseMultiParam(req.query.metal_type_id);
      if (metalTypeIds) productWhere.metal_type_id = { [Op.in]: metalTypeIds };
      const matches = await Product.findAll({ where: productWhere, attributes: ['id'] });
      filters.product_id = { [Op.in]: matches.map((p) => p.id) };
    }
    if (req.query.q) {
      filters[Op.or] = [
        { barcode: { [Op.like]: `%${req.query.q}%` } },
        { description: { [Op.like]: `%${req.query.q}%` } },
      ];
    }

    const where = await withNotHiddenInvoiceItems(
      { ...req.query, _role: req.user?.role },
      filters,
      { shopId: req.user?.shop_id },
    );

    const [{ count, rows }, sumRow] = await Promise.all([
      InvoiceItem.findAndCountAll({ where, order: [['created_at', 'DESC']], limit, offset }),
      InvoiceItem.findOne({
        where,
        attributes: [[fn('COALESCE', fn('SUM', col('amount')), 0), 'sold_value']],
        raw: true,
      }),
    ]);

    const productIds = [...new Set(rows.map((r) => r.product_id).filter(Boolean))];
    const products = productIds.length ? await Product.findAll({ where: { id: { [Op.in]: productIds } } }) : [];
    const productMap = new Map(products.map((p) => [p.id, p]));
    const categoryIds = [...new Set(products.map((p) => p.category_id).filter(Boolean))];
    const subcategoryIds = [...new Set(products.map((p) => p.subcategory_id).filter(Boolean))];
    const [categoryNames, subcategoryNames] = await Promise.all([
      lookupNames(Category, categoryIds),
      lookupNames(Category, subcategoryIds),
    ]);

    const data = rows.map((r, i) => {
      const product = r.product_id ? productMap.get(r.product_id) : null;
      const inv = invoiceById.get(r.invoice_id);
      const occurred = inv ? invoiceOccurredAt(inv) : null;
      return {
        id: r.id,
        sno: offset + i + 1,
        tag_no: r.barcode || product?.barcode || product?.code || '',
        category_name: product ? (categoryNames.get(product.category_id) || null) : null,
        subcategory_name: product ? (subcategoryNames.get(product.subcategory_id) || null) : null,
        sold_at: occurred ? occurred.toISOString() : rowCreatedAt(r),
        sold_price: toMoneyNumber(r.amount),
      };
    });

    return res.json({
      ...paginatedResult(count, data),
      totals: {
        items: count,
        sold_value: toMoneyNumber(sumRow?.sold_value),
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/inventory/stock-ageing — category × age-bucket grid
export const stockAgeing = async (req, res, next) => {
  try {
    const where = baseProductWhere(req.query);
    const products = await Product.findAll({ where });
    const now = new Date();

    const grid = new Map();
    for (const p of products) {
      const age = daysBetween(resolveStockInDate(p), now);
      const bucket = AGE_BUCKETS.find((b) => age >= b.min && age <= b.max) || AGE_BUCKETS[AGE_BUCKETS.length - 1];
      const key = `${p.category_id || 'none'}::${bucket.key}`;
      const qty = Number(p.stock_qty) || 0;
      const pcs = p.inventory_mode === 'unique_tag' ? 1 : qty;
      const row = grid.get(key) || {
        category_id: p.category_id, bucket: bucket.key, items: 0, gross_weight: 0, stone_weight: 0, net_weight: 0, stock_value: 0,
      };
      row.items += 1;
      row.gross_weight += weightTotal(p, 'gross_weight', pcs);
      row.stone_weight += qtyWeightTotal(p, 'stone_weight', pcs);
      row.net_weight += weightTotal(p, 'net_weight', pcs);
      row.stock_value += (Number(p.selling_price) || 0) * (p.inventory_mode === 'unique_tag' ? 1 : Math.max(qty, 0));
      grid.set(key, row);
    }

    const categoryIds = [...new Set([...grid.values()].map((r) => r.category_id).filter(Boolean))];
    const names = await lookupNames(Category, categoryIds);
    const data = [...grid.values()].map((r) => ({
      ...r,
      category_name: names.get(r.category_id) || 'Uncategorised',
      gross_weight: toWeightNumber(r.gross_weight),
      stone_weight: toWeightNumber(r.stone_weight),
      net_weight: toWeightNumber(r.net_weight),
      stock_value: toMoneyNumber(r.stock_value),
    }));

    return res.json({ data, buckets: AGE_BUCKETS.map((b) => b.key) });
  } catch (err) {
    next(err);
  }
};

async function resolveProductByTag(query) {
  const tag = query.tag_number || query.barcode || query.q;
  if (!tag) return null;
  return Product.findOne({ where: { [Op.or]: [{ barcode: tag }, { code: tag }] } });
}

async function buildProductLedger(productId, { hiddenInvoiceIds = null } = {}) {
  const includeHidden = hiddenInvoiceIds == null;
  let [statusRows, movementRows] = await Promise.all([
    ProductStatusHistory.findAll({ where: { product_id: productId }, order: [['created_at', 'ASC']] }),
    InventoryMovement.findAll({ where: { product_id: productId }, order: [['created_at', 'ASC']] }),
  ]);

  if (!includeHidden) {
    statusRows = statusRows.filter((r) => !isHiddenStatusHistory(r)
      && !(r.reference_id && hiddenInvoiceIds.has(r.reference_id)));
    movementRows = movementRows.filter((r) => !isHiddenMovement(r, hiddenInvoiceIds));
  }

  const userIds = [...new Set(statusRows.map((r) => r.user_id).filter(Boolean))];
  const users = userIds.length ? await User.findAll({ where: { id: { [Op.in]: userIds } } }) : [];
  const userNames = new Map(users.map((u) => [u.id, u.name]));

  const invoiceOccurredById = await loadInvoiceOccurredMap([
    ...statusRows.map((r) => r.reference_id),
    ...movementRows.map((r) => r.reference_id),
  ]);

  const statusEvents = statusRows.map((r) => ({
    type: 'status_change',
    from_status: r.from_status,
    from_status_label: productStatusLabel(r.from_status),
    to_status: r.to_status,
    to_status_label: productStatusLabel(r.to_status),
    reason: r.reason,
    reference_type: r.reference_type,
    reference_id: r.reference_id,
    performed_by: userNames.get(r.user_id) || null,
    timestamp: eventTimestamp(r, invoiceOccurredById),
  }));
  const movementEvents = movementRows.map((r) => ({
    type: 'movement',
    movement_type: r.movement_type,
    quantity: Number(r.quantity),
    reference_type: r.reference_type,
    reference_id: r.reference_id,
    timestamp: eventTimestamp(r, invoiceOccurredById),
  }));

  const events = [...statusEvents, ...movementEvents].sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
  const lastStatus = [...statusEvents].reverse().find((e) => e.to_status);
  return { events, lastVisibleStatus: lastStatus?.to_status || null };
}

// GET /api/reports/inventory/tag-history
export const tagHistory = async (req, res, next) => {
  try {
    const includeHidden = wantsHiddenBills({ ...req.query, _role: req.user?.role });
    const hiddenInvoiceIds = includeHidden ? null : await loadHiddenInvoiceIds(req.user?.shop_id);
    const product = await resolveProductByTag(req.query);

    if (product) {
      const { events, lastVisibleStatus } = await buildProductLedger(product.id, { hiddenInvoiceIds });
      return res.json({
        product: {
          id: product.id,
          name: product.name,
          barcode: product.barcode,
          code: product.code,
          ...publicProductStatus(product, includeHidden, lastVisibleStatus),
        },
        data: events,
      });
    }

    // No specific tag requested — paginated audit log across all tags.
    const { limit, offset } = parsePagination(req.query);
    const historyWhere = includeHidden ? {} : hiddenStatusHistoryWhere(hiddenInvoiceIds);
    const { count, rows } = await ProductStatusHistory.findAndCountAll({
      where: historyWhere,
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });
    const productIds = [...new Set(rows.map((r) => r.product_id))];
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
    const [products, users] = await Promise.all([
      productIds.length ? Product.findAll({ where: { id: { [Op.in]: productIds } } }) : [],
      userIds.length ? User.findAll({ where: { id: { [Op.in]: userIds } } }) : [],
    ]);
    const productMap = new Map(products.map((p) => [p.id, p]));
    const userNames = new Map(users.map((u) => [u.id, u.name]));
    const invoiceOccurredById = await loadInvoiceOccurredMap(rows.map((r) => r.reference_id));

    return res.json(paginatedResult(count, rows.map((r) => ({
      product_id: r.product_id,
      tag_number: productMap.get(r.product_id)?.code || null,
      barcode: productMap.get(r.product_id)?.barcode || null,
      product_name: productMap.get(r.product_id)?.name || 'Deleted product',
      from_status: r.from_status,
      from_status_label: productStatusLabel(r.from_status),
      to_status: r.to_status,
      to_status_label: productStatusLabel(r.to_status),
      action: r.reason || productStatusLabel(r.to_status),
      performed_by: userNames.get(r.user_id) || null,
      timestamp: eventTimestamp(r, invoiceOccurredById),
    }))));
  } catch (err) {
    next(err);
  }
};

const MOVEMENT_STAGE_LABELS = {
  PURCHASE: 'Purchase',
  SALE: 'Sale',
  SALE_RETURN: 'Return',
  ADJUSTMENT_ADD: 'Adjustment (Add)',
  ADJUSTMENT_REMOVE: 'Adjustment (Remove)',
  REPAIR_IN: 'Repair — Returned',
  REPAIR_OUT: 'Repair — Sent Out',
};

// GET /api/reports/inventory/item-movement — full lifecycle for one tag
// GET /api/reports/inventory/stock-details — per-item listing grouped by category
// Matches the physical "STOCK DETAILS" report format: SNO, TAG NO, PCS, G.WT, N.W, Cost, COUNTER, OLD TAG, DEALER, DATE
export const stockDetails = async (req, res, next) => {
  try {
    const where = baseProductWhere(req.query);
    const products = await Product.findAll({
      where,
      order: [['category_id', 'ASC'], ['created_at', 'ASC']],
    });

    const enriched = await enrichRows(products);

    // Group by category
    const byCategory = new Map();
    let sno = 1;
    for (const p of enriched) {
      const catName = p.category_name || 'Uncategorised';
      if (!byCategory.has(catName)) {
        byCategory.set(catName, { category_name: catName, items: [], total_pcs: 0, total_gross_weight: 0, total_net_weight: 0 });
      }
      const bucket = byCategory.get(catName);
      const pcs = p.inventory_mode === 'unique_tag' ? 1 : (Number(p.stock_qty) || 1);
      const gw = toWeightNumber(weightTotal(p, 'gross_weight', pcs));
      const nw = toWeightNumber(weightTotal(p, 'net_weight', pcs));

      const rawStockIn = p.stock_in_date || p.purchase_date || p.created_at || p.createdAt || null;
      const stockInAt = parseLocalDate(rawStockIn);
      const purchaseDateAt = parseLocalDate(p.purchase_date);
      const fmtDate = (d, withTime = false) => {
        if (!d) return '';
        const DD = String(d.getDate()).padStart(2, '0');
        const MM = String(d.getMonth() + 1).padStart(2, '0');
        const YY = String(d.getFullYear()).slice(2);
        if (!withTime) return `${DD}/${MM}/${YY}`;
        const HH = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${DD}/${MM}/${YY} ${HH}:${mm}`;
      };
      // Stock Details DATE = stock-in day (purchase_date, else createdAt).
      const dateStr = purchaseDateAt
        ? fmtDate(purchaseDateAt)
        : fmtDate(stockInAt);

      bucket.items.push({
        sno: sno++,
        stock_added_at: stockInAt && !purchaseDateAt ? stockInAt.toISOString() : null,
        stock_in_date: rawStockIn instanceof Date ? rawStockIn.toISOString() : (rawStockIn || null),
        purchase_date_str: fmtDate(purchaseDateAt),
        tag_no: p.code || p.barcode || '',
        pcs,
        gross_weight: gw,
        net_weight: nw,
        // Tray: current value of what's left (per-gram cost × remaining weight),
        // not the original whole-tray purchase amount.
        cost: toMoneyNumber(isWeightCostedTray(p) ? stockCostValue(p) : (p.purchase_price || p.selling_price || 0)),
        counter: p.counter_name || '',
        old_tag: p.barcode || '',
        dealer: p.vendor_name || '',
        date: dateStr,
        product_name: p.name || '',
        subcategory_name: p.subcategory_name || '',
        purity_name: p.purity_name || '',
      });
      bucket.total_pcs += pcs;
      bucket.total_gross_weight += gw;
      bucket.total_net_weight += nw;
    }

    const data = [...byCategory.values()].map((b) => ({
      ...b,
      total_gross_weight: toWeightNumber(b.total_gross_weight),
      total_net_weight: toWeightNumber(b.total_net_weight),
    }));

    const grandPcs = data.reduce((s, c) => s + c.total_pcs, 0);
    const grandGw = toWeightNumber(data.reduce((s, c) => s + c.total_gross_weight, 0));
    const grandNw = toWeightNumber(data.reduce((s, c) => s + c.total_net_weight, 0));

    return res.json({
      data,
      totals: { total_pcs: grandPcs, total_gross_weight: grandGw, total_net_weight: grandNw },
    });
  } catch (err) {
    next(err);
  }
};

export const itemMovement = async (req, res, next) => {
  try {
    const product = await resolveProductByTag(req.query);
    if (!product) {
      return res.status(400).json({ detail: 'tag_number or barcode is required to trace item movement' });
    }

    const includeHidden = wantsHiddenBills({ ...req.query, _role: req.user?.role });
    const hiddenInvoiceIds = includeHidden ? null : await loadHiddenInvoiceIds(req.user?.shop_id);
    const { events, lastVisibleStatus } = await buildProductLedger(product.id, { hiddenInvoiceIds });
    const stages = events.map((e) => ({
      stage: e.type === 'movement' ? (MOVEMENT_STAGE_LABELS[e.movement_type] || e.movement_type) : (e.to_status_label || e.to_status || 'Status update'),
      from: e.type === 'movement' ? e.reference_type : (e.from_status_label || e.from_status),
      to: e.type === 'movement' ? product.name : (e.to_status_label || e.to_status),
      employee: e.performed_by || null,
      date: e.timestamp,
      remarks: e.reason || e.reference_id || null,
    }));

    return res.json({
      product: {
        id: product.id, name: product.name, barcode: product.barcode, code: product.code,
        ...publicProductStatus(product, includeHidden, lastVisibleStatus),
        vendor_id: product.vendor_id,
      },
      data: stages,
    });
  } catch (err) {
    next(err);
  }
};
