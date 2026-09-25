/**
 * Auto-heals the SQLite schema before sequelize.sync().
 *
 * Two passes:
 *  1. retireIfMissingColumns — renames tables whose shape is so far off that
 *     sync() would fail (e.g. missing PK columns). sequelize.sync() then
 *     recreates them fresh.
 *  2. ensureModelColumns — iterates every Sequelize model and ALTER TABLE …
 *     ADD COLUMN for any column present in the model but absent in the DB.
 *     This is additive-only and never drops or renames columns.
 */
import sequelize from '../db.js';
import { QueryTypes, DataTypes } from 'sequelize';

// ─── helpers ──────────────────────────────────────────────────────────────────

async function tableExists(name) {
  const rows = await sequelize.query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
    { replacements: [name], type: QueryTypes.SELECT }
  );
  return rows.length > 0;
}

async function columnNames(table) {
  const rows = await sequelize.query(`PRAGMA table_info("${table}")`, {
    type: QueryTypes.SELECT,
  });
  return new Set(rows.map((r) => r.name));
}

/**
 * SQLite index names are GLOBAL (not scoped to a table). When we rename a table
 * to _legacy_, its named indexes keep their original names and block Sequelize from
 * creating same-named indexes on the fresh replacement table. Drop them first.
 */
async function dropTableIndexes(table) {
  const rows = await sequelize.query(
    `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = ? AND name NOT LIKE 'sqlite_autoindex_%'`,
    { replacements: [table], type: QueryTypes.SELECT }
  );
  for (const { name } of rows) {
    await sequelize.query(`DROP INDEX IF EXISTS "${name}"`);
    console.log(`[sqlite-schema] dropped index ${name} (on ${table})`);
  }
}

async function retireIfMissingColumns(table, requiredCols) {
  if (!(await tableExists(table))) return false;
  const cols = await columnNames(table);
  const missing = requiredCols.filter((c) => !cols.has(c));
  if (!missing.length) return false;
  const legacy = `${table}_legacy_${Date.now()}`;
  console.warn(
    `[sqlite-schema] ${table} missing [${missing.join(', ')}] — renaming to ${legacy} (will be recreated)`
  );
  await dropTableIndexes(table);
  await sequelize.query(`ALTER TABLE "${table}" RENAME TO "${legacy}"`);
  return true;
}

/** Map a Sequelize DataType instance to a SQLite affinity string. */
function toSqliteType(attr) {
  if (!attr || !attr.type) return 'TEXT';
  const t = attr.type;
  // VIRTUAL columns have no storage
  if (t instanceof DataTypes.VIRTUAL) return null;

  const key = (t.key || t.constructor?.key || '').toUpperCase();
  if (['INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT', 'BOOLEAN'].includes(key)) return 'INTEGER';
  if (['FLOAT', 'DOUBLE', 'REAL', 'DECIMAL', 'NUMERIC'].includes(key)) return 'REAL';
  // Everything else (STRING, TEXT, UUID, DATE, DATEONLY, JSON, JSONB, ENUM…) → TEXT
  return 'TEXT';
}

/**
 * Build a SQLite DEFAULT clause for ADD COLUMN.
 * Critical: array/object defaults (e.g. JSONB `[]`) must be JSON-stringified —
 * otherwise `DEFAULT ${[]}` becomes invalid SQL `DEFAULT ` and the column is never added.
 */
