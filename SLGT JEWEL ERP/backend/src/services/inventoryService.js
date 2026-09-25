import { Op, QueryTypes } from 'sequelize';
import sequelize, { withLock } from '../db.js';
import { newId } from '../utils.js';
import { Product, InventoryMovement, Notification, Category } from '../models/index.js';
import {
  INVENTORY_MODES,
  MOVEMENT_TYPES,
  UNIQUE_ITEM_STATUSES,
  UNIQUE_STATUS_TRANSITIONS,
  SELLABLE_UNIQUE_STATUSES,
  INVENTORY_PROTECTED_FIELDS,
  saleOutcomeStatus,
  RESTORABLE_SALE_STATUSES,
  NOT_IN_STOCK_STATUSES,
} from '../constants/inventory.js';

export class InventoryError extends Error {
  constructor(message, { status = 400, code = 'INVENTORY_ERROR' } = {}) {
    super(message);
    this.name = 'InventoryError';
    this.status = status;
    this.code = code;
  }
}

function assertShopMatch(product, shopId) {
  if (!shopId) throw new InventoryError('shop_id is required for inventory operations');
  if (product.shop_id && product.shop_id !== shopId) {
    throw new InventoryError('Cross-shop inventory movement rejected', {
      status: 403,
      code: 'CROSS_SHOP',
    });
  }
}

function weightsFromProduct(product, override = {}) {
  return {
    gross_weight: override.gross_weight ?? product.gross_weight ?? 0,
    net_weight: override.net_weight ?? product.net_weight ?? 0,
    stone_weight: override.stone_weight ?? product.stone_weight ?? 0,
  };
}

function isUnique(product) {
  return product.inventory_mode === INVENTORY_MODES.UNIQUE_TAG;
}

function canTransitionUnique(from, to) {
  const allowed = UNIQUE_STATUS_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

/**
 * Append a ledger row. Does not mutate stock by itself.
 */
export async function recordMovement({
  shopId,
  product,
  movementType,
  quantity,
  qtyBefore,
  qtyAfter,
  referenceType = null,
  referenceId = null,
  originDeviceId = null,
  createdBy = null,
  notes = null,
  weights = {},
  meta = {},
  occurredAt = null,
  transaction,
} = {}) {
  if (!transaction) throw new InventoryError('recordMovement requires a transaction', { status: 500 });
  if (!Object.values(MOVEMENT_TYPES).includes(movementType)) {
    throw new InventoryError(`Invalid movement_type: ${movementType}`);
  }
  assertShopMatch(product, shopId);

  return InventoryMovement.create({
    id: newId(),
    shop_id: shopId,
    product_id: product.id,
    movement_type: movementType,
    quantity,
    ...weightsFromProduct(product, weights),
    qty_before: qtyBefore,
    qty_after: qtyAfter,
    reference_type: referenceType,
    reference_id: referenceId,
    origin_device_id: originDeviceId,
    created_by: createdBy,
    notes,
    meta,
    ...(occurredAt ? { created_at: occurredAt } : {}),
  }, { transaction });
}

/** Append-only tag status history. Failures are non-fatal so stock still commits. */
export async function recordProductStatusChange({
  shopId,
  productId,
  fromStatus = null,
  toStatus,
  reason = null,
  referenceType = null,
  referenceId = null,
  userId = null,
  deviceId = null,
  occurredAt = null,
  transaction,
} = {}) {
  if (!transaction || !toStatus || fromStatus === toStatus) return null;
  try {
    const { ProductStatusHistory } = await import('../models/index.js');
    return ProductStatusHistory.create({
      id: newId(),
      shop_id: shopId,
      product_id: productId,
      from_status: fromStatus ?? null,
      to_status: toStatus,
      reason,
      reference_type: referenceType,
      reference_id: referenceId,
      user_id: userId,
      device_id: deviceId,
      ...(occurredAt ? { created_at: occurredAt } : {}),
    }, { transaction });
  } catch {
    return null;
  }
}

async function lockProduct(productId, transaction) {
  const product = await Product.findByPk(productId, withLock({}, transaction));
  if (!product) throw new InventoryError('Product not found', { status: 404, code: 'NOT_FOUND' });
  return product;
}

/** Normalize Sequelize UPDATE result → affected row count (Postgres + SQLite). */
function affectedRows(queryResult) {
  if (typeof queryResult === 'number') return queryResult;
  if (!Array.isArray(queryResult)) return 0;
  const meta = queryResult[1];
  if (typeof meta === 'number') return meta;
  if (meta && typeof meta.changes === 'number') return meta.changes;
  if (meta && typeof meta.rowCount === 'number') return meta.rowCount;
  if (Array.isArray(queryResult[0])) return queryResult[0].length;
  return 0;
}

export async function atomicUpdate(sql, replacements, transaction) {
  const result = await sequelize.query(sql, {
    replacements,
    transaction,
    type: QueryTypes.UPDATE,
  });
  let n = affectedRows(result);
  if (n === 0 && sequelize.getDialect() === 'sqlite') {
    // Some sqlite bindings return empty metadata — use changes()
    const row = await sequelize.query('SELECT changes() AS c', {
      transaction,
      type: QueryTypes.SELECT,
    });
    n = Number(row?.[0]?.c ?? row?.c ?? 0);
  }
  return n;
}

/** Parse JSON stored in notification.data safely */
function parseNotifData(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return {}; } }
  return raw;
}

/**
 * Find or create/update a single unread notification keyed by a data-field match.
 * Prevents duplicate alerts for the same condition.
 */
async function upsertSystemNotification({ shopId, type, matchFn, title, message, data, transaction }) {
  const candidates = await Notification.findAll({
    where: { type, is_read: false, user_id: null, ...(shopId ? { shop_id: shopId } : {}) },
    transaction,
    limit: 100,
  });
  const existing = candidates.find((n) => matchFn(parseNotifData(n.data)));

  if (existing) {
    await existing.update({ title, message, data: { ...parseNotifData(existing.data), ...data } }, { transaction });
    return;
  }

  await Notification.create({
    id: newId(),
    shop_id: shopId || null,
    type,
    title,
    message,
    data,
    is_read: false,
    user_id: null,
  }, { transaction });
}

/**
 * Resolve (mark read) existing unread notifications matching a condition.
 * Called when stock is replenished above threshold.
 */
async function resolveSystemNotification({ shopId, type, matchFn, transaction }) {
  const candidates = await Notification.findAll({
    where: { type, is_read: false, user_id: null, ...(shopId ? { shop_id: shopId } : {}) },
    transaction,
    limit: 100,
  });
  for (const n of candidates) {
    if (matchFn(parseNotifData(n.data))) {
      await n.update({ is_read: true }, { transaction });
    }
  }
}

/**
 * Check all stock thresholds after a stock decrease and raise alerts as needed.
 * - Out-of-stock: product-level, when qtyAfter reaches 0
 * - Low-stock: product-level, when qtyAfter <= product.low_stock_threshold
 * - Low-stock: subcategory-level, when SUM(subcategory stock) <= category.low_stock_threshold
 */
