import 'dotenv/config';
import express from 'express';
import cors from 'cors';

// Bind :8080 before SQLite / route imports so Electron does not kill a booting process.
import {
  app,
  server,
  protocol,
  mtls,
  certs,
  PORT,
  LISTEN_HOST,
  markBootReady,
} from './earlyListen.js';

import sequelize, { isLocalMode } from './db.js';
import { seedDatabase } from './seed.js';
import { registerRoutes } from './routes/index.js';
import { runMigrations } from './migrate.js';
import { APP_MODE, isBranchMode } from './config/appMode.js';
import { SCHEMA_VERSION } from './config/schemaVersion.js';
import branchConfig, { getPublicBranchStatus } from './config/branchConfig.js';
import { getDefaultShopId } from './services/defaultShop.js';
import { SchemaMeta } from './models/index.js';
import { startDiscoveryAdvertiser } from './services/lanDiscovery.js';
import { writeRecoverySnapshot } from './services/recoveryService.js';
import { requireAuthoritativeHost, getAuthoritativeWriteStatus } from './middleware/requireAuthoritativeHost.js';
import { Device } from './models/index.js';
import { newId } from './utils.js';
import { requireClientCert } from './security/tlsServer.js';
import { installConsoleRedaction } from './security/logRedaction.js';
import { safeErrorLog } from './security/logRedaction.js';
import { ensureClusterState, getClusterPublicStatus } from './services/clusterService.js';
import { createEncryptedBackup } from './services/encryptedBackupService.js';
import { runMetalRateAutoSyncTick } from './services/metalRateSyncService.js';
import { attachWsServer } from './services/wsServer.js';
import { assertNotWriteLocked } from './services/productionRestoreService.js';
import { logger } from './utils/logger.js';
import { requestLogMiddleware, errorLogMiddleware } from './middleware/requestLog.js';
import { sqliteBusyMiddleware } from './utils/sqliteBusy.js';

installConsoleRedaction();

async function ensureLocalActiveHost() {
  if (!isBranchMode() || !branchConfig.device_id) return;
  // Only the configured host PC may claim active_host — staff/replica PCs must not.
  if (branchConfig.role !== 'active_host') return;
  let shopId = branchConfig.shop_id;
  try {
    shopId = shopId || (await getDefaultShopId());
  } catch {
    return;
  }
  const ident = branchConfig.device_id;
  let device = await Device.findOne({ where: { shop_id: shopId, device_identifier: ident } });
  if (!device) {
    device = await Device.create({
      id: newId(),
      shop_id: shopId,
      device_name: branchConfig.device_name || 'Branch Host',
      device_identifier: ident,
      role: 'active_host',
      status: 'active',
      last_seen_at: new Date(),
      meta: { electron: true },
    });
    console.log(`  ✓ Registered local host device ${ident}`);
  } else {
    await device.update({
      role: 'active_host',
      status: 'active',
      last_seen_at: new Date(),
    });
  }
  // Demote other active hosts, and delete same-name ghosts (UUID regenerated on this PC)
  const others = await Device.findAll({ where: { shop_id: shopId } });
  const selfName = String(branchConfig.device_name || '').toLowerCase();
  for (const g of others) {
    if (g.device_identifier === ident) continue;
    if (g.role === 'active_host' && g.status === 'active') {
      await g.update({ role: 'peer', status: 'inactive' });
      console.log(`  ✓ Demoted ghost active_host ${g.device_identifier}`);
    }
    const sameName =
      selfName &&
      g.device_name &&
      String(g.device_name).toLowerCase() === selfName;
    if (sameName) {
      await g.destroy();
      console.log(`  ✓ Removed duplicate device row ${g.device_identifier} (${g.device_name})`);
    }
  }
}

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogMiddleware);

// mTLS peer check when TLS_MTLS=true
app.use(requireClientCert);

