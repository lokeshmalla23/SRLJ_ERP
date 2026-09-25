/**
 * Application Management (shop-level module licensing) — single source of
 * truth for feature keys/labels/descriptions/sections, consumed by the
 * Settings → Application Management tab. `AppShell`'s NAV and `App.jsx`'s
 * routes reference these same key strings directly (they don't import this
 * file) so adding a future feature here doesn't automatically wire it into
 * the sidebar/routes — see those two files to actually gate a nav item.
 *
 * This is layered ABOVE the existing RBAC permission system (`can()` /
 * `permissions.js`), not a replacement for it: a feature key here controls
 * whether a module exists for this shop at all; RBAC still controls what an
 * individual user can do inside it once enabled.
 */
export const APPLICATION_FEATURES = [
  { key: "dashboard", label: "Dashboard", description: "Home overview with sales, stock and rate summaries.", section: "Overview" },
  { key: "pos", label: "POS Billing", description: "Point-of-sale billing and invoice creation.", section: "Commerce" },
  { key: "inventory", label: "Inventory", description: "Stock management and inventory operations.", section: "Commerce" },
  { key: "barcode_management", label: "Barcode Management", description: "Barcode generation, printing and label management.", section: "Commerce" },
  { key: "catalog", label: "Catalog", description: "Categories, attributes and product catalog setup.", section: "Commerce" },
  { key: "customers", label: "Customers", description: "Customer records and purchase history.", section: "Commerce" },
  { key: "promotions", label: "Promotions", description: "Marketing campaigns and customer segments.", section: "Commerce" },
  { key: "quotations", label: "Estimations", description: "Price estimates and quotation-to-invoice conversion.", section: "Commerce" },
  { key: "orders", label: "Orders", description: "Custom order tracking and karigar assignment.", section: "Commerce" },
  { key: "barcode_stock_check", label: "Barcode Stock Check", description: "Physical stock verification by barcode scan.", section: "Commerce" },
  { key: "gold_schemes", label: "Gold Schemes", description: "Customer gold-saving schemes and scheme plan management.", section: "Programs" },
  { key: "vendors", label: "Vendors", description: "Vendor/supplier records.", section: "Purchase" },
  { key: "purchases", label: "Purchases", description: "Purchase orders and stock intake.", section: "Purchase" },
  { key: "accounts", label: "Accounts", description: "Accounting, daily closing and financial statements.", section: "Finance" },
  { key: "employees", label: "Employees", description: "Staff records and department management.", section: "Finance" },
  { key: "reports", label: "Reports", description: "Reports and analytics across all modules.", section: "Insights" },
];

export const APPLICATION_FEATURE_SECTIONS = [
  "Overview", "Commerce", "Programs", "Purchase", "Finance", "Insights",
];
