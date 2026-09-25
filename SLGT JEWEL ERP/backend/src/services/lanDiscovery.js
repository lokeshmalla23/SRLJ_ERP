/**
 * LAN discovery for Branch Service (Windows-friendly UDP broadcast).
 * Not a trust boundary — Host approval + device credential still required to join.
 */
import fs from 'fs';
import dgram from 'dgram';
import os from 'os';
import { isBranchMode } from '../config/appMode.js';
import branchConfig from '../config/branchConfig.js';
import { SCHEMA_VERSION } from '../config/schemaVersion.js';

const DISCOVERY_PORT = Number(process.env.DISCOVERY_PORT || 41779);
const MAGIC = 'JEWELLERY_CRM_BRANCH_V1';

let server = null;
let advertTimer = null;
let joinReady = false;
let joinReadyName = null;

// host_term is bumped by clusterService; we mirror it here so UDP packets carry
// the current term without blocking on a DB read inside buildAdvertisement().
let _hostTerm = (() => {
  try {
    const cfgPath = branchConfig.config_path;
    if (cfgPath && fs.existsSync(cfgPath)) {
      const data = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      return Number(data.host_term) || 1;
    }
  } catch { /* */ }
  return 1;
})();

/** Called by clusterService after promoting or fencing to keep UDP in sync. */
export function setAdvertisedHostTerm(term) {
  if (typeof term === 'number' && term > 0) _hostTerm = term;
}

function localIPv4s() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const list of Object.values(nets || {})) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address);
    }
  }
  return out;
}

function subnetBroadcasts() {
  const nets = os.networkInterfaces();
  const broadcasts = new Set(['255.255.255.255']);
  for (const list of Object.values(nets || {})) {
    for (const n of list || []) {
      if (n.family !== 'IPv4' || n.internal) continue;
      try {
        const ip = n.address.split('.').map(Number);
        const mask = n.netmask.split('.').map(Number);
        const bcast = ip.map((b, i) => (b | (~mask[i] & 0xff))).join('.');
        broadcasts.add(bcast);
      } catch { /* */ }
    }
  }
  return [...broadcasts];
}

export function buildAdvertisement() {
  return {
    magic: MAGIC,
    app_mode: 'branch',
    role: joinReady ? 'join_ready' : branchConfig.role,
    join_ready: joinReady,
    shop_id: branchConfig.shop_id,
    device_id: branchConfig.device_id,
    device_name: joinReadyName || branchConfig.device_name,
    schema_version: SCHEMA_VERSION,
    api_port: branchConfig.listen_port,
    host_term: _hostTerm,
    addresses: localIPv4s(),
    ts: Date.now(),
  };
}

function ensureSocket() {
  if (server) return;
  server = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  server.on('error', (err) => {
    console.warn('discovery advertiser error:', err.message);
  });
  server.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString('utf8'));
      if (data?.type === 'discover' && data.magic === MAGIC) {
        const reply = Buffer.from(JSON.stringify(buildAdvertisement()), 'utf8');
        server.send(reply, rinfo.port, rinfo.address);
      }
    } catch {
      /* ignore */
    }
  });
  server.bind(DISCOVERY_PORT, () => {
    try { server.setBroadcast(true); } catch { /* */ }
    console.log(`LAN discovery listening UDP ${DISCOVERY_PORT}`);
  });
}

function startAdvertLoop() {
  if (advertTimer) return;
  advertTimer = setInterval(() => {
    try {
      if (!server) return;
      const buf = Buffer.from(JSON.stringify({
        type: 'advertise',
        ...buildAdvertisement(),
      }), 'utf8');
      for (const bcast of subnetBroadcasts()) {
        server.send(buf, DISCOVERY_PORT, bcast);
      }
    } catch {
      /* */
    }
  }, 4000);
}

/** Active host advertises presence on LAN. */
export function startDiscoveryAdvertiser() {
  if (!isBranchMode()) return;
  if (branchConfig.role !== 'active_host' && !joinReady) return;
  ensureSocket();
  startAdvertLoop();
}

/** Client PC: broadcast "waiting for owner to assign PIN". */
export function startJoinReadyAdvertiser({ deviceName } = {}) {
  if (!isBranchMode()) return;
  joinReady = true;
  joinReadyName = deviceName || branchConfig.device_name || 'New PC';
  ensureSocket();
  startAdvertLoop();
  console.log('[discovery] join_ready advertising as', joinReadyName);
}

export function stopJoinReadyAdvertiser() {
  joinReady = false;
  joinReadyName = null;
}

export function stopDiscoveryAdvertiser() {
  stopJoinReadyAdvertiser();
  if (advertTimer) clearInterval(advertTimer);
  advertTimer = null;
  if (server) {
    try { server.close(); } catch { /* */ }
    server = null;
  }
}

function discoverByFilter(filterFn, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found = new Map();
    const finish = () => {
      try { socket.close(); } catch { /* */ }
      resolve([...found.values()]);
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString('utf8'));
        if (data?.magic !== MAGIC) return;
        if (!filterFn(data)) return;
        const key = data.device_id || `${rinfo.address}:${data.api_port}`;
        // rinfo.address is the actual interface the UDP packet arrived from —
        // always the right LAN address even when payload addresses[] includes
        // virtual adapters. Attach it as the first candidate.
        const secondaryAddresses = (data.addresses || []).filter((a) =>
          a && a !== rinfo.address && !a.startsWith('127.') && !a.startsWith('169.254.')
        );
        found.set(key, {
          ...data,
          rinfo_address: rinfo.address,
          candidate_urls: [
            `http://${rinfo.address}:${data.api_port || 8080}`,
            ...secondaryAddresses.map((a) => `http://${a}:${data.api_port || 8080}`),
          ],
        });
      } catch {
        /* */
      }
    });
    // Bind to the discovery port (reuseAddr) so we also catch periodic
    // 4-second broadcasts from waiting PCs, not just probe replies.
    socket.bind(DISCOVERY_PORT, () => {
      try { socket.setBroadcast(true); } catch { /* */ }
      const probe = Buffer.from(JSON.stringify({ type: 'discover', magic: MAGIC }), 'utf8');
      socket.send(probe, DISCOVERY_PORT, '255.255.255.255');
    });
    socket.on('error', () => {
      clearTimeout(timer);
      finish();
    });
  });
}

/** Client: discover active hosts (timeout ms). */
export function discoverBranchHosts({ timeoutMs = 3000 } = {}) {
  return discoverByFilter(
    (data) => data.role === 'active_host' && !data.join_ready,
    { timeoutMs }
  );
}

/** Owner: discover PCs waiting to join (join_ready). */
export function discoverJoinReadyDevices({ timeoutMs = 3000 } = {}) {
  return discoverByFilter(
    (data) => data.join_ready === true || data.role === 'join_ready',
    { timeoutMs }
  );
}
