import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import sequelize from '../db.js';
import {
  Product, StockHistory, InventoryAdjustment, InventoryMovement,
} from '../models/index.js';
import {
  adjustStock,
  InventoryError,
} from '../services/inventoryService.js';
import { MOVEMENT_TYPES } from '../constants/inventory.js';

/**
 * @deprecated Phase 3 — stock_history is no longer the authoritative ledger.
 * Kept for read compatibility of pre-migration rows only. New writes use inventory_movements.
 */
export async function recordStockChange(args) {
  console.warn('[deprecated] recordStockChange → use inventoryService.recordMovement');
  return StockHistory.create({
    id: uuidv4(),
    product_id: args.product_id,
    product_name: args.product_name,
    change_type: args.change_type,
    qty_change: args.qty_change,
    qty_before: args.qty_before,
    qty_after: args.qty_after,
    reference_id: args.reference_id ?? null,
    reference_type: args.reference_type ?? null,
    notes: args.notes ?? null,
    created_by: args.created_by ?? null,
  });
}

function mapMovementToLegacy(row) {
  const m = row.toJSON ? row.toJSON() : row;
  return {
    id: m.id,
    product_id: m.product_id,
    product_name: null,
    change_type: m.movement_type,
    qty_before: m.qty_before,
    qty_change: Math.abs(m.quantity),
    qty_after: m.qty_after,
    reference_id: m.reference_id,
    reference_type: m.reference_type,
    notes: m.notes,
    created_by: m.created_by,
    created_at: m.created_at,
    shop_id: m.shop_id,
    movement_type: m.movement_type,
    quantity: m.quantity,
    gross_weight: m.gross_weight,
    net_weight: m.net_weight,
    stone_weight: m.stone_weight,
    source: 'inventory_movements',
  };
}

// GET /api/stock/history — prefers inventory_movements (authoritative)
export const listStockHistory = async (req, res, next) => {
  try {
    const {
      product_id,
      change_type,
      movement_type,
      from,
      to,
      limit = 50,
      offset = 0,
    } = req.query;

    const where = {};
    if (product_id) where.product_id = product_id;
    const typeFilter = movement_type || change_type;
    if (typeFilter) where.movement_type = typeFilter;

    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        where.created_at[Op.lte] = end;
      }
    }

    const { count, rows } = await InventoryMovement.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    // Attach product names
    const productIds = [...new Set(rows.map((r) => r.product_id))];
    const products = productIds.length
      ? await Product.findAll({ where: { id: productIds }, attributes: ['id', 'name'] })
      : [];
    const nameMap = new Map(products.map((p) => [p.id, p.name]));

    const data = rows.map((r) => {
      const mapped = mapMovementToLegacy(r);
      mapped.product_name = nameMap.get(r.product_id) || null;
      return mapped;
    });

    return res.json({ total: count, data });
  } catch (err) {
    next(err);
  }
};

export const getStockHistoryRecord = async (req, res, next) => {
  try {
    const movement = await InventoryMovement.findByPk(req.params.id);
    if (movement) {
      const product = await Product.findByPk(movement.product_id);
      const mapped = mapMovementToLegacy(movement);
      mapped.product_name = product?.name || null;
      return res.json(mapped);
    }

    // Fallback to legacy stock_history
    const record = await StockHistory.findByPk(req.params.id);
    if (!record) return res.status(404).json({ detail: 'Stock history record not found' });
    return res.json({ ...record.toJSON(), source: 'stock_history' });
  } catch (err) {
    next(err);
  }
};

export const listAdjustments = async (req, res, next) => {
  try {
    const {
      product_id,
      adjustment_type,
      limit = 50,
      offset = 0,
    } = req.query;

    const where = {};
    if (product_id) where.product_id = product_id;
    if (adjustment_type) where.adjustment_type = adjustment_type;

    const { count, rows } = await InventoryAdjustment.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    return res.json({ total: count, data: rows.map((r) => r.toJSON()) });
  } catch (err) {
    next(err);
  }
};

// POST /api/stock/adjustments — atomic via inventoryService
export const createAdjustment = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { product_id, adjustment_type, qty_change, reason, notes } = req.body;

    if (!product_id || !adjustment_type || qty_change == null) {
      await t.rollback();
      return res.status(400).json({
        detail: 'product_id, adjustment_type, and qty_change are required',
      });
    }

    const VALID_TYPES = ['add', 'remove', 'damage', 'return'];
    if (!VALID_TYPES.includes(adjustment_type)) {
      await t.rollback();
      return res.status(400).json({
        detail: `adjustment_type must be one of: ${VALID_TYPES.join(', ')}`,
      });
    }

    const parsedQty = parseFloat(qty_change);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      await t.rollback();
      return res.status(400).json({ detail: 'qty_change must be a positive number' });
    }

    const product = await Product.findByPk(product_id, { transaction: t });
    if (!product) {
      await t.rollback();
      return res.status(404).json({ detail: 'Product not found' });
    }

    const created_by = req.user?.id ?? null;
    const result = await adjustStock({
      shopId: product.shop_id,
      productId: product_id,
      adjustmentType: adjustment_type,
      quantity: parsedQty,
      reason,
      notes,
      createdBy: created_by,
      transaction: t,
    });

    const adjustment = await InventoryAdjustment.create({
      id: uuidv4(),
      shop_id: product.shop_id,
      product_id,
      product_name: product.name,
      adjustment_type,
      qty_before: result.qtyBefore,
      qty_change: parsedQty,
      qty_after: result.qtyAfter,
      reason: reason ?? null,
      notes: notes ?? null,
      created_by,
    }, { transaction: t });

    // Link movement to adjustment id when movement exists
    if (result.movement) {
      await result.movement.update(
        { reference_id: adjustment.id, reference_type: 'inventory_adjustment' },
        { transaction: t }
      );
    }

    await t.commit();
    return res.status(201).json({
      adjustment: adjustment.toJSON(),
      movement: result.movement?.toJSON?.() || result.movement,
      qty_before: result.qtyBefore,
      qty_after: result.qtyAfter,
    });
  } catch (err) {
    await t.rollback();
    if (err instanceof InventoryError) {
      return res.status(err.status || 400).json({ detail: err.message, code: err.code });
    }
    next(err);
  }
};

// GET /api/stock/movements — explicit ledger endpoint
export const listMovements = async (req, res, next) => {
  try {
    const { product_id, movement_type, limit = 50, offset = 0 } = req.query;
    const where = {};
    if (product_id) where.product_id = product_id;
    if (movement_type) where.movement_type = movement_type;

    const { count, rows } = await InventoryMovement.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    return res.json({
      total: count,
      data: rows.map((r) => r.toJSON()),
      movement_types: Object.values(MOVEMENT_TYPES),
    });
  } catch (err) {
    next(err);
  }
};
