import { Op, fn, col } from 'sequelize';
import sequelize, { withLock } from '../db.js';
import { newId, parseMultiParam } from '../utils.js';
import {
  Product, Category, CatalogItem, ShopCounter, User,
  BarcodeStockCheckSession, BarcodeStockCheckScan,
} from '../models/index.js';

export class BarcodeStockCheckError extends Error {
  constructor(message, { status = 400, code = 'BARCODE_STOCK_CHECK_ERROR' } = {}) {
    super(message);
    this.name = 'BarcodeStockCheckError';
    this.status = status;
    this.code = code;
  }
}

function normalizeBarcode(v) {
  return String(v ?? '').trim();
}

/**
 * Physical stock currently in the shop — matches the scope a stock check
 * should cover. Passing categoryId narrows this to a single category-wise
 * session's scope; omitted/null keeps the existing "All Products" behavior.
 */
function expectedStockWhere(categoryId) {
  const where = {
    deleted_at: null,
    status: { [Op.notIn]: ['discontinued', 'sold', 'deleted', 'deleted_p'] },
    stock_qty: { [Op.gt]: 0 },
  };
  if (categoryId) where.category_id = categoryId;
  return where;
}

async function fetchScopeProducts({ transaction, categoryId } = {}) {
  return Product.findAll({
    where: expectedStockWhere(categoryId),
    attributes: [
      'id', 'name', 'barcode', 'category_id', 'subcategory_id', 'metal_type_id',
      'purity_id', 'counter_id', 'stock_qty', 'gross_weight', 'net_weight', 'status',
      'tray_total_weight',
    ],
    raw: true,
    transaction,
  });
}

async function enrichNames(rows) {
  const categoryIds = new Set();
  const catalogIds = new Set();
  const counterIds = new Set();
  for (const r of rows) {
    if (r.category_id) categoryIds.add(r.category_id);
    if (r.subcategory_id) categoryIds.add(r.subcategory_id);
    if (r.purity_id) catalogIds.add(r.purity_id);
    if (r.metal_type_id) catalogIds.add(r.metal_type_id);
    if (r.counter_id) counterIds.add(r.counter_id);
  }
  const [categories, catalogItems, counters] = await Promise.all([
    categoryIds.size ? Category.findAll({ where: { id: { [Op.in]: [...categoryIds] } }, attributes: ['id', 'name'], raw: true }) : [],
    catalogIds.size ? CatalogItem.findAll({ where: { id: { [Op.in]: [...catalogIds] } }, attributes: ['id', 'name'], raw: true }) : [],
    counterIds.size ? ShopCounter.findAll({ where: { id: { [Op.in]: [...counterIds] } }, attributes: ['id', 'name'], raw: true }) : [],
  ]);
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  // purity and metal type are both CatalogItem rows, looked up together.
  const catalogNames = new Map(catalogItems.map((c) => [c.id, c.name]));
  const counterNames = new Map(counters.map((c) => [c.id, c.name]));
  return rows.map((r) => ({
    ...r,
    category_name: categoryNames.get(r.category_id) || null,
    subcategory_name: categoryNames.get(r.subcategory_id) || null,
    purity_name: catalogNames.get(r.purity_id) || null,
    metal_name: catalogNames.get(r.metal_type_id) || null,
    counter_name: counterNames.get(r.counter_id) || null,
  }));
}

/**
 * Deterministic aggregation of all in-scope physical stock, grouped by barcode.
 * Duplicate product rows sharing a barcode are summed into one expected quantity.
 * Rows with no barcode are kept separate for manual verification.
 */
