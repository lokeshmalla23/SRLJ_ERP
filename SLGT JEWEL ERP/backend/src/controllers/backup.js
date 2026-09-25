import { Op } from 'sequelize';
import {
  Customer, Product, Invoice, Expense, Purchase, Order,
  Vendor, Employee, Scheme, StockHistory,
  Category, CatalogItem, InventoryMovement,
  Attribute, ShopCounter,
} from '../models/index.js';
import {
  importCustomersCsv,
  importProductsCsv,
  importVendorsCsv,
  importEmployeesCsv,
  importQuotationsCsv,
  importExpensesCsv,
  CUSTOMER_TEMPLATE_CSV,
  PRODUCT_TEMPLATE_CSV,
  VENDOR_TEMPLATE_CSV,
  EMPLOYEE_TEMPLATE_CSV,
  QUOTATION_TEMPLATE_CSV,
  EXPENSE_TEMPLATE_CSV,
} from '../services/csvImportService.js';
import { broadcast } from '../services/wsServer.js';
import { buildInventoryBackup, restoreInventoryBackup } from '../services/inventoryBackupService.js';
import { buildCustomerBackup, restoreCustomerBackup } from '../services/customerBackupService.js';

// ─── CSV helper ──────────────────────────────────────────────────────────────
function toCSV(rows, columns) {
  const header = columns.map((c) => `"${c.label}"`).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => {
      const val = typeof c.fn === 'function' ? c.fn(row) : (row[c.key] ?? '');
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    }).join(',')
  );
  return [header, ...lines].join('\r\n');
}

function sendCSV(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

// GET /api/backup/summary
export const getBackupSummary = async (req, res, next) => {
  try {
    const [
      customers, products, invoices, expenses, purchases, orders, vendors, employees, schemes,
      categories, catalog_items, inventory_movements, attributes, shop_counters,
    ] = await Promise.all([
      Customer.count(), Product.count(), Invoice.count(), Expense.count(),
      Purchase.count(), Order.count(), Vendor.count(), Employee.count(), Scheme.count(),
      Category.count(), CatalogItem.count(), InventoryMovement.count(),
      Attribute.count(), ShopCounter.count(),
    ]);
    res.json({
      customers, products, invoices, expenses, purchases, orders, vendors, employees, schemes,
      categories, catalog_items, inventory_movements, attributes, shop_counters,
    });
  } catch (err) { next(err); }
};

// ─── Inventory backup (stock + catalog) ─────────────────────────────────────

// GET /api/backup/inventory
export const getInventoryBackup = async (req, res, next) => {
  try {
    const payload = await buildInventoryBackup();
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="inventory_backup_${stamp}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) { next(err); }
};

// POST /api/backup/import/inventory
export const importInventoryBackup = async (req, res, next) => {
  try {
    const payload = req.body?.backup ?? req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ detail: 'Body must include the inventory backup object' });
    }
    const summary = await restoreInventoryBackup(payload, { userId: req.user?.id });
    const { products: p, categories: c, catalog_items: ci, attributes: a, shop_counters: sc, inventory_movements: m } = summary;
    if (p || c || ci || a || sc || m) {
      // Inventory page listens for this one — stock rows changed.
      broadcast({ type: 'product:changed', op: 'inventory_restore' });
      // Catalog page listens for this one — categories/metal/purity changed.
      broadcast({ type: 'catalog:changed', op: 'inventory_restore' });
    }
    res.json(summary);
  } catch (err) {
    if (err?.code === 'INVENTORY_BACKUP_INVALID' || err?.code === 'INVENTORY_BACKUP_RESTORE_FAILED') {
      return res.status(400).json({ detail: err.message, code: err.code });
    }
    next(err);
  }
};

// ─── Customer backup (profiles only) ────────────────────────────────────────

