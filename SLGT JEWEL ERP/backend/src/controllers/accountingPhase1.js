/**
 * Phase 1 accounting control + cutover HTTP handlers (API only — no UI).
 */
import {
  generalLedger,
  customerLedger,
  supplierLedger,
  accountingIntegrityCheck,
} from '../services/accountingControlsService.js';
import {
  assessHistoricalAccounting,
  buildOpeningSnapshot,
  applyAccountingCutover,
} from '../services/accountingCutoverService.js';
import {
  applyOpeningSetup,
  getOpeningSetupStatus,
} from '../services/openingSetupService.js';
import { getDefaultShopId } from '../services/defaultShop.js';

export const getGeneralLedger = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const code = req.query.account || req.query.code || req.query.account_code || req.params.code;
    if (!code) return res.status(400).json({ detail: 'account code required' });
    const data = await generalLedger({
      shopId,
      accountCode: String(code),
      from: req.query.from || null,
      to: req.query.to || null,
      limit: Number(req.query.limit) || 500,
    });
    if (!data.account) return res.status(404).json({ detail: `Account ${code} not found` });
    return res.json(data);
  } catch (err) {
    next(err);
  }
};

export const getCustomerLedger = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const data = await customerLedger({
      shopId,
      customerId: req.params.customerId,
      from: req.query.from || null,
      to: req.query.to || null,
    });
    if (!data) return res.status(404).json({ detail: 'Customer not found' });
    return res.json(data);
  } catch (err) {
    next(err);
  }
};

export const getSupplierLedger = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const data = await supplierLedger({
      shopId,
      vendorId: req.params.vendorId,
      from: req.query.from || null,
      to: req.query.to || null,
    });
    if (!data) return res.status(404).json({ detail: 'Vendor not found' });
    return res.json(data);
  } catch (err) {
    next(err);
  }
};

export const getAccountingIntegrity = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const data = await accountingIntegrityCheck({
      shopId,
      from: req.query.from || null,
      to: req.query.to || null,
    });
    return res.json(data);
  } catch (err) {
    next(err);
  }
};

export const getAccountingAssessment = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const data = await assessHistoricalAccounting(shopId);
    return res.json(data);
  } catch (err) {
    next(err);
  }
};

export const getOpeningSnapshot = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const data = await buildOpeningSnapshot(shopId, {
      cash: req.query.cash != null ? Number(req.query.cash) : null,
      bank: req.query.bank != null ? Number(req.query.bank) : null,
      upi: req.query.upi != null ? Number(req.query.upi) : null,
      card: req.query.card != null ? Number(req.query.card) : null,
    });
    return res.json(data);
  } catch (err) {
    next(err);
  }
};

export const postAccountingCutover = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const {
      cutover_date,
      cash = 0,
      bank = 0,
      upi = 0,
      card = 0,
      output_gst = 0,
      input_gst = 0,
      request_id = null,
    } = req.body || {};
    const result = await applyAccountingCutover({
      shopId,
      cutoverDate: cutover_date,
      cash: Number(cash) || 0,
      bank: Number(bank) || 0,
      upi: Number(upi) || 0,
      card: Number(card) || 0,
      outputGst: Number(output_gst) || 0,
      inputGst: Number(input_gst) || 0,
      userId: req.user?.id || null,
      requestId: request_id,
    });
    return res.status(result.idempotent ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
};

export const getOpeningSetup = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const data = await getOpeningSetupStatus(shopId);
    return res.json(data);
  } catch (err) {
    next(err);
  }
};

export const postOpeningSetup = async (req, res, next) => {
  try {
    const shopId = await getDefaultShopId();
    const {
      cutover_date,
      cash = 0,
      bank = 0,
      upi = 0,
      card = 0,
      output_gst = 0,
      input_gst = 0,
    } = req.body || {};
    const result = await applyOpeningSetup({
      shopId,
      cutoverDate: cutover_date,
      cash: Number(cash) || 0,
      bank: Number(bank) || 0,
      upi: Number(upi) || 0,
      card: Number(card) || 0,
      outputGst: Number(output_gst) || 0,
      inputGst: Number(input_gst) || 0,
      userId: req.user?.id || null,
    });
    return res.status(201).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        detail: err.message,
        status_snapshot: err.status_snapshot,
      });
    }
    next(err);
  }
};