// Locked architecture: superseded / non-host Branch nodes cannot mutate money/stock
app.use(requireAuthoritativeHost);
app.use(assertNotWriteLocked);
async function buildHealthPayload() {
  const base = {
    status: 'ok',
    service: isBranchMode() ? 'Jewellery CRM Branch Service' : 'Sri Srinivasa ERP API',
    ...getPublicBranchStatus(),
    timestamp: new Date().toISOString(),
  };

  let database = { status: 'unknown' };
  try {
    await sequelize.authenticate();
    const dbQuery = isLocalMode()
      ? "SELECT 'local-sqlite' AS db, sqlite_version() AS version"
      : 'SELECT current_database() AS db, version() AS version';
    const [[row]] = await sequelize.query(dbQuery);
    let schemaRow = null;
    try {
      schemaRow = await SchemaMeta.findByPk('schema_version');
    } catch {
      /* table may not exist yet during boot */
    }
    let shopId = branchConfig.shop_id;
    try {
      shopId = shopId || (await getDefaultShopId());
    } catch {
      /* fresh DB before seed */
    }
    database = {
      status: 'ok',
      name: row?.db || null,
      version: (row?.version || '').split(',')[0] || null,
      schema_version_db: schemaRow?.value || null,
    };
    base.shop_id = shopId;
  } catch (err) {
    database = { status: 'error', message: 'database unavailable' };
    base.status = 'degraded';
  }

  let cloud = { status: 'n/a' };
  if (branchConfig.cloud_endpoint) {
    cloud = { status: 'configured', endpoint_host: (() => {
      try { return new URL(branchConfig.cloud_endpoint).host; } catch { return 'invalid'; }
    })() };
  } else if (isBranchMode()) {
    cloud = { status: 'not_configured', note: 'Local operations do not require cloud' };
  }

  let authority = { authoritative: true, fenced: false };
  try {
    authority = await getAuthoritativeWriteStatus();
  } catch {
    authority = { authoritative: false, fenced: false, code: 'AUTHORITY_CHECK_FAILED' };
  }

  // Never include secrets, DATABASE_URL, JWT, or passwords.
  let cluster = null;
  try {
    cluster = await getClusterPublicStatus();
  } catch {
    cluster = null;
  }

  return {
    ...base,
    database,
    cloud,
    authority,
    cluster,
    billing_allowed: Boolean(authority.authoritative) && database.status === 'ok',
    replica_protection: cluster?.role === 'active_host' ? 'host' : cluster?.role || null,
    ready: base.status === 'ok' && database.status === 'ok',
    listen_bind: LISTEN_HOST,
    security_note: LISTEN_HOST === '0.0.0.0'
      ? 'Bound on all interfaces — restrict with OS firewall; do not port-forward to the internet.'
      : null,
  };
}

app.get('/api/health', async (_req, res) => {
  try {
    const payload = await buildHealthPayload();
    res.status(payload.ready ? 200 : 503).json(payload);
  } catch (err) {
    res.status(500).json({
      status: 'error',
      detail: 'health check failed',
      app_mode: APP_MODE,
      schema_version: SCHEMA_VERSION,
    });
  }
});

registerRoutes(app);

app.use((_req, res) => {
  res.status(404).json({ detail: 'Route not found' });
});

// SQLITE_BUSY: respond with 503 + Retry-After so the frontend can show a clear message
app.use(sqliteBusyMiddleware);
app.use(errorLogMiddleware);

