/**
 * Focused Accounts + Reports smoke checklist against a live Branch Service.
 * Usage: node src/scripts/smokeAccountsReports.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envBranch = path.resolve(__dirname, '../../.env.branch');
if (fs.existsSync(envBranch)) {
  for (const line of fs.readFileSync(envBranch, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i);
    const v = t.slice(i + 1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const base = process.env.BRANCH_SMOKE_URL || 'http://127.0.0.1:8000';
const smokeEmail = process.env.SMOKE_EMAIL;
const smokePassword = process.env.SMOKE_PASSWORD;
const from = '2026-01-01';
const to = '2026-08-11';
const today = '2026-08-11';

const results = [];

function record(area, check, status, detail = '', http = null) {
  results.push({ area, check, status, detail, http });
  const icon = status === 'PASS' ? 'PASS' : status === 'FAIL' ? 'FAIL' : 'WARN';
  console.log(`[${icon}] ${area} · ${check}${detail ? ` — ${detail}` : ''}${http != null ? ` (HTTP ${http})` : ''}`);
}

async function req(method, urlPath, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${base}${urlPath}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { status: 0, data: { error: e.message }, ok: false };
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, ok: res.ok };
}

function errDetail(data) {
  if (!data) return '';
  if (typeof data === 'string') return data.slice(0, 160);
  return String(data.detail || data.error || data.message || JSON.stringify(data)).slice(0, 160);
}

async function checkGet(area, name, urlPath, token, { soft = false } = {}) {
  const r = await req('GET', urlPath, { token });
  if (r.ok) {
    record(area, name, 'PASS', '', r.status);
    return r;
  }
  // 404 on optional ledgers without IDs is soft-warn if soft
  if (soft && (r.status === 400 || r.status === 404)) {
    record(area, name, 'WARN', errDetail(r.data), r.status);
    return r;
  }
  record(area, name, 'FAIL', errDetail(r.data), r.status);
  return r;
}

async function run() {
  console.log(`\n=== Accounts + Reports Smoke ===`);
  console.log(`Target: ${base}\n`);

  const health = await req('GET', '/api/health');
  if (!health.ok) {
    record('System', 'Health', 'FAIL', errDetail(health.data), health.status);
    return finish();
  }
  record('System', 'Health', 'PASS', health.data?.app_mode || '', health.status);

  if (!smokeEmail || !smokePassword) {
    record('Auth', 'Owner login', 'FAIL', 'Set SMOKE_EMAIL and SMOKE_PASSWORD env vars (no hardcoded defaults)');
    return finish();
  }

  const login = await req('POST', '/api/auth/login', {
    body: {
      email: smokeEmail,
      password: smokePassword,
    },
  });
  const token = login.data?.access_token || login.data?.token;
  if (!(login.ok && token)) {
    record('Auth', 'Owner login', 'FAIL', errDetail(login.data), login.status);
    return finish();
  }
  record('Auth', 'Owner login', 'PASS', '', login.status);

  const q = `from=${from}&to=${to}`;

  // ---- Accounts UI tabs ----
  const accountsGets = [
    ['Dashboard', `/api/accounts/dashboard?${q}`],
    ['Day Closing preview', `/api/accounts/daily-closings/${today}/preview`],
    ['Day Closing list', `/api/accounts/daily-closings?limit=5`],
    ['Day Book', `/api/accounts/day-book?${q}`],
    ['Sales Accounts', `/api/accounts/sales?${q}`],
    ['Customer Receivables', `/api/accounts/receivables`],
    ['Receipts', `/api/accounts/receipts?${q}`],
    ['Purchase Accounts', `/api/accounts/purchases?${q}`],
    ['Vendor Payables', `/api/accounts/payables`],
    ['Payments Register', `/api/accounts/payments-register?${q}`],
    ['Expenses', `/api/accounts/expenses?limit=20`],
    ['Expense Categories', `/api/accounts/expense-categories`],
    ['Cash Book', `/api/accounts/cash-book?${q}`],
    ['Bank Book', `/api/accounts/bank-book?${q}`],
    ['Bank Accounts', `/api/accounts/bank-accounts`],
    ['Bank Reconciliation', `/api/accounts/reconciliation`],
    ['Gold / Metal', `/api/accounts/metal`],
    ['Scheme Accounts', `/api/accounts/schemes`],
    ['GST / Tax', `/api/accounts/gst?${q}`],
    ['Trial Balance', `/api/accounts/trial-balance?${q}`],
    ['P&L', `/api/accounts/pnl?${q}`],
    ['Balance Sheet', `/api/accounts/balance-sheet?to=${to}`],
    ['Audit Trail', `/api/accounts/audit-trail?limit=10`],
    ['Integrity', `/api/accounts/integrity`],
    ['Assessment', `/api/accounts/assessment`],
    ['Opening Snapshot', `/api/accounts/opening-snapshot`],
    // GL requires account code — exercised with Cash (1000) below
    ['Accounts Summary', `/api/accounts/summary`],
    ['Employee Sales', `/api/accounts/employee-sales?${q}`],
    ['Legacy cashbook', `/api/accounts/cashbook?limit=5`],
  ];

  for (const [name, url] of accountsGets) {
    await checkGet('Accounts', name, url, token);
  }

  await checkGet('Accounts', 'GL Cash 1000', `/api/accounts/gl?account=1000&from=${from}&to=${to}`, token);

  await checkGet('Accounts', 'Employee Sales', `/api/accounts/employee-sales?${q}`, token);

  // Party ledgers — need IDs from lists
  const customers = await req('GET', '/api/customers?limit=1', { token });
  const custId = customers.data?.items?.[0]?.id || customers.data?.data?.[0]?.id || customers.data?.[0]?.id;
  if (custId) {
    await checkGet('Accounts', 'Customer Ledger (path)', `/api/accounts/customers/${custId}/ledger`, token);
  } else {
    record('Accounts', 'Customer Ledger', 'WARN', 'No customer to test ledger');
  }

  const vendors = await req('GET', '/api/vendors?limit=1', { token });
  const vendId = vendors.data?.items?.[0]?.id || vendors.data?.data?.[0]?.id || vendors.data?.[0]?.id;
  if (vendId) {
    await checkGet('Accounts', 'Vendor Ledger (path)', `/api/accounts/suppliers/${vendId}/ledger`, token);
  } else {
    record('Accounts', 'Vendor Ledger', 'WARN', 'No vendor to test ledger');
  }

  // Integrity soft checks
  const integrity = await req('GET', '/api/accounts/integrity', { token });
  if (integrity.ok) {
    const balanced = integrity.data?.trial_balance?.balanced;
    const warnings = integrity.data?.warnings || [];
    if (balanced === false) {
      record('Accounts', 'TB balanced flag', 'FAIL', 'trial_balance.balanced=false', integrity.status);
    } else if (balanced === true) {
      record('Accounts', 'TB balanced flag', 'PASS', `warnings=${warnings.length}`, integrity.status);
    } else {
      record('Accounts', 'TB balanced flag', 'WARN', 'balanced field missing', integrity.status);
    }
    if (warnings.length) {
      record('Accounts', 'Integrity warnings', 'WARN', warnings.slice(0, 3).map((w) => w.code || w.message).join('; '));
    }
  }

  // ---- Reports catalog APIs ----
  const reportGets = [
    // Executive / financial via accounts (catalog)
    ['Business Overview', `/api/accounts/dashboard?${q}`],
    ['Profitability P&L', `/api/accounts/pnl?${q}`],
    ['Cash Position', `/api/accounts/cash-book?${q}`],
    ['Balance Sheet report', `/api/accounts/balance-sheet?to=${to}`],
    ['Trial Balance report', `/api/accounts/trial-balance?${q}`],
    ['Day Book report', `/api/accounts/day-book?${q}`],
    ['Bank Book report', `/api/accounts/bank-book?${q}`],
    ['Receipt Register', `/api/accounts/receipts?${q}`],
    ['Payment Register', `/api/accounts/payments-register?${q}`],
    ['Customer Outstanding', `/api/accounts/receivables`],
    ['Supplier Outstanding', `/api/accounts/payables`],
    ['Accounting Integrity', `/api/accounts/integrity`],
    ['Sales Accounts Register', `/api/accounts/sales?${q}`],
    ['Purchase Accounts', `/api/accounts/purchases?${q}`],
    ['Metal Position', `/api/accounts/metal`],
    ['GST Accounts', `/api/accounts/gst?${q}`],
    ['Expense Register', `/api/accounts/expenses?${q}`],
    ['Scheme Liability', `/api/accounts/schemes`],

    // Ops reports
    ['Invoice Register', `/api/reports/sales/list?${q}`],
    ['Sales by Employee', `/api/reports/sales/by-employee?${q}`],
    ['Sales by Counter', `/api/reports/sales/by-counter?${q}`],
    ['Top Customers', `/api/reports/sales/top-customers?${q}`],
    ['Top Products', `/api/reports/sales/top-products?${q}`],
    ['Sales Trend', `/api/reports/sales/trend?${q}`],
    ['Legacy sales report', `/api/reports/sales?${q}`],

    ['Customer List', `/api/reports/customers/list`],
    ['Pending Balance', `/api/reports/customers/pending-balance`],
    ['Purchase Frequency', `/api/reports/customers/purchase-frequency`],
    ['Loyal Customers', `/api/reports/customers/loyal`],
    ['Inactive Customers', `/api/reports/customers/inactive`],
    ['Top Spending', `/api/reports/customers/top-spending?${q}`],
    ['Birthdays', `/api/reports/customers/birthday`],
    ['Anniversaries', `/api/reports/customers/anniversary`],

    ['Pending Payments', `/api/reports/purchases/pending-payments`],
    ['Outstanding Vendors', `/api/reports/purchases/outstanding-vendors`],
    ['Metal-wise Purchases', `/api/reports/purchases/metal-wise?${q}`],
    ['Purchase Trend', `/api/reports/purchases/trend?${q}`],

    ['Stock Check', `/api/reports/inventory/stock-check`],
    ['Category Stock', `/api/reports/inventory/category-stock`],
    ['Counter Stock', `/api/reports/inventory/counter-stock`],
    ["Today's Stock Added", `/api/reports/inventory/today-stock-added`],
    ['Dead Stock', `/api/reports/inventory/dead-stock`],
    ['Fast Moving', `/api/reports/inventory/fast-moving`],
    ['Stock Ageing', `/api/reports/inventory/stock-ageing`],
    ['Tag History', `/api/reports/inventory/tag-history`],
    // Item Movement requires tag/barcode — checked separately with a real tag if available
    ['Stock Details', `/api/reports/inventory/stock-details`],
    ['Legacy inventory', `/api/reports/inventory`],

    ['Hallmark', `/api/reports/hallmark`],
    ['Old Gold Buybook', `/api/reports/old-gold/buybook?${q}`],
    ['Commission', `/api/reports/commission?${q}`],
    ['Gold Rate History', `/api/reports/gold-rate-history`],

    ['Sales GST Register', `/api/reports/gst/list?${q}`],
    ['HSN Summary', `/api/reports/gst/hsn-summary?${q}`],
    ['Tax Rate Summary', `/api/reports/gst/tax-rate-summary?${q}`],
    ['Monthly GST', `/api/reports/gst/monthly-summary?${q}`],
    ['GST Liability', `/api/reports/gst/liability?${q}`],
    ['Legacy GST', `/api/reports/gst?${q}`],
    ['GSTR-1 JSON', `/api/reports/gst/gstr1-json?month=2026-08`],
    ['GSTR-3B JSON', `/api/reports/gst/gstr3b-json?month=2026-08`],
    ['GST Collection Trend', `/api/reports/gst/collection-trend?${q}`],

    ['Schemes List', `/api/reports/schemes/list`],
    ['Upcoming Maturity', `/api/reports/schemes/upcoming-maturity`],
    ['Missed Installments', `/api/reports/schemes/missed-installments`],
    ['Overdue Schemes', `/api/reports/schemes/overdue`],
    ['Scheme Collections', `/api/reports/schemes/collection?${q}`],
  ];

  for (const [name, url] of reportGets) {
    await checkGet('Reports', name, url, token);
  }

  const products = await req('GET', '/api/products?limit=1', { token });
  const prod = products.data?.items?.[0] || products.data?.data?.[0] || products.data?.[0];
  const tag = prod?.barcode || prod?.tag_number || prod?.sku;
  if (tag) {
    await checkGet(
      'Reports',
      'Item Movement (with tag)',
      `/api/reports/inventory/item-movement?tag_number=${encodeURIComponent(tag)}`,
      token,
    );
  } else {
    record('Reports', 'Item Movement (with tag)', 'WARN', 'No product tag/barcode available');
  }

  return finish();
}

function finish() {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const warn = results.filter((r) => r.status === 'WARN').length;

  console.log(`\n=== SUMMARY ===`);
  console.log(`PASS=${pass}  FAIL=${fail}  WARN=${warn}  TOTAL=${results.length}`);

  if (fail) {
    console.log(`\n--- FAILURES ---`);
    for (const r of results.filter((x) => x.status === 'FAIL')) {
      console.log(`FAIL · ${r.area} · ${r.check} · ${r.detail} · HTTP ${r.http}`);
    }
  }
  if (warn) {
    console.log(`\n--- WARNINGS ---`);
    for (const r of results.filter((x) => x.status === 'WARN')) {
      console.log(`WARN · ${r.area} · ${r.check} · ${r.detail} · HTTP ${r.http ?? '-'}`);
    }
  }

  const out = path.resolve(__dirname, '../../logs/smoke-accounts-reports.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        base,
        summary: { pass, fail, warn, total: results.length },
        failures: results.filter((r) => r.status === 'FAIL'),
        warnings: results.filter((r) => r.status === 'WARN'),
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${out}`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(2);
});