function sqliteDefaultClause(sqliteType, defVal, nullable) {
  const isNow =
    typeof defVal === 'object'
    && defVal !== null
    && (defVal === DataTypes.NOW || defVal.constructor === DataTypes.NOW?.constructor);

  if (defVal !== undefined && defVal !== null && typeof defVal !== 'function' && !isNow) {
    if (typeof defVal === 'boolean') return ` DEFAULT ${defVal ? 1 : 0}`;
    if (typeof defVal === 'number' && Number.isFinite(defVal)) return ` DEFAULT ${defVal}`;
    if (typeof defVal === 'string') return ` DEFAULT '${defVal.replace(/'/g, "''")}'`;
    if (defVal instanceof Date) return ` DEFAULT '${defVal.toISOString()}'`;
    if (typeof defVal === 'object') {
      const json = JSON.stringify(defVal).replace(/'/g, "''");
      return ` DEFAULT '${json}'`;
    }
  }

  if (!nullable) {
    // Safe NOT NULL defaults so ADD COLUMN succeeds on populated tables.
    if (sqliteType === 'INTEGER' || sqliteType === 'REAL') return ' DEFAULT 0';
    return ` DEFAULT ''`;
  }
  return '';
}

// ─── Phase 1: retire structurally broken tables ───────────────────────────────

/**
 * Retire a table if it has camelCase timestamp columns with NOT NULL constraint.
 * This happens when a table was originally created without `underscored: true`,
 * then the model was changed. Sequelize now writes `created_at`/`updated_at` only,
 * leaving `"createdAt"`/`"updatedAt"` as NULL which violates their NOT NULL constraint.
 */
async function retireIfCamelCaseTimestamps(table) {
  if (!(await tableExists(table))) return false;
  const rows = await sequelize.query(`PRAGMA table_info("${table}")`, { type: QueryTypes.SELECT });
  const hasCamelNotNull = rows.some(
    (r) => (r.name === 'createdAt' || r.name === 'updatedAt') && r.notnull === 1
  );
  if (!hasCamelNotNull) return false;
  const legacy = `${table}_legacy_${Date.now()}`;
  console.warn(`[sqlite-schema] ${table} has camelCase NOT NULL timestamps — renaming to ${legacy}`);
  await dropTableIndexes(table);
  await sequelize.query(`ALTER TABLE "${table}" RENAME TO "${legacy}"`);
  return true;
}

async function retireIncompatibleTables() {
  await retireIfMissingColumns('audit_events', ['seq', 'hash', 'event_type']);
  await retireIfMissingColumns('event_log', ['seq', 'event_type', 'payload']);
  await retireIfMissingColumns('cluster_state', ['host_term', 'host_id']);
  await retireIfMissingColumns('replica_acks', ['event_seq', 'device_id']);
  await retireIfMissingColumns('operation_ledger', ['operation_id', 'shop_id']);

  // Check every model table — safe because retireIfCamelCaseTimestamps is a no-op
  // when the table doesn't exist or doesn't have the camelCase NOT NULL timestamp issue.
  const allModels = Object.values(await import('../models/index.js'))
    .filter((v) => v && typeof v === 'function' && v.rawAttributes);
  for (const Model of allModels) {
    const tableName = resolveTableName(Model);
    if (tableName) await retireIfCamelCaseTimestamps(tableName);
  }
  // Always check invoice_sequences — allocation INSERTs only set snake_case timestamps.
  await retireIfCamelCaseTimestamps('invoice_sequences');
}

// ─── Phase 2: add missing columns from model definitions ─────────────────────

function resolveTableName(Model) {
  const raw = Model.getTableName?.();
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw.tableName) return String(raw.tableName);
  return null;
}

async function ensureModelColumns() {
  // Import all models — this triggers their defineModel() calls
  const allModels = Object.values(
    await import('../models/index.js')
  ).filter((v) => v && typeof v === 'function' && v.rawAttributes);

  let totalAdded = 0;

  for (const Model of allModels) {
    const tableName = resolveTableName(Model);
    if (!tableName) continue;
    if (!(await tableExists(tableName))) continue;

    const existing = await columnNames(tableName);
    const attrs = Model.rawAttributes || {};

    for (const [attrKey, attr] of Object.entries(attrs)) {
      // Sequelize underscored models keep JS keys like createdAt but store created_at.
      // Always use the physical column name — never ADD COLUMN "createdAt" beside created_at.
      const colName = attr.field || attrKey;
      if (existing.has(colName)) continue;

      // Determine SQLite column type
      const sqliteType = toSqliteType(attr);
      if (!sqliteType) continue; // VIRTUAL — no storage

      const nullable = attr.allowNull !== false;
      const defClause = sqliteDefaultClause(sqliteType, attr.defaultValue, nullable);

      try {
        await sequelize.query(
          `ALTER TABLE "${tableName}" ADD COLUMN "${colName}" ${sqliteType}${nullable ? '' : ' NOT NULL'}${defClause}`
        );
        console.log(`[sqlite-schema] ${tableName}.${colName} (${sqliteType}) added`);
        existing.add(colName);
        totalAdded++;
      } catch (err) {
        // Column may have been added by another concurrent process — non-fatal
        if (!err.message?.includes('duplicate column')) {
          console.warn(`[sqlite-schema] could not add ${tableName}.${colName}: ${err.message}`);
        }
      }
    }
  }

  if (totalAdded > 0) {
    console.log(`[sqlite-schema] added ${totalAdded} missing column(s) across all tables`);
  }
}