async function getExpectedAggregation(categoryId) {
  const rawRows = await fetchScopeProducts({ categoryId });
  const rows = await enrichNames(rawRows);

  const byBarcode = new Map();
  const nonBarcoded = [];

  for (const r of rows) {
    const barcode = normalizeBarcode(r.barcode);
    const qty = Number(r.stock_qty) || 0;
    // Tray unit: gross/net weight already hold the tray's own pooled weight
    // (not a per-piece figure) — use as-is instead of multiplying by pieces.
    const isTray = Number(r.tray_total_weight) > 0;
    const grossTotal = isTray ? (Number(r.tray_total_weight) || 0) : (Number(r.gross_weight) || 0) * qty;
    const netTotal = isTray ? (Number(r.tray_total_weight) || 0) : (Number(r.net_weight) || 0) * qty;

    if (!barcode) {
      nonBarcoded.push({
        product_id: r.id,
        item_name: r.name,
        quantity: qty,
        gross_weight: grossTotal,
        net_weight: netTotal,
        category_name: r.category_name,
        subcategory_name: r.subcategory_name,
        purity_name: r.purity_name,
        counter_name: r.counter_name,
        reason: 'No barcode',
      });
      continue;
    }

    if (!byBarcode.has(barcode)) {
      byBarcode.set(barcode, {
        barcode,
        item_name: r.name,
        category_id: r.category_id,
        category_name: r.category_name,
        subcategory_id: r.subcategory_id,
        subcategory_name: r.subcategory_name,
        purity_id: r.purity_id,
        purity_name: r.purity_name,
        metal_type_id: r.metal_type_id,
        metal_name: r.metal_name,
        counter_id: r.counter_id,
        counter_name: r.counter_name,
        expected_quantity: 0,
        gross_weight: 0,
        net_weight: 0,
        product_ids: [],
      });
    }
    const entry = byBarcode.get(barcode);
    entry.expected_quantity += qty;
    entry.gross_weight += grossTotal;
    entry.net_weight += netTotal;
    entry.product_ids.push(r.id);
  }

  return { byBarcode, nonBarcoded };
}

async function getScannedCounts(sessionId) {
  const rows = await BarcodeStockCheckScan.findAll({
    where: { session_id: sessionId, result: 'matched' },
    attributes: ['barcode', [fn('COUNT', col('id')), 'cnt']],
    group: ['barcode'],
    raw: true,
  });
  const map = new Map();
  for (const r of rows) map.set(r.barcode, Number(r.cnt) || 0);
  return map;
}

function paginate(rows, { page = 1, pageSize = 50, all = false } = {}) {
  const total = rows.length;
  if (all) {
    const cap = 5000;
    return { items: rows.slice(0, cap), total, page: 1, page_size: total, truncated: total > cap };
  }
  const size = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const p = Math.max(Number(page) || 1, 1);
  const start = (p - 1) * size;
  return { items: rows.slice(start, start + size), total, page: p, page_size: size, truncated: false };
}

export async function getOrCreateSession({ shopId, sessionId, userId, deviceId, categoryId }) {
  if (sessionId) {
    const existing = await BarcodeStockCheckSession.findByPk(sessionId);
    // Resuming an existing session always honors whatever scope it was
    // originally created with — a session's scope never changes mid-flight
    // (each category gets its own session; see the frontend's per-scope
    // session-id bookkeeping).
    if (existing) return existing;
  }
  let categoryName = null;
  if (categoryId) {
    const category = await Category.findByPk(categoryId);
    categoryName = category?.name || null;
  }
  return BarcodeStockCheckSession.create({
    id: newId(),
    shop_id: shopId || null,
    status: 'active',
    created_by: userId || null,
    device_id: deviceId || null,
    category_id: categoryId || null,
    category_name: categoryName,
    started_at: new Date(),
  });
}

export async function getSession(sessionId) {
  const session = await BarcodeStockCheckSession.findByPk(sessionId);
  if (!session) {
    throw new BarcodeStockCheckError('Stock check session not found', { status: 404, code: 'SESSION_NOT_FOUND' });
  }
  return session;
}

