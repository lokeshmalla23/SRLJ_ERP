/**
 * Migration 001 — initial local operational schema (SQLite).
 * Cloud PostgreSQL schema remains separate.
 */
module.exports = {
  id: 1,
  name: 'initial_schema',
  up(db) {
    db.exec(`
      -- Identity / membership
      CREATE TABLE IF NOT EXISTS shops (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        code TEXT,
        gstin TEXT,
        phone TEXT,
        email TEXT,
        address TEXT,
        invoice_prefix TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        settings_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        device_identifier TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'peer',
        status TEXT NOT NULL DEFAULT 'pending',
        last_seen_at TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE (shop_id, device_identifier)
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        permissions_json TEXT NOT NULL DEFAULT '{}',
        active INTEGER NOT NULL DEFAULT 1,
        password_hash TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        name TEXT NOT NULL,
        mobile TEXT,
        email TEXT,
        job_title TEXT,
        department TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        employee_code TEXT,
        updated_at TEXT
      );

      -- Catalog / customers
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        name TEXT NOT NULL,
        mobile TEXT NOT NULL,
        email TEXT,
        address TEXT,
        gst_number TEXT,
        pan_number TEXT,
        pan_image TEXT,
        tag TEXT DEFAULT 'regular',
        notes TEXT,
        total_purchases REAL DEFAULT 0,
        loyalty_points INTEGER DEFAULT 0,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS customers_mobile_idx ON customers (mobile);
      CREATE INDEX IF NOT EXISTS customers_name_idx ON customers (name);

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        name TEXT NOT NULL,
        code TEXT,
        barcode TEXT,
        category_id TEXT,
        metal_name TEXT,
        purity_name TEXT,
        inventory_mode TEXT NOT NULL DEFAULT 'quantity',
        stock_qty REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'available',
        gross_weight REAL,
        net_weight REAL,
        stone_weight REAL,
        wastage_pct REAL,
        making_charges REAL,
        making_charge_type TEXT,
        stone_charges REAL,
        hsn_code TEXT,
        low_stock_threshold REAL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS products_barcode_idx ON products (shop_id, barcode);
      CREATE INDEX IF NOT EXISTS products_code_idx ON products (shop_id, code);

      CREATE TABLE IF NOT EXISTS inventory_movements (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        product_id TEXT NOT NULL,
        movement_type TEXT NOT NULL,
        quantity REAL NOT NULL,
        qty_before REAL,
        qty_after REAL,
        status_before TEXT,
        status_after TEXT,
        reference_type TEXT,
        reference_id TEXT,
        notes TEXT,
        origin_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS inv_mov_product_idx ON inventory_movements (product_id, created_at);

      -- Billing
      CREATE TABLE IF NOT EXISTS invoice_sequences (
        shop_id TEXT NOT NULL,
        series TEXT NOT NULL,
        device_id TEXT,
        next_number INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (shop_id, series)
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        invoice_no TEXT NOT NULL,
        request_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        customer_id TEXT,
        customer_name TEXT,
        customer_mobile TEXT,
        salesperson_id TEXT,
        pan_number TEXT,
        subtotal REAL NOT NULL DEFAULT 0,
        discount REAL NOT NULL DEFAULT 0,
        discount_type TEXT DEFAULT 'flat',
        after_discount REAL,
        gst_pct REAL DEFAULT 3,
        gst_amount REAL NOT NULL DEFAULT 0,
        cgst_amount REAL NOT NULL DEFAULT 0,
        sgst_amount REAL NOT NULL DEFAULT 0,
        old_gold_value REAL NOT NULL DEFAULT 0,
        gold_rate REAL,
        grand_total REAL NOT NULL DEFAULT 0,
        payments_json TEXT NOT NULL DEFAULT '[]',
        items_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT,
        cancelled_at TEXT,
        cancelled_by TEXT,
        cancel_reason TEXT,
        origin_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS invoices_shop_no_uk ON invoices (shop_id, invoice_no);
      CREATE UNIQUE INDEX IF NOT EXISTS invoices_request_id_uk ON invoices (request_id)
        WHERE request_id IS NOT NULL AND trim(request_id) != '';

      CREATE TABLE IF NOT EXISTS invoice_items (
        id TEXT PRIMARY KEY NOT NULL,
        invoice_id TEXT NOT NULL,
        product_id TEXT,
        line_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
      );

      CREATE TABLE IF NOT EXISTS quotations (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        quote_no TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        payload_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS schemes (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        customer_id TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT
      );

      -- Settings / rates
      CREATE TABLE IF NOT EXISTS settings (
        shop_id TEXT,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT,
        PRIMARY KEY (shop_id, key)
      );

      -- Audit (append-only intent; no delete API in app layer)
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        device_id TEXT,
        user_id TEXT,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        request_id TEXT,
        reason TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_events (created_at);

      -- Sync / coordination
      CREATE TABLE IF NOT EXISTS sync_outbox (
        id TEXT PRIMARY KEY NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        shop_id TEXT NOT NULL,
        origin_device_id TEXT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload_json TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        synced_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS sync_outbox_status_idx ON sync_outbox (status, created_at);

      CREATE TABLE IF NOT EXISTS sync_processed_events (
        event_id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        processed_at TEXT NOT NULL DEFAULT (datetime('now')),
        source TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        shop_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        cursor TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT,
        PRIMARY KEY (shop_id, channel)
      );

      CREATE TABLE IF NOT EXISTS coordination_state (
        id          TEXT PRIMARY KEY DEFAULT 'singleton',
        state       TEXT NOT NULL DEFAULT 'UNKNOWN',
        cloud_ok    INTEGER NOT NULL DEFAULT 0,
        lan_ok      INTEGER NOT NULL DEFAULT 0,
        coordinator TEXT,
        last_probe  TEXT,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS device_membership (
        shop_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        paired_at TEXT,
        PRIMARY KEY (shop_id, device_id)
      );
    `);
  },
};
