/**
 * Smoke-test core Branch Service APIs (local PostgreSQL).
 * Expects Branch Service already running (npm run start:branch).
 *
 * Usage: node src/scripts/smokeBranch.js
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
    const k = t.slice(0, i);
    const v = t.slice(i + 1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const base = process.env.BRANCH_SMOKE_URL || 'http://127.0.0.1:8000';
const smokeEmail = process.env.SMOKE_EMAIL;
const smokePassword = process.env.SMOKE_PASSWORD;

async function req(method, urlPath, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  console.log(`Smoke against ${base}`);

  const health = await req('GET', '/api/health');
  assert(health.status === 200, `health ${health.status}`);
  assert(health.data.app_mode === 'branch', 'expected APP_MODE=branch');
  assert(health.data.database?.status === 'ok', 'database not ok');
  assert(health.data.ready === true, 'not ready');
  console.log('✓ health', {
    mode: health.data.app_mode,
    schema: health.data.schema_version,
    device: health.data.device_id,
    shop: health.data.shop_id,
  });

  if (!smokeEmail || !smokePassword) {
    throw new Error('Set SMOKE_EMAIL and SMOKE_PASSWORD env vars (no hardcoded defaults)');
  }

  const login = await req('POST', '/api/auth/login', {
    body: {
      email: smokeEmail,
      password: smokePassword,
    },
  });
  assert(
    login.status === 200 && (login.data?.access_token || login.data?.token),
    `login failed: ${JSON.stringify(login.data)}`
  );
  const token = login.data.access_token || login.data.token;
  console.log('✓ login');

  const customers = await req('GET', '/api/customers?limit=5', { token });
  assert(customers.status === 200, `customers ${customers.status}`);
  console.log('✓ customers');

  const products = await req('GET', '/api/products?limit=5', { token });
  assert(products.status === 200, `products ${products.status}`);
  console.log('✓ products');

  for (const [label, urlPath] of [
    ['orders', '/api/orders?limit=5'],
    ['schemes', '/api/schemes?limit=5'],
    ['settings', '/api/settings'],
  ]) {
    const r = await req('GET', urlPath, { token });
    assert(r.status === 200 || r.status === 403 || r.status === 404, `${label} ${r.status}`);
    console.log(`✓ ${label}`, r.status);
  }

  const rateRes = await req('GET', '/api/settings/gold-rate', { token });
  assert(rateRes.status === 200, `gold-rate ${rateRes.status}`);
  const rates = rateRes.data?.value || rateRes.data || {};
  const gold24 = Number(rates.gold_24k) || 7000;
  const gold22 = Number(rates.gold_22k) || gold24;
  const gold18 = Number(rates.gold_18k) || null;
  const rateMap = { '24K': gold24, '22K': gold22 };
  if (gold18) rateMap['18K'] = gold18;
  console.log('✓ gold rates', { gold24, gold22, gold18 });

  const barcode = `BR-SMOKE-${Date.now()}`;
  const createProd = await req('POST', '/api/products', {
    token,
    body: {
      name: 'Branch Smoke Ring',
      barcode,
      stock_qty: 3,
      net_weight: 5,
      gross_weight: 5.2,
      making_charges: 200,
      making_charge_type: 'fixed',
      status: 'available',
    },
  });
  assert(createProd.status === 200 || createProd.status === 201, `create product ${createProd.status}`);
  const productId = createProd.data?.id;
  assert(productId, 'product id');

  const line = calcLineAmounts({
    net_weight: 5,
    gross_weight: 5.2,
    wastage_pct: 0,
    making_charges: 200,
    making_charge_type: 'fixed',
    stone_charges: 0,
    purity: '22K',
    quantity: 1,
  }, gold24, rateMap);
  const totals = calcInvoiceTotals({ lineTotals: [line.line_total], gstPct: 3 });

  const inv = await req('POST', '/api/invoices', {
    token,
    body: {
      items: [{ product_id: productId, quantity: 1, purity: '22K' }],
      payments: [{ mode: 'cash', amount: totals.grand_total }],
      gold_rate: gold24,
      gold_22k: gold22,
      gold_18k: gold18 || undefined,
      request_id: `smoke-${Date.now()}`,
    },
  });
  assert(inv.status === 200 || inv.status === 201, `invoice ${inv.status} ${JSON.stringify(inv.data).slice(0, 300)}`);
  assert(inv.data?.invoice_no, 'invoice_no');
  console.log('✓ invoice', inv.data.invoice_no);

  console.log('\nBRANCH SMOKE PASSED (local PostgreSQL, no cloud required)');
}

run().catch((e) => {
  console.error('BRANCH SMOKE FAILED', e.message);
  process.exit(1);
});