// GET /api/backup/customer
export const getCustomerBackup = async (req, res, next) => {
  try {
    const payload = await buildCustomerBackup();
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="customer_backup_${stamp}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) { next(err); }
};

// POST /api/backup/import/customer
export const importCustomerBackup = async (req, res, next) => {
  try {
    const payload = req.body?.backup ?? req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ detail: 'Body must include the customer backup object' });
    }
    const summary = await restoreCustomerBackup(payload, { userId: req.user?.id });
    if (summary.customers) {
      // Customers page listens for this one.
      broadcast({ type: 'customer:changed', op: 'customer_restore' });
    }
    res.json(summary);
  } catch (err) {
    if (err?.code === 'CUSTOMER_BACKUP_INVALID' || err?.code === 'CUSTOMER_BACKUP_RESTORE_FAILED') {
      return res.status(400).json({ detail: err.message, code: err.code });
    }
    next(err);
  }
};

// GET /api/backup/customers
export const backupCustomers = async (req, res, next) => {
  try {
    const rows = await Customer.findAll({ order: [['created_at', 'ASC']] });
    const csv = toCSV(rows.map((r) => r.toJSON()), [
      { key: 'name', label: 'Name' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'email', label: 'Email' },
      { key: 'address', label: 'Address' },
      { key: 'gst_number', label: 'GST Number' },
      { key: 'tag', label: 'Tag' },
      { key: 'total_purchases', label: 'Total Purchases' },
      { key: 'dob', label: 'Date of Birth' },
      { key: 'anniversary', label: 'Anniversary' },
      { key: 'notes', label: 'Notes' },
      { key: 'created_at', label: 'Created At' },
    ]);
    sendCSV(res, `customers_${new Date().toISOString().slice(0,10)}.csv`, csv);
  } catch (err) { next(err); }
};

// GET /api/backup/products
export const backupProducts = async (req, res, next) => {
  try {
    const rows = await Product.findAll({ order: [['name', 'ASC']] });
    const { enrichProducts } = await import('./products.js');
    const enriched = await enrichProducts(rows);
    const csv = toCSV(enriched, [
      { key: 'name', label: 'Product Name' },
      { key: 'code', label: 'Code' },
      { key: 'barcode', label: 'Barcode' },
      { key: 'design_no', label: 'Design No' },
      { key: 'category_name', label: 'Category' },
      { key: 'subcategory_name', label: 'Sub Category' },
      { key: 'metal_name', label: 'Metal' },
      { key: 'purity_name', label: 'Purity' },
      { key: 'hallmark', label: 'Hallmark' },
      { key: 'certification', label: 'Certification' },
      { key: 'hsn_code', label: 'HSN Code' },
      { key: 'gst_slab', label: 'GST %' },
      { key: 'gross_weight', label: 'Gross Weight (g)' },
      { key: 'net_weight', label: 'Net Weight (g)' },
      { key: 'stone_weight', label: 'Stone Weight (g)' },
      { key: 'making_charges', label: 'Making Charges' },
      { key: 'making_charge_type', label: 'Making Charge Type' },
      { key: 'wastage_pct', label: 'Wastage %' },
      { key: 'purchase_price', label: 'Purchase Price' },
      { key: 'selling_price', label: 'Selling Price' },
      { key: 'stock_qty', label: 'Stock Qty' },
      { key: 'low_stock_threshold', label: 'Low Stock Threshold' },
      { key: 'status', label: 'Status' },
      { key: 'showcase_location', label: 'Showcase Location' },
    ]);
    sendCSV(res, `products_${new Date().toISOString().slice(0,10)}.csv`, csv);
  } catch (err) { next(err); }
};

