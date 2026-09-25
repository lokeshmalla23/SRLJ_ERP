/**
 * Controlled recovery snapshots (Phase 10).
 * Encrypted snapshot of recoverable branch state — NOT automatic leader election.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { SchemaMeta, Shop, Device } from '../models/index.js';
import { getDefaultShopId } from './defaultShop.js';
import branchConfig from '../config/branchConfig.js';
import { SCHEMA_VERSION } from '../config/schemaVersion.js';
import { isBranchMode } from '../config/appMode.js';
import { newId } from '../utils.js';
import { promoteClusterHost } from './clusterService.js';
import { appendAuditEvent } from './auditTrailService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function recoveryDir() {
  if (process.env.RECOVERY_DIR) return process.env.RECOVERY_DIR;
  if (process.env.ELECTRON_USERDATA) {
    return path.join(process.env.ELECTRON_USERDATA, 'recovery');
  }
  return path.resolve(__dirname, '../../.recovery');
}

function getRecoveryKey() {
  const key = process.env.RECOVERY_KEY || process.env.JWT_SECRET;
  if (!key) throw new Error('RECOVERY_KEY or JWT_SECRET required for recovery encryption');
  return crypto.createHash('sha256').update(String(key)).digest();
}

function encryptJson(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getRecoveryKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  };
}

function decryptJson(envelope) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getRecoveryKey(),
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(dec.toString('utf8'));
}

/**
 * Build recoverable payload: identity, schema, pending outbox, sync state.
 * Full DB dump is via pg_dump in backup scripts — snapshot carries sync-critical + metadata.
 */
export async function buildRecoveryPayload() {
  const shopId = branchConfig.shop_id || (await getDefaultShopId());
  const shop = await Shop.findByPk(shopId);
  const schema = await SchemaMeta.findByPk('schema_version');
  const devices = await Device.findAll({ where: { shop_id: shopId } });

  return {
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    schema_meta: schema?.value || null,
    shop: shop?.toJSON() || null,
    host: {
      device_id: branchConfig.device_id,
      device_name: branchConfig.device_name,
      role: branchConfig.role,
    },
    devices: devices.map((d) => d.toJSON()),
    note: 'Local SQLite only — LAN replication via lanReplicaSync',
  };
}

export async function writeRecoverySnapshot() {
  const dir = recoveryDir();
  fs.mkdirSync(dir, { recursive: true });
  const payload = await buildRecoveryPayload();
  const envelope = encryptJson(payload);
  const name = `recovery-${Date.now()}.json.enc`;
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, JSON.stringify(envelope, null, 2), { mode: 0o600 });

  // retention: keep last 14
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith('recovery-') && f.endsWith('.json.enc'))
    .sort();
  while (files.length > 14) {
    const old = files.shift();
    try { fs.unlinkSync(path.join(dir, old)); } catch { /* */ }
  }

  // latest pointer (also for recovery PCs to copy)
  fs.writeFileSync(path.join(dir, 'latest.json.enc'), JSON.stringify(envelope), { mode: 0o600 });
  return { path: filePath, created_at: payload.created_at };
}

export function readLatestSnapshot() {
  const latest = path.join(recoveryDir(), 'latest.json.enc');
  if (!fs.existsSync(latest)) return null;
  const envelope = JSON.parse(fs.readFileSync(latest, 'utf8'));
  const payload = decryptJson(envelope);
  return { payload, path: latest };
}

/**
 * Promote this device to active_host after operator confirmation.
 * Does NOT auto-elect. Caller must verify old host is down.
 */