export async function maybeLowStockNotify(product, qtyAfter, transaction) {
  const shopId = product?.shop_id;
  const productName = product?.name || product?.code || 'Product';

  // ── 1. Out-of-stock alert (product-level) ─────────────────────────────────
  if (qtyAfter <= 0) {
    await upsertSystemNotification({
      shopId,
      type: 'out_of_stock',
      matchFn: (d) => d.product_id === product.id,
      title: `Out of Stock: ${productName}`,
      message: `${productName} is completely out of stock. Restock immediately to resume sales.`,
      data: { product_id: product.id, product_name: productName, stock_qty: 0 },
      transaction,
    });
    // Also resolve any existing low_stock alert for this product since it's now OOS
    await resolveSystemNotification({
      shopId,
      type: 'low_stock',
      matchFn: (d) => d.product_id === product.id && !d.subcategory_id,
      transaction,
    });
  }

  // ── 2. Product-level low-stock threshold ──────────────────────────────────
  const productThreshold = parseFloat(product?.low_stock_threshold);
  if (productThreshold > 0 && qtyAfter > 0 && qtyAfter <= productThreshold) {
    await upsertSystemNotification({
      shopId,
      type: 'low_stock',
      matchFn: (d) => d.product_id === product.id && !d.subcategory_id,
      title: `Low Stock: ${productName}`,
      message: `${productName} has ${qtyAfter} unit(s) remaining (threshold: ${productThreshold}).`,
      data: { product_id: product.id, product_name: productName, stock_qty: qtyAfter, threshold: productThreshold },
      transaction,
    });
  }

  // ── 3. Subcategory-level threshold ────────────────────────────────────────
  const subcategoryId = product?.subcategory_id;
  if (!subcategoryId) return;

  const sub = await Category.findByPk(subcategoryId, { transaction });
  if (!sub || !sub.parent_id) return;

  const subThreshold = parseFloat(sub.low_stock_threshold);
  if (!(subThreshold > 0)) return;

  const rows = await sequelize.query(
    `SELECT COALESCE(SUM(CAST(stock_qty AS REAL)), 0) AS stock_qty
     FROM products
     WHERE deleted_at IS NULL AND subcategory_id = :sub_id`,
    { replacements: { sub_id: subcategoryId }, type: QueryTypes.SELECT, transaction },
  );
  const totalStock = Number(rows?.[0]?.stock_qty ?? 0);
  if (totalStock > subThreshold) return;

  const parent = await Category.findByPk(sub.parent_id, { transaction });
  const categoryName = parent?.name || 'Category';
  const subName = sub.name || 'Sub-category';

  await upsertSystemNotification({
    shopId,
    type: 'low_stock',
    matchFn: (d) => d.subcategory_id === subcategoryId,
    title: `Low Stock: ${categoryName} / ${subName}`,
    message: `${subName} (under ${categoryName}) is low on stock — ${totalStock} pcs remaining, threshold is ${subThreshold}.`,
    data: {
      subcategory_id: subcategoryId,
      category_id: sub.parent_id,
      category_name: categoryName,
      subcategory_name: subName,
      stock_qty: totalStock,
      threshold: subThreshold,
      product_id: product.id,
    },
    transaction,
  });
}

/**
 * Resolve low-stock / out-of-stock alerts after a stock increase.
 * Called from increaseStock so alerts clear automatically when you restock.
 */
export async function resolveStockAlerts(product, qtyAfter, transaction) {
  const shopId = product?.shop_id;

  // Resolve out-of-stock alert if stock is back above zero
  if (qtyAfter > 0) {
    await resolveSystemNotification({
      shopId,
      type: 'out_of_stock',
      matchFn: (d) => d.product_id === product.id,
      transaction,
    });
  }

  // Resolve product-level low-stock alert if above threshold
  const productThreshold = parseFloat(product?.low_stock_threshold);
  if (productThreshold > 0 && qtyAfter > productThreshold) {
    await resolveSystemNotification({
      shopId,
      type: 'low_stock',
      matchFn: (d) => d.product_id === product.id && !d.subcategory_id,
      transaction,
    });
  }

  // Resolve subcategory-level low-stock alert if total is now above threshold
  const subcategoryId = product?.subcategory_id;
  if (!subcategoryId) return;

  const sub = await Category.findByPk(subcategoryId, { transaction });
  if (!sub || !sub.parent_id) return;

  const subThreshold = parseFloat(sub.low_stock_threshold);
  if (!(subThreshold > 0)) return;

  const rows = await sequelize.query(
    `SELECT COALESCE(SUM(CAST(stock_qty AS REAL)), 0) AS stock_qty
     FROM products
     WHERE deleted_at IS NULL AND subcategory_id = :sub_id`,
    { replacements: { sub_id: subcategoryId }, type: QueryTypes.SELECT, transaction },
  );
  const totalStock = Number(rows?.[0]?.stock_qty ?? 0);
  if (totalStock > subThreshold) {
    await resolveSystemNotification({
      shopId,
      type: 'low_stock',
      matchFn: (d) => d.subcategory_id === subcategoryId,
      transaction,
    });
  }
}

/**
 * Quantity-mode: increase stock + ledger.
 */
export async function increaseStock({
  shopId,
  productId,
  quantity,
  movementType = MOVEMENT_TYPES.PURCHASE,
  referenceType = null,
  referenceId = null,
  createdBy = null,
  originDeviceId = null,
  notes = null,
  weights = {},
  transaction: externalTx = null,
} = {}) {
  const qty = parseFloat(quantity);
  if (!qty || qty <= 0) throw new InventoryError('quantity must be a positive number');

  const run = async (transaction) => {
    const product = await lockProduct(productId, transaction);
    assertShopMatch(product, shopId || product.shop_id);
    const resolvedShopId = shopId || product.shop_id;

    if (isUnique(product)) {
      throw new InventoryError(
        'Use unique-item APIs for unique_tag products (cannot bulk-increase)',
        { code: 'UNIQUE_MODE' }
      );
    }

    const qtyBefore = parseFloat(product.stock_qty) || 0;
    // Atomic increment (no race for concurrent purchases)
    await atomicUpdate(
      `UPDATE products
       SET stock_qty = COALESCE(stock_qty, 0) + :qty,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :id AND shop_id = :shopId`,
      { id: productId, shopId: resolvedShopId, qty },
      transaction,
    );
    await product.reload({ transaction });
    const qtyAfter = parseFloat(product.stock_qty) || 0;

    const movement = await recordMovement({
      shopId: resolvedShopId,
      product,
      movementType,
      quantity: qty,
      qtyBefore,
      qtyAfter,
      referenceType,
      referenceId,
      createdBy,
      originDeviceId,
      notes,
      weights,
      transaction,
    });

    // Sale return / restock of a sold or hidden-sold tag → Available again.
    if (qtyAfter > 0 && RESTORABLE_SALE_STATUSES.includes(product.status)) {
      const fromStatus = product.status;
      await atomicUpdate(
        `UPDATE products
         SET status = 'available', updated_at = CURRENT_TIMESTAMP
         WHERE id = :id AND shop_id = :shopId AND status IN ('sold', 'deleted_p')`,
        { id: productId, shopId: resolvedShopId },
        transaction,
      );
      await product.reload({ transaction });
      await recordProductStatusChange({
        shopId: resolvedShopId,
        productId,
        fromStatus,
        toStatus: UNIQUE_ITEM_STATUSES.AVAILABLE,
        reason: 'sale_return',
        referenceType,
        referenceId,
        userId: createdBy,
        deviceId: originDeviceId,
        transaction,
      });
    }

    // Resolve any low-stock / out-of-stock alerts now that stock has increased
    await resolveStockAlerts(product, qtyAfter, transaction);

    return { product, movement, qtyBefore, qtyAfter };
  };

  if (externalTx) return run(externalTx);
  return sequelize.transaction(run);
}

