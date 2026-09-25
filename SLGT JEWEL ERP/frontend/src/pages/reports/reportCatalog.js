/**
 * Unified Report Center catalog — maps every report to an API or existing view.
 * Financial statements reuse /api/accounts (journal source of truth).
 */

export const REPORT_CATEGORIES = [
  { id: "executive", label: "Executive", description: "Business overview, profitability, cash" },
  { id: "financial", label: "Financial", description: "P&L, Balance Sheet, Trial Balance, books" },
  { id: "sales", label: "Sales", description: "Invoices, trends, employees" },
  { id: "hidden-data", label: "Hidden Data", description: "Hidden POS bills only — owner unlock" },
  { id: "customers", label: "Customers", description: "Outstanding, frequency, loyalty" },
  { id: "suppliers", label: "Suppliers", description: "Purchases, payables, vendor ledgers" },
  { id: "inventory", label: "Inventory", description: "Stock, ageing, movement, tags" },
  { id: "jewellery", label: "Jewellery", description: "Hallmark, old gold, old silver, rates" },
  { id: "gst", label: "GST", description: "Liability, HSN, GSTR exports" },
  { id: "expenses", label: "Expenses", description: "Expense summary and register" },
  { id: "schemes", label: "Schemes", description: "Collections, overdue, maturity" },
  { id: "day-closing", label: "Day Closing Report", description: "Invoice-wise day close with tenders and metal sales" },
];

/**
 * type: 'api' | 'tab' | 'quick' | 'component'
 * source: 'accounts' (journals) | 'reports' (ops) | 'ui'
 */