const start = async () => {
  try {
    logger.info('boot', 'starting branch service', {
      app_mode: APP_MODE,
      schema_version: SCHEMA_VERSION,
      sqlite: isLocalMode(),
      log_dir: logger.getLogDir(),
    });
    if (isBranchMode()) {
      logger.info('boot', 'branch identity', {
        device: branchConfig.device_id,
        role: branchConfig.role,
      });
    }
    logger.info('sqlite', 'authenticating connection');
    await sequelize.authenticate();
    logger.info('sqlite', 'database connected ok');

    // Ensure base tables exist on fresh databases (does NOT alter existing columns).
    // Production schema evolution must use migrations (Umzug).
    if (isLocalMode()) {
      const { ensureLocalSqliteSchema } = await import('./services/ensureLocalSqliteSchema.js');
      await ensureLocalSqliteSchema();
      logger.info('sqlite', 'ensuring model tables (sync without alter)');
      await sequelize.sync({ alter: false });
      logger.info('sqlite', 'model sync complete');
    } else {
      console.log('Ensuring base model tables exist (sync without alter)...');
      await sequelize.sync({ alter: false });
    }

    // Optional dev-only convenience — NEVER enable in production.
    if (process.env.DB_SYNC_ALTER === 'true') {
      console.warn('WARNING: DB_SYNC_ALTER=true — altering schema via sequelize.sync. Not for production.');
      await sequelize.sync({ alter: true });
    }

    // Umzug migrations contain PostgreSQL-specific SQL — skip in SQLite mode.
    // SQLite schema is managed by sequelize.sync() above + ensureLocalSqliteSchema().
    if (!isLocalMode()) {
      await runMigrations();
    }

    // Branch identity: bind shop_id from DB if config left null
    if (isBranchMode() && !branchConfig.shop_id) {
      try {
        const shopId = await getDefaultShopId();
        console.log(`Branch Service using shop_id=${shopId}`);
      } catch (err) {
        console.warn(`Branch shop not ready yet: ${err.message}`);
      }
    }

    await seedDatabase();
    try {
      const { backfillFinancialModes } = await import('./services/financialMode.js');
      const result = await backfillFinancialModes(sequelize);
      logger.info('accounts', 'financial mode backfill', result);
    } catch (err) {
      logger.warn('accounts', 'financial mode backfill skipped', { error: err?.message });
    }
    try {
      const { backfillTransactionStamps } = await import('./services/backfillTransactionStamps.js');
      const stamped = await backfillTransactionStamps();
      logger.info('accounts', 'transaction stamp backfill', stamped);
    } catch (err) {
      logger.warn('accounts', 'transaction stamp backfill skipped', { error: err?.message });
    }
    try {
      const shopId = await getDefaultShopId();
      const { resolveFinancialMode, FINANCIAL_MODE } = await import('./services/financialMode.js');
      const mode = await resolveFinancialMode(shopId);
      if (mode === FINANCIAL_MODE.LIVE) {
        const { purgePreAccountsPracticeData } = await import('./services/purgePreAccountsPracticeData.js');
        const purged = await purgePreAccountsPracticeData(shopId);
        logger.info('accounts', 'leftover PRE_ACCOUNTS practice purge', purged);
      }
    } catch (err) {
      logger.warn('accounts', 'leftover PRE_ACCOUNTS practice purge skipped', { error: err?.message });
    }
    try {
      const { backfillSaleOutcomeStatuses } = await import('./services/productSaleStatusBackfill.js');
      const result = await backfillSaleOutcomeStatuses(sequelize);
      logger.info('inventory', 'sale status backfill', result);
    } catch (err) {
      logger.warn('inventory', 'sale status backfill skipped', { error: err?.message });
    }
    if (isBranchMode()) {
      try {
        await ensureLocalActiveHost();
        await ensureClusterState();
      } catch (err) {
        console.warn('ensureLocalActiveHost/cluster:', err.message);
      }
    }

    attachWsServer(server);
    markBootReady();
    logger.info('boot', 'API ready', {
      url: `${protocol}://${LISTEN_HOST}:${PORT}`,
      mode: APP_MODE,
      mtls,
    });
    if (certs?.note) console.log(`[security] ${certs.note}`);

    const METAL_RATE_SYNC_INTERVAL_MS = Number(process.env.DPGOLD_SYNC_INTERVAL_MS) || 60_000;
    runMetalRateAutoSyncTick().catch((e) => logger.warn('metal-rate-sync', 'initial sync failed', { error: e?.message }));
    setInterval(() => {
      runMetalRateAutoSyncTick().catch((e) => logger.warn('metal-rate-sync', 'auto sync tick failed', { error: e.message }));
    }, METAL_RATE_SYNC_INTERVAL_MS);

    if (isBranchMode()) {
      logger.info('boot', 'Branch Service ready — local SQLite / LAN only');
      startDiscoveryAdvertiser();
      setInterval(() => {
        writeRecoverySnapshot().catch((e) => logger.warn('recovery', 'snapshot failed', { error: e.message }));
      }, 5 * 60 * 1000);
      writeRecoverySnapshot().catch((e) => logger.warn('recovery', 'initial snapshot failed', { error: e?.message }));
      setInterval(() => {
        createEncryptedBackup({ tier: 'frequent' }).catch((e) =>
          logger.warn('backup', 'frequent backup failed', { error: e.message })
        );
      }, 60 * 60 * 1000);
      setInterval(() => {
        const hour = new Date().getHours();
        if (hour === 2) {
          createEncryptedBackup({ tier: 'daily' }).catch((e) =>
            logger.warn('backup', 'daily backup failed', { error: e.message })
          );
        }
        if (hour === 3 && new Date().getDate() === 1) {
          createEncryptedBackup({ tier: 'monthly' }).catch((e) =>
            logger.warn('backup', 'monthly backup failed', { error: e.message })
          );
        }
      }, 60 * 60 * 1000);
    }
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

process.on('uncaughtException', (err) => {
  logger.error('boot', 'uncaughtException', { error: err?.message, stack: err?.stack });
});
process.on('unhandledRejection', (reason) => {
  logger.error('boot', 'unhandledRejection', {
    error: reason?.message || String(reason),
    stack: reason?.stack,
  });
});

// Graceful shutdown when spawned by Electron (SIGTERM from backendProcess.stop())
process.on('SIGTERM', () => {
  console.log('Backend received SIGTERM, shutting down...');
  process.exit(0);
});

start();
