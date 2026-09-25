/**
 * Migration 002 — align SQLite column names with Sequelize model definitions.
 * Renames *_json columns → plain names, adds missing columns, restructures
 * invoice_sequences and settings to match the Sequelize schema.
 * Safe to re-run (all operations are guarded by column/table existence checks).
 */
module.exports = {
  id: 2,
  name: 'schema_align',
  up(db) {
    const col = (table, name) =>
      db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name);

    // ── invoices ────────────────────────────────────────────────────────────
    if (col('invoices', 'items_json'))    db.exec(`ALTER TABLE invoices RENAME COLUMN items_json    TO items`);
    if (col('invoices', 'payments_json')) db.exec(`ALTER TABLE invoices RENAME COLUMN payments_json TO payments`);
    if (!col('invoices', 'created_by'))   db.exec(`ALTER TABLE invoices ADD COLUMN created_by TEXT`);

    // ── users ────────────────────────────────────────────────────────────────
    if (col('users', 'permissions_json')) db.exec(`ALTER TABLE users RENAME COLUMN permissions_json TO permissions`);
    if (!col('users', 'version'))         db.exec(`ALTER TABLE users ADD COLUMN version INTEGER NOT NULL DEFAULT 1`);
    if (!col('users', 'deleted_at'))      db.exec(`ALTER TABLE users ADD COLUMN deleted_at TEXT`);
    if (!col('users', 'origin_device_id'))db.exec(`ALTER TABLE users ADD COLUMN origin_device_id TEXT`);

    // ── shops ────────────────────────────────────────────────────────────────
    if (col('shops', 'settings_json'))    db.exec(`ALTER TABLE shops RENAME COLUMN settings_json TO settings`);

    // ── devices ──────────────────────────────────────────────────────────────
    if (col('devices', 'meta_json'))      db.exec(`ALTER TABLE devices RENAME COLUMN meta_json TO meta`);
    if (!col('devices', 'device_number')) db.exec(`ALTER TABLE devices ADD COLUMN device_number INTEGER`);

    // ── sync_outbox ───────────────────────────────────────────────────────────
    if (col('sync_outbox', 'payload_json')) db.exec(`ALTER TABLE sync_outbox RENAME COLUMN payload_json TO payload`);

    // ── settings — migrate to id-keyed schema (preserves data) ───────────────
    if (!col('settings', 'id')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings_new (
          id               TEXT NOT NULL PRIMARY KEY,
          key              TEXT NOT NULL,
          value            TEXT NOT NULL DEFAULT '{}',
          shop_id          TEXT,
          version          INTEGER NOT NULL DEFAULT 1,
          deleted_at       TEXT,
          origin_device_id TEXT,
          created_at       TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at       TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS settings_new_key_uk ON settings_new (key);
      `);
      // Copy existing rows — old column is value_json
      const valueCol = col('settings', 'value_json') ? 'value_json' : 'value';
      db.exec(`
        INSERT INTO settings_new (id, key, value, shop_id, updated_at)
        SELECT lower(hex(randomblob(16))), key, COALESCE(${valueCol}, '{}'), shop_id, updated_at
        FROM settings;
        DROP TABLE settings;
        ALTER TABLE settings_new RENAME TO settings;
      `);
    }

    // ── invoice_sequences — drop & recreate with Sequelize schema ─────────────
    // Data loss is acceptable: invoice counter restarts per device after align.
    db.exec(`
      DROP TABLE IF EXISTS invoice_sequences;
      CREATE TABLE IF NOT EXISTS invoice_sequences (
        id            TEXT PRIMARY KEY NOT NULL,
        shop_id       TEXT NOT NULL,
        sequence_date TEXT NOT NULL,
        prefix        TEXT NOT NULL DEFAULT 'INV',
        next_value    INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS inv_seq_shop_date_prefix ON invoice_sequences (shop_id, sequence_date, prefix);
    `);

    // ── products — add columns present in Sequelize model but missing here ────
    const prodAdd = [
      ['subcategory_id',   'TEXT'],
      ['collection_ids',   "TEXT DEFAULT '[]'"],
      ['tag_ids',          "TEXT DEFAULT '[]'"],
      ['metal_type_id',    'TEXT'],
      ['purity_id',        'TEXT'],
      ['stone_type_ids',   "TEXT DEFAULT '[]'"],
      ['unit_id',          'TEXT'],
      ['attribute_values', "TEXT DEFAULT '{}'"],
      ['stone_details',    "TEXT DEFAULT '[]'"],
      ['certification',    'TEXT'],
      ['design_no',        'TEXT'],
      ['size',             'TEXT'],
      ['showcase_location','TEXT'],
      ['gst_slab',         'REAL DEFAULT 3'],
      ['purchase_price',   'REAL DEFAULT 0'],
      ['selling_price',    'REAL DEFAULT 0'],
      ['hallmark',         'TEXT'],
      ['version',          'INTEGER NOT NULL DEFAULT 1'],
      ['deleted_at',       'TEXT'],
      ['origin_device_id', 'TEXT'],
    ];
    for (const [name, def] of prodAdd) {
      if (!col('products', name)) db.exec(`ALTER TABLE products ADD COLUMN ${name} ${def}`);
    }

    // ── customers ─────────────────────────────────────────────────────────────
    const custAdd = [
      ['dob',              'TEXT'],
      ['anniversary',      'TEXT'],
      ['version',          'INTEGER NOT NULL DEFAULT 1'],
      ['deleted_at',       'TEXT'],
      ['origin_device_id', 'TEXT'],
    ];
    for (const [name, def] of custAdd) {
      if (!col('customers', name)) db.exec(`ALTER TABLE customers ADD COLUMN ${name} ${def}`);
    }

    // ── employees ─────────────────────────────────────────────────────────────
    const empAdd = [
      ['user_id',           'TEXT'],
      ['salary',            'REAL DEFAULT 0'],
      ['join_date',         'TEXT'],
      ['address',           'TEXT'],
      ['emergency_contact', 'TEXT'],
      ['notes',             'TEXT'],
      ['version',           'INTEGER NOT NULL DEFAULT 1'],
      ['deleted_at',        'TEXT'],
      ['origin_device_id',  'TEXT'],
    ];
    for (const [name, def] of empAdd) {
      if (!col('employees', name)) db.exec(`ALTER TABLE employees ADD COLUMN ${name} ${def}`);
    }
  },
};
