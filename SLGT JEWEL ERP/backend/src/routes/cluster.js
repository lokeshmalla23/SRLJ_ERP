/**
 * Cluster + replication + encrypted backup API.
 */
import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  getClusterPublicStatus,
  listClusterNodes,
  promoteClusterHost,
  fenceThisNode,
} from '../services/clusterService.js';
import {
  pullEventsForReplica,
  ackEvents,
  applyPulledEvents,
  getReplicationStatus,
} from '../services/replicationService.js';
import {
  createEncryptedBackup,
  listEncryptedBackups,
  restoreEncryptedBackup,
} from '../services/encryptedBackupService.js';
import { verifyAuditChain, listAuditEvents } from '../services/auditTrailService.js';
import { appendAuditEvent } from '../services/auditTrailService.js';
import { exportClusterSnapshot, importClusterSnapshot } from '../services/snapshotService.js';
import { getPromoteEligibility } from '../services/replicationService.js';
import branchConfig from '../config/branchConfig.js';
import { requireHostRole } from '../middleware/requireHostRole.js';
import { hashPassword, newId, defaultPermissionsForRole } from '../utils.js';
import { normalizePermissionsObject } from '../permissions.js';
import { User, Shop, Setting } from '../models/index.js';
import { clearDefaultShopCache } from '../services/defaultShop.js';
import { ensureClusterState } from '../services/clusterService.js';

const router = Router();

/** CRITICAL vs NORMAL ACK policy (documented for clients). */
router.get('/ack-policy', (_req, res) => {
  res.json({
    CRITICAL: ['Sale', 'Payment', 'Refund', 'Return', 'Stock adjustment', 'Invoice cancel/void', 'Scheme payment'],
    NORMAL: ['Customer edit', 'Quotation', 'Notes', 'Non-financial settings'],
    critical_behavior: 'Prefer SUCCESS after host durable commit + ≥1 replica ACK when a replica is online',
    normal_behavior: 'Async replication OK',
    solo_host: 'Allowed with warning: Running without replica protection',
  });
});

router.get('/promote-eligibility', authenticate, async (_req, res, next) => {
  try {
    res.json(await getPromoteEligibility());
  } catch (err) {
    next(err);
  }
});

/** Host exports full shop snapshot — owner/admin only (not normal employees). */
router.get('/snapshot', authenticate, requirePermission('settings', 'manage'), requireHostRole, async (_req, res, next) => {
  try {
    const snap = await exportClusterSnapshot();
    res.json(snap);
  } catch (err) {
    next(err);
  }
});

/** One-time bootstrap snapshot right after pairing (prefer header token). */
async function handleBootstrapSnapshot(req, res, next) {
  try {
    const { consumeBootstrapToken } = await import('../controllers/devices.js');
    const headerAuth = String(req.headers.authorization || '');
    const token = String(
      req.headers['x-bootstrap-token']
      || (headerAuth.toLowerCase().startsWith('bootstrap ') ? headerAuth.slice(10).trim() : '')
      || req.body?.token
      || req.query?.token
      || '',
    ).trim();
    const entry = consumeBootstrapToken(token);
    if (!entry) {
      return res.status(403).json({ detail: 'Invalid or expired bootstrap token' });
    }
    const claimedDevice = String(req.headers['x-device-id'] || req.body?.device_id || req.query?.device_id || '').trim();
    // Require device binding when the token was issued for a specific device
    if (entry.deviceId) {
      if (!claimedDevice) {
        return res.status(403).json({ detail: 'X-Device-Id required for bootstrap' });
      }
      if (claimedDevice !== entry.deviceId && claimedDevice !== entry.deviceIdentifier) {
        return res.status(403).json({ detail: 'Bootstrap token is not valid for this device' });
      }
    }
    try {
      const { ensureLanSharedSecret } = await import('../services/lanSecretService.js');
      await ensureLanSharedSecret(entry.shopId);
    } catch { /* */ }
    const snap = await exportClusterSnapshot();
    res.json(snap);
  } catch (err) {
    next(err);
  }
}

/** Prefer POST + header token (query-string GET kept for brief back-compat). */
router.post('/snapshot/bootstrap', handleBootstrapSnapshot);
router.get('/snapshot/bootstrap', handleBootstrapSnapshot);

/** Authenticated snapshot export — owner/admin only. */
router.post('/snapshot', authenticate, requirePermission('settings', 'manage'), requireHostRole, async (_req, res, next) => {
  try {
    const snap = await exportClusterSnapshot();
    res.json(snap);
  } catch (err) {
    next(err);
  }
});

