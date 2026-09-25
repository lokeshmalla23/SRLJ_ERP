import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  listDailyClosings,
  createDailyClosing,
  getDailyClosing,
  updateDailyClosing,
  previewDailyClosing,
  closeDailyClosing,
  setTillOpeningCash,
  getActiveBillingDateHandler,
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  listExpenseCategories,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
  listIncomes,
  createIncome,
  updateIncome,
  deleteIncome,
  getLedger,
  getAccountsSummary,
} from '../controllers/accounts.js';
import {
  listCashbook,
  createCashbookEntry,
  deleteCashbookEntry,
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
  createManualVoucher,
  employeeSales,
  listPaymentTransfers,
  createPaymentTransfer,
} from '../controllers/accountsFinance.js';
import {
  getGeneralLedger,
  getCustomerLedger,
  getSupplierLedger,
  getAccountingIntegrity,
  getAccountingAssessment,
  getOpeningSnapshot,
  postAccountingCutover,
  getOpeningSetup,
  postOpeningSetup,
} from '../controllers/accountingPhase1.js';
import {
  accountsDashboard,
  salesAccounts,
  purchaseAccounts,
  receivables,
  payables,
  cashBookGl,
  bankBookGl,
  dayBook,
  receiptsRegister,
  paymentsRegister,
  schemeAccounts,
  gstAccounts,
  metalAccounts,
  auditTrail,
  erpStatement,
  hiddenAccountsData,
} from '../controllers/accountsModule.js';
import {
  listBankAccounts,
  createBankAccount,
  updateBankAccount,
  getReconciliation,
  upsertReconciliationMark,
} from '../controllers/bankAccounts.js';

const router = Router();

router.get('/active-billing-date', authenticate, requirePermission('accounts', 'view'), getActiveBillingDateHandler);
router.get('/daily-closings', authenticate, requirePermission('accounts', 'view'), listDailyClosings);
router.post('/daily-closings/till-opening', authenticate, requirePermission('accounts', 'create'), setTillOpeningCash);
router.post('/daily-closings', authenticate, requirePermission('accounts', 'create'), createDailyClosing);
router.get('/daily-closings/:date/preview', authenticate, requirePermission('accounts', 'view'), previewDailyClosing);
router.post('/daily-closings/:date/close', authenticate, requirePermission('accounts', 'create'), closeDailyClosing);
router.get('/daily-closings/:date', authenticate, requirePermission('accounts', 'view'), getDailyClosing);
router.put('/daily-closings/:date', authenticate, requirePermission('accounts', 'edit'), updateDailyClosing);

router.get('/cashbook', authenticate, requirePermission('accounts', 'view'), listCashbook);
router.post('/cashbook', authenticate, requirePermission('accounts', 'create'), createCashbookEntry);
router.delete('/cashbook/:id', authenticate, requirePermission('accounts', 'delete'), deleteCashbookEntry);

router.get('/trial-balance', authenticate, requirePermission('accounts', 'view'), getTrialBalance);
router.get('/pnl', authenticate, requirePermission('accounts', 'view'), getProfitAndLoss);
router.get('/balance-sheet', authenticate, requirePermission('accounts', 'view'), getBalanceSheet);
router.post('/vouchers', authenticate, requirePermission('accounts', 'create'), createManualVoucher);
router.get('/transfers', authenticate, requirePermission('accounts', 'view'), listPaymentTransfers);
router.post('/transfers', authenticate, requirePermission('accounts', 'create'), createPaymentTransfer);
router.get('/employee-sales', authenticate, requirePermission('accounts', 'view'), employeeSales);