/**
 * Quantity-mode: decrease stock + ledger (SALE / ADJUSTMENT_REMOVE / etc.).
 */
export async function decreaseStock({
  shopId,
  productId,
  quantity,
  movementType = MOVEMENT_TYPES.SALE,
  referenceType = null,
  referenceId = null,
  createdBy = null,
  originDeviceId = null,
  notes = null,
  weights = {},
  isHidden = false,
  occurredAt = null,
  transaction: externalTx = null,
} = {}) {
  const qty = parseFloat(quantity);
  if (!qty || qty <= 0) throw new InventoryError('quantity must be a positive number');

  const run = async (transaction) => {
    const product = await lockProduct(productId, transaction);
    assertShopMatch(product, shopId || product.shop_id);
    const resolvedShopId = shopId || product.shop_id;

    if (isUnique(product)) {
      throw new InventoryError(
        'Use markUniqueItemSold for unique_tag products',
        { code: 'UNIQUE_MODE' }
      );
    }

    const qtyBefore = parseFloat(product.stock_qty) || 0;
    const fromStatus = product.status;
    // Atomic conditional decrement — prevents stock going negative under concurrent POS
    const changed = await atomicUpdate(
      `UPDATE products
       SET stock_qty = stock_qty - :qty,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :id
         AND shop_id = :shopId
         AND stock_qty >= :qty`,
      { id: productId, shopId: resolvedShopId, qty },
      transaction,
    );
    if (changed === 0) {
      throw new InventoryError(
        'Item is no longer available.',
        { status: 409, code: 'INSUFFICIENT_STOCK' },
      );
    }
    await product.reload({ transaction });
    const qtyAfter = parseFloat(product.stock_qty) || 0;

    const movement = await recordMovement({
      shopId: resolvedShopId,
      product,
      movementType,
      quantity: -qty,
      qtyBefore,
      qtyAfter,
      referenceType,
      referenceId,
      createdBy,
      originDeviceId,
      notes,
      weights,
      occurredAt,
      transaction,
    });

    // Quantity-mode jewellery tags: last piece sold → Sold out or Deleted P.
    if (movementType === MOVEMENT_TYPES.SALE && qtyAfter <= 0) {
      const toStatus = saleOutcomeStatus(isHidden);
      await atomicUpdate(
        `UPDATE products
         SET status = :toStatus, updated_at = CURRENT_TIMESTAMP
         WHERE id = :id
           AND shop_id = :shopId
           AND stock_qty <= 0
           AND status NOT IN ('sold', 'deleted_p', 'deleted')`,
        { id: productId, shopId: resolvedShopId, toStatus },
        transaction,
      );
      await product.reload({ transaction });
      await recordProductStatusChange({
        shopId: resolvedShopId,
        productId,
        fromStatus,
        toStatus,
        reason: isHidden ? 'hidden_sale' : 'sale',
        referenceType,
        referenceId,
        userId: createdBy,
        deviceId: originDeviceId,
        occurredAt,
        transaction,
      });
    }

    await maybeLowStockNotify(product, qtyAfter, transaction);
    return { product, movement, qtyBefore, qtyAfter };
  };

  if (externalTx) return run(externalTx);
  return sequelize.transaction(run);
}

/**
 * Manual adjustments: add / remove / damage / return (qty) for quantity mode,
 * or damage for unique mode.
 */
export async function adjustStock({
  shopId,
  productId,
  adjustmentType,
  quantity,
  reason = null,
  notes = null,
  createdBy = null,
  originDeviceId = null,
  transaction: externalTx = null,
} = {}) {
  const qty = parseFloat(quantity);
  if (!qty || qty <= 0) throw new InventoryError('quantity must be a positive number');

  const map = {
    add: MOVEMENT_TYPES.ADJUSTMENT_ADD,
    remove: MOVEMENT_TYPES.ADJUSTMENT_REMOVE,
    damage: MOVEMENT_TYPES.DAMAGE,
    return: MOVEMENT_TYPES.ADJUSTMENT_ADD, // stock return into inventory
  };
  const movementType = map[adjustmentType];
  if (!movementType) {
    throw new InventoryError(`adjustment_type must be one of: ${Object.keys(map).join(', ')}`);
  }

  const run = async (transaction) => {
    const product = await lockProduct(productId, transaction);
    assertShopMatch(product, shopId || product.shop_id);
    const resolvedShopId = shopId || product.shop_id;

    if (isUnique(product)) {
      if (adjustmentType === 'damage') {
        return damageUniqueItem({
          shopId: resolvedShopId,
          productId,
          notes: notes || reason,
          createdBy,
          originDeviceId,
          transaction,
        });
      }
      if (adjustmentType === 'add' || adjustmentType === 'return') {
        throw new InventoryError(
          'Cannot quantity-adjust a unique_tag item; use returnUniqueItem or set mode carefully',
          { code: 'UNIQUE_MODE' }
        );
      }
      if (adjustmentType === 'remove') {
        throw new InventoryError(
          'Cannot quantity-remove a unique_tag item; use damageItem or mark sold',
          { code: 'UNIQUE_MODE' }
        );
      }
    }

    if (adjustmentType === 'add' || adjustmentType === 'return') {
      return increaseStock({
        shopId: resolvedShopId,
        productId,
        quantity: qty,
        movementType,
        referenceType: 'inventory_adjustment',
        createdBy,
        originDeviceId,
        notes: notes || reason,
        transaction,
      });
    }

    return decreaseStock({
      shopId: resolvedShopId,
      productId,
      quantity: qty,
      movementType,
      referenceType: 'inventory_adjustment',
      createdBy,
      originDeviceId,
      notes: notes || reason,
      transaction,
    });
  };

  if (externalTx) return run(externalTx);
  return sequelize.transaction(run);
}

/**
 * Unique-tag: mark sold (one sale max until returned).
 * When requestId is provided, the item must be reserved by that checkout
 * (or still available with no competing lease).
 */
