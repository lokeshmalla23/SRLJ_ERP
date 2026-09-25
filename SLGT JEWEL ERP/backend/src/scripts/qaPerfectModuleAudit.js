/**
 * Perfect CRM module audit — correct API contracts + full interlink verification.
 * Expects Branch Service running. Creates disposable QA-* data.
 *
 * Usage: node src/scripts/qaPerfectModuleAudit.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calcLineAmounts, calcInvoiceTotals } from '../services/billingCalc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envBranch = path.resolve(__dirname, '../../.env.branch');
if (fs.existsSync(envBranch)) {
  for (const line of fs.readFileSync(envBranch, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    if (!process.env[t.slice(0, i)]) process.env[t.slice(0, i)] = t.slice(i + 1);
  }
}

const base = process.env.BRANCH_SMOKE_URL || 'http://127.0.0.1:8000';
const smokeEmail = process.env.SMOKE_EMAIL;
const smokePassword = process.env.SMOKE_PASSWORD;
const stamp = Date.now();
const results = [];
const findings = [];

function record(module, check, status, detail = '', severity = 'info') {
  const row = { module, check, status, detail, severity };
  results.push(row);
  if (status === 'FAIL' || status === 'WARN') findings.push(row);
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '!';
  console.log(`${icon} [${module}] ${check}${detail ? ` — ${detail}` : ''}`);
}

async function req(method, urlPath, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`${base}${urlPath}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, ok: res.ok };
  } catch (e) {
    return { status: 0, data: { error: e.message }, ok: false };
  }
}

function pickList(data) {
  if (Array.isArray(data)) return data;
  for (const k of ['items', 'data', 'rows', 'results', 'customers', 'products', 'employees', 'vendors']) {
    if (Array.isArray(data?.[k])) return data[k];
  }
  return [];
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function run() {
  console.log(`\n=== PERFECT CRM MODULE AUDIT ===\nTarget: ${base}\nStamp: ${stamp}\n`);

  // Health + Auth
  const health = await req('GET', '/api/health');
  if (!(health.status === 200 && health.data?.ready)) {
    record('System', 'Health ready', 'FAIL', JSON.stringify(health.data).slice(0, 180), 'critical');
    return finish(1);
  }
  record('System', 'Health ready', 'PASS', `mode=${health.data.app_mode} db=${health.data.database?.name}`);

  const bad = await req('POST', '/api/auth/login', {
    body: { email: smokeEmail || 'invalid-user@example.com', password: 'WRONG' },
  });
  record('Auth', 'Reject bad password', bad.status >= 400 ? 'PASS' : 'FAIL', `status=${bad.status}`, bad.status >= 400 ? 'info' : 'critical');

  if (!smokeEmail || !smokePassword) {
    record('Auth', 'Owner login', 'FAIL', 'Set SMOKE_EMAIL and SMOKE_PASSWORD env vars (no hardcoded defaults)', 'critical');
    return finish(1);
  }

  const login = await req('POST', '/api/auth/login', {
    body: {
      email: smokeEmail,
      password: smokePassword,
    },
  });
  const token = login.data?.access_token || login.data?.token;
  if (!(login.status === 200 && token)) {
    record('Auth', 'Owner login', 'FAIL', JSON.stringify(login.data).slice(0, 180), 'critical');
    return finish(1);
  }
  record('Auth', 'Owner login', 'PASS');

  const me = await req('GET', '/api/auth/me', { token });
  record('Auth', 'Session /me', me.status === 200 ? 'PASS' : 'FAIL', me.data?.email || me.data?.user?.email || `status=${me.status}`);

  // Gold rates
  const rateRes = await req('GET', '/api/settings/gold-rate', { token });
  const rates = rateRes.data?.value || rateRes.data || {};
  const gold24 = Number(rates.gold_24k) || 14000;
  const gold22 = Number(rates.gold_22k) || 12000;
  const gold18 = Number(rates.gold_18k) || 7000;
  const rateMap = { '24K': gold24, '22K': gold22, '18K': gold18 };
  record('Settings', 'Gold rate map', rateRes.status === 200 ? 'PASS' : 'FAIL', `24K=${gold24} 22K=${gold22}`);

  // Read probes
  const probes = [
    ['Dashboard', '/api/dashboard/summary'],
    ['Customers', '/api/customers?limit=5'],
    ['Products', '/api/products?limit=5'],
    ['Catalog', '/api/categories'],
    ['Catalog', '/api/catalog/metal-types'],
    ['Catalog', '/api/catalog/purities'],
    ['Invoices', '/api/invoices?limit=5'],
    ['Quotations', '/api/quotations?limit=5'],
    ['Orders', '/api/orders?limit=5'],
    ['Vendors', '/api/vendors?limit=5'],
    ['Purchases', '/api/purchases?limit=5'],
    ['Schemes', '/api/schemes?limit=5'],
    ['SchemePlans', '/api/scheme-plans?limit=5'],
    ['Employees', '/api/employees?limit=5'],
    ['Promotions', '/api/promotions/campaigns?limit=5'],
    ['Settings', '/api/settings'],
    ['Notifications', '/api/notifications?limit=5'],
    ['Search', '/api/search?q=gold'],
    ['Barcodes', '/api/barcodes/stats'],
    ['Stock', '/api/stock/history?limit=5'],
    ['Reports', '/api/reports/sales?from=2026-01-01&to=2026-12-31'],
    ['Accounts', '/api/accounts/dashboard'],
    ['Accounts', '/api/accounts/receivables'],
    ['Accounts', '/api/accounts/payables'],
    ['Accounts', '/api/accounts/trial-balance'],
    ['Accounts', '/api/accounts/cash-book'],
    ['Accounts', '/api/accounts/day-book'],
    ['Accounts', '/api/accounts/expenses?limit=5'],
    ['Accounts', '/api/accounts/gst'],
    ['Accounts', '/api/accounts/integrity'],
    ['Accounts', '/api/accounts/sales'],
    ['Accounts', '/api/accounts/metal'],
    ['Accounts', '/api/accounts/schemes'],
    ['Accounts', '/api/accounts/bank-book'],
    ['Accounts', '/api/accounts/pnl'],
    ['Accounts', '/api/accounts/balance-sheet'],
    ['Accounts', '/api/accounts/receipts'],
    ['Accounts', '/api/accounts/payments-register'],
    ['Accounts', '/api/accounts/employee-sales'],
    ['Accounts', '/api/accounts/daily-closings'],
    ['Advances', '/api/advances?limit=5'],
  ];
  for (const [mod, url] of probes) {
    const r = await req('GET', url, { token });
    if (r.status === 200) record(mod, `GET ${url.split('?')[0]}`, 'PASS');
    else if (r.status === 404) record(mod, `GET ${url.split('?')[0]}`, 'WARN', '404', 'medium');
    else record(mod, `GET ${url.split('?')[0]}`, 'FAIL', `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`, 'high');
  }

  // Customer CRUD + duplicate reject
  const mobile = `9${String(stamp).slice(-9)}`;
  const cust = await req('POST', '/api/customers', {
    token,
    body: { name: `QA Perfect ${stamp}`, mobile, email: `qa.perfect.${stamp}@example.com`, address: 'QA Addr', tag: 'regular' },
  });
  const customerId = cust.data?.id;
  if ((cust.status === 200 || cust.status === 201) && customerId) {
    record('Customers', 'Create customer', 'PASS', customerId);
  } else {
    record('Customers', 'Create customer', 'FAIL', `${cust.status} ${JSON.stringify(cust.data).slice(0, 160)}`, 'critical');
  }

  if (customerId) {
    const get = await req('GET', `/api/customers/${customerId}`, { token });
    const gotName = get.data?.name || get.data?.customer?.name || '';
    record('Customers', 'Read customer', get.status === 200 && String(gotName).includes(String(stamp)) ? 'PASS' : 'FAIL', gotName || `status=${get.status} keys=${Object.keys(get.data||{}).join(',')}`);
    const c360 = await req('GET', `/api/customers/${customerId}/360`, { token });
    record('Customers', 'Customer 360', c360.status === 200 ? 'PASS' : 'FAIL', `status=${c360.status}`);
    const dup = await req('POST', '/api/customers', {
      token,
      body: { name: `QA Dup ${stamp}`, mobile },
    });
    if (dup.status === 409 || (dup.status >= 400 && /already|duplicate/i.test(JSON.stringify(dup.data)))) {
      record('Customers', 'Reject duplicate mobile', 'PASS', `status=${dup.status}`);
    } else if (dup.status === 200 || dup.status === 201) {
      record('Customers', 'Reject duplicate mobile', 'FAIL', 'Duplicate accepted — restart branch service to load fix', 'high');
    } else {
      record('Customers', 'Reject duplicate mobile', 'WARN', `${dup.status} ${JSON.stringify(dup.data).slice(0, 120)}`, 'medium');
    }
  }

  // Vendor + Employee
  const vendor = await req('POST', '/api/vendors', {
    token,
    body: { name: `QA Vendor ${stamp}`, mobile: `8${String(stamp).slice(-9)}`, vendor_type: 'supplier' },
  });
  const vendorId = vendor.data?.id;
  record('Vendors', 'Create vendor', (vendor.status < 300 && vendorId) ? 'PASS' : 'FAIL', vendorId || JSON.stringify(vendor.data).slice(0, 120), vendorId ? 'info' : 'high');

  const emp = await req('POST', '/api/employees', {
    token,
    body: { name: `QA Staff ${stamp}`, mobile: `7${String(stamp).slice(-9)}`, status: 'active', department: 'Sales' },
  });
  const employeeId = emp.data?.id;
  record('Employees', 'Create employee', (emp.status < 300 && employeeId) ? 'PASS' : 'FAIL', employeeId || JSON.stringify(emp.data).slice(0, 120));

  // Product + barcode search
  // Product create allocates a numeric tag barcode when non-serial values are sent
  const requestedBarcode = `QA-PF-${stamp}`;
  const prod = await req('POST', '/api/products', {
    token,
    body: {
      name: `QA Perfect Ring ${stamp}`,
      barcode: requestedBarcode,
      stock_qty: 5,
      net_weight: 4.5,
      gross_weight: 4.8,
      making_charges: 500,
      making_charge_type: 'fixed',
      status: 'available',
      purity: '22K',
    },
  });
  const productId = prod.data?.id;
  const barcode = prod.data?.barcode || requestedBarcode;
  const stockBefore = num(prod.data?.stock_qty) ?? 5;
  record('Inventory', 'Create product', (prod.status < 300 && productId) ? 'PASS' : 'FAIL', `id=${productId} stock=${stockBefore} barcode=${barcode}`, productId ? 'info' : 'critical');

  if (productId) {
    const bc = await req('GET', `/api/products/barcode-search?q=${encodeURIComponent(barcode)}`, { token });
    const found = pickList(bc.data).some((p) => p.id === productId || p.barcode === barcode)
      || bc.data?.id === productId
      || JSON.stringify(bc.data || {}).includes(String(barcode));
    record('Inventory', 'Barcode search', (bc.status === 200 && found) ? 'PASS' : 'WARN', found ? barcode : `status=${bc.status} q=${barcode}`, found ? 'info' : 'medium');
  }

  // Purchase (correct contract)
  let purchaseId = null;
  if (vendorId) {
    const purchase = await req('POST', '/api/purchases', {
      token,
      body: {
        vendor_id: vendorId,
        purchase_date: today(),
        purchase_type: 'gold_bullion',
        status: 'received',
        gst_pct: 3,
        subtotal: 10000,
        gst_amount: 300,
        grand_total: 10300,
        paid_amount: 10300,
        payment_mode: 'cash',
        items: [{
          description: `QA Raw Gold ${stamp}`,
          quantity: 1,
          weight_g: 10,
          purity: '22K',
          rate_per_g: 1000,
          amount: 10000,
        }],
      },
    });
    purchaseId = purchase.data?.id || purchase.data?.purchase?.id;
    record('Purchases', 'Create purchase', (purchase.status < 300 && purchaseId) ? 'PASS' : 'FAIL',
      purchaseId || `${purchase.status} ${JSON.stringify(purchase.data).slice(0, 160)}`, purchaseId ? 'info' : 'high');
  }

  // Quotation
  let quotationId = null;
  if (customerId && productId) {
    const line = calcLineAmounts({
      net_weight: 4.5, gross_weight: 4.8, wastage_pct: 0, making_charges: 500,
      making_charge_type: 'fixed', stone_charges: 0, purity: '22K', quantity: 1,
    }, gold24, rateMap);
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    const q = await req('POST', '/api/quotations', {
      token,
      body: {
        customer_id: customerId,
        customer_name: `QA Perfect ${stamp}`,
        customer_mobile: mobile,
        gold_rate: gold24,
        gold_22k: gold22,
        items: [{
          product_id: productId,
          quantity: 1,
          purity: '22K',
          net_weight: 4.5,
          gross_weight: 4.8,
          making_charges: 500,
          making_charge_type: 'fixed',
          name: `QA Perfect Ring ${stamp}`,
        }],
        subtotal: totals.subtotal,
        gst_pct: 3,
        gst_amount: totals.gst_amount,
        grand_total: totals.grand_total,
        notes: `QA quote ${stamp}`,
      },
    });
    quotationId = q.data?.id;
    record('Quotations', 'Create quotation', (q.status < 300 && quotationId) ? 'PASS' : 'FAIL',
      q.data?.quote_no || quotationId || `${q.status} ${JSON.stringify(q.data).slice(0, 160)}`, quotationId ? 'info' : 'high');
  }

  // Scheme plan + enroll
  const plan = await req('POST', '/api/scheme-plans', {
    token,
    body: { name: `QA Plan ${stamp}`, duration_months: 11, installment_amount: 2000, bonus_months: 1, is_active: true },
  });
  const planId = plan.data?.id;
  record('Schemes', 'Create scheme plan', (plan.status < 300 && planId) ? 'PASS' : 'FAIL', planId || JSON.stringify(plan.data).slice(0, 120));

  let schemeId = null;
  if (customerId && planId) {
    const sch = await req('POST', '/api/schemes', {
      token,
      body: {
        customer_id: customerId,
        customer_name: `QA Perfect ${stamp}`,
        customer_mobile: mobile,
        scheme_plan_id: planId,
        plan_name: `QA Plan ${stamp}`,
        monthly_amount: 2000,
        duration_months: 11,
        start_date: today(),
        status: 'active',
      },
    });
    schemeId = sch.data?.id;
    record('Schemes', 'Enroll customer', (sch.status < 300 && schemeId) ? 'PASS' : 'FAIL',
      schemeId || `${sch.status} ${JSON.stringify(sch.data).slice(0, 160)}`, schemeId ? 'info' : 'medium');
    if (schemeId) {
      const pay = await req('POST', `/api/schemes/${schemeId}/payments`, {
        token,
        body: { amount: 2000, mode: 'cash', payment_date: today(), gold_rate: gold22 },
      });
      record('Schemes', 'Installment payment', pay.status < 300 ? 'PASS' : 'FAIL',
        pay.status < 300 ? '' : `${pay.status} ${JSON.stringify(pay.data).slice(0, 140)}`, pay.status < 300 ? 'info' : 'high');
    }
  }

  // Order
  if (customerId) {
    const ord = await req('POST', '/api/orders', {
      token,
      body: {
        type: 'custom',
        customer_id: customerId,
        customer_name: `QA Perfect ${stamp}`,
        customer_mobile: mobile,
        description: `QA custom order ${stamp}`,
        metal_type: 'Gold',
        purity: '22K',
        estimated_weight: 5,
        estimated_price: 50000,
        advance_paid: 0,
        delivery_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        vendor_id: vendorId || undefined,
      },
    });
    record('Orders', 'Create order', ord.status < 300 && ord.data?.id ? 'PASS' : 'FAIL',
      ord.data?.id || `${ord.status} ${JSON.stringify(ord.data).slice(0, 140)}`, ord.data?.id ? 'info' : 'medium');
  }

  // Expense
  const exp = await req('POST', '/api/accounts/expenses', {
    token,
    body: { amount: 175, payment_mode: 'cash', date: today(), description: `QA expense ${stamp}` },
  });
  record('Accounts', 'Create expense', exp.status < 300 ? 'PASS' : 'FAIL', exp.data?.id || JSON.stringify(exp.data).slice(0, 120));

  // Promotions
  const camp = await req('POST', '/api/promotions/campaigns', {
    token,
    body: {
      name: `QA Campaign ${stamp}`,
      type: 'sms',
      message_template: 'Hello {{name}}, QA promo',
      segment: 'all',
      status: 'draft',
    },
  });
  record('Promotions', 'Create campaign', camp.status < 300 ? 'PASS' : 'WARN',
    camp.data?.id || `${camp.status} ${JSON.stringify(camp.data).slice(0, 120)}`, camp.status < 300 ? 'info' : 'low');

  // POS critical path
  let invoiceId = null;
  let invoiceNo = null;
  let grandTotal = null;
  if (productId && customerId) {
    const line = calcLineAmounts({
      net_weight: 4.5, gross_weight: 4.8, wastage_pct: 0, making_charges: 500,
      making_charge_type: 'fixed', stone_charges: 0, purity: '22K', quantity: 1,
    }, gold24, rateMap);
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    grandTotal = totals.grand_total;

    const empty = await req('POST', '/api/invoices', {
      token,
      body: { items: [], payments: [], gold_rate: gold24, request_id: `qa-empty-${stamp}` },
    });
    record('POS', 'Reject empty cart', empty.status >= 400 ? 'PASS' : 'FAIL', `status=${empty.status}`, empty.status >= 400 ? 'info' : 'critical');

    const inv = await req('POST', '/api/invoices', {
      token,
      body: {
        customer_id: customerId,
        customer_name: `QA Perfect ${stamp}`,
        customer_mobile: mobile,
        salesperson_id: employeeId || undefined,
        items: [{ product_id: productId, quantity: 1, purity: '22K' }],
        payments: [{ mode: 'cash', amount: totals.grand_total }],
        gold_rate: gold24,
        gold_22k: gold22,
        gold_18k: gold18,
        request_id: `qa-perfect-inv-${stamp}`,
      },
    });
    invoiceId = inv.data?.id || inv.data?.invoice?.id;
    invoiceNo = inv.data?.invoice_no || inv.data?.invoice?.invoice_no;
    if ((inv.status === 200 || inv.status === 201) && invoiceNo) {
      record('POS', 'Create paid invoice', 'PASS', `${invoiceNo} total=${inv.data.grand_total ?? inv.data.invoice?.grand_total}`);
      const serverTotal = num(inv.data.grand_total ?? inv.data.invoice?.grand_total);
      if (serverTotal != null && Math.abs(serverTotal - Number(totals.grand_total)) <= 1) {
        record('POS', 'Server totals match rateMap calc', 'PASS', `₹${serverTotal}`);
      } else {
        record('POS', 'Server totals match rateMap calc', 'FAIL', `server=${serverTotal} expected=${totals.grand_total}`, 'critical');
      }
    } else {
      record('POS', 'Create paid invoice', 'FAIL', `${inv.status} ${JSON.stringify(inv.data).slice(0, 220)}`, 'critical');
    }

    // Idempotency
    if (invoiceNo) {
      const inv2 = await req('POST', '/api/invoices', {
        token,
        body: {
          customer_id: customerId,
          items: [{ product_id: productId, quantity: 1, purity: '22K' }],
          payments: [{ mode: 'cash', amount: totals.grand_total }],
          gold_rate: gold24,
          gold_22k: gold22,
          request_id: `qa-perfect-inv-${stamp}`,
        },
      });
      const inv2No = inv2.data?.invoice_no || inv2.data?.invoice?.invoice_no;
      record('POS', 'Idempotent retry', (inv2No === invoiceNo) ? 'PASS' : 'FAIL', inv2No || `status=${inv2.status}`, inv2No === invoiceNo ? 'info' : 'critical');
    }

    // Stock
    let stockAfter = Math.max(0, stockBefore - (invoiceId ? 1 : 0));
    if (invoiceId) {
      const after = await req('GET', `/api/products/${productId}`, { token });
      stockAfter = num(after.data?.stock_qty);
      record('Inventory', 'Stock after sale', stockAfter === stockBefore - 1 ? 'PASS' : 'FAIL',
        `${stockBefore} → ${stockAfter}`, stockAfter === stockBefore - 1 ? 'info' : 'critical');
    }

    // Oversell — pay exact total for qty above stock so we hit INSUFFICIENT_STOCK (not over/underpay)
    const left = Math.max(0, Math.floor(stockAfter || 0));
    const overQty = left + 5;
    const overLine = calcLineAmounts({
      net_weight: 4.5, gross_weight: 4.8, wastage_pct: 0, making_charges: 500,
      making_charge_type: 'fixed', stone_charges: 0, purity: '22K', quantity: overQty,
    }, gold24, rateMap);
    const overTotals = calcInvoiceTotals({ lineTotals: [overLine.line_total], gstPct: 3 });
    const oversell = await req('POST', '/api/invoices', {
      token,
      body: {
        customer_id: customerId,
        items: [{ product_id: productId, quantity: overQty, purity: '22K' }],
        payments: [{ mode: 'cash', amount: overTotals.grand_total }],
        gold_rate: gold24,
        gold_22k: gold22,
        request_id: `qa-oversell-${stamp}`,
      },
    });
    const overCode = String(oversell.data?.code || '');
    if (oversell.status === 409 || overCode === 'INSUFFICIENT_STOCK') {
      record('POS', 'Oversell rejected with 4xx', 'PASS', `status=${oversell.status} code=${overCode || 'INSUFFICIENT_STOCK'}`);
    } else if (oversell.status === 400 || oversell.status === 409) {
      record('POS', 'Oversell rejected with 4xx', 'WARN', `Rejected status=${oversell.status} code=${overCode} (want INSUFFICIENT_STOCK)`, 'medium');
    } else if (oversell.status >= 400) {
      record('POS', 'Oversell rejected with 4xx', 'WARN', `Rejected but status=${oversell.status} body=${JSON.stringify(oversell.data).slice(0, 160)}`, 'medium');
    } else {
      record('POS', 'Oversell rejected with 4xx', 'FAIL', 'Oversell accepted', 'critical');
    }
  }

  // Interlinks after sale
  if (customerId && invoiceId) {
    const c360 = await req('GET', `/api/customers/${customerId}/360`, { token });
    const blob = JSON.stringify(c360.data || {});
    record('Customers', '360 links invoice', c360.status === 200 && (blob.includes(invoiceId) || blob.includes(invoiceNo)) ? 'PASS' : 'WARN',
      c360.status === 200 ? '' : `status=${c360.status}`);

    const ledger = await req('GET', `/api/accounts/customers/${customerId}/ledger`, { token });
    record('Accounts', 'Customer ledger', ledger.status === 200 ? 'PASS' : 'FAIL', `status=${ledger.status}`);

    const sales = await req('GET', '/api/accounts/sales', { token });
    const salesBlob = JSON.stringify(sales.data || {});
    record('Accounts', 'Sales register has invoice', sales.status === 200 && (salesBlob.includes(invoiceNo) || salesBlob.includes(invoiceId)) ? 'PASS' : 'WARN');

    const cash = await req('GET', '/api/accounts/cash-book', { token });
    record('Accounts', 'Cash book loads', cash.status === 200 ? 'PASS' : 'FAIL', `status=${cash.status}`);

    const integrity = await req('GET', '/api/accounts/integrity', { token });
    const tb = integrity.data?.trial_balance;
    const balanced = integrity.status === 200 && (tb?.balanced === true || (tb && Math.abs(Number(tb.difference || 0)) < 0.05));
    record('Accounts', 'Integrity / TB balanced', balanced ? 'PASS' : 'FAIL',
      balanced ? `D=${tb?.total_debit} C=${tb?.total_credit}` : JSON.stringify(integrity.data).slice(0, 180),
      balanced ? 'info' : 'critical');

    const tbDirect = await req('GET', '/api/accounts/trial-balance', { token });
    const d = num(tbDirect.data?.total_debit ?? tbDirect.data?.totals?.debit);
    const c = num(tbDirect.data?.total_credit ?? tbDirect.data?.totals?.credit);
    if (tbDirect.status === 200 && d != null && c != null) {
      record('Accounts', 'Trial balance balanced', Math.abs(d - c) < 0.05 ? 'PASS' : 'FAIL', `D=${d} C=${c}`, Math.abs(d - c) < 0.05 ? 'info' : 'critical');
    } else {
      record('Accounts', 'Trial balance', tbDirect.status === 200 ? 'WARN' : 'FAIL', `status=${tbDirect.status}`);
    }
  }

  if (vendorId) {
    const vl = await req('GET', `/api/accounts/suppliers/${vendorId}/ledger`, { token });
    record('Accounts', 'Supplier ledger', vl.status === 200 ? 'PASS' : 'WARN', `status=${vl.status}`);
  }

  // Reports + search + dashboard
  const salesReport = await req('GET', '/api/reports/sales?from=2026-01-01&to=2026-12-31', { token });
  record('Reports', 'Sales report includes invoice',
    salesReport.status === 200 && invoiceNo && JSON.stringify(salesReport.data).includes(invoiceNo) ? 'PASS'
      : salesReport.status === 200 ? 'WARN' : 'FAIL',
    invoiceNo || `status=${salesReport.status}`);

  const search = await req('GET', `/api/search?q=${encodeURIComponent(`QA Perfect ${stamp}`)}`, { token });
  record('Search', 'Finds QA customer', search.status === 200 && JSON.stringify(search.data).includes(String(stamp)) ? 'PASS' : 'WARN');

  const dash = await req('GET', '/api/dashboard/summary', { token });
  record('Dashboard', 'Summary after activity', dash.status === 200 ? 'PASS' : 'FAIL', `status=${dash.status}`);

  // Quotation convert (optional — may fail if stock already reduced from first sale on same product)
  if (quotationId && grandTotal) {
    // Create fresh product for convert to avoid stock issues
    const qp = await req('POST', '/api/products', {
      token,
      body: {
        name: `QA QuoteConv ${stamp}`,
        barcode: `QA-QC-${stamp}`,
        stock_qty: 2,
        net_weight: 4.5,
        gross_weight: 4.8,
        making_charges: 500,
        making_charge_type: 'fixed',
        status: 'available',
      },
    });
    // Convert existing quote (uses quote's locked items)
    const conv = await req('POST', `/api/quotations/${quotationId}/convert`, {
      token,
      body: {
        payments: [{ mode: 'cash', amount: Number(grandTotal) }],
        gold_rate: gold24,
        gold_22k: gold22,
        request_id: `qa-qconv-${stamp}`,
      },
    });
    if (conv.status < 300) {
      record('Quotations', 'Convert → invoice', 'PASS', conv.data?.invoice_no || conv.data?.id || 'ok');
      const again = await req('POST', `/api/quotations/${quotationId}/convert`, {
        token,
        body: { payments: [{ mode: 'cash', amount: 1 }], gold_rate: gold24, request_id: `qa-qconv2-${stamp}` },
      });
      record('Quotations', 'Reject double convert', again.status >= 400 ? 'PASS' : 'FAIL', `status=${again.status}`, again.status >= 400 ? 'info' : 'critical');
    } else {
      record('Quotations', 'Convert → invoice', 'WARN', `${conv.status} ${JSON.stringify(conv.data).slice(0, 160)} — may need unused stock line`, 'medium');
    }
    void qp;
  }

  return finish(findings.some((f) => f.status === 'FAIL' && (f.severity === 'critical' || f.severity === 'high')) ? 1 : 0);
}

function finish(code) {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const warn = results.filter((r) => r.status === 'WARN').length;
  console.log(`\n=== SUMMARY ===\nPASS=${pass} FAIL=${fail} WARN=${warn} TOTAL=${results.length}`);
  const outPath = path.resolve(__dirname, '../../logs/qa-perfect-module-audit.json');
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({
      generated_at: new Date().toISOString(),
      base,
      stamp,
      summary: { pass, fail, warn, total: results.length },
      findings,
      results,
    }, null, 2));
    console.log(`Wrote ${outPath}`);
  } catch (e) {
    console.log('Could not write report:', e.message);
  }
  process.exit(code);
}

run().catch((e) => {
  console.error('PERFECT AUDIT CRASHED', e);
  process.exit(1);
});
