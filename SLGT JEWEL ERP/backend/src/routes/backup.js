import { Router } from 'express';
import { authenticate, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import {
  getBackupSummary,
  backupCustomers,
  backupProducts,
  backupInvoices,
  backupExpenses,
  backupVendors,
  backupEmployees,
  backupStockHistory,
  downloadCustomerTemplate,
  downloadProductTemplate,
  downloadVendorTemplate,
  downloadEmployeeTemplate,
  downloadQuotationTemplate,
  downloadExpenseTemplate,
  importCustomers,
  importProducts,
  importVendors,
  importEmployees,
  importQuotations,
  importExpenses,
  getInventoryBackup,
  importInventoryBackup,
  getCustomerBackup,
  importCustomerBackup,
} from '../controllers/backup.js';

const router = Router();

router.get('/summary', authenticate, requirePermission('backup', 'view'), getBackupSummary);
router.get('/customers', authenticate, requirePermission('backup', 'export'), backupCustomers);
router.get('/products', authenticate, requirePermission('backup', 'export'), backupProducts);
router.get('/invoices', authenticate, requirePermission('backup', 'export'), backupInvoices);
router.get('/expenses', authenticate, requirePermission('backup', 'export'), backupExpenses);
router.get('/vendors', authenticate, requirePermission('backup', 'export'), backupVendors);
router.get('/employees', authenticate, requirePermission('backup', 'export'), backupEmployees);
router.get('/stock-history', authenticate, requirePermission('backup', 'export'), backupStockHistory);

// Inventory-only backup (stock + catalog) — restore touches inventory only.
router.get('/inventory', authenticate, requirePermission('backup', 'export'), getInventoryBackup);
router.post('/import/inventory', authenticate, requireAnyPermission(
  ['backup', 'export'],
  ['inventory', 'import'],
  ['inventory', 'create'],
), importInventoryBackup);

// Customer-only backup (profiles) — restore touches customers only.
router.get('/customer', authenticate, requirePermission('backup', 'export'), getCustomerBackup);
router.post('/import/customer', authenticate, requireAnyPermission(
  ['backup', 'export'],
  ['customers', 'create'],
  ['customers', 'edit'],
), importCustomerBackup);

router.get('/templates/customers', authenticate, requirePermission('backup', 'export'), downloadCustomerTemplate);
router.get('/templates/products', authenticate, requirePermission('backup', 'export'), downloadProductTemplate);
router.get('/templates/vendors', authenticate, requirePermission('backup', 'export'), downloadVendorTemplate);
router.get('/templates/employees', authenticate, requirePermission('backup', 'export'), downloadEmployeeTemplate);
router.get('/templates/quotations', authenticate, requirePermission('backup', 'export'), downloadQuotationTemplate);
router.get('/templates/expenses', authenticate, requirePermission('backup', 'export'), downloadExpenseTemplate);

router.post('/import/customers', authenticate, requirePermission('backup', 'export'), importCustomers);
router.post('/import/products', authenticate, requireAnyPermission(
  ['backup', 'export'],
  ['inventory', 'import'],
  ['inventory', 'create'],
), importProducts);
router.post('/import/vendors', authenticate, requirePermission('backup', 'export'), importVendors);
router.post('/import/employees', authenticate, requirePermission('backup', 'export'), importEmployees);
router.post('/import/quotations', authenticate, requirePermission('backup', 'export'), importQuotations);
router.post('/import/expenses', authenticate, requirePermission('backup', 'export'), importExpenses);

export default router;
