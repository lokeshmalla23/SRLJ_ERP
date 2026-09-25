'use strict';
/**
 * Migration 007 — ensure local SQLite tables exist.
 * All tables are guarded with CREATE TABLE IF NOT EXISTS.
 */
module.exports = {
  id: 7,
  name: 'full_sync_tables',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);

    db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        parent_id TEXT,
        icon TEXT,
        display_order INTEGER DEFAULT 0,
        code_prefix TEXT,
        default_wastage_pct REAL DEFAULT 0,
        default_making_charge REAL DEFAULT 0,
        default_making_charge_type TEXT DEFAULT 'fixed',
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        origin_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS vendors (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        name TEXT NOT NULL,
        type TEXT,
        contact_person TEXT,
        mobile TEXT,
        email TEXT,
        address TEXT,
        gst_number TEXT,
        pan_number TEXT,
        bank_details TEXT,
        credit_limit REAL DEFAULT 0,
        credit_days INTEGER DEFAULT 0,
        outstanding_balance REAL DEFAULT 0,
        total_purchases REAL DEFAULT 0,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        origin_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS expense_categories (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        color TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        category_id TEXT,
        category_name TEXT,
        description TEXT,
        amount REAL NOT NULL DEFAULT 0,
        payment_mode TEXT,
        reference TEXT,
        date TEXT,
        notes TEXT,
        created_by TEXT,
        origin_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS purchases (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        po_number TEXT,
        vendor_id TEXT,
        vendor_name TEXT,
        purchase_date TEXT,
        purchase_type TEXT,
        items TEXT NOT NULL DEFAULT '[]',
        subtotal REAL DEFAULT 0,
        gst_pct REAL DEFAULT 3,
        gst_amount REAL DEFAULT 0,
        grand_total REAL DEFAULT 0,
        paid_amount REAL DEFAULT 0,
        balance REAL DEFAULT 0,
        payments TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        notes TEXT,
        created_by TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        origin_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS daily_closings (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        date TEXT NOT NULL,
        opening_cash REAL DEFAULT 0,
        closing_cash REAL DEFAULT 0,
        total_sales REAL DEFAULT 0,
        total_expenses REAL DEFAULT 0,
        cash_received REAL DEFAULT 0,
        upi_received REAL DEFAULT 0,
        card_received REAL DEFAULT 0,
        bank_received REAL DEFAULT 0,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        closed_by TEXT,
        origin_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS daily_closings_date_uk ON daily_closings (shop_id, date);

      CREATE TABLE IF NOT EXISTS catalog_items (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        code TEXT,
        description TEXT,
        color TEXT,
        meta TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        origin_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS attributes (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        name TEXT NOT NULL,
        code TEXT,
        field_type TEXT NOT NULL DEFAULT 'text',
        options TEXT NOT NULL DEFAULT '[]',
        required INTEGER NOT NULL DEFAULT 0,
        unit TEXT,
        category_ids TEXT NOT NULL DEFAULT '[]',
        display_order INTEGER DEFAULT 0,
        help_text TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        origin_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS scheme_plans (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        name TEXT NOT NULL,
        plan_type TEXT NOT NULL DEFAULT 'fixed_amount',
        duration_months INTEGER DEFAULT 12,
        bonus_months INTEGER DEFAULT 0,
        default_monthly_amount REAL DEFAULT 0,
        description TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        origin_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS inventory_adjustments (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        product_id TEXT,
        product_name TEXT,
        adjustment_type TEXT,
        qty_before REAL DEFAULT 0,
        qty_change REAL DEFAULT 0,
        qty_after REAL DEFAULT 0,
        reason TEXT,
        notes TEXT,
        created_by TEXT,
        origin_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS stock_history (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        product_id TEXT,
        product_name TEXT,
        change_type TEXT,
        qty_before REAL DEFAULT 0,
        qty_change REAL DEFAULT 0,
        qty_after REAL DEFAULT 0,
        reference_id TEXT,
        reference_type TEXT,
        notes TEXT,
        created_by TEXT,
        origin_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        name TEXT NOT NULL,
        type TEXT,
        message_template TEXT,
        segment TEXT,
        segment_config TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'draft',
        scheduled_at TEXT,
        sent_at TEXT,
        total_recipients INTEGER DEFAULT 0,
        sent_count INTEGER DEFAULT 0,
        created_by TEXT,
        origin_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS campaign_messages (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        campaign_id TEXT,
        customer_id TEXT,
        customer_name TEXT,
        mobile TEXT,
        message TEXT,
        whatsapp_url TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        origin_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        user_id TEXT,
        type TEXT,
        title TEXT,
        message TEXT,
        data TEXT NOT NULL DEFAULT '{}',
        is_read INTEGER NOT NULL DEFAULT 0,
        origin_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS barcode_templates (
        id TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        fields TEXT NOT NULL DEFAULT '[]',
        barcode_type TEXT DEFAULT 'CODE128',
        columns INTEGER DEFAULT 3,
        label_size TEXT,
        label_width_mm REAL,
        label_height_mm REAL,
        show_border INTEGER DEFAULT 0,
        font_size INTEGER DEFAULT 10,
        is_default INTEGER DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT,
        origin_device_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );
    `);

    // Add employee_code to employees if missing (already in migration 002 but guard again)
    if (!col('employees', 'employee_code')) {
      db.exec(`ALTER TABLE employees ADD COLUMN employee_code TEXT`);
    }
  },
};
