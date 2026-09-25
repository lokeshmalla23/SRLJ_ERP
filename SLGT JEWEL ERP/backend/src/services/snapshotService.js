/**
 * Consistent shop snapshot for replica bootstrap (JSON row dump).
 * Host: export → Replica: import → then catch up via event_log after watermark.
 */
import sequelize from '../db.js';
import { isLocalMode } from '../db.js';
import {
  Shop, Device, User, Category, Attribute, CatalogItem, Product, Customer,
  Invoice, Scheme, SchemePlan, ExpenseCategory, Expense, Employee, Quotation,
  Vendor, Purchase, Order, BarcodeTemplate, Setting, InvoiceSequence,
  BarcodeSequence, InventoryMovement, SchemaMeta, EventLog, OperationLedger,
  AuditEvent, ClusterState, Payment, CustomerAdvance, CustomerAdvanceApplication,
  ProductStatusHistory, ChartOfAccount, JournalEntry, JournalLine,
  ShopCounter, DailyClosing, CashbookEntry, MetalIssue, GoldRateHistory, BillingRateEvent,
} from '../models/index.js';
import { ensureClusterState } from './clusterService.js';
import { SCHEMA_VERSION } from '../config/schemaVersion.js';
import { newId } from '../utils.js';

const SNAPSHOT_TABLES = [
  { key: 'shops', model: Shop },
  { key: 'devices', model: Device },
  { key: 'users', model: User },
  { key: 'categories', model: Category },
  { key: 'attributes', model: Attribute },
  { key: 'catalog_items', model: CatalogItem },
  { key: 'products', model: Product },
  { key: 'customers', model: Customer },
  { key: 'invoices', model: Invoice },
  { key: 'schemes', model: Scheme },
  { key: 'scheme_plans', model: SchemePlan },
  { key: 'expense_categories', model: ExpenseCategory },
  { key: 'expenses', model: Expense },
  { key: 'daily_closings', model: DailyClosing },
  { key: 'cashbook_entries', model: CashbookEntry },
  { key: 'metal_issues', model: MetalIssue },
  { key: 'gold_rate_history', model: GoldRateHistory },
  { key: 'billing_rate_events', model: BillingRateEvent },
  { key: 'employees', model: Employee },
  { key: 'quotations', model: Quotation },
  { key: 'vendors', model: Vendor },
  { key: 'purchases', model: Purchase },
  { key: 'orders', model: Order },
  { key: 'barcode_templates', model: BarcodeTemplate },
  { key: 'settings', model: Setting },
  { key: 'invoice_sequences', model: InvoiceSequence },
  { key: 'barcode_sequences', model: BarcodeSequence },
  { key: 'inventory_movements', model: InventoryMovement },
  { key: 'operation_ledger', model: OperationLedger },
  { key: 'payments', model: Payment },
  { key: 'customer_advances', model: CustomerAdvance },
  { key: 'customer_advance_applications', model: CustomerAdvanceApplication },
  { key: 'product_status_history', model: ProductStatusHistory },
  { key: 'chart_of_accounts', model: ChartOfAccount },
  { key: 'journal_entries', model: JournalEntry },
  { key: 'journal_lines', model: JournalLine },
  { key: 'shop_counters', model: ShopCounter },
  { key: 'audit_events', model: AuditEvent },
  { key: 'event_log', model: EventLog },
];

function stripSecretsFromUser(row) {
  if (!row) return row;
  const out = { ...row };
  // Keep password_hash only for owner bootstrap on replica — required for host login forwarding
  // Offline auth on replica uses device-bound cache instead of bulk hash distribution long-term.
  return out;
}

export async function exportClusterSnapshot() {
  const cluster = await ensureClusterState();
  if (!cluster || cluster.role !== 'active_host') {
    const err = new Error('Only the active host can export a snapshot');
    err.status = 403;
    err.code = 'NOT_HOST';
    throw err;
  }

  if (isLocalMode()) {
    try {
      await sequelize.query('PRAGMA wal_checkpoint(FULL)');
    } catch { /* PG path */ }
  }

  const tables = {};
  for (const { key, model } of SNAPSHOT_TABLES) {
    try {
      const rows = await model.findAll({ raw: true });
      tables[key] = key === 'users'
        ? rows.map(stripSecretsFromUser)
        : rows;
    } catch (err) {
      console.warn(`snapshot: skip ${key}:`, err.message);
      tables[key] = [];
    }
  }

  let schemaMeta = null;
  try {
    const sm = await SchemaMeta.findByPk('schema_version');
    schemaMeta = sm?.toJSON() || null;
  } catch { /* */ }

  return {
    v: 1,
    type: 'jewellery_crm_cluster_snapshot',
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    schema_meta: schemaMeta,
    shop_id: cluster.shop_id,
    host_id: cluster.host_id,
    host_term: cluster.host_term,
    watermark: Number(cluster.event_watermark || 0),
    tables,
  };
}

/**
 * Import snapshot on a replica (destructive replace of business tables for shop).
 */
export async function importClusterSnapshot(snapshot, { deviceId, deviceName } = {}) {
  if (!snapshot || snapshot.type !== 'jewellery_crm_cluster_snapshot') {
    const err = new Error('Invalid snapshot payload');
    err.status = 400;
    throw err;
  }
  if (Number(snapshot.schema_version) !== SCHEMA_VERSION) {
    const err = new Error(`Schema mismatch: snapshot=${snapshot.schema_version} local=${SCHEMA_VERSION}`);
    err.status = 409;
    err.code = 'SCHEMA_MISMATCH';
    throw err;
  }

  await sequelize.transaction(async (transaction) => {
    // Clear and reload in FK-friendly order (children first delete, parents first insert)
    const clearOrder = [...SNAPSHOT_TABLES].reverse();
    for (const { key, model } of clearOrder) {
      try {
        await model.destroy({ where: {}, truncate: false, transaction });
      } catch (err) {
        console.warn(`snapshot import clear ${key}:`, err.message);
      }
    }

    for (const { key, model } of SNAPSHOT_TABLES) {
      const rows = snapshot.tables?.[key] || [];
      if (!rows.length) continue;
      // bulkCreate in chunks
      const chunk = 100;
      for (let i = 0; i < rows.length; i += chunk) {
        const slice = rows.slice(i, i + chunk);
        await model.bulkCreate(slice, {
          transaction,
          ignoreDuplicates: true,
          validate: false,
        });
      }
    }

    // Cluster state = this node as replica at snapshot watermark
    const nodeId = deviceId || (await ensureClusterState())?.node_id;
    let cs = await ClusterState.findOne({ where: { shop_id: snapshot.shop_id }, transaction });
    const payload = {
      shop_id: snapshot.shop_id,
      node_id: nodeId || newId(),
      host_id: snapshot.host_id,
      host_term: snapshot.host_term,
      role: 'replica',
      event_watermark: snapshot.watermark,
      fenced: false,
      fenced_reason: null,
      meta: {
        imported_at: new Date().toISOString(),
        snapshot_at: snapshot.created_at,
        device_name: deviceName || null,
      },
    };
    if (cs) {
      await cs.update(payload, { transaction });
    } else {
      await ClusterState.create({ id: newId(), ...payload }, { transaction });
    }
  });

  return {
    imported: true,
    shop_id: snapshot.shop_id,
    host_id: snapshot.host_id,
    host_term: snapshot.host_term,
    watermark: snapshot.watermark,
  };
}