export async function promoteToActiveHost({
  confirmDualActiveRisk = false,
  deviceIdentifier,
  deviceName,
} = {}) {
  if (!confirmDualActiveRisk) {
    throw Object.assign(new Error('Must confirm dual-active risk awareness'), {
      code: 'CONFIRM_REQUIRED',
      status: 400,
    });
  }
  const snap = readLatestSnapshot();
  if (!snap) {
    throw Object.assign(new Error('No recovery snapshot available'), { code: 'NO_SNAPSHOT', status: 400 });
  }
  if (Number(snap.payload.schema_version) !== SCHEMA_VERSION) {
    throw Object.assign(new Error('Schema mismatch with recovery snapshot'), {
      code: 'SCHEMA_MISMATCH',
      status: 409,
    });
  }
  const shopId = snap.payload.shop?.id || (await getDefaultShopId());
  if (snap.payload.shop?.id && snap.payload.shop.id !== shopId) {
    throw Object.assign(new Error('Shop identity mismatch'), { code: 'SHOP_MISMATCH', status: 409 });
  }

  // Demote any existing active_host rows in local registry
  await Device.update(
    { role: 'client', status: 'offline' },
    { where: { shop_id: shopId, role: 'active_host' } }
  );

  const ident = deviceIdentifier || branchConfig.device_id;
  let device = await Device.findOne({ where: { shop_id: shopId, device_identifier: ident } });
  if (!device) {
    device = await Device.create({
      id: newId(),
      shop_id: shopId,
      device_name: deviceName || branchConfig.device_name || 'Recovery Host',
      device_identifier: ident,
      role: 'active_host',
      status: 'active',
      last_seen_at: new Date(),
      meta: { promoted_at: new Date().toISOString(), from_snapshot: snap.path },
    });
  } else {
    await device.update({
      role: 'active_host',
      status: 'active',
      last_seen_at: new Date(),
      meta: { ...(device.meta || {}), promoted_at: new Date().toISOString() },
    });
  }

  // Bump host_term via cluster service (fencing)
  let clusterPromote = null;
  try {
    clusterPromote = await promoteClusterHost({ confirmDualActiveRisk: true });
  } catch (err) {
    console.warn('promoteToActiveHost cluster term bump:', err.message);
  }

  try {
    await appendAuditEvent({
      eventType: 'HOST_PROMOTED',
      action: 'recovery.promote',
      entityType: 'device',
      entityId: device.id,
      newValue: { host_term: clusterPromote?.host_term, device: device.device_identifier },
      reason: 'Controlled recovery promote',
    });
  } catch { /* */ }

  return {
    promoted: true,
    device: device.toJSON(),
    host_term: clusterPromote?.host_term || null,
    warning:
      'Shut down or isolate the previous host before continuing. If it returns, it must rejoin as a replica — not auto-activate.',
    snapshot_at: snap.payload.created_at,
    pending_restored: (snap.payload.sync_outbox_pending || []).length,
  };
}

/** Old host: detect another active host and refuse authoritative role. */
export async function fenceIfSuperseded() {
  if (!isBranchMode()) return { fenced: false };
  const shopId = branchConfig.shop_id || (await getDefaultShopId());
  const hosts = await Device.findAll({
    where: { shop_id: shopId, role: 'active_host', status: 'active' },
  });
  const me = branchConfig.device_id;
  // Only treat peers that are clearly a *different* live host as superseding.
  // Ignore ghost rows with no recent heartbeat (common after Neon/device seed noise).
  const STALE_MS = 5 * 60 * 1000;
  const now = Date.now();
  const others = hosts.filter((h) => {
    if (!h.device_identifier || h.device_identifier === me) return false;
    const seen = h.last_seen_at ? new Date(h.last_seen_at).getTime() : 0;
    if (!seen || Number.isNaN(seen)) return false; // never seen → ghost, ignore
    return (now - seen) < STALE_MS;
  });
  if (others.length > 0) {
    return {
      fenced: true,
      active_hosts: others.map((h) => ({
        device_id: h.id,
        device_name: h.device_name,
        device_identifier: h.device_identifier,
      })),
      action: 'disable_authoritative_writes_and_rejoin_as_client',
    };
  }
  return { fenced: false };
}
