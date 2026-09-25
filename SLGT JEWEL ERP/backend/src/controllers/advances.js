import {
  receiveAdvance,
  applyAdvancesToInvoice,
  getCustomerAdvanceBalance,
  listAdvances,
  AdvanceError,
} from '../services/advanceService.js';

function mapErr(err, next, res) {
  if (err instanceof AdvanceError) {
    return res.status(err.status || 400).json({ detail: err.message, code: err.code });
  }
  return next(err);
}

export const listCustomerAdvances = async (req, res, next) => {
  try {
    const rows = await listAdvances({
      customerId: req.query.customer_id || req.params.customerId,
      status: req.query.status,
      limit: req.query.limit,
    });
    return res.json({ data: rows });
  } catch (err) {
    return mapErr(err, next, res);
  }
};

export const getBalance = async (req, res, next) => {
  try {
    const customerId = req.params.customerId || req.query.customer_id;
    if (!customerId) return res.status(400).json({ detail: 'customer_id required' });
    const result = await getCustomerAdvanceBalance(customerId);
    return res.json(result);
  } catch (err) {
    return mapErr(err, next, res);
  }
};

export const createAdvance = async (req, res, next) => {
  try {
    const {
      customer_id,
      amount,
      mode,
      reference,
      request_id,
    } = req.body || {};
    const advance = await receiveAdvance({
      customerId: customer_id,
      amount,
      mode,
      reference,
      requestId: request_id || req.headers['x-request-id'] || null,
      userId: req.user?.id,
      shopId: req.user?.shop_id,
    });
    return res.status(201).json(advance);
  } catch (err) {
    return mapErr(err, next, res);
  }
};

export const applyAdvance = async (req, res, next) => {
  try {
    const {
      customer_id,
      invoice_id,
      amount,
      request_id,
    } = req.body || {};
    const result = await applyAdvancesToInvoice({
      customerId: customer_id,
      invoiceId: invoice_id,
      amount,
      requestId: request_id || req.headers['x-request-id'] || null,
      shopId: req.user?.shop_id,
      userId: req.user?.id,
    });
    return res.json(result);
  } catch (err) {
    return mapErr(err, next, res);
  }
};
