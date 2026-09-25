/**
 * Accounts module HTTP handlers (dashboard, registers, books, GST, metal, audit).
 */
import {
  getAccountsDashboard,
  listSalesAccounts,
  listPurchaseAccounts,
  listReceivables,
  listPayables,
  getCashBookGl,
  getBankBookGl,
  getDayBook,
  listReceipts,
  listPaymentsRegister,
  getSchemeAccounts,
  getGstAccounts,
  getMetalAccounts,
  listAuditTrail,
  getErpStatement,
  getHiddenAccountsData,
} from '../services/accountsModuleService.js';
import { wantsHiddenBills } from '../utils/invoiceVisibility.js';

const wrap = (fn) => async (req, res, next) => {
  try {
    const data = await fn({ ...req.query, _shop_id: req.user?.shop_id, _role: req.user?.role });
    return res.json(data);
  } catch (err) {
    next(err);
  }
};

export const accountsDashboard = wrap(getAccountsDashboard);
export const salesAccounts = wrap(listSalesAccounts);
export const purchaseAccounts = wrap(listPurchaseAccounts);
export const receivables = wrap(listReceivables);
export const payables = wrap(listPayables);
export const cashBookGl = wrap(getCashBookGl);
export const bankBookGl = wrap(getBankBookGl);
export const dayBook = wrap(getDayBook);
export const receiptsRegister = wrap(listReceipts);
export const paymentsRegister = wrap(listPaymentsRegister);
export const schemeAccounts = wrap(getSchemeAccounts);
export const gstAccounts = wrap(getGstAccounts);
export const metalAccounts = wrap(getMetalAccounts);
export const auditTrail = wrap(listAuditTrail);
export const erpStatement = wrap(getErpStatement);

export const hiddenAccountsData = async (req, res, next) => {
  try {
    const query = { ...req.query, _shop_id: req.user?.shop_id, _role: req.user?.role };
    if (!wantsHiddenBills(query)) {
      return res.status(404).json({ detail: 'Not found' });
    }
    return res.json(await getHiddenAccountsData(query));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ detail: err.message });
    next(err);
  }
};
