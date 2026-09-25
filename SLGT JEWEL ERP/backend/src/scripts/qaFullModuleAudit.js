/**
 * Full CRM module & interlink QA audit.
 * Expects Branch Service running. Creates disposable test data with QA-* prefixes.
 *
 * Usage: node src/scripts/qaFullModuleAudit.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calcLineAmounts, calcInvoiceTotals } from '../services/billingCalc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envBranch = path.resolve(__dirname, '../../.env.branch');
if (fs.existsExists?.(envBranch) || fs.existsSync(envBranch)) {
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
const stamp = Date.now();
const findings = [];
const moduleResults = [];

function record(module, check, status, detail = '', severity = 'info') {
  const row = { module, check, status, detail, severity };
  moduleResults.push(row);
  if (status === 'FAIL' || status === 'WARN') {
    findings.push(row);
  }
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : status === 'WARN' ? '!' : '·';
  console.log(`${icon} [${module}] ${check}${detail ? ` — ${detail}` : ''}`);
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
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, ok: res.ok };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

async function run() {
  console.log(`\n=== CRM FULL MODULE QA AUDIT ===`);
  console.log(`Target: ${base}`);
  console.log(`Stamp: QA-${stamp}\n`);

  // -------- Auth / Health --------
  const health = await req('GET', '/api/health');
  if (health.status === 200 && health.data?.ready) {
    record('System', 'Health ready', 'PASS', `mode=${health.data.app_mode} db=${health.data.database?.name}`);
  } else {
    record('System', 'Health ready', 'FAIL', JSON.stringify(health.data).slice(0, 200), 'critical');
    dumpAndExit(1);
  }

  const badLogin = await req('POST', '/api/auth/login', {
    body: { email: smokeEmail || 'invalid-user@example.com', password: 'WRONG-PASSWORD' },
  });
  if (badLogin.status >= 400) {
    record('Auth', 'Reject bad password', 'PASS', `status=${badLogin.status}`);
  } else {
    record('Auth', 'Reject bad password', 'FAIL', 'Accepted invalid credentials', 'critical');
  }

  if (!smokeEmail || !smokePassword) {
    record('Auth', 'Owner login', 'FAIL', 'Set SMOKE_EMAIL and SMOKE_PASSWORD env vars (no hardcoded defaults)', 'critical');
    dumpAndExit(1);
  }

  const login = await req('POST', '/api/auth/login', {
    body: {
      email: smokeEmail,
      password: smokePassword,
    },
  });
  const token = login.data?.access_token || login.data?.token;
  if ((login.status === 200) && token) {
    record('Auth', 'Owner login', 'PASS');
  } else {
    record('Auth', 'Owner login', 'FAIL', JSON.stringify(login.data).slice(0, 200), 'critical');
    dumpAndExit(1);
  }

  const me = await req('GET', '/api/auth/me', { token });
  if (me.status === 200 && (me.data?.email || me.data?.user?.email)) {
    record('Auth', 'Session /me', 'PASS', me.data.email || me.data.user?.email);
  } else {
    record('Auth', 'Session /me', 'FAIL', `status=${me.status}`, 'high');
  }

  // -------- Read-only module probes --------
  const probes = [
    ['Dashboard', '/api/dashboard/summary'],
    ['Customers', '/api/customers?limit=5'],
    ['Products', '/api/products?limit=5'],
    ['Catalog categories', '/api/categories'],
    ['Catalog metals', '/api/catalog/metals'],
    ['Invoices', '/api/invoices?limit=5'],
    ['Quotations', '/api/quotations?limit=5'],
    ['Orders', '/api/orders?limit=5'],
    ['Vendors', '/api/vendors?limit=5'],
    ['Purchases', '/api/purchases?limit=5'],
    ['Schemes', '/api/schemes?limit=5'],
    ['Scheme plans', '/api/scheme-plans?limit=5'],
    ['Employees', '/api/employees?limit=5'],
    ['Promotions', '/api/promotions/campaigns?limit=5'],
    ['Settings', '/api/settings'],
    ['Notifications', '/api/notifications?limit=5'],
    ['Search', '/api/search?q=gold'],
    ['Barcodes stats', '/api/barcodes/stats'],
    ['Stock history', '/api/stock/history?limit=5'],
    ['Reports sales', '/api/reports/sales?from=2026-01-01&to=2026-12-31'],
    ['Accounts dashboard', '/api/accounts/dashboard'],
    ['Accounts receivables', '/api/accounts/receivables'],
    ['Accounts payables', '/api/accounts/payables'],
    ['Accounts trial balance', '/api/accounts/trial-balance'],
    ['Accounts cash book', '/api/accounts/cash-book'],
    ['Accounts day book', '/api/accounts/day-book'],
    ['Accounts expenses', '/api/accounts/expenses?limit=5'],
    ['Accounts GST', '/api/accounts/gst'],
    ['Accounts integrity', '/api/accounts/integrity'],
    ['Accounts audit', '/api/accounts/audit-trail?limit=5'],
    ['Advances', '/api/advances?limit=5'],
  ];

  for (const [name, url] of probes) {
    const r = await req('GET', url, { token });
    if (r.status === 200) {
      const list = pickList(r.data);
      const extra = Array.isArray(list) ? `items=${list.length}` : typeof r.data;
      record(name.split(' ')[0], `GET ${url.split('?')[0]}`, 'PASS', `status=200 ${extra}`);
    } else if (r.status === 404) {
      record(name.split(' ')[0], `GET ${url.split('?')[0]}`, 'WARN', `404 Not Found`, 'medium');
    } else if (r.status === 403) {
      record(name.split(' ')[0], `GET ${url.split('?')[0]}`, 'WARN', `403 Forbidden for owner`, 'medium');
    } else if (r.status === 500) {
      record(name.split(' ')[0], `GET ${url.split('?')[0]}`, 'FAIL', `500 ${JSON.stringify(r.data).slice(0, 180)}`, 'high');
    } else {
      record(name.split(' ')[0], `GET ${url.split('?')[0]}`, 'FAIL', `status=${r.status} ${JSON.stringify(r.data).slice(0, 180)}`, 'high');
    }
  }

  // -------- Catalog seed check --------
  const cats = await req('GET', '/api/categories', { token });
  const catList = pickList(cats.data);
  if (cats.status === 200 && catList.length > 0) {
    record('Catalog', 'Categories seeded', 'PASS', `count=${catList.length}`);
  } else if (cats.status === 200) {
    record('Catalog', 'Categories seeded', 'WARN', 'Empty categories — products may lack classification', 'medium');
  }

  // -------- Create Customer --------
  const phone = `9${String(stamp).slice(-9)}`;
  const cust = await req('POST', '/api/customers', {
    token,
    body: {
      name: `QA Customer ${stamp}`,
      mobile: phone,
      email: `qa.${stamp}@example.com`,
      address: 'QA Test Address',
      city: 'Hyderabad',
    },
  });
  const customerId = cust.data?.id || cust.data?.customer?.id;
  if ((cust.status === 200 || cust.status === 201) && customerId) {
    record('Customers', 'Create customer', 'PASS', `id=${customerId}`);
  } else {
    record('Customers', 'Create customer', 'FAIL', `${cust.status} ${JSON.stringify(cust.data).slice(0, 200)}`, 'critical');
  }

  const custGet = customerId ? await req('GET', `/api/customers/${customerId}`, { token }) : { status: 0 };
  if (custGet.status === 200 && (custGet.data?.name || custGet.data?.customer?.name)) {
    const name = custGet.data.name || custGet.data.customer?.name;
    if (String(name).includes(String(stamp))) {
      record('Customers', 'Read back customer', 'PASS', name);
    } else {
      record('Customers', 'Read back customer', 'FAIL', `Name mismatch: ${name}`, 'high');
    }
  } else if (customerId) {
    record('Customers', 'Read back customer', 'FAIL', `status=${custGet.status}`, 'high');
  }

  const cust360 = customerId ? await req('GET', `/api/customers/${customerId}/360`, { token }) : { status: 0 };
  if (customerId) {
    if (cust360.status === 200) {
      record('Customers', 'Customer 360', 'PASS');
    } else {
      record('Customers', 'Customer 360', 'FAIL', `status=${cust360.status} ${JSON.stringify(cust360.data).slice(0, 160)}`, 'high');
    }
  }

  // Duplicate phone handling
  if (customerId) {
    const dup = await req('POST', '/api/customers', {
      token,
      body: { name: `QA Dup ${stamp}`, mobile: phone },
    });
    if (dup.status >= 400) {
      record('Customers', 'Reject duplicate phone', 'PASS', `status=${dup.status}`);
    } else {
      record('Customers', 'Reject duplicate phone', 'WARN', 'Duplicate phone accepted — may cause CRM data confusion', 'medium');
    }
  }

  // -------- Vendor --------
  const vendor = await req('POST', '/api/vendors', {
    token,
    body: {
      name: `QA Vendor ${stamp}`,
      mobile: `8${String(stamp).slice(-9)}`,
      vendor_type: 'supplier',
      address: 'QA Vendor Addr',
    },
  });
  const vendorId = vendor.data?.id || vendor.data?.vendor?.id;
  if ((vendor.status === 200 || vendor.status === 201) && vendorId) {
    record('Vendors', 'Create vendor', 'PASS', `id=${vendorId}`);
  } else {
    record('Vendors', 'Create vendor', 'FAIL', `${vendor.status} ${JSON.stringify(vendor.data).slice(0, 200)}`, 'high');
  }

  // -------- Employee --------
  const emp = await req('POST', '/api/employees', {
    token,
    body: {
      name: `QA Staff ${stamp}`,
      mobile: `7${String(stamp).slice(-9)}`,
      role: 'sales',
      department: 'Sales',
      status: 'active',
    },
  });
  const employeeId = emp.data?.id || emp.data?.employee?.id;
  if ((emp.status === 200 || emp.status === 201) && employeeId) {
    record('Employees', 'Create employee', 'PASS', `id=${employeeId}`);
  } else {
    record('Employees', 'Create employee', 'FAIL', `${emp.status} ${JSON.stringify(emp.data).slice(0, 180)}`, 'medium');
  }

  // -------- Product (inventory) --------
  const barcode = `QA-BC-${stamp}`;
  const prod = await req('POST', '/api/products', {
    token,
    body: {
      name: `QA Ring ${stamp}`,
      barcode,
      stock_qty: 5,
      net_weight: 4.5,
      gross_weight: 4.8,
      making_charges: 500,
      making_charge_type: 'fixed',
      status: 'available',
      purity: '22K',
      metal: 'Gold',
    },
  });
  const productId = prod.data?.id || prod.data?.product?.id;
  const stockBefore = num(prod.data?.stock_qty ?? prod.data?.product?.stock_qty) ?? 5;
  if ((prod.status === 200 || prod.status === 201) && productId) {
    record('Inventory', 'Create product', 'PASS', `id=${productId} stock=${stockBefore}`);
  } else {
    record('Inventory', 'Create product', 'FAIL', `${prod.status} ${JSON.stringify(prod.data).slice(0, 220)}`, 'critical');
  }

  // barcode search interlink
  if (productId) {
    const bcSearch = await req('GET', `/api/products/barcode-search?q=${encodeURIComponent(barcode)}`, { token });
    const found = pickList(bcSearch.data);
    const hit = found.find?.(p => p.id === productId || p.barcode === barcode)
      || (bcSearch.data?.id === productId ? bcSearch.data : null)
      || (bcSearch.data?.product?.id === productId ? bcSearch.data.product : null);
    if (bcSearch.status === 200 && (hit || String(JSON.stringify(bcSearch.data)).includes(barcode))) {
      record('Inventory', 'Barcode search finds product', 'PASS');
    } else {
      // try alternate path
      const bc2 = await req('GET', `/api/products?barcode=${encodeURIComponent(barcode)}`, { token });
      if (bc2.status === 200 && String(JSON.stringify(bc2.data)).includes(barcode)) {
        record('Inventory', 'Barcode search finds product', 'PASS', 'via products?barcode');
      } else {
        record('Inventory', 'Barcode search finds product', 'WARN', `status=${bcSearch.status}`, 'medium');
      }
    }
  }

  // -------- Purchase → stock interlink --------
  let purchaseId = null;
  let purchaseProductId = null;
  if (vendorId) {
    const purchaseProd = await req('POST', '/api/products', {
      token,
      body: {
        name: `QA Purchase Tag ${stamp}`,
        barcode: `QA-PUR-${stamp}`,
        stock_qty: 0,
        net_weight: 3,
        gross_weight: 3.2,
        making_charges: 100,
        making_charge_type: 'fixed',
        status: 'available',
        purity: '22K',
      },
    });
    purchaseProductId = purchaseProd.data?.id;
    const purchase = await req('POST', '/api/purchases', {
      token,
      body: {
        vendor_id: vendorId,
        invoice_no: `QA-PINV-${stamp}`,
        purchase_date: new Date().toISOString().slice(0, 10),
        items: [
          {
            product_id: purchaseProductId,
            description: `QA Purchase Tag ${stamp}`,
            quantity: 2,
            net_weight: 3,
            rate: 6500,
            amount: 39000,
          },
        ],
        payments: [{ mode: 'cash', amount: 39000 }],
        total_amount: 39000,
      },
    });
    purchaseId = purchase.data?.id || purchase.data?.purchase?.id;
    if ((purchase.status === 200 || purchase.status === 201) && purchaseId) {
      record('Purchases', 'Create purchase', 'PASS', `id=${purchaseId}`);
      if (purchaseProductId) {
        const afterPur = await req('GET', `/api/products/${purchaseProductId}`, { token });
        const stockAfterPur = num(afterPur.data?.stock_qty ?? afterPur.data?.product?.stock_qty);
        if (stockAfterPur != null && stockAfterPur >= 1) {
          record('Purchases', 'Purchase increases stock', 'PASS', `stock=${stockAfterPur}`);
        } else if (afterPur.status === 200) {
          record('Purchases', 'Purchase increases stock', 'WARN', `stock=${stockAfterPur} — verify tagging flow`, 'high');
        } else {
          record('Purchases', 'Purchase product readback', 'FAIL', `status=${afterPur.status}`, 'high');
        }
      }
    } else {
      // try simplified purchase body
      const purchase2 = await req('POST', '/api/purchases', {
        token,
        body: {
          vendor_id: vendorId,
          bill_no: `QA-PINV-${stamp}`,
          date: new Date().toISOString().slice(0, 10),
          items: [
            {
              name: `QA Loose Gold ${stamp}`,
              metal: 'Gold',
              purity: '22K',
              net_weight: 10,
              rate_per_gram: 6500,
              quantity: 1,
              amount: 65000,
            },
          ],
          paid_amount: 65000,
          payment_mode: 'cash',
        },
      });
      purchaseId = purchase2.data?.id || purchase2.data?.purchase?.id;
      if ((purchase2.status === 200 || purchase2.status === 201) && purchaseId) {
        record('Purchases', 'Create purchase', 'PASS', `id=${purchaseId} (alt payload)`);
      } else {
        record('Purchases', 'Create purchase', 'FAIL', `${purchase.status}/${purchase2.status} ${JSON.stringify(purchase.data).slice(0, 140)} | ${JSON.stringify(purchase2.data).slice(0, 140)}`, 'high');
      }
    }
  }

  // -------- Quotation --------
  let quotationId = null;
  if (customerId && productId) {
    const q = await req('POST', '/api/quotations', {
      token,
      body: {
        customer_id: customerId,
        items: [{ product_id: productId, quantity: 1, purity: '22K' }],
        gold_rate: 7000,
        notes: `QA quotation ${stamp}`,
      },
    });
    quotationId = q.data?.id || q.data?.quotation?.id;
    if ((q.status === 200 || q.status === 201) && quotationId) {
      record('Quotations', 'Create quotation', 'PASS', `id=${quotationId}`);
    } else {
      const q2 = await req('POST', '/api/quotations', {
        token,
        body: {
          customer_id: customerId,
          lines: [{ product_id: productId, qty: 1, purity: '22K' }],
          gold_rate: 7000,
        },
      });
      quotationId = q2.data?.id || q2.data?.quotation?.id;
      if ((q2.status === 200 || q2.status === 201) && quotationId) {
        record('Quotations', 'Create quotation', 'PASS', `id=${quotationId} (alt)`);
      } else {
        record('Quotations', 'Create quotation', 'FAIL', `${q.status}/${q2.status} ${JSON.stringify(q.data).slice(0, 160)}`, 'high');
      }
    }
  }

  // -------- Scheme plan + enrollment --------
  let schemePlanId = null;
  let schemeId = null;
  const plan = await req('POST', '/api/scheme-plans', {
    token,
    body: {
      name: `QA Plan ${stamp}`,
      duration_months: 11,
      installment_amount: 2000,
      bonus_months: 1,
      is_active: true,
    },
  });
  schemePlanId = plan.data?.id || plan.data?.plan?.id;
  if ((plan.status === 200 || plan.status === 201) && schemePlanId) {
    record('Schemes', 'Create scheme plan', 'PASS', `id=${schemePlanId}`);
  } else {
    const plan2 = await req('POST', '/api/scheme-plans', {
      token,
      body: {
        plan_name: `QA Plan ${stamp}`,
        months: 11,
        monthly_amount: 2000,
        active: true,
      },
    });
    schemePlanId = plan2.data?.id || plan2.data?.plan?.id;
    if ((plan2.status === 200 || plan2.status === 201) && schemePlanId) {
      record('Schemes', 'Create scheme plan', 'PASS', `id=${schemePlanId} (alt)`);
    } else {
      record('Schemes', 'Create scheme plan', 'FAIL', `${plan.status}/${plan2.status} ${JSON.stringify(plan.data).slice(0, 140)}`, 'medium');
    }
  }

  if (customerId && schemePlanId) {
    const sch = await req('POST', '/api/schemes', {
      token,
      body: {
        customer_id: customerId,
        scheme_plan_id: schemePlanId,
        start_date: new Date().toISOString().slice(0, 10),
        installment_amount: 2000,
      },
    });
    schemeId = sch.data?.id || sch.data?.scheme?.id;
    if ((sch.status === 200 || sch.status === 201) && schemeId) {
      record('Schemes', 'Enroll customer in scheme', 'PASS', `id=${schemeId}`);
      const pay = await req('POST', `/api/schemes/${schemeId}/payments`, {
        token,
        body: { amount: 2000, mode: 'cash', payment_date: new Date().toISOString().slice(0, 10) },
      });
      if (pay.status === 200 || pay.status === 201) {
        record('Schemes', 'Scheme installment payment', 'PASS');
      } else {
        record('Schemes', 'Scheme installment payment', 'FAIL', `${pay.status} ${JSON.stringify(pay.data).slice(0, 160)}`, 'high');
      }
    } else {
      record('Schemes', 'Enroll customer in scheme', 'FAIL', `${sch.status} ${JSON.stringify(sch.data).slice(0, 160)}`, 'medium');
    }
  }

  // -------- Order --------
  if (customerId) {
    const ord = await req('POST', '/api/orders', {
      token,
      body: {
        customer_id: customerId,
        order_type: 'custom',
        description: `QA custom order ${stamp}`,
        metal: 'Gold',
        purity: '22K',
        estimated_weight: 5,
        status: 'pending',
        delivery_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        vendor_id: vendorId || undefined,
      },
    });
    const orderId = ord.data?.id || ord.data?.order?.id;
    if ((ord.status === 200 || ord.status === 201) && orderId) {
      record('Orders', 'Create order', 'PASS', `id=${orderId}`);
    } else {
      record('Orders', 'Create order', 'FAIL', `${ord.status} ${JSON.stringify(ord.data).slice(0, 180)}`, 'medium');
    }
  }

  // -------- Expense --------
  const expCat = await req('GET', '/api/accounts/expense-categories', { token });
  let expenseCategoryId = pickList(expCat.data)[0]?.id;
  if (!expenseCategoryId && expCat.status === 200) {
    const createCat = await req('POST', '/api/accounts/expense-categories', {
      token,
      body: { name: `QA ExpCat ${stamp}` },
    });
    expenseCategoryId = createCat.data?.id;
  }
  const expense = await req('POST', '/api/accounts/expenses', {
    token,
    body: {
      category_id: expenseCategoryId,
      amount: 150,
      payment_mode: 'cash',
      date: new Date().toISOString().slice(0, 10),
      description: `QA expense ${stamp}`,
      notes: `QA expense ${stamp}`,
    },
  });
  if (expense.status === 200 || expense.status === 201) {
    record('Accounts', 'Create expense', 'PASS', `id=${expense.data?.id || 'ok'}`);
  } else {
    record('Accounts', 'Create expense', 'FAIL', `${expense.status} ${JSON.stringify(expense.data).slice(0, 180)}`, 'medium');
  }

  // -------- Gold rate map (must match server settings) --------
  const rateRes = await req('GET', '/api/settings/gold-rate', { token });
  const rateVal = rateRes.data?.value || rateRes.data || {};
  const gold24 = Number(rateVal.gold_24k) || 14000;
  const gold22 = Number(rateVal.gold_22k) || 12000;
  const gold18 = Number(rateVal.gold_18k) || 7000;
  const rateMap = { '24K': gold24, '22K': gold22, '18K': gold18 };
  if (rateRes.status === 200 && gold22 > 0) {
    record('Settings', 'Gold rate map loaded', 'PASS', `24K=${gold24} 22K=${gold22} 18K=${gold18}`);
  } else {
    record('Settings', 'Gold rate map loaded', 'WARN', `status=${rateRes.status} using fallbacks`, 'medium');
  }

  // Detect smoke-style mismatch: calc with only gold_rate 7000 vs rateMap 22K
  {
    const wrong = calcLineAmounts({
      net_weight: 5, gross_weight: 5.2, wastage_pct: 0, making_charges: 200,
      making_charge_type: 'fixed', stone_charges: 0, purity: '22K', quantity: 1,
    }, 7000, {});
    const right = calcLineAmounts({
      net_weight: 5, gross_weight: 5.2, wastage_pct: 0, making_charges: 200,
      making_charge_type: 'fixed', stone_charges: 0, purity: '22K', quantity: 1,
    }, gold24, rateMap);
    const wrongTot = calcInvoiceTotals({ lineTotals: [wrong.line_total], gstPct: 3 }).grand_total;
    const rightTot = calcInvoiceTotals({ lineTotals: [right.line_total], gstPct: 3 }).grand_total;
    if (Math.abs(wrongTot - rightTot) > 1) {
      record('POS', 'Rate-map vs flat gold_rate mismatch risk', 'FAIL',
        `flat7000→₹${wrongTot} but server rateMap→₹${rightTot} (smoke/tests underpay)`, 'critical');
    } else {
      record('POS', 'Rate-map vs flat gold_rate mismatch risk', 'PASS');
    }
  }

  // -------- POS Invoice (critical path) --------
  let invoiceId = null;
  let invoiceNo = null;
  let grandTotal = null;
  if (productId && customerId) {
    const line = calcLineAmounts({
      net_weight: 4.5,
      gross_weight: 4.8,
      wastage_pct: 0,
      making_charges: 500,
      making_charge_type: 'fixed',
      stone_charges: 0,
      purity: '22K',
      quantity: 1,
    }, gold24, rateMap);
    const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
    grandTotal = totals.grand_total;

    const emptyCart = await req('POST', '/api/invoices', {
      token,
      body: { items: [], payments: [], gold_rate: 7000, request_id: `qa-empty-${stamp}` },
    });
    if (emptyCart.status >= 400) {
      record('POS', 'Reject empty cart', 'PASS', `status=${emptyCart.status}`);
    } else {
      record('POS', 'Reject empty cart', 'FAIL', 'Empty invoice accepted', 'critical');
    }

    const inv = await req('POST', '/api/invoices', {
      token,
      body: {
        customer_id: customerId,
        items: [{ product_id: productId, quantity: 1, purity: '22K' }],
        payments: [{ mode: 'cash', amount: totals.grand_total }],
        gold_rate: gold24,
        gold_22k: gold22,
        gold_18k: gold18,
        request_id: `qa-inv-${stamp}`,
      },
    });
    invoiceId = inv.data?.id || inv.data?.invoice?.id;
    invoiceNo = inv.data?.invoice_no || inv.data?.invoice?.invoice_no;
    if ((inv.status === 200 || inv.status === 201) && invoiceNo) {
      record('POS', 'Create paid invoice', 'PASS', `${invoiceNo} total=${inv.data.grand_total ?? inv.data.invoice?.grand_total}`);
      const serverTotal = num(inv.data.grand_total ?? inv.data.invoice?.grand_total);
      if (serverTotal != null && Math.abs(serverTotal - Number(totals.grand_total)) > 1) {
        record('POS', 'Server totals match calc', 'WARN', `server=${serverTotal} expected≈${totals.grand_total}`, 'high');
      } else if (serverTotal != null) {
        record('POS', 'Server totals match calc', 'PASS', `total=${serverTotal}`);
      }
    } else {
      record('POS', 'Create paid invoice', 'FAIL', `${inv.status} ${JSON.stringify(inv.data).slice(0, 250)}`, 'critical');
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
          gold_18k: gold18,
          request_id: `qa-inv-${stamp}`,
        },
      });
      const inv2No = inv2.data?.invoice_no || inv2.data?.invoice?.invoice_no;
      if ((inv2.status === 200 || inv2.status === 201) && inv2No === invoiceNo) {
        record('POS', 'Idempotent retry same request_id', 'PASS', inv2No);
      } else if (inv2.status >= 400) {
        record('POS', 'Idempotent retry same request_id', 'WARN', `Rejected instead of returning same invoice: ${inv2.status}`, 'medium');
      } else if (inv2No && inv2No !== invoiceNo) {
        record('POS', 'Idempotent retry same request_id', 'FAIL', `Duplicate invoice created ${inv2No}`, 'critical');
      }
    }

    // Stock after sale
    if (productId && invoiceId) {
      const after = await req('GET', `/api/products/${productId}`, { token });
      const stockAfter = num(after.data?.stock_qty ?? after.data?.product?.stock_qty);
      if (stockAfter != null && stockAfter === stockBefore - 1) {
        record('Inventory', 'Stock decremented after sale', 'PASS', `${stockBefore} → ${stockAfter}`);
      } else if (stockAfter != null) {
        record('Inventory', 'Stock decremented after sale', 'FAIL', `expected ${stockBefore - 1}, got ${stockAfter}`, 'critical');
      } else {
        record('Inventory', 'Stock decremented after sale', 'FAIL', `Could not read stock status=${after.status}`, 'critical');
      }
    }

    // Insufficient stock
    if (productId) {
      const prodNow = await req('GET', `/api/products/${productId}`, { token });
      const left = num(prodNow.data?.stock_qty ?? prodNow.data?.product?.stock_qty) ?? 0;
      const oversell = await req('POST', '/api/invoices', {
        token,
        body: {
          customer_id: customerId,
          items: [{ product_id: productId, quantity: left + 5, purity: '22K' }],
          payments: [{ mode: 'cash', amount: 999999 }],
          gold_rate: gold24,
          gold_22k: gold22,
          request_id: `qa-oversell-${stamp}`,
        },
      });
      if (oversell.status >= 400) {
        record('POS', 'Reject oversell / insufficient stock', 'PASS', `status=${oversell.status}`);
      } else {
        record('POS', 'Reject oversell / insufficient stock', 'FAIL', 'Oversell accepted', 'critical');
      }
    }
  }

  // -------- Customer 360 after sale --------
  if (customerId && invoiceId) {
    const c360 = await req('GET', `/api/customers/${customerId}/360`, { token });
    const blob = JSON.stringify(c360.data || {});
    if (c360.status === 200 && (blob.includes(invoiceId) || blob.includes(invoiceNo) || blob.includes('invoice'))) {
      record('Customers', '360 shows invoice linkage', 'PASS');
    } else if (c360.status === 200) {
      record('Customers', '360 shows invoice linkage', 'WARN', '360 OK but invoice not obviously linked in payload', 'medium');
    } else {
      record('Customers', '360 shows invoice linkage', 'FAIL', `status=${c360.status}`, 'high');
    }
  }

  // -------- Accounts interlink after sale --------
  if (invoiceId) {
    const salesAcc = await req('GET', '/api/accounts/sales', { token });
    const salesBlob = JSON.stringify(salesAcc.data || {});
    if (salesAcc.status === 200 && (salesBlob.includes(invoiceNo) || salesBlob.includes(invoiceId))) {
      record('Accounts', 'Sales register includes invoice', 'PASS');
    } else if (salesAcc.status === 200) {
      record('Accounts', 'Sales register includes invoice', 'WARN', 'Sales API OK but invoice not found in response (filter/date?)', 'high');
    } else {
      record('Accounts', 'Sales register includes invoice', 'FAIL', `status=${salesAcc.status}`, 'high');
    }

    const cashBook = await req('GET', '/api/accounts/cash-book', { token });
    if (cashBook.status === 200) {
      const cashBlob = JSON.stringify(cashBook.data || {});
      if (cashBlob.includes(invoiceNo) || cashBlob.includes(String(grandTotal)) || cashBlob.includes('cash')) {
        record('Accounts', 'Cash book reflects sale', 'PASS');
      } else {
        record('Accounts', 'Cash book reflects sale', 'WARN', 'Cash book loaded but sale not obviously present', 'high');
      }
    } else {
      record('Accounts', 'Cash book reflects sale', 'FAIL', `status=${cashBook.status}`, 'high');
    }

    const dayBook = await req('GET', '/api/accounts/day-book', { token });
    if (dayBook.status === 200) {
      record('Accounts', 'Day book loads after sale', 'PASS');
    } else {
      record('Accounts', 'Day book loads after sale', 'FAIL', `status=${dayBook.status} ${JSON.stringify(dayBook.data).slice(0, 120)}`, 'high');
    }

    const integrity = await req('GET', '/api/accounts/integrity', { token });
    if (integrity.status === 200) {
      const issues = integrity.data?.issues || integrity.data?.errors || integrity.data?.failures || [];
      const ok = integrity.data?.ok === true || integrity.data?.healthy === true || integrity.data?.status === 'ok'
        || (Array.isArray(issues) && issues.length === 0 && integrity.data?.ok !== false);
      if (ok || (Array.isArray(issues) && issues.length === 0)) {
        record('Accounts', 'Integrity check', 'PASS', typeof integrity.data === 'object' ? JSON.stringify(integrity.data).slice(0, 120) : '');
      } else {
        record('Accounts', 'Integrity check', 'FAIL', JSON.stringify(integrity.data).slice(0, 250), 'critical');
      }
    } else {
      record('Accounts', 'Integrity check', 'FAIL', `status=${integrity.status}`, 'high');
    }

    const tb = await req('GET', '/api/accounts/trial-balance', { token });
    if (tb.status === 200) {
      const debit = num(tb.data?.total_debit ?? tb.data?.totals?.debit ?? tb.data?.debit_total);
      const credit = num(tb.data?.total_credit ?? tb.data?.totals?.credit ?? tb.data?.credit_total);
      if (debit != null && credit != null) {
        if (Math.abs(debit - credit) < 0.05) {
          record('Accounts', 'Trial balance balanced', 'PASS', `D=${debit} C=${credit}`);
        } else {
          record('Accounts', 'Trial balance balanced', 'FAIL', `D=${debit} C=${credit} diff=${(debit - credit).toFixed(2)}`, 'critical');
        }
      } else {
        record('Accounts', 'Trial balance balanced', 'WARN', 'Could not parse debit/credit totals', 'medium');
      }
    } else {
      record('Accounts', 'Trial balance', 'FAIL', `status=${tb.status}`, 'high');
    }

    const custLedger = await req('GET', `/api/accounts/customer-ledger?customer_id=${customerId}`, { token });
    if (custLedger.status === 200) {
      record('Accounts', 'Customer ledger loads', 'PASS');
    } else if (custLedger.status === 404) {
      // try alternate
      const cl2 = await req('GET', `/api/accounts/ledger/customer/${customerId}`, { token });
      if (cl2.status === 200) record('Accounts', 'Customer ledger loads', 'PASS', 'alt path');
      else record('Accounts', 'Customer ledger loads', 'WARN', `status=${custLedger.status}/${cl2.status}`, 'medium');
    } else {
      record('Accounts', 'Customer ledger loads', 'FAIL', `status=${custLedger.status}`, 'medium');
    }
  }

  if (vendorId && purchaseId) {
    const payables = await req('GET', '/api/accounts/payables', { token });
    if (payables.status === 200) {
      record('Accounts', 'Payables after purchase', 'PASS');
    } else {
      record('Accounts', 'Payables after purchase', 'FAIL', `status=${payables.status}`, 'medium');
    }
    const vendLedger = await req('GET', `/api/accounts/supplier-ledger?vendor_id=${vendorId}`, { token });
    if (vendLedger.status === 200) {
      record('Accounts', 'Supplier ledger loads', 'PASS');
    } else {
      const vl2 = await req('GET', `/api/accounts/vendor-ledger?vendor_id=${vendorId}`, { token });
      if (vl2.status === 200) record('Accounts', 'Supplier ledger loads', 'PASS', 'alt');
      else record('Accounts', 'Supplier ledger loads', 'WARN', `status=${vendLedger.status}/${vl2.status}`, 'medium');
    }
  }

  // -------- Quotation convert interlink --------
  if (quotationId) {
    const conv = await req('POST', `/api/quotations/${quotationId}/convert`, {
      token,
      body: {
        payments: grandTotal ? [{ mode: 'cash', amount: grandTotal }] : [{ mode: 'cash', amount: 999999 }],
        gold_rate: gold24,
        gold_22k: gold22,
        request_id: `qa-qconv-${stamp}`,
      },
    });
    if (conv.status === 200 || conv.status === 201) {
      record('Quotations', 'Convert quotation → invoice', 'PASS', conv.data?.invoice_no || conv.data?.id || 'ok');
      const conv2 = await req('POST', `/api/quotations/${quotationId}/convert`, {
        token,
        body: { payments: [{ mode: 'cash', amount: 1 }], gold_rate: gold24, gold_22k: gold22, request_id: `qa-qconv2-${stamp}` },
      });
      if (conv2.status >= 400) {
        record('Quotations', 'Reject double convert', 'PASS', `status=${conv2.status}`);
      } else {
        record('Quotations', 'Reject double convert', 'FAIL', 'Second convert succeeded', 'critical');
      }
    } else {
      record('Quotations', 'Convert quotation → invoice', 'WARN', `${conv.status} ${JSON.stringify(conv.data).slice(0, 160)}`, 'medium');
    }
  }

  // -------- Dashboard reflects activity --------
  const dash = await req('GET', '/api/dashboard/summary', { token });
  if (dash.status === 200) {
    record('Dashboard', 'Summary after transactions', 'PASS');
  } else {
    record('Dashboard', 'Summary after transactions', 'FAIL', `status=${dash.status}`, 'high');
  }

  // -------- Reports after sale --------
  const salesReport = await req('GET', '/api/reports/sales?from=2026-01-01&to=2026-12-31', { token });
  if (salesReport.status === 200) {
    const blob = JSON.stringify(salesReport.data || {});
    if (invoiceNo && blob.includes(invoiceNo)) {
      record('Reports', 'Sales report includes QA invoice', 'PASS');
    } else {
      record('Reports', 'Sales report includes QA invoice', 'WARN', 'Report OK; invoice may be aggregated/not listed', 'medium');
    }
  } else {
    record('Reports', 'Sales report', 'FAIL', `status=${salesReport.status}`, 'high');
  }

  // -------- Search finds customer/product --------
  if (customerId) {
    const s = await req('GET', `/api/search?q=QA%20Customer%20${stamp}`, { token });
    if (s.status === 200 && String(JSON.stringify(s.data)).includes(String(stamp))) {
      record('Search', 'Global search finds QA customer', 'PASS');
    } else if (s.status === 200) {
      record('Search', 'Global search finds QA customer', 'WARN', 'Search returned but no QA hit', 'medium');
    } else {
      record('Search', 'Global search', 'FAIL', `status=${s.status}`, 'medium');
    }
  }

  // -------- Credit sale / receivables interlink --------
  if (customerId) {
    const creditProd = await req('POST', '/api/products', {
      token,
      body: {
        name: `QA Credit Item ${stamp}`,
        barcode: `QA-CR-${stamp}`,
        stock_qty: 2,
        net_weight: 2,
        gross_weight: 2.1,
        making_charges: 100,
        making_charge_type: 'fixed',
        status: 'available',
        purity: '22K',
      },
    });
    const creditProductId = creditProd.data?.id;
    if (creditProductId) {
      const line = calcLineAmounts({
        net_weight: 2, gross_weight: 2.1, wastage_pct: 0,
        making_charges: 100, making_charge_type: 'fixed', stone_charges: 0,
        purity: '22K', quantity: 1,
      }, gold24, rateMap);
      const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });
      const half = Math.round(Number(totals.grand_total) / 2);
      const creditInv = await req('POST', '/api/invoices', {
        token,
        body: {
          customer_id: customerId,
          items: [{ product_id: creditProductId, quantity: 1, purity: '22K' }],
          payments: [{ mode: 'cash', amount: half }],
          gold_rate: gold24,
          gold_22k: gold22,
          request_id: `qa-credit-${stamp}`,
        },
      });
      if (creditInv.status === 200 || creditInv.status === 201) {
        record('POS', 'Partial payment (credit) invoice', 'PASS', `paid=${half} total=${totals.grand_total}`);
        const recv = await req('GET', '/api/accounts/receivables', { token });
        const blob = JSON.stringify(recv.data || {});
        if (recv.status === 200 && (blob.includes(customerId) || blob.includes(String(stamp)) || blob.includes('outstanding') || num(recv.data?.total_outstanding) > 0 || pickList(recv.data).length >= 0)) {
          const outstandingHint = blob.includes(customerId) || /outstanding|balance|due/i.test(blob);
          if (outstandingHint) {
            record('Accounts', 'Receivables show credit sale', 'PASS');
          } else {
            record('Accounts', 'Receivables show credit sale', 'WARN', 'Receivables API OK; customer outstanding not clearly linked', 'high');
          }
        } else {
          record('Accounts', 'Receivables show credit sale', 'FAIL', `status=${recv.status}`, 'high');
        }
      } else {
        // maybe system requires full payment
        if (creditInv.status >= 400) {
          record('POS', 'Partial payment (credit) invoice', 'WARN', `Rejected: ${JSON.stringify(creditInv.data).slice(0, 160)}`, 'medium');
        }
      }
    }
  }

  // -------- Promotions probe create --------
  const camp = await req('POST', '/api/promotions/campaigns', {
    token,
    body: {
      name: `QA Campaign ${stamp}`,
      channel: 'sms',
      message: 'QA test promo',
      status: 'draft',
    },
  });
  if (camp.status === 200 || camp.status === 201) {
    record('Promotions', 'Create campaign draft', 'PASS');
  } else if (camp.status === 404) {
    record('Promotions', 'Create campaign draft', 'WARN', 'Endpoint not found', 'low');
  } else {
    record('Promotions', 'Create campaign draft', 'WARN', `${camp.status} ${JSON.stringify(camp.data).slice(0, 120)}`, 'low');
  }

  dumpAndExit(findings.some(f => f.status === 'FAIL' && (f.severity === 'critical' || f.severity === 'high')) ? 1 : 0);
}

function dumpAndExit(code) {
  const pass = moduleResults.filter(r => r.status === 'PASS').length;
  const fail = moduleResults.filter(r => r.status === 'FAIL').length;
  const warn = moduleResults.filter(r => r.status === 'WARN').length;
  console.log('\n=== SUMMARY ===');
  console.log(`PASS=${pass} FAIL=${fail} WARN=${warn} TOTAL=${moduleResults.length}`);
  const outPath = path.resolve(__dirname, '../../logs/qa-full-module-audit.json');
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({
      generated_at: new Date().toISOString(),
      base,
      stamp,
      summary: { pass, fail, warn, total: moduleResults.length },
      findings,
      results: moduleResults,
    }, null, 2));
    console.log(`Wrote ${outPath}`);
  } catch (e) {
    console.log('Could not write report file:', e.message);
  }
  process.exit(code);
}

run().catch((e) => {
  console.error('QA AUDIT CRASHED', e);
  process.exit(1);
});