// GET /api/backup/invoices
export const backupInvoices = async (req, res, next) => {
  try {
    const where = {};
    if (req.query.from) where.created_at = { [Op.gte]: new Date(req.query.from) };
    if (req.query.to) {
      const to = new Date(req.query.to); to.setHours(23, 59, 59, 999);
      where.created_at = { ...(where.created_at || {}), [Op.lte]: to };
    }
    const rows = await Invoice.findAll({ where, order: [['created_at', 'DESC']] });
    const csv = toCSV(rows.map((r) => r.toJSON()), [
      { key: 'invoice_no', label: 'Invoice No' },
      { key: 'customer_name', label: 'Customer Name' },
      { key: 'customer_mobile', label: 'Mobile' },
      { key: 'subtotal', label: 'Subtotal' },
      { key: 'discount', label: 'Discount' },
      { key: 'gst_pct', label: 'GST %' },
      { key: 'gst_amount', label: 'GST Amount' },
      { key: 'grand_total', label: 'Grand Total' },
      { key: 'status', label: 'Status' },
      { key: 'notes', label: 'Notes' },
      { key: 'created_at', label: 'Date' },
    ]);
    sendCSV(res, `invoices_${new Date().toISOString().slice(0,10)}.csv`, csv);
  } catch (err) { next(err); }
};

// GET /api/backup/expenses
export const backupExpenses = async (req, res, next) => {
  try {
    const where = {};
    if (req.query.from) where.date = { [Op.gte]: req.query.from };
    if (req.query.to) where.date = { ...(where.date || {}), [Op.lte]: req.query.to };
    const rows = await Expense.findAll({ where, order: [['date', 'DESC']] });
    const csv = toCSV(rows.map((r) => r.toJSON()), [
      { key: 'date', label: 'Date' },
      { key: 'time', label: 'Time' },
      { key: 'description', label: 'Description' },
      { key: 'category_name', label: 'Category' },
      { key: 'amount', label: 'Amount' },
      { key: 'payment_mode', label: 'Payment Mode' },
      { key: 'reference', label: 'Reference' },
      { key: 'notes', label: 'Notes' },
    ]);
    sendCSV(res, `expenses_${new Date().toISOString().slice(0,10)}.csv`, csv);
  } catch (err) { next(err); }
};

// GET /api/backup/vendors
export const backupVendors = async (req, res, next) => {
  try {
    const rows = await Vendor.findAll({ order: [['name', 'ASC']] });
    const csv = toCSV(rows.map((r) => r.toJSON()), [
      { key: 'name', label: 'Vendor Name' },
      { key: 'type', label: 'Type' },
      { key: 'contact_person', label: 'Contact Person' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'email', label: 'Email' },
      { key: 'address', label: 'Address' },
      { key: 'gst_number', label: 'GST Number' },
      { key: 'pan_number', label: 'PAN Number' },
      { key: 'outstanding_balance', label: 'Outstanding Balance' },
      { key: 'total_purchases', label: 'Total Purchases' },
      { key: 'status', label: 'Status' },
    ]);
    sendCSV(res, `vendors_${new Date().toISOString().slice(0,10)}.csv`, csv);
  } catch (err) { next(err); }
};

// GET /api/backup/employees
export const backupEmployees = async (req, res, next) => {
  try {
    const rows = await Employee.findAll({ order: [['name', 'ASC']] });
    const csv = toCSV(rows.map((r) => r.toJSON()), [
      { key: 'name', label: 'Name' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'email', label: 'Email' },
      { key: 'job_title', label: 'Job Title' },
      { key: 'department', label: 'Department' },
      { key: 'salary', label: 'Salary' },
      { key: 'join_date', label: 'Join Date' },
      { key: 'status', label: 'Status' },
      { key: 'address', label: 'Address' },
      { key: 'emergency_contact', label: 'Emergency Contact' },
    ]);
    sendCSV(res, `employees_${new Date().toISOString().slice(0,10)}.csv`, csv);
  } catch (err) { next(err); }
};