/** Expected/scanned/pending totals for the session — also keeps session.status in sync. */
export async function computeSummary(sessionId) {
  const session = await getSession(sessionId);
  const { byBarcode, nonBarcoded } = await getExpectedAggregation(session.category_id);
  const scannedCounts = await getScannedCounts(sessionId);

  let totalExpectedPieces = 0;
  let totalScannedPieces = 0;
  let completedBarcodes = 0;
  let discrepancyBarcodes = 0;

  for (const [barcode, entry] of byBarcode) {
    const rawScanned = scannedCounts.get(barcode) || 0;
    const clamped = Math.min(rawScanned, entry.expected_quantity);
    totalExpectedPieces += entry.expected_quantity;
    totalScannedPieces += clamped;
    if (entry.expected_quantity > 0 && clamped >= entry.expected_quantity) completedBarcodes += 1;
    if (rawScanned > entry.expected_quantity) discrepancyBarcodes += 1;
  }

  const expectedBarcodes = byBarcode.size;
  const pendingBarcodes = expectedBarcodes - completedBarcodes;
  const pendingPieces = Math.max(totalExpectedPieces - totalScannedPieces, 0);
  const nonBarcodedPieces = nonBarcoded.reduce((s, r) => s + r.quantity, 0);
  const isComplete = expectedBarcodes > 0 && totalScannedPieces === totalExpectedPieces;

  if (isComplete && session.status !== 'completed') {
    await session.update({ status: 'completed', completed_at: new Date() });
  } else if (!isComplete && session.status === 'completed') {
    await session.update({ status: 'active', completed_at: null });
  }

  return {
    session_id: session.id,
    status: isComplete ? 'completed' : 'active',
    category_id: session.category_id || null,
    category_name: session.category_name || null,
    started_at: session.started_at,
    reset_count: session.reset_count,
    expected_pieces: totalExpectedPieces,
    scanned_pieces: totalScannedPieces,
    pending_pieces: pendingPieces,
    expected_barcodes: expectedBarcodes,
    completed_barcodes: completedBarcodes,
    pending_barcodes: pendingBarcodes,
    non_barcoded_count: nonBarcoded.length,
    non_barcoded_pieces: nonBarcodedPieces,
    is_complete: isComplete,
    has_discrepancy: discrepancyBarcodes > 0,
    discrepancy_barcodes: discrepancyBarcodes,
  };
}

export async function listStock({ sessionId, filters = {}, page, pageSize, all }) {
  const session = await getSession(sessionId);
  const { byBarcode } = await getExpectedAggregation(session.category_id);
  const scannedCounts = await getScannedCounts(sessionId);

  let rows = [...byBarcode.values()].map((entry) => {
    const rawScanned = scannedCounts.get(entry.barcode) || 0;
    const scanned = Math.min(rawScanned, entry.expected_quantity);
    const pending = Math.max(entry.expected_quantity - scanned, 0);
    const completed = entry.expected_quantity > 0 && scanned >= entry.expected_quantity;
    return {
      barcode: entry.barcode,
      item_name: entry.item_name,
      category_id: entry.category_id,
      category_name: entry.category_name,
      subcategory_id: entry.subcategory_id,
      subcategory_name: entry.subcategory_name,
      purity_id: entry.purity_id,
      purity_name: entry.purity_name,
      metal_type_id: entry.metal_type_id,
      metal_name: entry.metal_name,
      counter_id: entry.counter_id,
      counter_name: entry.counter_name,
      expected_quantity: entry.expected_quantity,
      scanned_quantity: scanned,
      pending_quantity: pending,
      gross_weight: entry.gross_weight,
      net_weight: entry.net_weight,
      status: completed ? 'completed' : (scanned > 0 ? 'in_progress' : 'pending'),
      over_scanned: rawScanned > entry.expected_quantity,
    };
  });

  const { search, category_id, subcategory_id, counter_id, purity_id, metal_type_id, status, show_completed } = filters;
  if (search) {
    const q = String(search).toLowerCase();
    rows = rows.filter((r) => r.barcode.toLowerCase().includes(q) || (r.item_name || '').toLowerCase().includes(q));
  }
  // Each filter may be a single id or a comma-separated list (multi-select).
  const categoryIds = parseMultiParam(category_id);
  if (categoryIds) rows = rows.filter((r) => categoryIds.includes(r.category_id));
  const subcategoryIds = parseMultiParam(subcategory_id);
  if (subcategoryIds) rows = rows.filter((r) => subcategoryIds.includes(r.subcategory_id));
  const counterIds = parseMultiParam(counter_id);
  if (counterIds) rows = rows.filter((r) => counterIds.includes(r.counter_id));
  const purityIds = parseMultiParam(purity_id);
  if (purityIds) rows = rows.filter((r) => purityIds.includes(r.purity_id));
  const metalTypeIds = parseMultiParam(metal_type_id);
  if (metalTypeIds) rows = rows.filter((r) => metalTypeIds.includes(r.metal_type_id));
  const statuses = parseMultiParam(status);
  if (statuses) rows = rows.filter((r) => statuses.includes(r.status));
  else if (!show_completed) rows = rows.filter((r) => r.status !== 'completed');

  rows.sort((a, b) => (a.item_name || '').localeCompare(b.item_name || '') || a.barcode.localeCompare(b.barcode));

  return paginate(rows, { page, pageSize, all });
}