/**
 * ensureModelColumns() only adds a table's `serial_no` as NULL on existing
 * rows — assign it a per-shop running number so rows created before the
 * column existed still get one. Safe to re-run: only touches rows still
 * NULL, and resumes counting from each shop's current max.
 */
async function backfillSerialNumbers(table) {
  if (!(await tableExists(table))) return;
  if (!(await columnNames(table)).has('serial_no')) return;

  const pending = await sequelize.query(
    `SELECT id, shop_id FROM "${table}" WHERE serial_no IS NULL ORDER BY shop_id ASC, created_at ASC`,
    { type: QueryTypes.SELECT }
  );
  if (!pending.length) return;

  const maxRows = await sequelize.query(
    `SELECT shop_id, MAX(serial_no) as max_serial FROM "${table}" WHERE serial_no IS NOT NULL GROUP BY shop_id`,
    { type: QueryTypes.SELECT }
  );
  const counters = {};
  for (const r of maxRows) counters[r.shop_id || ''] = Number(r.max_serial) || 0;

  for (const row of pending) {
    const key = row.shop_id || '';
    counters[key] = (counters[key] || 0) + 1;
    await sequelize.query(`UPDATE "${table}" SET serial_no = ? WHERE id = ?`, {
      replacements: [counters[key], row.id],
    });
  }
  console.log(`[sqlite-schema] backfilled serial_no for ${pending.length} row(s) in ${table}`);
}

// ─── Phase 3: ensure critical tables that sync() won't create ─────────────────

async function ensureCriticalTables() {
  if (!(await tableExists('invoice_items'))) {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS invoice_items (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        invoice_id TEXT NOT NULL,
        line_no INTEGER NOT NULL DEFAULT 0,
        product_id TEXT,
        barcode TEXT,
        description TEXT,
        quantity REAL DEFAULT 1,
        gross_weight REAL,
        net_weight REAL,
        rate REAL,
        making REAL,
        wastage REAL,
        tax_pct REAL,
        tax_amount REAL,
        amount REAL,
        hsn_code TEXT,
        snapshot_json TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `);
    console.log('[sqlite-schema] invoice_items table created');
  }
  if (!(await tableExists('purchase_items'))) {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS purchase_items (
        id TEXT PRIMARY KEY,
        shop_id TEXT,
        purchase_id TEXT NOT NULL,
        line_no INTEGER NOT NULL DEFAULT 0,
        product_id TEXT,
        barcode TEXT,
        description TEXT,
        quantity REAL DEFAULT 1,
        weight_g REAL,
        rate REAL,
        tax_pct REAL,
        tax_amount REAL,
        amount REAL,
        snapshot_json TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `);
    console.log('[sqlite-schema] purchase_items table created');
  }
}

// ─── Phase 4: drop orphaned indexes from legacy (retired) tables ──────────────
// SQLite index names are GLOBAL. After renaming a table to _legacy_NNN its
// named indexes keep their original names and block sync() from recreating them
// on the fresh replacement table. Find every named index whose owner table has
// been retired and drop it so sync() can recreate it cleanly.

async function dropLegacyTableIndexes() {
  // Find every named index whose owner table has been retired (_legacy_ in name).
  // SQLite index names are global so these block sync() from creating same-named
  // indexes on fresh replacement tables.
  const allIndexes = await sequelize.query(
    `SELECT name, tbl_name FROM sqlite_master
     WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'`,
    { type: QueryTypes.SELECT }
  );
  for (const { name, tbl_name } of allIndexes) {
    if (!tbl_name.includes('_legacy_')) continue;
    try {
      await sequelize.query(`DROP INDEX IF EXISTS "${name}"`);
      console.log(`[sqlite-schema] dropped orphaned index ${name} (retired table: ${tbl_name})`);
    } catch (err) {
      console.warn(`[sqlite-schema] could not drop orphaned index ${name}: ${err.message}`);
    }
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function ensureLocalSqliteSchema() {
  await retireIncompatibleTables();
  await dropLegacyTableIndexes();
  await ensureModelColumns();
  await backfillSerialNumbers('schemes');
  await backfillSerialNumbers('customers');
  await ensureCriticalTables();
}
