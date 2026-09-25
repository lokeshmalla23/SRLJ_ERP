/**
 * Ordered SQLite migrations with safety guards:
 *   1. Pre-migration backup
 *   2. Pending outbox drain check (warn but do not block)
 *   3. Migrate inside a transaction
 *   4. Post-migration integrity check
 *   5. Rollback path: backup is kept; if integrity fails, throw so caller can restore
 */
const { backupDatabase, integrityCheck } = require('./sqlite');

const migrations = [
  require('./migrations/001_initial_schema'),
  require('./migrations/002_schema_align'),
  require('./migrations/003_missing_product_columns'),
  require('./migrations/004_sync_state_align'),
  require('./migrations/005_add_created_at'),
  require('./migrations/006_expand_schemes_orders_quotations'),
  require('./migrations/007_full_sync_tables'),
  require('./migrations/008_inventory_movements_weights'),
  require('./migrations/009_neon_column_parity'),
  require('./migrations/010_product_code_sequences'),
  require('./migrations/011_invoice_scheme_quotation'),
  require('./migrations/012_daily_closing_eod_fields'),
  require('./migrations/013_feature_pack_accounts_jewellery'),
  require('./migrations/014_daily_closing_snapshot'),
  require('./migrations/015_invoice_is_hidden'),
  require('./migrations/016_scheme_cash_gold_fields'),
  require('./migrations/017_pure_metal_daily'),
  require('./migrations/018_category_low_stock_threshold'),
  require('./migrations/019_category_counter_id'),
  require('./migrations/020_quotation_booking_fields'),
  require('./migrations/021_catalog_is_system'),
  require('./migrations/022_pure_products'),
  require('./migrations/023_pure_form_type_bulk'),
  require('./migrations/024_audit_events_metadata'),
  require('./migrations/025_invoice_address_detailed_stone'),
  require('./migrations/026_customer_invoice_aadhaar'),
  require('./migrations/027_old_gold_exchange_snapshot'),
  require('./migrations/028_quotation_salesperson_name'),
  require('./migrations/029_barcode_stock_check'),
  require('./migrations/030_business_date'),
  require('./migrations/031_drop_pure_metal_daily'),
  require('./migrations/032_incomes'),
  require('./migrations/033_daily_closing_income_fields'),
  require('./migrations/034_customer_advance_business_date'),
  require('./migrations/035_expense_time_field'),
  require('./migrations/036_old_silver_exchange'),
  require('./migrations/037_product_purchase_cost_per_gram'),
  require('./migrations/038_product_cal_code'),
];

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_schema_migrations (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS local_schema_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
}

function getAppliedIds(db) {
  const rows = db.prepare('SELECT id FROM local_schema_migrations ORDER BY id').all();
  return new Set(rows.map((r) => r.id));
}

function getSchemaVersion(db) {
  ensureMigrationTable(db);
  const row = db.prepare("SELECT value FROM local_schema_meta WHERE key = 'local_schema_version'").get();
  return row ? Number(row.value) : 0;
}

function setSchemaVersion(db, version) {
  db.prepare(`
    INSERT INTO local_schema_meta (key, value) VALUES ('local_schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(version));
}

function pendingOutboxCount(db) {
  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM sync_outbox WHERE status = 'pending'").get();
    return row ? row.n : 0;
  } catch {
    return 0;
  }
}

/**
 * Run pending migrations with safety guards. Idempotent.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} [userDataPath] - required for pre-migration backup; if omitted, backup is skipped
 * @returns {Promise<{ before: number, after: number, applied: string[], backup?: string, warnings: string[] }>}
 */
async function migrate(db, userDataPath) {
  ensureMigrationTable(db);
  const before = getSchemaVersion(db);
  const appliedIds = getAppliedIds(db);
  const pending = migrations.filter((m) => !appliedIds.has(m.id));
  const warnings = [];

  if (pending.length === 0) {
    return { before, after: before, applied: [], warnings };
  }

  // 1. Pre-migration backup
  let backupPath;
  if (userDataPath) {
    const bak = await backupDatabase(db, userDataPath);
    if (bak.ok) {
      backupPath = bak.path;
      console.log(`[migrate] Pre-migration backup: ${backupPath}`);
    } else {
      warnings.push(`Pre-migration backup failed: ${bak.error}`);
      console.warn('[migrate] Pre-migration backup failed:', bak.error);
    }
  }

  // 2. Warn if outbox has pending events (stale writes risk during schema change)
  const outboxPending = pendingOutboxCount(db);
  if (outboxPending > 0) {
    const msg = `${outboxPending} outbox event(s) pending sync before migration — they will be preserved`;
    warnings.push(msg);
    console.warn('[migrate]', msg);
  }

  // 3. Apply migrations in a transaction
  const applied = [];
  const run = db.transaction(() => {
    for (const m of pending) {
      console.log(`[migrate] Applying migration ${m.id}: ${m.name}`);
      m.up(db);
      db.prepare('INSERT INTO local_schema_migrations (id, name) VALUES (?, ?)').run(m.id, m.name);
      setSchemaVersion(db, m.id);
      applied.push(`${m.id}_${m.name}`);
    }
  });
  run();

  // 4. Post-migration integrity check
  const integrity = integrityCheck(db);
  if (!integrity.ok) {
    const msg = `Post-migration integrity check failed: ${integrity.result}. Pre-migration backup at: ${backupPath || 'none'}`;
    console.error('[migrate] INTEGRITY FAILURE —', msg);
    throw new Error(msg);
  }

  console.log(`[migrate] Done. Applied: [${applied.join(', ')}]. Schema v${getSchemaVersion(db)}.`);
  return { before, after: getSchemaVersion(db), applied, backup: backupPath, warnings };
}

module.exports = {
  migrations,
  migrate,
  getSchemaVersion,
  ensureMigrationTable,
};