export async function listManualVerification({ sessionId, filters = {}, page, pageSize, all }) {
  const session = await getSession(sessionId);
  const { nonBarcoded } = await getExpectedAggregation(session.category_id);
  let rows = nonBarcoded;

  const { search } = filters;
  if (search) {
    const q = String(search).toLowerCase();
    rows = rows.filter((r) => (r.item_name || '').toLowerCase().includes(q));
  }

  rows = [...rows].sort((a, b) => (a.item_name || '').localeCompare(b.item_name || ''));

  return paginate(rows, { page, pageSize, all });
}

export async function listHistory({ sessionId, limit = 50 }) {
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const scans = await BarcodeStockCheckScan.findAll({
    where: { session_id: sessionId },
    order: [['created_at', 'DESC']],
    limit: cap,
    raw: true,
  });
  const userIds = [...new Set(scans.map((s) => s.scanned_by).filter(Boolean))];
  const users = userIds.length
    ? await User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ['id', 'name'], raw: true })
    : [];
  const userNames = new Map(users.map((u) => [u.id, u.name]));
  return scans.map((s) => ({
    id: s.id,
    barcode: s.barcode,
    item_name: s.item_name,
    result: s.result,
    scanned_by_name: userNames.get(s.scanned_by) || null,
    created_at: s.created_at,
  }));
}

/**
 * Record one physical scan. Transaction locks the session row so concurrent
 * rapid scans of the same barcode (or two scanners at once) cannot both read
 * the same "scanned so far" count and push scanned_quantity past expected.
 */
export async function recordScan({ sessionId, barcode, userId, deviceId }) {
  const raw = normalizeBarcode(barcode);
  if (!raw) {
    throw new BarcodeStockCheckError('Barcode is required', { status: 400, code: 'BARCODE_REQUIRED' });
  }

  return sequelize.transaction(async (t) => {
    const session = await BarcodeStockCheckSession.findByPk(sessionId, withLock({}, t));
    if (!session) {
      throw new BarcodeStockCheckError('Stock check session not found', { status: 404, code: 'SESSION_NOT_FOUND' });
    }

    const categoryId = session.category_id || null;
    const matches = await Product.findAll({
      where: { ...expectedStockWhere(categoryId), barcode: raw },
      attributes: ['id', 'name', 'stock_qty'],
      transaction: t,
    });
    const expectedQuantity = matches.reduce((s, p) => s + (Number(p.stock_qty) || 0), 0);
    const itemName = matches[0]?.name || null;
    const productId = matches[0]?.id || null;

    if (expectedQuantity <= 0) {
      // Category-wise session: before declaring the barcode unknown, check
      // whether it actually belongs to some OTHER category — that's a
      // "wrong category" scan, not a genuinely missing/unrecognized product.
      if (categoryId) {
        const outside = await Product.findAll({
          where: { ...expectedStockWhere(), barcode: raw },
          attributes: ['id', 'name', 'category_id'],
          transaction: t,
        });
        if (outside.length) {
          const actualCategory = outside[0].category_id
            ? await Category.findByPk(outside[0].category_id, { transaction: t })
            : null;
          await BarcodeStockCheckScan.create({
            id: newId(),
            session_id: sessionId,
            shop_id: session.shop_id,
            barcode: raw,
            product_id: outside[0].id,
            item_name: outside[0].name,
            result: 'wrong_category',
            scanned_by: userId || null,
            device_id: deviceId || null,
          }, { transaction: t });
          return {
            result: 'wrong_category',
            barcode: raw,
            item_name: outside[0].name,
            expected_category_name: session.category_name || null,
            actual_category_name: actualCategory?.name || null,
          };
        }
      }
      await BarcodeStockCheckScan.create({
        id: newId(),
        session_id: sessionId,
        shop_id: session.shop_id,
        barcode: raw,
        product_id: null,
        item_name: null,
        result: 'not_found',
        scanned_by: userId || null,
        device_id: deviceId || null,
      }, { transaction: t });
      return { result: 'not_found', barcode: raw };
    }

    const scannedSoFar = await BarcodeStockCheckScan.count({
      where: { session_id: sessionId, barcode: raw, result: 'matched' },
      transaction: t,
    });

    if (scannedSoFar >= expectedQuantity) {
      await BarcodeStockCheckScan.create({
        id: newId(),
        session_id: sessionId,
        shop_id: session.shop_id,
        barcode: raw,
        product_id: productId,
        item_name: itemName,
        result: 'already_completed',
        scanned_by: userId || null,
        device_id: deviceId || null,
      }, { transaction: t });
      return {
        result: 'already_completed',
        barcode: raw,
        item_name: itemName,
        expected_quantity: expectedQuantity,
        scanned_quantity: scannedSoFar,
        pending_quantity: 0,
        completed: true,
      };
    }

    await BarcodeStockCheckScan.create({
      id: newId(),
      session_id: sessionId,
      shop_id: session.shop_id,
      barcode: raw,
      product_id: productId,
      item_name: itemName,
      result: 'matched',
      scanned_by: userId || null,
      device_id: deviceId || null,
    }, { transaction: t });

    const scannedQuantity = scannedSoFar + 1;
    const pendingQuantity = Math.max(expectedQuantity - scannedQuantity, 0);
    return {
      result: 'matched',
      barcode: raw,
      item_name: itemName,
      expected_quantity: expectedQuantity,
      scanned_quantity: scannedQuantity,
      pending_quantity: pendingQuantity,
      completed: pendingQuantity === 0,
    };
  });
}