export async function markUniqueItemSold({
  shopId,
  productId,
  referenceType = 'invoice',
  referenceId = null,
  createdBy = null,
  originDeviceId = null,
  requestId = null,
  quotationId = null,
  notes = null,
  isHidden = false,
  occurredAt = null,
  transaction: externalTx = null,
} = {}) {
  const run = async (transaction) => {
    const product = await lockProduct(productId, transaction);
    assertShopMatch(product, shopId || product.shop_id);
    const resolvedShopId = shopId || product.shop_id;
    const toStatus = saleOutcomeStatus(isHidden);

    if (!isUnique(product)) {
      throw new InventoryError('Product is not inventory_mode=unique_tag', { code: 'NOT_UNIQUE' });
    }
    if (!product.barcode || !String(product.barcode).trim()) {
      throw new InventoryError('unique_tag items require a barcode before sale', {
        code: 'BARCODE_REQUIRED',
      });
    }

    const fromStatus = product.status || UNIQUE_ITEM_STATUSES.AVAILABLE;
    if (RESTORABLE_SALE_STATUSES.includes(fromStatus) || fromStatus === UNIQUE_ITEM_STATUSES.DELETED) {
      throw new InventoryError('Item already sold or unavailable', {
        status: 409,
        code: 'ALREADY_SOLD',
      });
    }
    if (!SELLABLE_UNIQUE_STATUSES.includes(fromStatus) && fromStatus !== UNIQUE_ITEM_STATUSES.RESERVED) {
      throw new InventoryError(
        `Item already ${fromStatus} — cannot sell`,
        { status: 409, code: 'ALREADY_SOLD' }
      );
    }

    // Active estimation booking lease always wins — only that quotation may sell the tag
    {
      const { SaleAuthority } = await import('../models/index.js');
      const { Op } = await import('sequelize');
      const bookingLease = await SaleAuthority.findOne({
        where: {
          shop_id: resolvedShopId,
          entity_type: 'product',
          entity_id: productId,
          status: 'GRANTED',
          expires_at: { [Op.gt]: new Date() },
          request_id: { [Op.like]: 'quotation:%' },
        },
        transaction,
      });
      if (bookingLease) {
        const bookingKey = quotationId ? quotationBookingRequestId(quotationId) : null;
        const ok = bookingKey && (
          bookingLease.request_id === bookingKey
          || bookingLease.request_id === `${bookingKey}::${productId}`
          || String(bookingLease.request_id).startsWith(`${bookingKey}::`)
        );
        if (!ok) {
          throw new InventoryError(
            'Item is booked on an estimation — open that estimation in POS or cancel the booking first.',
            { status: 409, code: 'ITEM_RESERVED' },
          );
        }
      }
    }

    // If reserved, require matching reservation ownership for this checkout
    // or a long-lived estimation booking lease for quotationId.
    if (fromStatus === UNIQUE_ITEM_STATUSES.RESERVED || fromStatus === UNIQUE_ITEM_STATUSES.ESTIMATION) {
      const bookingKey = quotationId ? quotationBookingRequestId(quotationId) : null;
      if (!requestId && !bookingKey) {
        throw new InventoryError(
          'Item is currently reserved at another counter.',
          { status: 409, code: 'ITEM_RESERVED' },
        );
      }
      const { SaleAuthority } = await import('../models/index.js');
      const { Op } = await import('sequelize');
      await SaleAuthority.update(
        { status: 'EXPIRED' },
        {
          where: {
            shop_id: resolvedShopId,
            entity_id: productId,
            status: 'GRANTED',
            expires_at: { [Op.lt]: new Date() },
            // Never expire active booking leases here — handled by booking expiry flow
            request_id: { [Op.notLike]: 'quotation:%' },
          },
          transaction,
        },
      );
      const orKeys = [];
      if (requestId) {
        orKeys.push({ request_id: requestId });
        orKeys.push({ request_id: { [Op.like]: `${requestId}::%` } });
      }
      if (bookingKey) {
        orKeys.push({ request_id: bookingKey });
        orKeys.push({ request_id: `${bookingKey}::${productId}` });
      }
      const lease = await SaleAuthority.findOne({
        where: {
          shop_id: resolvedShopId,
          entity_type: 'product',
          entity_id: productId,
          status: 'GRANTED',
          [Op.or]: orKeys,
        },
        transaction,
      });
      if (!lease || lease.expires_at < new Date()) {
        throw new InventoryError(
          'Item is currently reserved at another counter.',
          { status: 409, code: 'ITEM_RESERVED' },
        );
      }
    }

    // Conditional update — rejects concurrent double-sale
    const soldRows = await atomicUpdate(
      `UPDATE products
       SET status = :toStatus, stock_qty = 0, updated_at = CURRENT_TIMESTAMP
       WHERE id = :id
         AND shop_id = :shopId
         AND inventory_mode = 'unique_tag'
         AND status IN ('available', 'on_display', 'reserved', 'estimation')`,
      { id: productId, shopId: resolvedShopId, toStatus },
      transaction,
    );

    if (soldRows === 0) {
      throw new InventoryError('Item already sold or unavailable', {
        status: 409,
        code: 'ALREADY_SOLD',
      });
    }

    await product.reload({ transaction });
    const qtyBefore = 1;
    const qtyAfter = 0;

    await recordProductStatusChange({
      shopId: resolvedShopId,
      productId,
      fromStatus,
      toStatus,
      reason: isHidden ? 'hidden_sale' : 'sale',
      referenceType,
      referenceId,
      userId: createdBy,
      deviceId: originDeviceId,
      occurredAt,
      transaction,
    });

    // Commit matching leases
    if (requestId) {
      try {
        const { SaleAuthority } = await import('../models/index.js');
        const { Op } = await import('sequelize');
        await SaleAuthority.update(
          { status: 'COMMITTED', committed_at: new Date() },
          {
            where: {
              shop_id: resolvedShopId,
              entity_id: productId,
              status: 'GRANTED',
              [Op.or]: [
                { request_id: requestId },
                { request_id: { [Op.like]: `${requestId}::%` } },
              ],
            },
            transaction,
          },
        );
      } catch { /* non-fatal */ }
    }

    const movement = await recordMovement({
      shopId: resolvedShopId,
      product,
      movementType: MOVEMENT_TYPES.SALE,
      quantity: -1,
      qtyBefore,
      qtyAfter,
      referenceType,
      referenceId,
      createdBy,
      originDeviceId,
      notes,
      weights: weightsFromProduct(product),
      meta: { from_status: fromStatus, to_status: toStatus, request_id: requestId, hidden_sale: Boolean(isHidden) },
      occurredAt,
      transaction,
    });

    // Unique items go to 0 when sold — trigger out-of-stock alert
    await maybeLowStockNotify(product, qtyAfter, transaction);

    return { product, movement, qtyBefore, qtyAfter };
  };

  if (externalTx) return run(externalTx);
  return sequelize.transaction(run);
}

