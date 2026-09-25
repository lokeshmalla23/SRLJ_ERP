import {
  listPureProducts,
  createPureProduct,
  updatePureProduct,
  softDeletePureProduct,
  PureProductError,
} from '../services/pureProductService.js';
import { getDefaultShopId } from '../services/defaultShop.js';
import { PureProduct } from '../models/index.js';

function handlePureErr(err, res, next) {
  if (err instanceof PureProductError) {
    return res.status(err.status || 400).json({ detail: err.message, code: err.code });
  }
  return next(err);
}

// GET /api/pure-products
export const list = async (req, res, next) => {
  try {
    const shopId = req.user?.shop_id || (await getDefaultShopId());
    const metal = req.query.metal || null;
    const sellableOnly = req.query.sellable === '1' || req.query.sellable === 'true';
    const rows = await listPureProducts({ shopId, metal, sellableOnly });
    return res.json(rows.map((r) => (r.toJSON ? r.toJSON() : r)));
  } catch (err) {
    return handlePureErr(err, res, next);
  }
};

// GET /api/pure-products/:id
export const getOne = async (req, res, next) => {
  try {
    const row = await PureProduct.findByPk(req.params.id);
    if (!row || row.deleted_at) {
      return res.status(404).json({ detail: 'Pure product not found' });
    }
    return res.json(row.toJSON());
  } catch (err) {
    return handlePureErr(err, res, next);
  }
};

// POST /api/pure-products
export const create = async (req, res, next) => {
  try {
    const shopId = req.user?.shop_id || (await getDefaultShopId());
    const row = await createPureProduct(req.body || {}, { shopId });
    return res.status(201).json(row.toJSON());
  } catch (err) {
    return handlePureErr(err, res, next);
  }
};

// PATCH /api/pure-products/:id
export const update = async (req, res, next) => {
  try {
    const shopId = req.user?.shop_id || (await getDefaultShopId());
    const row = await updatePureProduct(req.params.id, req.body || {}, { shopId });
    return res.json(row.toJSON());
  } catch (err) {
    return handlePureErr(err, res, next);
  }
};

// DELETE /api/pure-products/:id
export const remove = async (req, res, next) => {
  try {
    const shopId = req.user?.shop_id || (await getDefaultShopId());
    const row = await softDeletePureProduct(req.params.id, { shopId });
    return res.json({ ok: true, id: row.id });
  } catch (err) {
    return handlePureErr(err, res, next);
  }
};
