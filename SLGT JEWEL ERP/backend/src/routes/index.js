import authRoutes from './auth.js';
import metaRoutes from './meta.js';
import userRoutes from './users.js';
import catalogRoutes from './catalog.js';
import productRoutes from './products.js';
import customerRoutes from './customers.js';
import invoiceRoutes from './invoices.js';
import schemeRoutes from './schemes.js';
import schemePlanRoutes from './schemePlans.js';
import settingsRoutes from './settings.js';
import reportsRoutes from './reports.js';
import dashboardRoutes from './dashboard.js';
import promotionsRoutes from './promotions.js';
import accountsRoutes from './accounts.js';
import notificationsRoutes from './notifications.js';
import searchRoutes from './search.js';
import employeesRoutes from './employees.js';
import stockHistoryRoutes from './stockHistory.js';
import vendorsRoutes from './vendors.js';
import purchasesRoutes from './purchases.js';
import ordersRoutes from './orders.js';
import backupRoutes from './backup.js';
import quotationsRoutes from './quotations.js';
import barcodesRoutes from './barcodes.js';
import devicesRoutes from './devices.js';
import recoveryRoutes from './recovery.js';
import systemRoutes from './system.js';
import authorityRoutes from './authority.js';
import clusterRoutes from './cluster.js';
import advancesRoutes from './advances.js';
import mastersExtraRoutes from './mastersExtra.js';
import draftSalesRoutes from './draftSales.js';
import featurePackRoutes from './featurePack.js';
import dbBrowserRoutes from './dbBrowser.js';
import pureProductRoutes from './pureProducts.js';
import barcodeStockCheckRoutes from './barcodeStockCheck.js';
import { requireApplicationFeature } from '../middleware/requireApplicationFeature.js';

export function registerRoutes(app) {
  app.use('/api/auth', authRoutes);
  app.use('/api/meta', metaRoutes);
  app.use('/api/users', userRoutes);

  // Catalog routes cover /api/categories, /api/attributes, /api/catalog/:kind
  app.use('/api', catalogRoutes);

  app.use('/api/products', productRoutes);
  app.use('/api/pure-products', pureProductRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/invoices', invoiceRoutes);
  app.use('/api/schemes', schemeRoutes);
  // Application Management (shop-level module licensing) gates these mounts
  // wholesale — every route in the file requires the module regardless of
  // RBAC. Routes known to be shared dependencies of another module (e.g.
  // employees.js's GET / used by POS's salesperson dropdown, schemes.js's
  // GET /payments-due) are gated per-route inside their own route file
  // instead, so an unrelated enabled module doesn't break — see those files.
  app.use('/api/scheme-plans', requireApplicationFeature('gold_schemes'), schemePlanRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/reports', featurePackRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/promotions', requireApplicationFeature('promotions'), promotionsRoutes);
  app.use('/api/accounts', requireApplicationFeature('accounts'), accountsRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/employees', employeesRoutes);
  app.use('/api/stock', stockHistoryRoutes);
  app.use('/api/vendors', requireApplicationFeature('vendors'), vendorsRoutes);
  app.use('/api/purchases', requireApplicationFeature('purchases'), purchasesRoutes);
  app.use('/api/orders', requireApplicationFeature('orders'), ordersRoutes);
  app.use('/api/backup', backupRoutes);
  app.use('/api/quotations', quotationsRoutes);
  app.use('/api/barcodes', barcodesRoutes);
  app.use('/api/devices', devicesRoutes);
  app.use('/api/db-browser', dbBrowserRoutes);
  app.use('/api/recovery', recoveryRoutes);
  app.use('/api/system', systemRoutes);
  app.use('/api/authority', authorityRoutes);
  app.use('/api/cluster', clusterRoutes);
  app.use('/api/advances', advancesRoutes);
  app.use('/api/masters', mastersExtraRoutes);
  app.use('/api/draft-sales', draftSalesRoutes);
  app.use('/api/barcode-stock-check', requireApplicationFeature('barcode_stock_check'), barcodeStockCheckRoutes);
}
