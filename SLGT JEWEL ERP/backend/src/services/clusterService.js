/**
 * Shop cluster identity: shop_id, node_id, host_id, host_term, role, fencing.
 */
import fs from 'fs';
import path from 'path';
import { Op } from 'sequelize';
import { ClusterState, Device } from '../models/index.js';
import branchConfig from '../config/branchConfig.js';
import { getDefaultShopId } from './defaultShop.js';
import { isBranchMode } from '../config/appMode.js';
import { newId } from '../utils.js';
import { setAdvertisedHostTerm, stopDiscoveryAdvertiser } from './lanDiscovery.js';

function persistBranchJson(patch) {
  try {
    const cfgPath = branchConfig.config_path;
    const dir = path.dirname(cfgPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let existing = {};
    if (fs.existsSync(cfgPath)) {
      existing = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    }
    const next = { ...existing, ...patch };
    delete next.database_url;
    delete next.database_password;
    delete next.jwt_secret;
    fs.writeFileSync(cfgPath, JSON.stringify(next, null, 2), { mode: 0o600 });
  } catch (err) {
    console.warn('clusterService: could not persist branch.json:', err.message);
  }
}

export async function ensureClusterState() {
  if (!isBranchMode()) return null;
  try {
    let shopId = branchConfig.shop_id;
    try {
      shopId = shopId || (await getDefaultShopId());
    } catch {
      return null;
    }
    const nodeId = branchConfig.device_id;
    if (!shopId || !nodeId) return null;

    let row = await ClusterState.findOne({ where: { shop_id: shopId } });
    const role = branchConfig.role === 'active_host' ? 'active_host' : 'replica';
    if (!row) {
      row = await ClusterState.create({
        id: newId(),
        shop_id: shopId,
        node_id: nodeId,
        host_id: role === 'active_host' ? nodeId : null,
        host_term: 1,
        role,
        event_watermark: 0,
        fenced: false,
        meta: {},
      });
      persistBranchJson({
        shop_id: shopId,
        device_id: nodeId,
        host_id: row.host_id,
        host_term: row.host_term,
        role: branchConfig.role,
      });
    } else {
      const patch = {};
      if (row.node_id !== nodeId) patch.node_id = nodeId;
      // Host PC: reclaim write authority when this process is configured as active_host.
      // Prevents ghost UUID / old host_id from permanently fencing local billing.
      if (role === 'active_host') {
        if (row.role !== 'active_host') patch.role = 'active_host';
        if (row.host_id !== nodeId) {
          // A different node is claiming the host role (e.g. after ownership transfer +
          // DB copy). Bump host_term so replicas elect this node over the old host.
          patch.host_id   = nodeId;
          patch.host_term = Number(row.host_term || 0) + 1;
        }
        if (row.fenced) {
          patch.fenced = false;
          patch.fenced_reason = null;
        }
      } else if (role === 'replica') {
        if (row.role !== 'replica') patch.role = 'replica';
      }
      if (Object.keys(patch).length) {
        await row.update(patch);
        row = await ClusterState.findByPk(row.id);
      }
      persistBranchJson({
        shop_id: shopId,
        device_id: nodeId,
        host_id: row.host_id,
        host_term: row.host_term,
        role: branchConfig.role,
      });
    }
    return row;
  } catch (err) {
    console.warn('ensureClusterState skipped:', err.message);
    return null;
  }
}

export async function getClusterPublicStatus() {
  const row = await ensureClusterState();
  if (!row) {
    return {
      shop_id: branchConfig.shop_id,
      node_id: branchConfig.device_id,
      host_id: null,
      host_term: null,
      role: branchConfig.role,
      fenced: false,
      event_watermark: 0,
    };
  }
  return {
    shop_id: row.shop_id,
    node_id: row.node_id,
    host_id: row.host_id,
    host_term: row.host_term,
    role: row.role,
    fenced: row.fenced,
    fenced_reason: row.fenced_reason,
    event_watermark: Number(row.event_watermark || 0),
  };
}

export async function assertCanWriteAuthoritatively() {
  const row = await ensureClusterState();
  if (!row) return { ok: true };
  // Update heartbeat on every authoritative write check (fire-and-forget)
  if (row.role === 'active_host') {
    Device.update(
      { last_seen_at: new Date() },
      { where: { shop_id: row.shop_id, device_identifier: row.node_id } },
    ).catch(() => {});
  }
  if (row.fenced) {
    return {
      ok: false,
      code: 'HOST_FENCED',
      detail: row.fenced_reason || 'This node is fenced. Rejoin as a replica after promote on the new host.',
      host_term: row.host_term,
      host_id: row.host_id,
    };
  }
  if (row.role !== 'active_host' || row.host_id !== row.node_id) {
    return {
      ok: false,
      code: 'HOST_NOT_AUTHORITATIVE',
      detail: 'This node is a replica. Send writes to the active host.',
      host_term: row.host_term,
      host_id: row.host_id,
      role: row.role,
    };
  }
  return { ok: true, host_term: row.host_term, host_id: row.host_id };
}

/**
 * Promote this node to host: bump host_term, set host_id, clear fence.
 * Caller must confirm dual-active risk and isolate old host.
 */
export async function promoteClusterHost({ confirmDualActiveRisk = false } = {}) {
  if (!confirmDualActiveRisk) {
    const err = new Error('Must confirm dual-active risk (isolate previous host first)');
    err.code = 'CONFIRM_REQUIRED';
    err.status = 400;
    throw err;
  }
  const row = await ensureClusterState();
  if (!row) {
    const err = new Error('Cluster state not initialized');
    err.status = 400;
    throw err;
  }

  const nextTerm = Number(row.host_term || 0) + 1;
  await row.update({
    role: 'active_host',
    host_id: row.node_id,
    host_term: nextTerm,
    fenced: false,
    fenced_reason: null,
    meta: {
      ...(row.meta || {}),
      promoted_at: new Date().toISOString(),
      previous_host_id: row.host_id,
      previous_term: row.host_term,
    },
  });

  const shopId = row.shop_id;
  await Device.update(
    { role: 'client', status: 'offline' },
    { where: { shop_id: shopId, role: 'active_host', device_identifier: { [Op.ne]: row.node_id } } }
  );

  let device = await Device.findOne({ where: { shop_id: shopId, device_identifier: row.node_id } });
  if (device) {
    await device.update({
      role: 'active_host',
      status: 'active',
      last_seen_at: new Date(),
      meta: { ...(device.meta || {}), host_term: nextTerm, promoted_at: new Date().toISOString() },
    });
  }

  persistBranchJson({
    shop_id: shopId,
    device_id: row.node_id,
    host_id: row.node_id,
    host_term: nextTerm,
    role: 'active_host',
  });
  setAdvertisedHostTerm(nextTerm);

  return {
    promoted: true,
    host_id: row.node_id,
    host_term: nextTerm,
    warning:
      'Shut down or isolate the previous host before continuing. If it returns, it must rejoin as a replica — do not let it write.',
  };
}

/** Mark this node fenced (superseded). */
export async function fenceThisNode(reason, observedTerm = null) {
  const row = await ensureClusterState();
  if (!row) return null;
  await row.update({
    fenced: true,
    role: 'replica',
    fenced_reason: reason,
    meta: {
      ...(row.meta || {}),
      fenced_at: new Date().toISOString(),
      observed_term: observedTerm,
    },
  });
  persistBranchJson({ role: 'client', host_term: row.host_term });
  // Stop broadcasting as active_host immediately so replicas don't see this
  // node as a candidate during the election after ownership/host transfer.
  try { stopDiscoveryAdvertiser(); } catch { /* non-fatal */ }
  return row;
}

/**
 * If a peer advertises a higher host_term, fence locally.
 */
export async function observePeerHostTerm({ hostId, hostTerm }) {
  const row = await ensureClusterState();
  if (!row || hostTerm == null) return { fenced: false };
  const term = Number(hostTerm);
  if (Number.isNaN(term)) return { fenced: false };
  if (term > Number(row.host_term) && row.host_id === row.node_id) {
    await fenceThisNode(
      `Superseded by host_term ${term} on host ${hostId || 'unknown'}. Rejoin as replica.`,
      term
    );
    return { fenced: true, host_term: term, host_id: hostId };
  }
  if (term > Number(row.host_term)) {
    await row.update({
      host_term: term,
      host_id: hostId || row.host_id,
      role: 'replica',
    });
  }
  return { fenced: false };
}

const HOST_HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes without a heartbeat = stale host

/**
 * Record a heartbeat for the active host into its Device row.
 * Call this on every authoritative write or on a periodic timer.
 */
export async function recordHostHeartbeat() {
  const row = await ensureClusterState();
  if (!row || row.role !== 'active_host') return;
  try {
    await Device.update(
      { last_seen_at: new Date() },
      { where: { shop_id: row.shop_id, device_identifier: row.node_id } },
    );
  } catch (err) {
    console.warn('clusterService: heartbeat update failed:', err.message);
  }
}

/**
 * Fence this node if the current host Device row has not been seen within
 * HOST_HEARTBEAT_TIMEOUT_MS. Replicas call this to detect a crashed host
 * and self-promote safely via promoteClusterHost().
 *
 * Returns { stale: boolean, last_seen_at, host_id }
 */
export async function checkHostHeartbeat() {
  const row = await ensureClusterState();
  if (!row) return { stale: false };

  const hostDevice = await Device.findOne({
    where: { shop_id: row.shop_id, device_identifier: row.host_id },
  });

  if (!hostDevice?.last_seen_at) return { stale: false, host_id: row.host_id };

  const elapsed = Date.now() - new Date(hostDevice.last_seen_at).getTime();
  const stale = elapsed > HOST_HEARTBEAT_TIMEOUT_MS;

  if (stale && row.role === 'active_host' && row.host_id === row.node_id) {
    // This node IS the host and its own heartbeat is stale — self-fence to prevent ghost writes
    await fenceThisNode(
      `Host self-fenced: no heartbeat for ${Math.round(elapsed / 1000)}s. Promote another node.`,
    );
  }

  return {
    stale,
    elapsed_ms: elapsed,
    host_id: row.host_id,
    last_seen_at: hostDevice.last_seen_at,
    timeout_ms: HOST_HEARTBEAT_TIMEOUT_MS,
  };
}

export async function listClusterNodes() {
  const status = await getClusterPublicStatus();
  if (!status.shop_id) return { cluster: status, devices: [] };
  const devices = await Device.findAll({
    where: { shop_id: status.shop_id, status: 'active' },
    order: [['device_name', 'ASC']],
  });
  return {
    cluster: status,
    devices: devices.map((d) => ({
      id: d.id,
      device_name: d.device_name,
      device_identifier: d.device_identifier,
      role: d.role,
      status: d.status,
      last_seen_at: d.last_seen_at,
      is_self: d.device_identifier === status.node_id,
      // Only the cluster host_id is the host — never show demoted ghosts as HOST
      is_host: d.device_identifier === status.host_id,
      meta: d.meta,
    })),
  };
}