export const REPORT_CATALOG = [
  // Executive
  { id: "exec-overview", category: "executive", name: "Business Overview", source: "accounts", type: "api", endpoint: "/accounts/dashboard", description: "KPIs from live accounts + sales" },
  { id: "exec-pnl", category: "executive", name: "Profitability (P&L)", source: "accounts", type: "api", endpoint: "/accounts/pnl", description: "Journal-based profit & loss" },
  { id: "exec-cash", category: "executive", name: "Cash Position", source: "accounts", type: "api", endpoint: "/accounts/cash-book", description: "Cash book from GL 1000" },

  // Financial
  { id: "fin-pnl", category: "financial", name: "Profit & Loss", source: "accounts", type: "api", endpoint: "/accounts/pnl" },
  { id: "fin-bs", category: "financial", name: "Balance Sheet", source: "accounts", type: "api", endpoint: "/accounts/balance-sheet" },
  { id: "fin-tb", category: "financial", name: "Trial Balance", source: "accounts", type: "api", endpoint: "/accounts/trial-balance" },
  { id: "fin-day-book", category: "financial", name: "Day Book", source: "accounts", type: "api", endpoint: "/accounts/day-book" },
  { id: "fin-cash-book", category: "financial", name: "Cash Book", source: "accounts", type: "api", endpoint: "/accounts/cash-book" },
  { id: "fin-bank-book", category: "financial", name: "Bank Book", source: "accounts", type: "api", endpoint: "/accounts/bank-book" },
  { id: "fin-receipts", category: "financial", name: "Receipt Register", source: "accounts", type: "api", endpoint: "/accounts/receipts" },
  { id: "fin-payments", category: "financial", name: "Payment Register", source: "accounts", type: "api", endpoint: "/accounts/payments-register" },
  { id: "fin-receivables", category: "financial", name: "Customer Outstanding", source: "accounts", type: "api", endpoint: "/accounts/receivables" },
  { id: "fin-payables", category: "financial", name: "Supplier Outstanding", source: "accounts", type: "api", endpoint: "/accounts/payables" },
  { id: "fin-integrity", category: "financial", name: "Accounting Integrity", source: "accounts", type: "api", endpoint: "/accounts/integrity" },

  // Sales
  { id: "sales-workspace", category: "sales", name: "Sales Workspace", source: "ui", type: "tab", tab: "sales", description: "Full sales analytics workspace" },
  { id: "sales-list", category: "sales", name: "Invoice Register", source: "reports", type: "api", endpoint: "/reports/sales/list" },
  { id: "sales-by-employee", category: "sales", name: "Sales by Employee", source: "reports", type: "api", endpoint: "/reports/sales/by-employee" },
  { id: "sales-top-customers", category: "sales", name: "Top Customers", source: "reports", type: "api", endpoint: "/reports/sales/top-customers" },
  { id: "sales-top-products", category: "sales", name: "Top Products", source: "reports", type: "api", endpoint: "/reports/sales/top-products" },
  { id: "sales-trend", category: "sales", name: "Sales Trend", source: "reports", type: "api", endpoint: "/reports/sales/trend" },
  { id: "sales-accounts", category: "sales", name: "Sales Accounts Register", source: "accounts", type: "api", endpoint: "/accounts/sales" },
  { id: "sales-birthday", category: "sales", name: "Birthdays", source: "reports", type: "api", endpoint: "/reports/customers/birthday", description: "This month’s birthdays — today’s matches at the top" },
  { id: "sales-anniversary", category: "sales", name: "Anniversaries", source: "reports", type: "api", endpoint: "/reports/customers/anniversary", description: "This month’s anniversaries — today’s matches at the top" },

  { id: "hidden-data-workspace", category: "hidden-data", name: "Hidden Data", source: "reports", type: "tab", tab: "hidden-data", description: "Hidden POS bills, sales, tenders and items" },

  // Customers
  { id: "cust-workspace", category: "customers", name: "Customers Workspace", source: "ui", type: "tab", tab: "customers" },
  { id: "cust-list", category: "customers", name: "Customer List Report", source: "reports", type: "api", endpoint: "/reports/customers/list" },
  { id: "cust-pending", category: "customers", name: "Pending Balance / Advances", source: "reports", type: "api", endpoint: "/reports/customers/pending-balance" },
  { id: "cust-frequency", category: "customers", name: "Purchase Frequency", source: "reports", type: "api", endpoint: "/reports/customers/purchase-frequency" },
  { id: "cust-loyal", category: "customers", name: "Loyal Customers", source: "reports", type: "api", endpoint: "/reports/customers/loyal" },
  { id: "cust-inactive", category: "customers", name: "Inactive Customers", source: "reports", type: "api", endpoint: "/reports/customers/inactive" },
  { id: "cust-top", category: "customers", name: "Top Spending", source: "reports", type: "api", endpoint: "/reports/customers/top-spending" },
  { id: "cust-birthday", category: "customers", name: "Birthdays", source: "reports", type: "api", endpoint: "/reports/customers/birthday", description: "This month’s birthdays — today’s matches at the top" },
  { id: "cust-anniversary", category: "customers", name: "Anniversaries", source: "reports", type: "api", endpoint: "/reports/customers/anniversary", description: "This month’s anniversaries — today’s matches at the top" },
  { id: "cust-ar", category: "customers", name: "Receivables Ageing", source: "accounts", type: "api", endpoint: "/accounts/receivables" },

  // Suppliers
  { id: "sup-workspace", category: "suppliers", name: "Purchases Workspace", source: "ui", type: "tab", tab: "purchases" },
  { id: "sup-pending", category: "suppliers", name: "Pending Payments", source: "reports", type: "api", endpoint: "/reports/purchases/pending-payments" },
  { id: "sup-outstanding", category: "suppliers", name: "Outstanding Vendors", source: "reports", type: "api", endpoint: "/reports/purchases/outstanding-vendors" },
  { id: "sup-metal", category: "suppliers", name: "Metal-wise Purchases", source: "reports", type: "api", endpoint: "/reports/purchases/metal-wise" },
  { id: "sup-trend", category: "suppliers", name: "Purchase Trend", source: "reports", type: "api", endpoint: "/reports/purchases/trend" },
  { id: "sup-accounts", category: "suppliers", name: "Purchase Accounts", source: "accounts", type: "api", endpoint: "/accounts/purchases" },
  { id: "sup-payables", category: "suppliers", name: "Payables Ageing", source: "accounts", type: "api", endpoint: "/accounts/payables" },

  // Inventory
  { id: "inv-workspace", category: "inventory", name: "Inventory Workspace", source: "ui", type: "tab", tab: "inventory" },
  { id: "inv-stock-details", category: "inventory", name: "Current Stock / Valuation", source: "ui", type: "quick", quick: "stock-details" },
  { id: "inv-category", category: "inventory", name: "Category Stock", source: "ui", type: "quick", quick: "category-stock" },
  { id: "inv-counter", category: "inventory", name: "Counter Stock", source: "ui", type: "quick", quick: "counter-stock" },
  { id: "inv-today", category: "inventory", name: "Today's Stock Added", source: "ui", type: "quick", quick: "today-stock-added" },
  { id: "inv-dead", category: "inventory", name: "Dead Stock", source: "ui", type: "quick", quick: "dead-stock" },
  { id: "inv-fast", category: "inventory", name: "Fast Moving", source: "ui", type: "quick", quick: "fast-moving" },
  { id: "inv-ageing", category: "inventory", name: "Stock Ageing", source: "ui", type: "quick", quick: "stock-ageing" },
  { id: "inv-tag", category: "inventory", name: "Tag History", source: "ui", type: "quick", quick: "tag-history" },
  { id: "inv-movement", category: "inventory", name: "Stock Movement", source: "ui", type: "quick", quick: "item-movement" },
  { id: "inv-check", category: "inventory", name: "Stock Check", source: "ui", type: "quick", quick: "stock-check" },
  { id: "inv-sold-items", category: "inventory", name: "Sold Stock Info", source: "ui", type: "quick", quick: "sold-items" },

  // Jewellery
  { id: "jew-workspace", category: "jewellery", name: "Jewellery / More Workspace", source: "ui", type: "tab", tab: "more" },
  { id: "jew-hallmark", category: "jewellery", name: "Hallmark Report", source: "reports", type: "api", endpoint: "/reports/hallmark" },
  { id: "jew-oldgold-exchange", category: "jewellery", name: "Old Gold Exchange", source: "reports", type: "tab", tab: "more", description: "Invoice-linked old gold exchanges — weight, purity, rate, value, status" },
  { id: "jew-oldsilver-exchange", category: "jewellery", name: "Old Silver Exchange", source: "reports", type: "tab", tab: "more", description: "Invoice-linked old silver exchanges — weight, purity, rate, value, status" },
 // { id: "jew-oldgold", category: "jewellery", name: "Old Gold Buybook", source: "reports", type: "api", endpoint: "/reports/old-gold/buybook" },
  { id: "jew-commission", category: "jewellery", name: "Commission Report", source: "reports", type: "api", endpoint: "/reports/commission" },
  { id: "jew-rates", category: "jewellery", name: "Gold Rate History", source: "reports", type: "api", endpoint: "/reports/gold-rate-history" },

  // GST
  { id: "gst-workspace", category: "gst", name: "GST Workspace", source: "ui", type: "tab", tab: "gst" },
  { id: "gst-list", category: "gst", name: "Sales GST Register", source: "reports", type: "api", endpoint: "/reports/gst/list" },
  { id: "gst-hsn", category: "gst", name: "HSN Summary", source: "reports", type: "api", endpoint: "/reports/gst/hsn-summary" },
  { id: "gst-rate", category: "gst", name: "Tax Rate Summary", source: "reports", type: "api", endpoint: "/reports/gst/tax-rate-summary" },
  { id: "gst-monthly", category: "gst", name: "Monthly GST Summary", source: "reports", type: "api", endpoint: "/reports/gst/monthly-summary" },
  { id: "gst-liability", category: "gst", name: "GST Liability", source: "reports", type: "api", endpoint: "/reports/gst/liability" },
  { id: "gst-accounts", category: "gst", name: "GST Accounts (CGST/SGST/IGST)", source: "accounts", type: "api", endpoint: "/accounts/gst" },
  { id: "gst-collection-trend", category: "gst", name: "GST Collection Trend", source: "reports", type: "api", endpoint: "/reports/gst/collection-trend" },

  // Expenses
  { id: "exp-register", category: "expenses", name: "Expense Register", source: "accounts", type: "api", endpoint: "/accounts/expenses", description: "All expenses in range (CRUD remains in Accounts)" },
  { id: "exp-pnl", category: "expenses", name: "Expenses in P&L", source: "accounts", type: "api", endpoint: "/accounts/pnl", description: "Expense lines from journal P&L" },

  // Schemes
  { id: "sch-workspace", category: "schemes", name: "Schemes Workspace", source: "ui", type: "tab", tab: "schemes" },
  { id: "sch-list", category: "schemes", name: "Schemes List", source: "reports", type: "api", endpoint: "/reports/schemes/list" },
  { id: "sch-maturity", category: "schemes", name: "Upcoming Maturity", source: "reports", type: "api", endpoint: "/reports/schemes/upcoming-maturity" },
  { id: "sch-missed", category: "schemes", name: "Missed Installments", source: "reports", type: "api", endpoint: "/reports/schemes/missed-installments" },
  { id: "sch-overdue", category: "schemes", name: "Overdue Schemes", source: "reports", type: "api", endpoint: "/reports/schemes/overdue" },
  { id: "sch-collection", category: "schemes", name: "Scheme Collections", source: "reports", type: "api", endpoint: "/reports/schemes/collection" },
  { id: "sch-accounts", category: "schemes", name: "Scheme Accounts Liability", source: "accounts", type: "api", endpoint: "/accounts/schemes" },

  // Day Closing Report
  { id: "dcr-workspace", category: "day-closing", name: "Day Closing Report", source: "reports", type: "tab", tab: "day-closing", description: "Bills for the selected transaction date — hidden bills only after unlock" },
];