/**
 * Reserve a unique jewellery item: AVAILABLE/ON_DISPLAY → RESERVED.
 * Creates / reuses a SaleAuthority lease bound to requestId.
 */
export async function reserveUniqueItem({
  shopId,
  productId,
  requestId,
  deviceId = null,
  ttlSeconds = 90,
  transaction: externalTx = null,
} = {}) {
  if (!requestId) throw new InventoryError('request_id required for reservation', { status: 400 });
  const run = async (transaction) => {
    const product = await lockProduct(productId, transaction);
    assertShopMatch(product, shopId || product.shop_id);
    const resolvedShopId = shopId || product.shop_id;
    if (!isUnique(product)) {
      throw new InventoryError('Reservation applies only to unique_tag jewellery', { code: 'NOT_UNIQUE' });
    }

    const { SaleAuthority } = await import('../models/index.js');
    const { Op } = await import('sequelize');

    // Expire stale POS leases only — never auto-release active estimation bookings
    const stale = await SaleAuthority.findAll({
      where: {
        shop_id: resolvedShopId,
        entity_type: 'product',
        entity_id: productId,
        status: 'GRANTED',
        expires_at: { [Op.lt]: new Date() },
        request_id: { [Op.notLike]: 'quotation:%' },
      },
      transaction,
    });
    for (const lease of stale) {
      await lease.update({ status: 'EXPIRED' }, { transaction });
    }
    if (stale.length) {
      const stillHeld = await SaleAuthority.findOne({
        where: {
          shop_id: resolvedShopId,
          entity_type: 'product',
          entity_id: productId,
          status: 'GRANTED',
          expires_at: { [Op.gt]: new Date() },
        },
        transaction,
      });
      if (!stillHeld) {
        await sequelize.query(
          `UPDATE products SET status = 'available', updated_at = CURRENT_TIMESTAMP
           WHERE id = :id AND shop_id = :shopId AND status = 'reserved'`,
          { replacements: { id: productId, shopId: resolvedShopId }, transaction },
        );
      }
    }

    const leaseKey = `${requestId}::${productId}`;
    const existing = await SaleAuthority.findOne({
      where: {
        [Op.or]: [{ request_id: leaseKey }, { request_id: requestId, entity_id: productId }],
      },
      transaction,
    });
    if (existing?.status === 'GRANTED' && existing.expires_at > new Date()) {
      return {
        granted: true,
        lease_id: existing.id,
        expires_at: existing.expires_at,
        idempotent: true,
        product,
      };
    }

    const conflict = await SaleAuthority.findOne({
      where: {
        shop_id: resolvedShopId,
        entity_type: 'product',
        entity_id: productId,
        status: 'GRANTED',
        expires_at: { [Op.gt]: new Date() },
      },
      transaction,
    });
    if (conflict) {
      throw new InventoryError(
        'Item is currently reserved at another counter.',
        { status: 409, code: 'ITEM_RESERVED' },
      );
    }

    const reservedRows = await atomicUpdate(
      `UPDATE products
       SET status = 'reserved', updated_at = CURRENT_TIMESTAMP
       WHERE id = :id
         AND shop_id = :shopId
         AND inventory_mode = 'unique_tag'
         AND status IN ('available', 'on_display')`,
      { id: productId, shopId: resolvedShopId },
      transaction,
    );
    if (reservedRows === 0) {
      await product.reload({ transaction });
      if (product.status === UNIQUE_ITEM_STATUSES.SOLD) {
        throw new InventoryError('Item already sold or unavailable', {
          status: 409,
          code: 'ALREADY_SOLD',
        });
      }
      throw new InventoryError(
        'Item is currently reserved at another counter.',
        { status: 409, code: 'ITEM_RESERVED' },
      );
    }

    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const lease = await SaleAuthority.create({
      shop_id: resolvedShopId,
      device_id: deviceId || 'unknown',
      request_id: leaseKey,
      entity_type: 'product',
      entity_id: productId,
      status: 'GRANTED',
      expires_at: expiresAt,
      meta: { checkout_request_id: requestId },
    }, { transaction });

    await product.reload({ transaction });
    try {
      const { ProductStatusHistory } = await import('../models/index.js');
      await ProductStatusHistory.create({
        id: newId(),
        shop_id: resolvedShopId,
        product_id: productId,
        from_status: product.status === 'reserved' ? 'available' : null,
        to_status: 'reserved',
        reason: 'pos_reserve',
        reference_type: 'checkout',
        reference_id: requestId,
        device_id: deviceId,
      }, { transaction });
    } catch { /* */ }
    return { granted: true, lease_id: lease.id, expires_at: expiresAt, product };
  };

  if (externalTx) return run(externalTx);
  return sequelize.transaction(run);
}

/**
 * Release a unique-item reservation: RESERVED → AVAILABLE.
 */
export async function releaseUniqueItem({
  shopId,
  productId,
  requestId = null,
  leaseId = null,
  transaction: externalTx = null,
} = {}) {
  const run = async (transaction) => {
    const product = await lockProduct(productId, transaction);
    assertShopMatch(product, shopId || product.shop_id);
    const resolvedShopId = shopId || product.shop_id;
    const { SaleAuthority } = await import('../models/index.js');
    const { Op } = await import('sequelize');

    const where = {
      shop_id: resolvedShopId,
      entity_type: 'product',
      entity_id: productId,
      status: 'GRANTED',
    };
    if (leaseId) where.id = leaseId;
    else if (requestId) {
      where[Op.or] = [
        { request_id: requestId },
        { request_id: `${requestId}::${productId}` },
      ];
    }

    await SaleAuthority.update(
      { status: 'RELEASED', released_at: new Date() },
      { where, transaction },
    );

    await sequelize.query(
      `UPDATE products
       SET status = 'available', updated_at = CURRENT_TIMESTAMP
       WHERE id = :id AND shop_id = :shopId AND status = 'reserved'`,
      { replacements: { id: productId, shopId: resolvedShopId }, transaction },
    );
    await product.reload({ transaction });
    return { ok: true, product };
  };

  if (externalTx) return run(externalTx);
  return sequelize.transaction(run);
}

/**
 * Unique-tag: sale return → available.
 */