router.get('/dashboard', authenticate, requirePermission('accounts', 'view'), accountsDashboard);
router.get('/sales', authenticate, requirePermission('accounts', 'view'), salesAccounts);
router.get('/purchases', authenticate, requirePermission('accounts', 'view'), purchaseAccounts);
router.get('/receivables', authenticate, requirePermission('accounts', 'view'), receivables);
router.get('/payables', authenticate, requirePermission('accounts', 'view'), payables);
router.get('/cash-book', authenticate, requirePermission('accounts', 'view'), cashBookGl);
router.get('/bank-book', authenticate, requirePermission('accounts', 'view'), bankBookGl);
router.get('/bank-accounts', authenticate, requirePermission('accounts', 'view'), listBankAccounts);
router.post('/bank-accounts', authenticate, requirePermission('accounts', 'create'), createBankAccount);
router.put('/bank-accounts/:id', authenticate, requirePermission('accounts', 'edit'), updateBankAccount);
router.get('/reconciliation', authenticate, requirePermission('accounts', 'view'), getReconciliation);
router.post('/reconciliation/mark', authenticate, requirePermission('accounts', 'edit'), upsertReconciliationMark);
router.get('/day-book', authenticate, requirePermission('accounts', 'view'), dayBook);
router.get('/erp-statement', authenticate, requirePermission('accounts', 'view'), erpStatement);
router.get('/hidden-data', authenticate, requirePermission('accounts', 'view'), hiddenAccountsData);
router.get('/receipts', authenticate, requirePermission('accounts', 'view'), receiptsRegister);
router.get('/payments-register', authenticate, requirePermission('accounts', 'view'), paymentsRegister);
router.get('/schemes', authenticate, requirePermission('accounts', 'view'), schemeAccounts);
router.get('/gst', authenticate, requirePermission('accounts', 'view'), gstAccounts);
router.get('/metal', authenticate, requirePermission('accounts', 'view'), metalAccounts);
router.get('/audit-trail', authenticate, requirePermission('accounts', 'view'), auditTrail);

router.get('/gl', authenticate, requirePermission('accounts', 'view'), getGeneralLedger);
router.get('/customers/:customerId/ledger', authenticate, requirePermission('accounts', 'view'), getCustomerLedger);
router.get('/suppliers/:vendorId/ledger', authenticate, requirePermission('accounts', 'view'), getSupplierLedger);
router.get('/integrity', authenticate, requirePermission('accounts', 'view'), getAccountingIntegrity);
router.get('/assessment', authenticate, requirePermission('accounts', 'view'), getAccountingAssessment);
router.get('/opening-snapshot', authenticate, requirePermission('accounts', 'view'), getOpeningSnapshot);
router.get('/opening-setup', authenticate, requirePermission('accounts', 'view'), getOpeningSetup);
router.post('/opening-setup', authenticate, requirePermission('accounts', 'create'), postOpeningSetup);
router.post('/cutover', authenticate, requirePermission('accounts', 'create'), postAccountingCutover);

router.get('/expenses', authenticate, requirePermission('accounts', 'view'), listExpenses);
router.post('/expenses', authenticate, requirePermission('accounts', 'create'), createExpense);
router.put('/expenses/:id', authenticate, requirePermission('accounts', 'edit'), updateExpense);
router.delete('/expenses/:id', authenticate, requirePermission('accounts', 'delete'), deleteExpense);

router.get('/incomes', authenticate, requirePermission('accounts', 'view'), listIncomes);
router.post('/incomes', authenticate, requirePermission('accounts', 'create'), createIncome);
router.put('/incomes/:id', authenticate, requirePermission('accounts', 'edit'), updateIncome);
router.delete('/incomes/:id', authenticate, requirePermission('accounts', 'delete'), deleteIncome);

router.get('/expense-categories', authenticate, requirePermission('accounts', 'view'), listExpenseCategories);
router.post('/expense-categories', authenticate, requirePermission('accounts', 'create'), createExpenseCategory);
router.put('/expense-categories/:id', authenticate, requirePermission('accounts', 'edit'), updateExpenseCategory);
router.delete('/expense-categories/:id', authenticate, requirePermission('accounts', 'delete'), deleteExpenseCategory);

router.get('/ledger', authenticate, requirePermission('accounts', 'view'), getLedger);
router.get('/summary', authenticate, requirePermission('accounts', 'view'), getAccountsSummary);

export default router;