export function searchReports(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return REPORT_CATALOG;
  return REPORT_CATALOG.filter(
    (r) =>
      r.name.toLowerCase().includes(q)
      || r.id.includes(q)
      || (r.description || "").toLowerCase().includes(q)
      || r.category.includes(q),
  );
}

export function reportsInCategory(categoryId) {
  return REPORT_CATALOG.filter((r) => r.category === categoryId);
}

export function findReport(reportId) {
  return REPORT_CATALOG.find((r) => r.id === reportId) || null;
}

export function defaultReportForCategory(categoryId, isVisible) {
  let list = reportsInCategory(categoryId);
  if (isVisible) list = list.filter((r) => isVisible("item", r.id));
  if (!list.length) return null;
  return list.find((r) => r.type === "tab") || list[0];
}

/** Categories filtered by the Application Management section-visibility toggle. isVisible(level, id) => bool. */
export function visibleReportCategories(isVisible) {
  return REPORT_CATEGORIES.filter((c) => c.id !== "hidden-data" && isVisible("category", c.id));
}

/** Sub-items within a category filtered by the same toggle. */
export function visibleReportsInCategory(categoryId, isVisible) {
  return reportsInCategory(categoryId).filter((r) => isVisible("item", r.id));
}

export function categoryForReport(reportId) {
  const r = findReport(reportId);
  return r?.category || REPORT_CATEGORIES[0]?.id || "executive";
}
