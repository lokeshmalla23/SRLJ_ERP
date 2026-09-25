/**
 * Read-only SQL browser for shop owners — list tables / browse rows / search.
 * Never executes arbitrary SQL; only parameterized SELECT against whitelisted tables.
 */
import { QueryTypes } from 'sequelize';
import sequelize, { isLocalMode } from '../db.js';

const SENSITIVE_COL = /password|passwd|secret|token|pin_hash|api_key|recovery_key/i;
const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Business ERP tables only — hide sync/cluster/infra/internal tables from the browser. */
const ERP_TABLES = new Set([
  // Masters
  'shops',
  'settings',
  'users',
  'employees',
  'categories',
  'attributes',
  'catalog_items',
  'hsn_codes',
  'barcode_templates',
  // Inventory / catalog
  'products',
  'inventory_movements',
  'inventory_adjustments',
  'stock_history',
  'product_status_history',
  'metal_issues',
  'pure_products',
  'gold_rate_history',
  // Customers / CRM
  'customers',
  'customer_advances',
  'customer_advance_applications',
  'campaigns',
  'campaign_messages',
  // Sales
  'invoices',
  'invoice_items',
  'payments',
  'quotations',
  'draft_sales',
  'orders',
  'credit_notes',
  'old_gold_receipts',
  // Schemes
  'schemes',
  'scheme_plans',
  // Purchases / vendors
  'vendors',
  'purchases',
  'purchase_items',
  // Accounts / cash
  'chart_of_accounts',
  'journal_entries',
  'journal_lines',
  'cashbook_entries',
  'bank_accounts',
  'bank_reconciliation_items',
  'expenses',
  'expense_categories',
  'daily_closings',
]);

/** Internal / desktop infra — never expose in ERP browser. */
const HIDDEN_TABLE_PREFIXES = [
  'sqlite_',
  'SequelizeMeta',
  'pg_',
];

const HIDDEN_TABLES = new Set([
  'cluster_state',
  'replica_acks',
  'event_log',
  'operation_ledger',
  'schema_meta',
  'sale_authorities',
  'shop_counters',
  'invoice_sequences',
  'barcode_sequences',
  'billing_rate_events',
  'devices',
  'notifications',
  'audit_events',
]);

function isErpBrowserTable(name) {
  if (!name || typeof name !== 'string') return false;
  if (HIDDEN_TABLES.has(name)) return false;
  if (HIDDEN_TABLE_PREFIXES.some((p) => name.startsWith(p) || name === p)) return false;
  return ERP_TABLES.has(name);
}

function quoteIdent(name) {
  if (!IDENT.test(name)) throw Object.assign(new Error('Invalid identifier'), { status: 400 });
  return `"${name}"`;
}

async function getTableNames() {
  let names;
  if (isLocalMode()) {
    const rows = await sequelize.query(
      `SELECT name AS name
       FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'SequelizeMeta%'
       ORDER BY name ASC`,
      { type: QueryTypes.SELECT },
    );
    names = rows.map((r) => r.name);
  } else {
    const rows = await sequelize.query(
      `SELECT tablename AS name
       FROM pg_tables
       WHERE schemaname = 'public'
       ORDER BY tablename ASC`,
      { type: QueryTypes.SELECT },
    );
    names = rows.map((r) => r.name);
  }
  return names.filter(isErpBrowserTable);
}

async function assertTable(tableName) {
  const names = await getTableNames();
  if (!names.includes(tableName)) {
    throw Object.assign(new Error('Table not found'), { status: 404 });
  }
}

async function countRows(tableName) {
  try {
    const rows = await sequelize.query(
      `SELECT COUNT(*) AS c FROM ${quoteIdent(tableName)}`,
      { type: QueryTypes.SELECT },
    );
    return Number(rows?.[0]?.c ?? 0);
  } catch {
    return null;
  }
}

export async function listTables() {
  const names = await getTableNames();
  const tables = [];
  for (const name of names) {
    tables.push({ name, row_count: await countRows(name) });
  }
  return { dialect: isLocalMode() ? 'sqlite' : 'postgres', tables };
}