/** Replica imports snapshot (local) — settings.manage required. */
router.post('/snapshot/import', authenticate, requirePermission('settings', 'manage'), async (req, res, next) => {
  try {
    const result = await importClusterSnapshot(req.body?.snapshot || req.body, {
      deviceId: branchConfig.device_id,
      deviceName: branchConfig.device_name,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** One-shot local import from Electron after pairing (loopback + flag file). */
router.post('/snapshot/import-local', async (req, res, next) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    // Only accept from loopback
    const ip = req.socket?.remoteAddress || '';
    if (!ip.includes('127.0.0.1') && ip !== '::1' && ip !== ':ffff:127.0.0.1') {
      return res.status(403).json({ detail: 'Local import only' });
    }
    const flagCandidates = [
      process.env.SNAPSHOT_IMPORT_FLAG,
      path.join(process.env.USERDATA || '', 'allow-snapshot-import'),
    ].filter(Boolean);
    // Also check common Electron userData paths via env set by desktop
    if (process.env.ELECTRON_USERDATA) {
      flagCandidates.push(path.join(process.env.ELECTRON_USERDATA, 'allow-snapshot-import'));
    }
    const okFlag = flagCandidates.some((f) => f && fs.existsSync(f)) || process.env.ALLOW_SNAPSHOT_IMPORT === '1';
    if (!okFlag && process.env.ELECTRON_RUN === '1') {
      // Soft allow when ELECTRON_RUN and loopback — desktop sets flag; if missing still allow once for join
      if (req.headers['x-local-import'] !== '1') {
        return res.status(403).json({ detail: 'Import not permitted' });
      }
    }
    const result = await importClusterSnapshot(req.body?.snapshot || req.body, {
      deviceId: branchConfig.device_id,
      deviceName: branchConfig.device_name,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * First-run: create shop owner when no users exist (production — no default password).
 * Body: { name, email, password, shop_name }
 */
router.post('/bootstrap-owner', async (req, res, next) => {
  try {
    const userCount = await User.count();
    if (userCount > 0) {
      return res.status(409).json({ detail: 'Owner already exists', code: 'OWNER_EXISTS' });
    }
    const { name, email, password, shop_name: shopName } = req.body || {};
    if (!email || !password || String(password).length < 8) {
      return res.status(400).json({ detail: 'Email and password (min 8 chars) required' });
    }
    clearDefaultShopCache();
    let shopId = branchConfig.shop_id;
    if (!shopId) {
      const shop = await Shop.create({
        id: newId(),
        name: shopName || 'My Jewellery Shop',
        code: 'SHOP',
        invoice_prefix: 'INV',
        status: 'active',
        settings: {},
      });
      shopId = shop.id;
    } else if (shopName) {
      const shop = await Shop.findByPk(shopId);
      if (shop) await shop.update({ name: shopName });
    }
    const user = await User.create({
      id: newId(),
      shop_id: shopId,
      email: String(email).toLowerCase().trim(),
      name: name || 'Shop Owner',
      password_hash: await hashPassword(password),
      role: 'shop_owner',
      permissions: normalizePermissionsObject(defaultPermissionsForRole('shop_owner')),
      active: true,
    });
    await ensureClusterState();
    // Ensure a persistent shop join code exists for employee PCs
    try {
      const existing = await Setting.findOne({ where: { key: 'shop_join_code' } });
      if (!existing) {
        await Setting.create({
          id: newId(),
          key: 'shop_join_code',
          shop_id: shopId,
          value: { code: String(Math.floor(100000 + Math.random() * 900000)) },
        });
      }
    } catch (e) {
      console.warn('shop_join_code seed:', e.message);
    }
    const { password_hash, ...safe } = user.toJSON();
    res.status(201).json({ user: safe, shop_id: shopId });
  } catch (err) {
    next(err);
  }
});

router.get('/bootstrap-status', async (_req, res, next) => {
  try {
    const userCount = await User.count();
    res.json({
      needs_owner: userCount === 0,
      dev_seed_allowed: process.env.CRM_DEV_SEED === '1' || process.env.NODE_ENV !== 'production',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/status', authenticate, async (_req, res, next) => {
  try {
    const cluster = await getClusterPublicStatus();
    const replication = await getReplicationStatus();
    res.json({ cluster, replication });
  } catch (err) {
    next(err);
  }
});

router.get('/nodes', authenticate, async (_req, res, next) => {
  try {
    res.json(await listClusterNodes());
  } catch (err) {
    next(err);
  }
});

/** Host serves events after watermark (paired devices; authenticated). */
router.get('/events', authenticate, async (req, res, next) => {
  try {
    const afterSeq = Number(req.query.after_seq || 0);
    const limit = Number(req.query.limit || 200);
    const data = await pullEventsForReplica({
      afterSeq,
      limit,
      peerHostTerm: req.query.peer_host_term ? Number(req.query.peer_host_term) : null,
      peerHostId: req.query.peer_host_id || null,
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/events/ack', authenticate, async (req, res, next) => {
  try {
    const { seqs, device_id: deviceId } = req.body || {};
    const result = await ackEvents({
      deviceId: deviceId || branchConfig.device_id,
      seqs: Array.isArray(seqs) ? seqs : [],
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** Replica applies a batch pulled from host (local apply). */
router.post('/events/apply', authenticate, async (req, res, next) => {
  try {
    const { events, host_id: hostId, host_term: hostTerm } = req.body || {};
    const result = await applyPulledEvents(events || [], { hostId, hostTerm });
    if (result.critical_seqs?.length) {
      await ackEvents({
        deviceId: branchConfig.device_id,
        seqs: result.critical_seqs,
      });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Manual failover — owner only.
 * Body: { confirm_dual_active_risk: true, confirm_isolate_old_host: true }
 */
router.post(
  '/promote',
  authenticate,
  requirePermission('settings', 'manage'),
  async (req, res, next) => {
    try {
      const {
        confirm_dual_active_risk: confirmDual,
        confirm_isolate_old_host: confirmIsolate,
      } = req.body || {};
      if (!confirmIsolate) {
        return res.status(400).json({
          detail:
            'Confirm that the previous host is shut down or isolated from the LAN before promoting.',
          code: 'ISOLATE_OLD_HOST_REQUIRED',
        });
      }
      const result = await promoteClusterHost({ confirmDualActiveRisk: Boolean(confirmDual) });
      await appendAuditEvent({
        eventType: 'HOST_PROMOTED',
        action: 'cluster.promote',
        userId: req.user?.id,
        newValue: result,
        reason: 'Manual failover',
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/fence',
  authenticate,
  requirePermission('settings', 'manage'),
  async (req, res, next) => {
    try {
      const row = await fenceThisNode(req.body?.reason || 'Operator fenced this node');
      res.json({ fenced: true, cluster: row });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/backups', authenticate, requirePermission('settings', 'manage'), requireHostRole, (_req, res) => {
  res.json(listEncryptedBackups());
});

router.post(
  '/backups',
  authenticate,
  requirePermission('settings', 'manage'),
  requireHostRole,
  async (req, res, next) => {
    try {
      const tier = req.body?.tier || 'frequent';
      const result = await createEncryptedBackup({ tier, userId: req.user?.id });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/backups/restore',
  authenticate,
  requirePermission('settings', 'manage'),
  requireHostRole,
  async (req, res, next) => {
    try {
      const { path: encPath, dest, live } = req.body || {};
      if (!encPath) {
        return res.status(400).json({ detail: 'path required' });
      }
      // Production Host restore: swap live SQLite after validation + pre-restore backup
      if (live === true || dest === 'live' || dest === '__live__') {
        const { restoreLiveDatabase } = await import('../services/productionRestoreService.js');
        const result = await restoreLiveDatabase({
          encPath,
          userId: req.user?.id,
        });
        return res.json(result);
      }
      if (!dest) {
        return res.status(400).json({ detail: 'path and dest required (or live:true for Host restore)' });
      }
      const result = restoreEncryptedBackup(encPath, dest);
      await appendAuditEvent({
        eventType: 'BACKUP_RESTORED',
        action: 'backup.restore',
        userId: req.user?.id,
        newValue: result,
        reason: req.body?.reason || 'Restore drill',
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/audit/verify',
  authenticate,
  requirePermission('settings', 'manage'),
  async (_req, res, next) => {
    try {
      const status = await getClusterPublicStatus();
      if (!status.shop_id) return res.json({ ok: true, checked: 0 });
      res.json(await verifyAuditChain(status.shop_id));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/audit/events',
  authenticate,
  requirePermission('settings', 'view'),
  async (req, res, next) => {
    try {
      const status = await getClusterPublicStatus();
      const result = await listAuditEvents({
        shopId: status.shop_id,
        limit: req.query.limit,
        offset: req.query.offset,
        entityType: req.query.entity_type,
        action: req.query.action,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
