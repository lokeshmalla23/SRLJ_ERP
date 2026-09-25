'use strict';
/**
 * Migration 006 — expand schemes, orders, quotations from payload_json blobs
 * to the fully-normalized column schema that Sequelize models expect.
 */
module.exports = {
  id: 6,
  name: 'expand_schemes_orders_quotations',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);

    // ── schemes ───────────────────────────────────────────────────────────────
    const schemeAdd = [
      ['customer_id',      'TEXT'],
      ['customer_name',    'TEXT'],
      ['customer_mobile',  'TEXT'],
      ['plan_name',        'TEXT'],
      ['scheme_type',      "TEXT DEFAULT 'fixed_amount'"],
      ['monthly_amount',   'REAL DEFAULT 0'],
      ['duration_months',  'INTEGER DEFAULT 12'],
      ['start_date',       'TEXT'],
      ['status',           "TEXT NOT NULL DEFAULT 'active'"],
      ['payments',         "TEXT NOT NULL DEFAULT '[]'"],
      ['notes',            'TEXT'],
      ['redeemed_at',      'TEXT'],
      ['shop_id',          'TEXT'],
      ['version',          'INTEGER NOT NULL DEFAULT 1'],
      ['deleted_at',       'TEXT'],
      ['origin_device_id', 'TEXT'],
    ];
    for (const [name, def] of schemeAdd) {
      if (!col('schemes', name)) db.exec(`ALTER TABLE schemes ADD COLUMN ${name} ${def}`);
    }

    // ── orders ────────────────────────────────────────────────────────────────
    const orderAdd = [
      ['order_no',            'TEXT'],
      ['type',                "TEXT NOT NULL DEFAULT 'custom'"],
      ['customer_id',         'TEXT'],
      ['customer_name',       'TEXT'],
      ['customer_mobile',     'TEXT'],
      ['description',         'TEXT'],
      ['metal_type',          'TEXT'],
      ['purity',              'TEXT'],
      ['estimated_weight',    'REAL'],
      ['stone_details',       'TEXT'],
      ['estimated_price',     'REAL DEFAULT 0'],
      ['advance_paid',        'REAL DEFAULT 0'],
      ['balance_due',         'REAL DEFAULT 0'],
      ['karigar_name',        'TEXT'],
      ['karigar_vendor_id',   'TEXT'],
      ['customer_dob',        'TEXT'],
      ['customer_anniversary','TEXT'],
      ['delivery_date',       'TEXT'],
      ['status',              "TEXT NOT NULL DEFAULT 'received'"],
      ['priority',            "TEXT NOT NULL DEFAULT 'normal'"],
      ['notes',               'TEXT'],
      ['created_by',          'TEXT'],
      ['shop_id',             'TEXT'],
      ['version',             'INTEGER NOT NULL DEFAULT 1'],
      ['deleted_at',          'TEXT'],
      ['origin_device_id',    'TEXT'],
    ];
    for (const [name, def] of orderAdd) {
      if (!col('orders', name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${def}`);
    }
    // Unique index for order_no
    try {
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS orders_order_no_uk ON orders (order_no) WHERE order_no IS NOT NULL`);
    } catch { /* already exists */ }

    // ── quotations ────────────────────────────────────────────────────────────
    const quoteAdd = [
      ['quote_no',               'TEXT'],
      ['customer_id',            'TEXT'],
      ['customer_name',          'TEXT'],
      ['customer_mobile',        'TEXT'],
      ['customer_email',         'TEXT'],
      ['items',                  "TEXT NOT NULL DEFAULT '[]'"],
      ['gold_rate',              'REAL DEFAULT 0'],
      ['subtotal',               'REAL DEFAULT 0'],
      ['discount',               'REAL DEFAULT 0'],
      ['discount_type',          "TEXT DEFAULT 'flat'"],
      ['gst_pct',                'REAL DEFAULT 3'],
      ['gst_amount',             'REAL DEFAULT 0'],
      ['grand_total',            'REAL DEFAULT 0'],
      ['valid_until',            'TEXT'],
      ['status',                 "TEXT NOT NULL DEFAULT 'draft'"],
      ['converted_invoice_id',   'TEXT'],
      ['notes',                  'TEXT'],
      ['terms',                  'TEXT'],
      ['created_by',             'TEXT'],
      ['shop_id',                'TEXT'],
      ['version',                'INTEGER NOT NULL DEFAULT 1'],
      ['deleted_at',             'TEXT'],
      ['origin_device_id',       'TEXT'],
    ];
    for (const [name, def] of quoteAdd) {
      if (!col('quotations', name)) db.exec(`ALTER TABLE quotations ADD COLUMN ${name} ${def}`);
    }
    try {
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS quotations_quote_no_uk ON quotations (quote_no) WHERE quote_no IS NOT NULL`);
    } catch { /* already exists */ }
  },
};
