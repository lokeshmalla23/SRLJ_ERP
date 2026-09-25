import { createPartialReturn } from '../services/returnService.js';
import { BillingError } from '../services/billingService.js';
import { CreditNote } from '../models/index.js';

export const partialReturn = async (req, res, next) => {
  try {
    const result = await createPartialReturn(req.params.id, {
      lines: req.body?.lines || req.body?.items || [],
      reason: req.body?.reason,
      request_id: req.body?.request_id || req.headers['x-request-id'],
      user: req.user,
      refund: req.body?.refund || [],
    });
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof BillingError) {
      return res.status(err.status || 400).json({ detail: err.message, code: err.code });
    }
    next(err);
  }
};

export const listCreditNotes = async (req, res, next) => {
  try {
    const where = {};
    if (req.query.invoice_id) where.invoice_id = req.query.invoice_id;
    const rows = await CreditNote.findAll({ where, order: [['created_at', 'DESC']], limit: 100 });
    return res.json({ data: rows });
  } catch (err) {
    next(err);
  }
};
