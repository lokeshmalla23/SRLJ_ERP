import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { getSalesReport, getGstReport, getInventoryReport, getHiddenDataReport } from '../controllers/reports.js';
import {
  listSalesInvoices, salesByEmployee, salesByCounter, topCustomers, topSellingProducts, salesTrend,
  estimationsToSale,
} from '../controllers/reports/sales.js';
import {
  listGstInvoices, hsnSummary, taxRateSummary, monthlyGstSummary, gstCollectionTrend, gstLiability,
} from '../controllers/reports/gst.js';
import {
  stockCheck, categoryStock, counterStock, todaysStockAdded, deadStock,
  fastMovingStock, stockAgeing, tagHistory, itemMovement, stockDetails, soldItems,
} from '../controllers/reports/inventoryQuickReports.js';
import {
  listCustomersReport, birthdayReport, anniversaryReport, pendingBalance,
  customerLedger, customerMetalSummary, purchaseFrequency, loyalCustomers, inactiveCustomers,
} from '../controllers/reports/customers.js';
import {
  listSchemesReport, upcomingMaturity, missedInstallments, overdueInstallments,
  collectionReport, schemeLedger,
} from '../controllers/reports/schemes.js';
import {
  vendorLedger, metalWisePurchases, pendingPayments, outstandingVendors, purchaseTrend,
} from '../controllers/reports/purchases.js';
import { getDayClosingReport } from '../controllers/reports/dayClosing.js';

const router = Router();
const view = requirePermission('reports', 'view');

// Legacy endpoints — unchanged, kept for backward compatibility.
router.get('/sales', authenticate, view, getSalesReport);
router.get('/hidden-data', authenticate, view, getHiddenDataReport);
router.get('/gst', authenticate, view, getGstReport);
router.get('/inventory', authenticate, view, getInventoryReport);

// Enhanced Sales report endpoints.
router.get('/sales/list', authenticate, view, listSalesInvoices);
router.get('/sales/by-employee', authenticate, view, salesByEmployee);
router.get('/sales/by-counter', authenticate, view, salesByCounter);
router.get('/sales/top-customers', authenticate, view, topCustomers);
router.get('/sales/top-products', authenticate, view, topSellingProducts);
router.get('/sales/trend', authenticate, view, salesTrend);
router.get('/sales/estimations-to-sale', authenticate, view, estimationsToSale);

// Enhanced GST report endpoints.
router.get('/gst/list', authenticate, view, listGstInvoices);
router.get('/gst/hsn-summary', authenticate, view, hsnSummary);
router.get('/gst/tax-rate-summary', authenticate, view, taxRateSummary);
router.get('/gst/monthly-summary', authenticate, view, monthlyGstSummary);
router.get('/gst/collection-trend', authenticate, view, gstCollectionTrend);
router.get('/gst/liability', authenticate, view, gstLiability);

// Inventory Quick Reports.
router.get('/inventory/stock-check', authenticate, view, stockCheck);
router.get('/inventory/category-stock', authenticate, view, categoryStock);
router.get('/inventory/counter-stock', authenticate, view, counterStock);
router.get('/inventory/today-stock-added', authenticate, view, todaysStockAdded);
router.get('/inventory/dead-stock', authenticate, view, deadStock);
router.get('/inventory/fast-moving', authenticate, view, fastMovingStock);
router.get('/inventory/stock-ageing', authenticate, view, stockAgeing);
router.get('/inventory/tag-history', authenticate, view, tagHistory);
router.get('/inventory/item-movement', authenticate, view, itemMovement);
router.get('/inventory/stock-details', authenticate, view, stockDetails);
router.get('/inventory/sold-items', authenticate, view, soldItems);

// Enhanced Customers report endpoints.
router.get('/customers/list', authenticate, view, listCustomersReport);
router.get('/customers/birthday', authenticate, view, birthdayReport);
router.get('/customers/anniversary', authenticate, view, anniversaryReport);
router.get('/customers/pending-balance', authenticate, view, pendingBalance);
router.get('/customers/purchase-frequency', authenticate, view, purchaseFrequency);
router.get('/customers/loyal', authenticate, view, loyalCustomers);
router.get('/customers/inactive', authenticate, view, inactiveCustomers);
router.get('/customers/top-spending', authenticate, view, topCustomers);
router.get('/customers/:id/ledger', authenticate, view, customerLedger);
router.get('/customers/:id/metal-summary', authenticate, view, customerMetalSummary);

// Enhanced Schemes report endpoints.
router.get('/schemes/list', authenticate, view, listSchemesReport);
router.get('/schemes/upcoming-maturity', authenticate, view, upcomingMaturity);
router.get('/schemes/missed-installments', authenticate, view, missedInstallments);
router.get('/schemes/overdue', authenticate, view, overdueInstallments);
router.get('/schemes/collection', authenticate, view, collectionReport);
router.get('/schemes/:id/ledger', authenticate, view, schemeLedger);

// Enhanced Purchases report endpoints.
router.get('/purchases/vendor-ledger', authenticate, view, vendorLedger);
router.get('/purchases/metal-wise', authenticate, view, metalWisePurchases);
router.get('/purchases/pending-payments', authenticate, view, pendingPayments);
router.get('/purchases/outstanding-vendors', authenticate, view, outstandingVendors);
router.get('/purchases/trend', authenticate, view, purchaseTrend);

router.get('/day-closing', authenticate, view, getDayClosingReport);

export default router;
