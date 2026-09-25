import { Op } from 'sequelize';
import sequelize from '../db.js';
import { SaleAuthority, Product } from '../models/index.js';
import {
  InventoryError,
  reserveUniqueItem,
  releaseUniqueItem,
} from '../services/inventoryService.js';
import { INVENTORY_MODES } from '../constants/inventory.js';

const LEASE_TTL_SECONDS = 90;

/** Expire stale GRANTED leases and free reserved products. */
async function expireStaleLeases(shopId, transaction = null) {
  const stale = await SaleAuthority.findAll({
    where: {
      shop_id: shopId,
      status: 'GRANTED',
      expires_at: { [Op.lt]: new Date() },
    },
    transaction,
  });
  for (const lease of stale) {
    await lease.update({ status: 'EXPIRED' }, { transaction });
    if (lease.entity_type === 'product') {
      await sequelize.query(
        `UPDATE products SET status = 'available', updated_at = CURRENT_TIMESTAMP
         WHERE id = :id AND shop_id = :shopId AND status = 'reserved'`,
        {
          replacements: { id: lease.entity_id, shopId },
          transaction,
        },
      );
    }
  }
}

/**
 * POST /api/authority/reserve
 * Body: { entity_type, entity_id, request_id, device_id }
 * Unique jewellery: AVAILABLE → RESERVED with lease ownership.
 * Quantity products: lease only (stock still decremented atomically at checkout).
 */
export const reserve = async (req, res, next) => {
  try {
    const shopId = req.user?.shop_id;
    if (!shopId) return res.status(403).json({ detail: 'No shop_id on token' });

    const { entity_type = 'product', entity_id, request_id, device_id } = req.body;
    if (!entity_id || !request_id) {
      return res.status(400).json({ detail: 'entity_id and request_id are required' });
    }

    await expireStaleLeases(shopId);

    if (entity_type === 'product') {
      const product = await Product.findByPk(entity_id);
      if (!product) return res.status(404).json({ detail: 'Product not found' });
      if (product.inventory_mode === INVENTORY_MODES.UNIQUE_TAG) {
        try {
          const result = await reserveUniqueItem({
            shopId,
            productId: entity_id,
            requestId: request_id,
            deviceId: device_id || req.user?.device_id || 'unknown',
            ttlSeconds: LEASE_TTL_SECONDS,
          });
          return res.status(result.idempotent ? 200 : 201).json({
            granted: true,
            lease_id: result.lease_id,
            expires_at: result.expires_at,
            idempotent: Boolean(result.idempotent),
            status: 'reserved',
          });
        } catch (err) {
          if (err instanceof InventoryError) {
            return res.status(err.status || 409).json({
              granted: false,
              reason: err.message,
              code: err.code,
            });
          }
          throw err;
        }
      }
    }

    // Quantity / non-unique: soft lease (does not lock stock_qty)
    const t = await sequelize.transaction();
    try {
      const leaseKey = `${request_id}::${entity_id}`;
      const existing = await SaleAuthority.findOne({
        where: { request_id: leaseKey },
        transaction: t,
      });
      if (existing) {
        await t.commit();
        if (existing.status === 'GRANTED' && existing.expires_at > new Date()) {
          return res.json({
            granted: true,
            lease_id: existing.id,
            expires_at: existing.expires_at,
            idempotent: true,
          });
        }
        return res.status(409).json({
          granted: false,
          reason: `Existing lease in status ${existing.status}`,
          code: 'LEASE_CONFLICT',
        });
      }

      const expiresAt = new Date(Date.now() + LEASE_TTL_SECONDS * 1000);
      const lease = await SaleAuthority.create({
        shop_id: shopId,
        device_id: device_id || req.user?.device_id || 'unknown',
        request_id: leaseKey,
        entity_type,
        entity_id,
        status: 'GRANTED',
        expires_at: expiresAt,
        meta: { checkout_request_id: request_id },
      }, { transaction: t });
      await t.commit();
      return res.status(201).json({ granted: true, lease_id: lease.id, expires_at: expiresAt });
    } catch (err) {
      await t.rollback();
      throw err;
    }
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/authority/commit
 * Body: { lease_id, invoice_id? }
 */
export const commit = async (req, res, next) => {
  try {
    const shopId = req.user?.shop_id;
    const { lease_id } = req.body;
    if (!lease_id) return res.status(400).json({ detail: 'lease_id required' });

    const lease = await SaleAuthority.findOne({ where: { id: lease_id, shop_id: shopId } });
    if (!lease) return res.status(404).json({ detail: 'Lease not found' });
    if (lease.status === 'COMMITTED') return res.json({ ok: true, idempotent: true });
    if (lease.status !== 'GRANTED') {
      return res.status(409).json({ detail: `Cannot commit lease in status ${lease.status}`, code: 'INVALID_LEASE_STATE' });
    }
    if (lease.expires_at < new Date()) {
      return res.status(409).json({ detail: 'Lease has expired', code: 'LEASE_EXPIRED' });
    }

    await lease.update({ status: 'COMMITTED', committed_at: new Date() });
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/authority/release
 * Body: { lease_id } | { request_id, entity_id }
 */
export const release = async (req, res, next) => {
  try {
    const shopId = req.user?.shop_id;
    const { lease_id, request_id, entity_id } = req.body;

    let lease = null;
    if (lease_id) {
      lease = await SaleAuthority.findOne({ where: { id: lease_id, shop_id: shopId } });
    } else if (request_id && entity_id) {
      lease = await SaleAuthority.findOne({
        where: {
          shop_id: shopId,
          entity_id,
          status: 'GRANTED',
          [Op.or]: [
            { request_id },
            { request_id: `${request_id}::${entity_id}` },
          ],
        },
      });
    } else {
      return res.status(400).json({ detail: 'lease_id or (request_id + entity_id) required' });
    }

    if (!lease) return res.status(404).json({ detail: 'Lease not found' });
    if (['RELEASED', 'EXPIRED', 'COMMITTED'].includes(lease.status)) {
      return res.json({ ok: true, idempotent: true });
    }

    if (lease.entity_type === 'product') {
      await releaseUniqueItem({
        shopId,
        productId: lease.entity_id,
        leaseId: lease.id,
        requestId: lease.meta?.checkout_request_id || null,
      });
    } else {
      await lease.update({ status: 'RELEASED', released_at: new Date() });
    }
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/authority/leases?entity_id=&status=
 */
export const listLeases = async (req, res, next) => {
  try {
    const shopId = req.user?.shop_id;
    const { entity_id, status } = req.query;
    if (shopId) await expireStaleLeases(shopId);
    const where = { shop_id: shopId };
    if (entity_id) where.entity_id = entity_id;
    if (status) where.status = status;
    const leases = await SaleAuthority.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: 100,
    });
    return res.json(leases.map((l) => l.toJSON()));
  } catch (err) {
    next(err);
  }
};