export async function returnUniqueItem({
  shopId,
  productId,
  referenceType = 'sale_return',
  referenceId = null,
  createdBy = null,
  originDeviceId = null,
  notes = null,
  transaction: externalTx = null,
} = {}) {
  const run = async (transaction) => {
    const product = await lockProduct(productId, transaction);
    assertShopMatch(product, shopId || product.shop_id);
    const resolvedShopId = shopId || product.shop_id;

    if (!isUnique(product)) {
      throw new InventoryError('Product is not inventory_mode=unique_tag', { code: 'NOT_UNIQUE' });
    }

    const fromStatus = product.status;
    if (!RESTORABLE_SALE_STATUSES.includes(fromStatus)) {
      throw new InventoryError(`Cannot return item with status "${fromStatus}" (expected sold or deleted_p)`, {
        code: 'NOT_SOLD',
      });
    }

    const returned = await atomicUpdate(
      `UPDATE products
       SET status = 'available', stock_qty = 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = :id
         AND shop_id = :shopId
         AND inventory_mode = 'unique_tag'
         AND status IN ('sold', 'deleted_p')`,
      { id: productId, shopId: resolvedShopId },
      transaction,
    );
    if (returned === 0) {
      throw new InventoryError('Return failed — item not in sold state', { code: 'NOT_SOLD' });
    }

    await product.reload({ transaction });

    await recordProductStatusChange({
      shopId: resolvedShopId,
      productId,
      fromStatus,
      toStatus: UNIQUE_ITEM_STATUSES.AVAILABLE,
      reason: 'sale_return',
      referenceType,
      referenceId,
      userId: createdBy,
      deviceId: originDeviceId,
      transaction,
    });

    const movement = await recordMovement({
      shopId: resolvedShopId,
      product,
      movementType: MOVEMENT_TYPES.SALE_RETURN,
      quantity: 1,
      qtyBefore: 0,
      qtyAfter: 1,
      referenceType,
      referenceId,
      createdBy,
      originDeviceId,
      notes,
      weights: weightsFromProduct(product),
      meta: { from_status: fromStatus, to_status: 'available' },
      transaction,
    });

    // Item returned to stock — resolve any out-of-stock alert
    await resolveStockAlerts(product, 1, transaction);

    return { product, movement, qtyBefore: 0, qtyAfter: 1 };
  };

  if (externalTx) return run(externalTx);
  return sequelize.transaction(run);
}

export async function damageUniqueItem({
  shopId,
  productId,
  notes = null,
  createdBy = null,
  originDeviceId = null,
  transaction: externalTx = null,
} = {}) {
  const run = async (transaction) => {
    const product = await lockProduct(productId, transaction);
    assertShopMatch(product, shopId || product.shop_id);
    const resolvedShopId = shopId || product.shop_id;

    if (!isUnique(product)) {
      // quantity-mode damage handled via decreaseStock
      throw new InventoryError('damageUniqueItem requires unique_tag mode');
    }

    const fromStatus = product.status;
    if (fromStatus === UNIQUE_ITEM_STATUSES.SOLD) {
      throw new InventoryError('Cannot damage a sold item without return first');
    }
    if (fromStatus === UNIQUE_ITEM_STATUSES.DAMAGED) {
      throw new InventoryError('Item already damaged');
    }
    if (!canTransitionUnique(fromStatus, UNIQUE_ITEM_STATUSES.DAMAGED)) {
      throw new InventoryError(`Invalid transition ${fromStatus} → damaged`);
    }

    const qtyBefore = parseFloat(product.stock_qty) || 0;
    await product.update({ status: UNIQUE_ITEM_STATUSES.DAMAGED, stock_qty: 0 }, { transaction });

    const movement = await recordMovement({
      shopId: resolvedShopId,
      product,
      movementType: MOVEMENT_TYPES.DAMAGE,
      quantity: qtyBefore > 0 ? -qtyBefore : -1,
      qtyBefore,
      qtyAfter: 0,
      referenceType: 'inventory_adjustment',
      createdBy,
      originDeviceId,
      notes,
      meta: { from_status: fromStatus, to_status: 'damaged' },
      transaction,
    });

    return { product, movement, qtyBefore, qtyAfter: 0 };
  };

  if (externalTx) return run(externalTx);
  return sequelize.transaction(run);
}

/**
 * Toggle a product's merchandising "on display" flag: AVAILABLE ⇄ ON_DISPLAY.
 * Purely a location flag — no stock_qty change, no ledger movement. Works for
 * both unique_tag and quantity-mode products (unlike reserve/damage/sold,
 * which apply to unique_tag items only).
 */
export async function setDisplayStatus({
  shopId,
  productId,
  onDisplay,
  createdBy = null,
  transaction: externalTx = null,
} = {}) {
  const run = async (transaction) => {
    const product = await lockProduct(productId, transaction);
    assertShopMatch(product, shopId || product.shop_id);
    const resolvedShopId = shopId || product.shop_id;

    const fromStatus = product.status;
    const target = onDisplay ? UNIQUE_ITEM_STATUSES.ON_DISPLAY : UNIQUE_ITEM_STATUSES.AVAILABLE;
    if (fromStatus === target) {
      return { product, unchanged: true };
    }
    if (fromStatus !== UNIQUE_ITEM_STATUSES.AVAILABLE && fromStatus !== UNIQUE_ITEM_STATUSES.ON_DISPLAY) {
      throw new InventoryError(
        `Cannot change display status while item is "${fromStatus}"`,
        { status: 409, code: 'INVALID_STATUS_FOR_DISPLAY' },
      );
    }

    const updatedRows = await atomicUpdate(
      `UPDATE products
       SET status = :target, updated_at = CURRENT_TIMESTAMP
       WHERE id = :id AND shop_id = :shopId AND status = :fromStatus`,
      { id: productId, shopId: resolvedShopId, target, fromStatus },
      transaction,
    );
    if (updatedRows === 0) {
      throw new InventoryError('Item status changed — reload and try again', { status: 409, code: 'STALE_STATUS' });
    }

    await product.reload({ transaction });

    try {
      const { ProductStatusHistory } = await import('../models/index.js');
      await ProductStatusHistory.create({
        id: newId(),
        shop_id: resolvedShopId,
        product_id: productId,
        from_status: fromStatus,
        to_status: target,
        reason: onDisplay ? 'marked_on_display' : 'removed_from_display',
        reference_type: 'manual',
        user_id: createdBy,
      }, { transaction });
    } catch { /* non-fatal */ }

    return { product, unchanged: false };
  };

  if (externalTx) return run(externalTx);
  return sequelize.transaction(run);
}

/**
 * Validate availability for sale (used by Phase 4 POS; also useful now).
 */
export async function validateAvailability(productId, quantity = 1, { transaction } = {}) {
  const product = transaction
    ? await lockProduct(productId, transaction)
    : await Product.findByPk(productId);
  if (!product) throw new InventoryError('Product not found', { status: 404 });

  if (isUnique(product)) {
    if (!SELLABLE_UNIQUE_STATUSES.includes(product.status)) {
      throw new InventoryError(`Item unavailable (status: ${product.status})`, { code: 'UNAVAILABLE' });
    }
    if (quantity !== 1) {
      throw new InventoryError('unique_tag items can only be sold with quantity 1');
    }
    return { product, mode: INVENTORY_MODES.UNIQUE_TAG };
  }

  const qty = parseFloat(product.stock_qty) || 0;
  if (NOT_IN_STOCK_STATUSES.includes(product.status)) {
    throw new InventoryError(`Item unavailable (status: ${product.status})`, { code: 'UNAVAILABLE' });
  }
  if (qty < quantity) {
    throw new InventoryError(
      `Insufficient stock for "${product.name}". Available: ${qty}`,
      { status: 409, code: 'INSUFFICIENT_STOCK' }
    );
  }
  return { product, mode: INVENTORY_MODES.QUANTITY };
}

