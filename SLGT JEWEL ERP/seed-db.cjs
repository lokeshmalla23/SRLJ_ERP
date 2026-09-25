/**
 * Wipes business data and seeds fresh demo records.
 * Keeps: users, shops, settings, migrations, event_log infrastructure.
 * Run: node seed-db.cjs
 */
const sqlite3 = require('./backend/node_modules/sqlite3/lib/sqlite3.js');
const path = require('path');
const crypto = require('crypto');

const DB = process.env.APPDATA + '/jewellery-crm-desktop/data/jewellery-crm.sqlite';
const db = new sqlite3.Database(DB, (err) => {
  if (err) { console.error('Cannot open DB:', err.message); process.exit(1); }
  console.log('Opened:', DB);
  run();
});

const uid  = () => crypto.randomUUID();
const now  = () => new Date().toISOString();
const days = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };
const mons = (n) => { const d = new Date(); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0,10); };

function exec(sql) {
  return new Promise((res, rej) => db.run(sql, (e) => e ? rej(e) : res()));
}
function run_stmt(sql, params) {
  return new Promise((res, rej) => db.run(sql, params, function(e) { e ? rej(e) : res(this); }));
}
function all(sql) {
  return new Promise((res, rej) => db.all(sql, (e, r) => e ? rej(e) : res(r)));
}

