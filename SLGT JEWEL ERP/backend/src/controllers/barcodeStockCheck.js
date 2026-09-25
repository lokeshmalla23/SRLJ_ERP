import { getDefaultShopId } from '../services/defaultShop.js';
import {
  BarcodeStockCheckError,
  getOrCreateSession,
  getSession,
  computeSummary,
  listStock,
  listManualVerification,
  listHistory,
  listCategorySummaries,
  recordScan,
  resetSession,
} from '../services/barcodeStockCheckService.js';

function sendError(res, err, next) {
  if (err instanceof BarcodeStockCheckError) {
    return res.status(err.status || 400).json({ detail: err.message, code: err.code });
  }
  next(err);
}

export const createSession = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const session = await getOrCreateSession({
      shopId,
      sessionId: req.body?.session_id || null,
      userId: req.user?.id || null,
      deviceId: req.deviceId || null,
      categoryId: req.body?.category_id || null,
    });
    return res.status(201).json(session);
  } catch (err) {
    sendError(res, err, next);
  }
};

export const getSessionById = async (req, res, next) => {
  try {
    const session = await getSession(req.params.id);
    return res.json(session);
  } catch (err) {
    sendError(res, err, next);
  }
};

export const getSummary = async (req, res, next) => {
  try {
    const summary = await computeSummary(req.params.id);
    return res.json(summary);
  } catch (err) {
    sendError(res, err, next);
  }
};

export const getStock = async (req, res, next) => {
  try {
    const { search, category_id, subcategory_id, counter_id, purity_id, metal_type_id, status, show_completed, page, page_size, all } = req.query;
    const result = await listStock({
      sessionId: req.params.id,
      filters: {
        search,
        category_id,
        subcategory_id,
        counter_id,
        purity_id,
        metal_type_id,
        status,
        show_completed: show_completed === '1' || show_completed === 'true',
      },
      page,
      pageSize: page_size,
      all: all === '1' || all === 'true',
    });
    return res.json(result);
  } catch (err) {
    sendError(res, err, next);
  }
};

export const getManualVerification = async (req, res, next) => {
  try {
    const { search, page, page_size, all } = req.query;
    const result = await listManualVerification({
      sessionId: req.params.id,
      filters: { search },
      page,
      pageSize: page_size,
      all: all === '1' || all === 'true',
    });
    return res.json(result);
  } catch (err) {
    sendError(res, err, next);
  }
};

export const getCategorySummary = async (req, res, next) => {
  try {
    const result = await listCategorySummaries();
    return res.json({ items: result });
  } catch (err) {
    sendError(res, err, next);
  }
};

export const getHistory = async (req, res, next) => {
  try {
    const result = await listHistory({ sessionId: req.params.id, limit: req.query.limit });
    return res.json(result);
  } catch (err) {
    sendError(res, err, next);
  }
};

export const postScan = async (req, res, next) => {
  try {
    const scanResult = await recordScan({
      sessionId: req.params.id,
      barcode: req.body?.barcode,
      userId: req.user?.id || null,
      deviceId: req.deviceId || null,
    });
    return res.json(scanResult);
  } catch (err) {
    sendError(res, err, next);
  }
};

export const postReset = async (req, res, next) => {
  try {
    await resetSession(req.params.id);
    const summary = await computeSummary(req.params.id);
    return res.json(summary);
  } catch (err) {
    sendError(res, err, next);
  }
};