/**
 * Apply a sale line against inventory (quantity or unique).
 * Phase 3: used by invoices; Phase 4 will harden further.
 */
export async function applySaleLine({
  shopId,
  productId,
  quantity = 1,
  referenceType = 'invoice',
  referenceId = null,
  createdBy = null,
  originDeviceId = null,
  requestId = null,
  quotationId = null,
  affectLiveStock = true,
  isHidden = false,
  occurredAt = null,
  transaction,
} = {}) {
  if (!transaction) throw new InventoryError('applySaleLine requires a transaction', { status: 500 });

  const product = await lockProduct(productId, transaction);
  assertShopMatch(product, shopId || product.shop_id);
  const resolvedShopId = shopId || product.shop_id;

  if (affectLiveStock === false) {
    const qty = isUnique(product) ? 1 : (parseFloat(quantity) || 1);
    const qtyNow = parseFloat(product.stock_qty) || 0;
    const movement = await recordMovement({
      shopId: resolvedShopId,
      product,
      movementType: MOVEMENT_TYPES.SALE,
      quantity: -Math.abs(qty),
      qtyBefore: qtyNow,
      qtyAfter: qtyNow,
      referenceType,
      referenceId,
      originDeviceId,
      createdBy,
      notes: 'PRE_ACCOUNTS test sale — live stock not reduced',
      meta: { financial_mode: 'PRE_ACCOUNTS', test_sale: true },
      occurredAt,
      transaction,
    });
    return { product, movement, qtyBefore: qtyNow, qtyAfter: qtyNow, test: true };
  }

  if (isUnique(product)) {
    return markUniqueItemSold({
      shopId: resolvedShopId,
      productId,
      referenceType,
      referenceId,
      createdBy,
      originDeviceId,
      requestId,
      quotationId,
      isHidden,
      occurredAt,
      transaction,
    });
  }

  return decreaseStock({
    shopId: resolvedShopId,
    productId,
    quantity,
    movementType: MOVEMENT_TYPES.SALE,
    referenceType,
    referenceId,
    createdBy,
    originDeviceId,
    isHidden,
    occurredAt,
    transaction,
  });
}

/**
 * Reverse a prior sale line (invoice cancel / sale return).
 * Creates SALE_RETURN movements — never deletes historical SALE rows.
 */
export async function applyReturnLine({
  shopId,
  productId,
  quantity = 1,
  referenceType = 'invoice_cancel',
  referenceId = null,
  createdBy = null,
  originDeviceId = null,
  transaction,
} = {}) {
  if (!transaction) throw new InventoryError('applyReturnLine requires a transaction', { status: 500 });

  const product = await lockProduct(productId, transaction);
  assertShopMatch(product, shopId || product.shop_id);
  const resolvedShopId = shopId || product.shop_id;

  if (isUnique(product)) {
    return returnUniqueItem({
      shopId: resolvedShopId,
      productId,
      referenceType,
      referenceId,
      createdBy,
      originDeviceId,
      transaction,
    });
  }

  return increaseStock({
    shopId: resolvedShopId,
    productId,
    quantity,
    movementType: MOVEMENT_TYPES.SALE_RETURN,
    referenceType,
    referenceId,
    createdBy,
    originDeviceId,
    transaction,
  });
}

/**
 * Strip protected inventory fields from a generic product PATCH body.
 * Returns { safeUpdates, blocked }.
 */
export function stripInventoryFieldsFromProductUpdate(body = {}, { allowStockQty = false } = {}) {
  const safeUpdates = { ...body };
  const blocked = [];
  for (const field of INVENTORY_PROTECTED_FIELDS) {
    if (field === 'stock_qty' && allowStockQty) continue;
    if (Object.prototype.hasOwnProperty.call(safeUpdates, field)) {
      blocked.push(field);
      delete safeUpdates[field];
    }
  }
  return { safeUpdates, blocked };
}

/**
 * Set inventory_mode explicitly (admin). unique_tag requires barcode and stock 0|1.
 */
export async function setInventoryMode({
  shopId,
  productId,
  mode,
  createdBy = null,
  transaction: externalTx = null,
} = {}) {
  if (!Object.values(INVENTORY_MODES).includes(mode)) {
    throw new InventoryError(`mode must be one of: ${Object.values(INVENTORY_MODES).join(', ')}`);
  }

  const run = async (transaction) => {
    const product = await lockProduct(productId, transaction);
    assertShopMatch(product, shopId || product.shop_id);

    if (mode === INVENTORY_MODES.UNIQUE_TAG) {
      if (!product.barcode || !String(product.barcode).trim()) {
        throw new InventoryError('Cannot set unique_tag without a barcode');
      }
      const qty = parseFloat(product.stock_qty) || 0;
      if (qty !== 0 && qty !== 1) {
        throw new InventoryError(
          `unique_tag requires stock_qty 0 or 1 (currently ${qty}). Adjust stock first.`
        );
      }
      if (product.status === UNIQUE_ITEM_STATUSES.SOLD && qty !== 0) {
        throw new InventoryError('Inconsistent sold unique item stock');
      }
    }

    await product.update({ inventory_mode: mode }, { transaction });
    return product;
  };

  if (externalTx) return run(externalTx);
  return sequelize.transaction(run);
}

/** Stable SaleAuthority request_id prefix for estimation bookings. */
export function quotationBookingRequestId(quotationId) {
  return `quotation:${quotationId}`;
}

/**
 * Tray unit: carve the sold weight out of the tray the moment an estimation is
 * booked (advance taken) — not just at final POS billing. Otherwise the tray's
 * full weight still shows as available to the next customer's estimation even
 * though this weight is already promised. Atomic conditional decrement, same
 * guarded-UPDATE pattern decreaseStock uses, so concurrent bookings on the
 * same tray can't oversell its weight.
 */
export async function reserveTrayWeightForBooking({
  shopId,
  productId,
  weight,
  transaction: externalTx = null,
} = {}) {
  const w = parseFloat(weight);
  if (!(w > 0)) throw new InventoryError('weight must be a positive number');

  const run = async (transaction) => {
    const product = await lockProduct(productId, transaction);
    assertShopMatch(product, shopId || product.shop_id);
    const resolvedShopId = shopId || product.shop_id;

    const changed = await atomicUpdate(
      `UPDATE products
       SET tray_total_weight = ROUND(ROUND(COALESCE(tray_total_weight, 0), 3) - :weight, 3),
           gross_weight = ROUND(ROUND(COALESCE(tray_total_weight, 0), 3) - :weight, 3),
           net_weight = ROUND(ROUND(COALESCE(tray_total_weight, 0), 3) - :weight, 3),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :id AND shop_id = :shopId AND ROUND(COALESCE(tray_total_weight, 0), 3) >= :weight`,
      { id: productId, shopId: resolvedShopId, weight: w },
      transaction,
    );
    if (changed === 0) {
      throw new InventoryError(
        `Tray weight is no longer available for "${product.name || product.barcode}"`,
        { status: 409, code: 'INSUFFICIENT_STOCK' },
      );
    }
    await product.reload({ transaction });
    return product;
  };

  if (externalTx) return run(externalTx);
  return sequelize.transaction(run);
}