// GET /api/backup/stock-history
export const backupStockHistory = async (req, res, next) => {
  try {
    const where = {};
    if (req.query.from) where.created_at = { [Op.gte]: new Date(req.query.from) };
    if (req.query.to) {
      const to = new Date(req.query.to); to.setHours(23,59,59,999);
      where.created_at = { ...(where.created_at || {}), [Op.lte]: to };
    }
    const rows = await StockHistory.findAll({ where, order: [['created_at', 'DESC']], limit: 5000 });
    const csv = toCSV(rows.map((r) => r.toJSON()), [
      { key: 'created_at', label: 'Date' },
      { key: 'product_name', label: 'Product' },
      { key: 'change_type', label: 'Change Type' },
      { key: 'qty_before', label: 'Qty Before' },
      { key: 'qty_change', label: 'Qty Change' },
      { key: 'qty_after', label: 'Qty After' },
      { key: 'reference_type', label: 'Reference Type' },
      { key: 'notes', label: 'Notes' },
    ]);
    sendCSV(res, `stock_history_${new Date().toISOString().slice(0,10)}.csv`, csv);
  } catch (err) { next(err); }
};

// ─── CSV Import ──────────────────────────────────────────────────────────────
export const downloadCustomerTemplate = (_req, res) => {
  sendCSV(res, 'customers_import_template.csv', CUSTOMER_TEMPLATE_CSV);
};

export const downloadProductTemplate = (_req, res) => {
  sendCSV(res, 'products_import_template.csv', PRODUCT_TEMPLATE_CSV);
};

export const downloadVendorTemplate = (_req, res) => {
  sendCSV(res, 'vendors_import_template.csv', VENDOR_TEMPLATE_CSV);
};

export const downloadEmployeeTemplate = (_req, res) => {
  sendCSV(res, 'employees_import_template.csv', EMPLOYEE_TEMPLATE_CSV);
};

export const downloadQuotationTemplate = (_req, res) => {
  sendCSV(res, 'quotations_import_template.csv', QUOTATION_TEMPLATE_CSV);
};

export const downloadExpenseTemplate = (_req, res) => {
  sendCSV(res, 'expenses_import_template.csv', EXPENSE_TEMPLATE_CSV);
};

export const importCustomers = async (req, res, next) => {
  try {
    const csv = req.body?.csv;
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ detail: 'Body must include csv string' });
    }
    const result = await importCustomersCsv(csv, {
      userId: req.user?.id,
      updateExisting: req.body?.update_existing !== false,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const importProducts = async (req, res, next) => {
  try {
    const csv = req.body?.csv;
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (rows?.length) {
      const result = await importProductsCsv(rows, {
        userId: req.user?.id,
        updateExisting: req.body?.update_existing !== false,
      });
      if ((result.created || 0) + (result.updated || 0) > 0) {
        broadcast({ type: 'product:changed', op: 'import' });
      }
      return res.json(result);
    }
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ detail: 'Body must include csv string or rows array' });
    }
    const result = await importProductsCsv(csv, {
      userId: req.user?.id,
      updateExisting: req.body?.update_existing !== false,
    });
    if ((result.created || 0) + (result.updated || 0) > 0) {
      broadcast({ type: 'product:changed', op: 'import' });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const importVendors = async (req, res, next) => {
  try {
    const csv = req.body?.csv;
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ detail: 'Body must include csv string' });
    }
    res.json(await importVendorsCsv(csv, { updateExisting: req.body?.update_existing !== false }));
  } catch (err) {
    next(err);
  }
};

export const importEmployees = async (req, res, next) => {
  try {
    const csv = req.body?.csv;
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ detail: 'Body must include csv string' });
    }
    res.json(await importEmployeesCsv(csv, { updateExisting: req.body?.update_existing !== false }));
  } catch (err) {
    next(err);
  }
};

export const importQuotations = async (req, res, next) => {
  try {
    const csv = req.body?.csv;
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ detail: 'Body must include csv string' });
    }
    res.json(await importQuotationsCsv(csv, {
      userId: req.user?.id,
      updateExisting: req.body?.update_existing !== false,
    }));
  } catch (err) {
    next(err);
  }
};

export const importExpenses = async (req, res, next) => {
  try {
    const csv = req.body?.csv;
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ detail: 'Body must include csv string' });
    }
    res.json(await importExpensesCsv(csv, { userId: req.user?.id }));
  } catch (err) {
    next(err);
  }
};