export async function describeTable(tableName) {
  await assertTable(tableName);

  if (isLocalMode()) {
    const cols = await sequelize.query(`PRAGMA table_info(${quoteIdent(tableName)})`, {
      type: QueryTypes.SELECT,
    });
    return {
      table: tableName,
      columns: cols.map((c) => ({
        name: c.name,
        type: c.type || 'TEXT',
        nullable: !c.notnull,
        primary_key: Boolean(c.pk),
        default: c.dflt_value ?? null,
        sensitive: SENSITIVE_COL.test(c.name),
      })),
    };
  }

  const cols = await sequelize.query(
    `SELECT column_name AS name, data_type AS type,
            is_nullable AS is_nullable, column_default AS column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = :table
     ORDER BY ordinal_position`,
    { replacements: { table: tableName }, type: QueryTypes.SELECT },
  );
  const pks = await sequelize.query(
    `SELECT kcu.column_name AS name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.table_schema = 'public' AND tc.table_name = :table AND tc.constraint_type = 'PRIMARY KEY'`,
    { replacements: { table: tableName }, type: QueryTypes.SELECT },
  );
  const pkSet = new Set(pks.map((p) => p.name));
  return {
    table: tableName,
    columns: cols.map((c) => ({
      name: c.name,
      type: c.type,
      nullable: String(c.is_nullable).toUpperCase() === 'YES',
      primary_key: pkSet.has(c.name),
      default: c.column_default ?? null,
      sensitive: SENSITIVE_COL.test(c.name),
    })),
  };
}

function maskRow(row, columns) {
  const out = { ...row };
  for (const col of columns) {
    if (col.sensitive && out[col.name] != null && out[col.name] !== '') {
      out[col.name] = '••••••••';
    }
  }
  return out;
}

export async function browseTable(tableName, {
  q = '',
  limit = 200,
  offset = 0,
  orderBy = null,
  orderDir = 'ASC',
} = {}) {
  const meta = await describeTable(tableName);
  const columns = meta.columns;
  const colNames = columns.map((c) => c.name);
  // Inline LIMIT/OFFSET — SQLite often mishandles bound params for these.
  const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 2000);
  const off = Math.max(parseInt(offset, 10) || 0, 0);

  let orderCol = orderBy && colNames.includes(orderBy)
    ? orderBy
    : (columns.find((c) => c.primary_key)?.name || colNames[0]);
  const dir = String(orderDir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  const search = String(q || '').trim();
  const textCols = columns.filter((c) => {
    if (c.sensitive) return false;
    const t = String(c.type || '').toLowerCase();
    if (isLocalMode()) return true;
    return (
      t.includes('char')
      || t.includes('text')
      || t.includes('uuid')
      || t.includes('json')
      || t.includes('name')
      || t.includes('numeric')
      || t.includes('int')
      || t.includes('decimal')
      || t.includes('double')
      || t.includes('real')
      || t.includes('bool')
      || t.includes('date')
      || t.includes('time')
    );
  }).map((c) => c.name);

  const whereParts = [];
  const replacements = {};
  if (search && textCols.length) {
    const like = isLocalMode() ? 'LIKE' : 'ILIKE';
    const ors = textCols.map((name, i) => {
      const key = `q${i}`;
      replacements[key] = `%${search}%`;
      return `CAST(${quoteIdent(name)} AS TEXT) ${like} :${key}`;
    });
    whereParts.push(`(${ors.join(' OR ')})`);
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const tableSql = quoteIdent(tableName);
  const orderSql = orderCol ? `ORDER BY ${quoteIdent(orderCol)} ${dir}` : '';

  const countRowsResult = await sequelize.query(
    `SELECT COUNT(*) AS c FROM ${tableSql} ${whereSql}`,
    { replacements, type: QueryTypes.SELECT },
  );
  const total = Number(countRowsResult?.[0]?.c ?? 0);

  const rows = await sequelize.query(
    `SELECT * FROM ${tableSql} ${whereSql} ${orderSql} LIMIT ${lim} OFFSET ${off}`,
    { replacements, type: QueryTypes.SELECT },
  );

  return {
    table: tableName,
    columns,
    rows: (rows || []).map((r) => maskRow(r, columns)),
    total,
    limit: lim,
    offset: off,
    q: search,
    order_by: orderCol,
    order_dir: dir,
  };
}