/**
 * Per-category progress overview — one row per top-level category that has
 * in-stock barcoded products, using that category's most recent stock-check
 * session (if any). Purely a read/aggregation over existing data — no new
 * tables, and does not affect or depend on which session is "current" for
 * the caller's own screen.
 */
export async function listCategorySummaries() {
  const categories = await Category.findAll({
    where: { parent_id: null },
    attributes: ['id', 'name'],
    order: [['display_order', 'ASC'], ['name', 'ASC']],
    raw: true,
  });

  const results = [];
  for (const cat of categories) {
    const { byBarcode } = await getExpectedAggregation(cat.id);
    const expectedBarcodes = byBarcode.size;
    if (expectedBarcodes === 0) continue; // nothing to check in this category

    let expectedPieces = 0;
    for (const entry of byBarcode.values()) expectedPieces += entry.expected_quantity;

    const latestSession = await BarcodeStockCheckSession.findOne({
      where: { category_id: cat.id },
      order: [['started_at', 'DESC']],
    });

    let scannedPieces = 0;
    let completedBarcodes = 0;
    if (latestSession) {
      const scannedCounts = await getScannedCounts(latestSession.id);
      for (const entry of byBarcode.values()) {
        const rawScanned = scannedCounts.get(entry.barcode) || 0;
        const clamped = Math.min(rawScanned, entry.expected_quantity);
        scannedPieces += clamped;
        if (entry.expected_quantity > 0 && clamped >= entry.expected_quantity) completedBarcodes += 1;
      }
    }

    results.push({
      category_id: cat.id,
      category_name: cat.name,
      session_id: latestSession?.id || null,
      expected_pieces: expectedPieces,
      scanned_pieces: scannedPieces,
      pending_pieces: Math.max(expectedPieces - scannedPieces, 0),
      expected_barcodes: expectedBarcodes,
      completed_barcodes: completedBarcodes,
      progress_pct: expectedPieces > 0 ? Math.round((scannedPieces / expectedPieces) * 1000) / 10 : 0,
      is_complete: expectedBarcodes > 0 && scannedPieces === expectedPieces,
    });
  }
  return results;
}

/** Clears this session's scan progress only — never touches Product/stock_qty. */
export async function resetSession(sessionId) {
  return sequelize.transaction(async (t) => {
    const session = await BarcodeStockCheckSession.findByPk(sessionId, withLock({}, t));
    if (!session) {
      throw new BarcodeStockCheckError('Stock check session not found', { status: 404, code: 'SESSION_NOT_FOUND' });
    }
    await BarcodeStockCheckScan.destroy({ where: { session_id: sessionId }, transaction: t });
    await session.update({
      status: 'active',
      completed_at: null,
      reset_at: new Date(),
      reset_count: (session.reset_count || 0) + 1,
    }, { transaction: t });
    return session;
  });
}