/** Reverse of reserveTrayWeightForBooking — booking cancelled/expired, give the weight back. */
export async function restoreTrayWeightForBooking({
  shopId,
  productId,
  weight,
  transaction: externalTx = null,
} = {}) {
  const w = parseFloat(weight);
  if (!(w > 0)) return null;

  const run = async (transaction) => {
    const product = await lockProduct(productId, transaction);
    const resolvedShopId = shopId || product.shop_id;
    await atomicUpdate(
      `UPDATE products
       SET tray_total_weight = ROUND(ROUND(COALESCE(tray_total_weight, 0), 3) + :weight, 3),
           gross_weight = ROUND(ROUND(COALESCE(tray_total_weight, 0), 3) + :weight, 3),
           net_weight = ROUND(ROUND(COALESCE(tray_total_weight, 0), 3) + :weight, 3),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :id ${resolvedShopId ? 'AND shop_id = :shopId' : ''}`,
      { id: productId, shopId: resolvedShopId, weight: w },
      transaction,
    );
    await product.reload({ transaction });
    return product;
  };

  if (externalTx) return run(externalTx);
  return sequelize.transaction(run);
}

/**
 * Long-lived unique-tag reserve for a booked estimation (until validUntil end-of-day).
 */
/**
 * Hold a jewellery tag for a booked estimation (advance taken) until deadline.
 * Unique tags and 1-piece quantity tags get status "estimation" — still in the
 * shop, not free to sell on POS except via that estimation. TEST bookings
 * never call this. Bulk/tray SKUs are not status-held (tray weight is carved out separately).
 */
export async function reserveForQuotationBooking({
  shopId,
  productId,
  quotationId,
  validUntil,
  createdBy = null,
  transaction: externalTx = null,
} = {}) {
  if (!quotationId) throw new InventoryError('quotationId required', { status: 400 });
  const run = async (transaction) => {
    const product = await lockProduct(productId, transaction);
    assertShopMatch(product, shopId || product.shop_id);
    const resolvedShopId = shopId || product.shop_id;
    const fromStatus = product.status || UNIQUE_ITEM_STATUSES.AVAILABLE;
    const qty = parseFloat(product.stock_qty) || 0;
    const tray = Number(product.tray_total_weight) > 0;
    const unique = isUnique(product);
    const singleTag = unique || (!tray && qty === 1);

    if (!singleTag) {
      return { ok: true, skipped: true, product };
    }
    if (![UNIQUE_ITEM_STATUSES.AVAILABLE, UNIQUE_ITEM_STATUSES.ON_DISPLAY].includes(fromStatus)) {
      throw new InventoryError(
        `Item "${product.name || product.barcode}" is ${fromStatus} — cannot book`,
        { status: 409, code: 'ITEM_UNAVAILABLE' },
      );
    }

    const expiresAt = validUntil
      ? new Date(`${String(validUntil).slice(0, 10)}T23:59:59.999`)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const { SaleAuthority } = await import('../models/index.js');
    const bookingKey = quotationBookingRequestId(quotationId);
    const leaseKey = `${bookingKey}::${productId}`;
    const deviceId = 'quotation-booking';

    const existing = await SaleAuthority.findOne({
      where: { request_id: leaseKey },
      transaction,
    });
    if (existing?.status === 'GRANTED' && existing.expires_at > new Date()) {
      return { ok: true, lease_id: existing.id, product, idempotent: true };
    }

    const heldRows = await atomicUpdate(
      `UPDATE products
       SET status = 'estimation', updated_at = CURRENT_TIMESTAMP
       WHERE id = :id AND shop_id = :shopId
         AND status IN ('available', 'on_display')`,
      { id: productId, shopId: resolvedShopId },
      transaction,
    );
    if (heldRows === 0) {
      throw new InventoryError(
        `Item "${product.name || product.barcode}" is no longer available`,
        { status: 409, code: 'ITEM_UNAVAILABLE' },
      );
    }

    let lease;
    if (existing) {
      await existing.update({
        status: 'GRANTED',
        expires_at: expiresAt,
        released_at: null,
        device_id: deviceId,
        meta: { quotation_id: quotationId, kind: 'quotation_booking', created_by: createdBy },
      }, { transaction });
      lease = existing;
    } else {
      lease = await SaleAuthority.create({
        id: newId(),
        shop_id: resolvedShopId,
        request_id: leaseKey,
        entity_type: 'product',
        entity_id: productId,
        status: 'GRANTED',
        expires_at: expiresAt,
        device_id: deviceId,
        meta: { quotation_id: quotationId, kind: 'quotation_booking', created_by: createdBy },
      }, { transaction });
    }

    await recordProductStatusChange({
      shopId: resolvedShopId,
      productId,
      fromStatus,
      toStatus: UNIQUE_ITEM_STATUSES.ESTIMATION,
      reason: 'quotation_booking',
      referenceType: 'quotation',
      referenceId: quotationId,
      userId: createdBy,
      transaction,
    });

    await product.reload({ transaction });
    return { ok: true, lease_id: lease.id, product };
  };

  if (externalTx) return run(externalTx);
  return sequelize.transaction(run);
}

/** Release all unique-tag reserves for a quotation booking. */
export async function releaseQuotationBookingReserves({
  shopId,
  quotationId,
  productIds = [],
  transaction: externalTx = null,
} = {}) {
  if (!quotationId) throw new InventoryError('quotationId required', { status: 400 });
  const run = async (transaction) => {
    const { SaleAuthority } = await import('../models/index.js');
    const { Op } = await import('sequelize');
    const bookingKey = quotationBookingRequestId(quotationId);
    const ids = [...new Set((productIds || []).filter(Boolean))];

    for (const productId of ids) {
      await SaleAuthority.update(
        { status: 'RELEASED', released_at: new Date() },
        {
          where: {
            status: 'GRANTED',
            entity_type: 'product',
            entity_id: productId,
            [Op.or]: [
              { request_id: bookingKey },
              { request_id: `${bookingKey}::${productId}` },
            ],
          },
          transaction,
        },
      );
      await sequelize.query(
        `UPDATE products
         SET status = 'available', updated_at = CURRENT_TIMESTAMP
         WHERE id = :id AND status IN ('reserved', 'estimation')
           ${shopId ? 'AND shop_id = :shopId' : ''}`,
        {
          replacements: { id: productId, ...(shopId ? { shopId } : {}) },
          transaction,
        },
      );
    }
    return { ok: true, released: ids.length };
  };

  if (externalTx) return run(externalTx);
  return sequelize.transaction(run);
}

export { INVENTORY_PROTECTED_FIELDS, MOVEMENT_TYPES, INVENTORY_MODES };