async function run() {
  try {
    // ── 1. Get shop_id ──────────────────────────────────────────────────────
    const shops = await all("SELECT id FROM shops LIMIT 1");
    const shopId = shops[0]?.id || 'demo-shop';
    console.log('Shop ID:', shopId);

    // ── 2. Wipe business tables ─────────────────────────────────────────────
    console.log('Wiping existing data...');
    const tables = [
      'draft_sales', 'invoice_items', 'invoices',
      'schemes', 'customers', 'products',
      'categories', 'catalog_items', 'attributes',
      'barcode_sequences', 'product_code_sequences', 'invoice_sequences',
      'sync_outbox', 'event_log',
    ];
    for (const t of tables) {
      await exec(`DELETE FROM ${t}`).catch(() => console.warn('  skip', t));
    }
    console.log('  Wiped:', tables.join(', '));

    // ── 3. Gold rate (update settings) ─────────────────────────────────────
    const grateVal = JSON.stringify({ gold_24k: 7200, gold_22k: 6600, gold_18k: 5400, pure_silver: 95, silver: 82 });
    await exec(`UPDATE settings SET value='${grateVal}' WHERE key='gold_rate'`).catch(() => {});
    console.log('  Gold rates set: 24K=₹7200, 22K=₹6600, 18K=₹5400');

    // ── 4. Customers ────────────────────────────────────────────────────────
    console.log('Seeding customers...');
    const customers = [
      { id: uid(), name: 'Lakshmi Devi',    mobile: '9848012345', email: 'lakshmi@example.com',  address: 'Jubilee Hills, Hyderabad', tag: 'vip' },
      { id: uid(), name: 'Ramesh Kumar',    mobile: '9876543210', email: 'ramesh@example.com',   address: 'Banjara Hills, Hyderabad',  tag: 'regular' },
      { id: uid(), name: 'Priya Sharma',    mobile: '9845001122', email: 'priya@example.com',    address: 'Kondapur, Hyderabad',       tag: 'regular' },
      { id: uid(), name: 'Venkat Reddy',    mobile: '9700112233', email: null,                   address: 'Secunderabad',              tag: 'wholesale' },
      { id: uid(), name: 'Sunita Agarwal',  mobile: '9912334455', email: 'sunita@example.com',   address: 'Madhapur, Hyderabad',       tag: 'vip' },
    ];
    for (const c of customers) {
      await run_stmt(
        `INSERT INTO customers (id,shop_id,name,mobile,email,address,tag,total_purchases,loyalty_points,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,0,0,?,?)`,
        [c.id, shopId, c.name, c.mobile, c.email, c.address, c.tag, now(), now()]
      );
    }
    console.log('  Customers:', customers.map(c=>c.name).join(', '));

    // ── 5. Products ─────────────────────────────────────────────────────────
    console.log('Seeding products...');
    // Category IDs from DB
    const CAT = {
      necklaces: '1ce677f1-1d3d-47c3-ab09-fcf0558796f5',
      bangles:   'c68712e0-94b3-423a-9c85-5d40ed027ba9',
      rings:     'f7c080eb-617f-45b1-a5d1-38bc5bdfc6b5',
      earrings:  'c767c817-e894-4502-bab2-74d6b5bbe643',
      chains:    '8aced9e9-2286-4fe9-80a1-c9447b7d0b42',
      pendants:  'ff78660a-04fa-4218-9c49-24cb5a475eb7',
      anklets:   '86cc9a51-ef1d-4ae9-9878-a32081f79467',
    };
    const products = [
      // Gold items
      { id: uid(), code:'GN-001', name:'22K Gold Necklace',       cat: CAT.necklaces, metal:'Gold',   purity:'22K', gross_weight:22.500, net_weight:20.800, stone_weight:0.500, making_charges:450, selling_price:145600 },
      { id: uid(), code:'GB-001', name:'22K Gold Bangles (Pair)', cat: CAT.bangles,   metal:'Gold',   purity:'22K', gross_weight:28.200, net_weight:26.500, stone_weight:0,     making_charges:350, selling_price:182250 },
      { id: uid(), code:'GR-001', name:'18K Gold Ring',           cat: CAT.rings,     metal:'Gold',   purity:'18K', gross_weight: 4.800, net_weight: 4.200, stone_weight:0.200, making_charges:800, selling_price: 25200 },
      { id: uid(), code:'GE-001', name:'22K Gold Earrings',       cat: CAT.earrings,  metal:'Gold',   purity:'22K', gross_weight: 6.400, net_weight: 5.900, stone_weight:0.100, making_charges:550, selling_price: 40590 },
      { id: uid(), code:'GC-001', name:'22K Gold Chain',          cat: CAT.chains,    metal:'Gold',   purity:'22K', gross_weight:12.000, net_weight:11.500, stone_weight:0,     making_charges:300, selling_price: 79350 },
      { id: uid(), code:'GK-001', name:'24K Gold Coin (5g)',      cat: CAT.pendants,  metal:'Gold',   purity:'24K', gross_weight: 5.000, net_weight: 5.000, stone_weight:0,     making_charges:150, selling_price: 37200 },
      { id: uid(), code:'GP-001', name:'22K Gold Pendant',        cat: CAT.pendants,  metal:'Gold',   purity:'22K', gross_weight: 3.200, net_weight: 2.900, stone_weight:0.100, making_charges:650, selling_price: 20250 },
      { id: uid(), code:'GBR-001',name:'18K Gold Bracelet',       cat: CAT.bangles,   metal:'Gold',   purity:'18K', gross_weight: 8.500, net_weight: 7.800, stone_weight:0.300, making_charges:700, selling_price: 46200 },
      // Silver items
      { id: uid(), code:'SA-001', name:'Silver Anklets (Pair)',   cat: CAT.anklets,   metal:'Silver', purity:'S925', gross_weight:45.000, net_weight:42.000, stone_weight:0,    making_charges: 80, selling_price:  4290 },
      { id: uid(), code:'SP-001', name:'Silver Pooja Set',        cat: CAT.bangles,   metal:'Silver', purity:'S925', gross_weight:85.000, net_weight:80.000, stone_weight:0,    making_charges: 60, selling_price:  7960 },
      { id: uid(), code:'SB-001', name:'Silver Bracelet',         cat: CAT.bangles,   metal:'Silver', purity:'S925', gross_weight:18.000, net_weight:17.000, stone_weight:0,    making_charges:100, selling_price:  1730 },
    ];
    for (const p of products) {
      await run_stmt(
        `INSERT INTO products (id,shop_id,code,name,category_id,metal_name,purity_name,gross_weight,net_weight,stone_weight,making_charges,selling_price,stock_qty,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,5,'available',?,?)`,
        [p.id, shopId, p.code, p.name, p.cat, p.metal, p.purity, p.gross_weight, p.net_weight, p.stone_weight, p.making_charges, p.selling_price, now(), now()]
      );
    }
    console.log('  Products:', products.map(p=>p.name).join(', '));

    // ── 6. Invoices ─────────────────────────────────────────────────────────
    console.log('Seeding invoices...');
    const goldRate22 = 6600;

    const makeItem = (p, qty=1) => ({
      product_id: p.id, name: p.name, code: p.code, purity: p.purity, metal: p.metal,
      quantity: qty, gross_weight: p.gross_weight, net_weight: p.net_weight,
      stone_weight: p.stone_weight, making_charges: p.making_charges,
      unit_price: p.price * qty, line_total: p.price * qty, gold_rate: goldRate22,
      wastage_amount: 0, making_amount: p.making_charges * p.net_weight,
    });

    const invoices = [
      // Today
      {
        id: uid(), invoice_no: 'INV-0001', customer: customers[0], date: now(),
        items: [makeItem(products[0]), makeItem(products[3])],
        subtotal: products[0].price + products[3].price,
        grand_total: products[0].price + products[3].price,
        payment_mode: 'cash',
      },
      {
        id: uid(), invoice_no: 'INV-0002', customer: customers[1], date: now(),
        items: [makeItem(products[4])],
        subtotal: products[4].price, grand_total: products[4].price, payment_mode: 'upi',
      },
      // Earlier this month
      {
        id: uid(), invoice_no: 'INV-0003', customer: customers[2], date: days(-5),
        items: [makeItem(products[1])],
        subtotal: products[1].price, grand_total: products[1].price, payment_mode: 'card',
      },
      {
        id: uid(), invoice_no: 'INV-0004', customer: customers[4], date: days(-8),
        items: [makeItem(products[2]), makeItem(products[6])],
        subtotal: products[2].price + products[6].price,
        grand_total: products[2].price + products[6].price, payment_mode: 'cash',
      },
      {
        id: uid(), invoice_no: 'INV-0005', customer: customers[3], date: days(-12),
        items: [makeItem(products[8]), makeItem(products[9])],
        subtotal: products[8].price + products[9].price,
        grand_total: products[8].price + products[9].price, payment_mode: 'cash',
      },
      // Last month
      {
        id: uid(), invoice_no: 'INV-0006', customer: customers[0], date: days(-32),
        items: [makeItem(products[5])],
        subtotal: products[5].price, grand_total: products[5].price, payment_mode: 'upi',
      },
      {
        id: uid(), invoice_no: 'INV-0007', customer: customers[1], date: days(-38),
        items: [makeItem(products[7])],
        subtotal: products[7].price, grand_total: products[7].price, payment_mode: 'cash',
      },
    ];

    for (const inv of invoices) {
      const gst = +(inv.grand_total * 0.03).toFixed(2);
      const cgst = +(gst / 2).toFixed(2);
      const pmts = JSON.stringify([{ mode: inv.payment_mode, amount: inv.grand_total + gst }]);
      const itemsJson = JSON.stringify(inv.items);
      await run_stmt(
        `INSERT INTO invoices (id,shop_id,invoice_no,customer_id,customer_name,customer_mobile,items,subtotal,gst_pct,gst_amount,cgst_amount,sgst_amount,grand_total,payments,gold_rate,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,3,?,?,?,?,?,${goldRate22},?,?)`,
        [inv.id, shopId, inv.invoice_no, inv.customer.id, inv.customer.name, inv.customer.mobile,
         itemsJson, inv.subtotal, gst, cgst, cgst, inv.grand_total + gst, pmts, inv.date, inv.date]
      ).catch(e => {
        // fallback insert with fewer columns
        return run_stmt(
          `INSERT OR IGNORE INTO invoices (id,shop_id,invoice_no,customer_id,customer_name,items,subtotal,grand_total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [inv.id, shopId, inv.invoice_no, inv.customer.id, inv.customer.name, itemsJson, inv.subtotal, inv.grand_total + gst, inv.date, inv.date]
        );
      });
      // Update customer total_purchases
      await exec(`UPDATE customers SET total_purchases = total_purchases + ${inv.grand_total + gst} WHERE id = '${inv.customer.id}'`).catch(()=>{});
    }
    console.log('  Invoices:', invoices.map(i=>i.invoice_no).join(', '));

    // ── 7. Schemes ──────────────────────────────────────────────────────────
    console.log('Seeding schemes...');

    // Scheme helper — build payments array with gold grams
    const makePayments = (count, amount, rates) => {
      return Array.from({ length: count }, (_, i) => {
        const rate = rates[i] || rates[rates.length-1];
        const grams = +(amount / rate).toFixed(3);
        const d = new Date(); d.setMonth(d.getMonth() - (count - i));
        return { id: uid(), amount, mode: 'cash', paid_at: d.toISOString(), gold_rate_at_payment: rate, grams_credited: grams };
      });
    };

    const schemes = [
      {
        id: uid(), customer: customers[0], plan_name: 'Monthly Gold Plan — 11 Months',
        scheme_type: 'fixed_amount', monthly_amount: 5000, duration_months: 11, bonus_months: 1,
        start_date: mons(-6), status: 'active',
        payments: makePayments(6, 5000, [6200, 6350, 6400, 6500, 6550, 6600]),
      },
      {
        id: uid(), customer: customers[1], plan_name: 'Swarnakala Gold Gram Scheme',
        scheme_type: 'swarnakala', monthly_amount: 3000, duration_months: 11, bonus_months: 1,
        start_date: mons(-4), status: 'active',
        payments: makePayments(4, 3000, [6300, 6400, 6500, 6600]),
      },
      {
        id: uid(), customer: customers[4], plan_name: 'Monthly Gold Plan — 11 Months',
        scheme_type: 'fixed_amount', monthly_amount: 10000, duration_months: 11, bonus_months: 1,
        start_date: mons(-3), status: 'active',
        payments: makePayments(3, 10000, [6450, 6550, 6600]),
      },
    ];

    for (const s of schemes) {
      const totalPaid = s.payments.reduce((sum, p) => sum + p.amount, 0);
      await run_stmt(
        `INSERT INTO schemes (id,shop_id,customer_id,customer_name,customer_mobile,plan_name,scheme_type,monthly_amount,duration_months,start_date,status,payments,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [s.id, shopId, s.customer.id, s.customer.name, s.customer.mobile,
         s.plan_name, s.scheme_type, s.monthly_amount, s.duration_months,
         s.start_date, s.status, JSON.stringify(s.payments), now(), now()]
      ).catch(e => console.warn('  scheme insert warn:', e.message));
      console.log(`  ${s.customer.name}: ${s.plan_name} (${s.payments.length} payments, total gold: ${s.payments.reduce((a,p)=>a+p.grams_credited,0).toFixed(3)}g)`);
    }

    // ── 8. Done ─────────────────────────────────────────────────────────────
    console.log('\n✓ Seed complete!');
    console.log('  Customers :', customers.length);
    console.log('  Products  :', products.length);
    console.log('  Invoices  :', invoices.length);
    console.log('  Schemes   :', schemes.length);
    console.log('\nRestart the desktop app to see fresh data.');

    db.close();
  } catch (err) {
    console.error('Seed failed:', err.message);
    db.close();
    process.exit(1);
  }
}
