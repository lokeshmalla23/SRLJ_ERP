'use strict';
/**
 * LAN Coordinator — Phase 5/6
 *
 * Responsibilities:
 *   1. Maintain a live registry of LAN peers (fed by UDP discovery)
 *   2. Elect the coordinator deterministically: lowest deviceId among peers seen within 30s
 *   3. If THIS device is elected coordinator: run an HTTP authority server for pre-commit GRANT/REJECT
 *   4. If THIS device is NOT coordinator: proxy authority requests to the coordinator
 *   5. HMAC-sign all LAN messages; verify on receipt (Phase 15)
 *
 * Coordinator HTTP server binds on LAN_AUTH_PORT (default 41780).
 * Peers discover the coordinator's address via UDP discovery (port 41779).
 *
 * Lease store is in-memory on the coordinator (ephemeral — coordinator crash causes re-election
 * and all outstanding leases are treated as expired by re-electing peers).
 *
 * Epoch: incremented on each election. Peers reject authority responses with stale epochs.
 */

const http    = require('http');
const crypto  = require('crypto');

const LAN_AUTH_PORT      = 41780;
const PEER_STALE_MS      = 30_000;  // 30s without heartbeat → peer is dead
const LEASE_TTL_MS       = 25_000;  // 25s lease, shorter than cloud's 30s
const ELECTION_DEBOUNCE  = 2_000;   // wait 2s after peer change before re-electing
const HMAC_WINDOW_MS     = 10_000;  // reject messages older than 10s (replay protection)

let _deviceId   = null;
let _shopId     = null;
let _sharedKey  = null;  // HMAC key; must be same across all shop devices
let _db         = null;

// Peer registry: Map<deviceId, { deviceId, url, lastSeen }>
const _peers = new Map();
// My own entry
let _self = null;

// Coordinator state
let _currentCoordinator = null;  // { deviceId, url, epoch }
let _epoch              = 0;
let _isCoordinator      = false;
let _electionTimer      = null;

// LAN authority server (runs only on coordinator)
let _server      = null;
// In-memory lease store (coordinator only): Map<entityKey, { leaseId, deviceId, expiresAt }>
const _leases = new Map();
let _onCoordinatorChange = null;

// ─── Init ──────────────────────────────────────────────────────────────────────

function init({ deviceId, shopId, sharedKey, db, selfUrl, onCoordinatorChange }) {
  _deviceId            = deviceId;
  _shopId              = shopId;
  if (!sharedKey || String(sharedKey).length < 32) {
    console.warn('[lanCoordinator] No shop LAN shared key — coordination signing disabled until pairing/bootstrap provides one');
    _sharedKey = null;
  } else {
    _sharedKey = String(sharedKey);
  }
  _db                  = db;
  _onCoordinatorChange = onCoordinatorChange || null;

  _self = { deviceId, url: selfUrl || `http://127.0.0.1:${LAN_AUTH_PORT}`, lastSeen: Date.now() };
  _peers.set(deviceId, _self);

  _runElection();
}

function setSharedKey(sharedKey) {
  if (!sharedKey || String(sharedKey).length < 32) {
    throw new Error('LAN shared key too short');
  }
  _sharedKey = String(sharedKey);
}

function hasSharedKey() {
  return Boolean(_sharedKey && _sharedKey.length >= 32);
}

// ─── Peer management ──────────────────────────────────────────────────────────

/** Called by UDP discovery when a peer heartbeat arrives. */
function registerPeer({ deviceId, url }) {
  if (!deviceId || !url) return;
  _peers.set(deviceId, { deviceId, url, lastSeen: Date.now() });
  _scheduleElection();
}

/** Called by UDP discovery when a peer disappears. */
function removePeer(deviceId) {
  if (deviceId === _deviceId) return;
  _peers.delete(deviceId);
  _scheduleElection();
}

/** Return live peers (seen within PEER_STALE_MS). */
function livePeers() {
  const cutoff = Date.now() - PEER_STALE_MS;
  return [..._peers.values()].filter((p) => p.lastSeen >= cutoff);
}

// ─── Election ─────────────────────────────────────────────────────────────────

function _scheduleElection() {
  if (_electionTimer) clearTimeout(_electionTimer);
  _electionTimer = setTimeout(_runElection, ELECTION_DEBOUNCE);
}

function _runElection() {
  const live = livePeers();
  if (live.length === 0) {
    _becomeIsolated();
    return;
  }

  // Deterministic: lowest deviceId string wins
  const sorted = live.slice().sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  const elected = sorted[0];
  const amCoordinator = elected.deviceId === _deviceId;

  const epochChanged = !_currentCoordinator || _currentCoordinator.deviceId !== elected.deviceId;
  if (epochChanged) {
    _epoch = _epoch + 1;
    _currentCoordinator = { deviceId: elected.deviceId, url: elected.url, epoch: _epoch };
    console.log(`[lanCoordinator] Epoch ${_epoch}: coordinator = ${elected.deviceId} (me: ${_deviceId})`);

    if (_onCoordinatorChange) {
      _onCoordinatorChange({ coordinator: _currentCoordinator, amCoordinator, peers: live });
    }
  }

  if (amCoordinator && !_isCoordinator) {
    _startAuthorityServer();
  } else if (!amCoordinator && _isCoordinator) {
    _stopAuthorityServer();
  }

  _isCoordinator = amCoordinator;
}

function _becomeIsolated() {
  if (_isCoordinator) _stopAuthorityServer();
  _isCoordinator      = false;
  _currentCoordinator = null;
  if (_onCoordinatorChange) {
    _onCoordinatorChange({ coordinator: null, amCoordinator: false, peers: [] });
  }
}

// ─── HMAC helpers ─────────────────────────────────────────────────────────────

function _sign(payload) {
  if (!_sharedKey) throw new Error('LAN shared key not configured');
  const ts    = Date.now();
  const msg   = `${ts}:${JSON.stringify(payload)}`;
  const sig   = crypto.createHmac('sha256', _sharedKey).update(msg).digest('hex');
  return { ts, sig };
}

function _verify(payload, ts, sig) {
  if (!_sharedKey) return false;
  if (Math.abs(Date.now() - Number(ts)) > HMAC_WINDOW_MS) return false;
  const msg      = `${ts}:${JSON.stringify(payload)}`;
  const expected = crypto.createHmac('sha256', _sharedKey).update(msg).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// ─── Authority server (coordinator only) ──────────────────────────────────────

function _startAuthorityServer() {
  if (_server) return;
  _leases.clear();

  _server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST') {
      res.writeHead(405);
      return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }

      if (req.url === '/api/lan/reserve')  return _handleReserve(parsed, res);
      if (req.url === '/api/lan/release')  return _handleRelease(parsed, res);
      if (req.url === '/api/lan/health')   return _handleHealth(parsed, res);

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    });
  });

  _server.listen(LAN_AUTH_PORT, '0.0.0.0', () => {
    console.log(`[lanCoordinator] Authority server listening on :${LAN_AUTH_PORT}`);
  });

  _server.on('error', (err) => {
    console.error('[lanCoordinator] Server error:', err.message);
    _server = null;
    _isCoordinator = false;
  });
}

function _stopAuthorityServer() {
  if (!_server) return;
  _server.close(() => {
    console.log('[lanCoordinator] Authority server stopped');
  });
  _server = null;
  _leases.clear();
}

function _handleHealth(_body, res) {
  res.writeHead(200);
  res.end(JSON.stringify({
    ok:             true,
    coordinator:    _deviceId,
    epoch:          _epoch,
    leases_active:  _leases.size,
    peers:          livePeers().length,
  }));
}

function _handleReserve(body, res) {
  const { entity_key, request_id, device_id, ts, sig } = body;

  // HMAC verification
  const payload = { entity_key, request_id, device_id };
  if (!_verify(payload, ts, sig)) {
    res.writeHead(401);
    return res.end(JSON.stringify({ granted: false, reason: 'Invalid HMAC signature', code: 'AUTH_FAILED' }));
  }

  if (!entity_key || !request_id) {
    res.writeHead(400);
    return res.end(JSON.stringify({ granted: false, reason: 'entity_key and request_id required' }));
  }

  // Expire stale leases
  const now = Date.now();
  for (const [key, lease] of _leases) {
    if (lease.expiresAt < now) _leases.delete(key);
  }

  // Idempotency: same request_id from same device
  const existing = [..._leases.values()].find((l) => l.requestId === request_id);
  if (existing && existing.deviceId === device_id && existing.expiresAt > now) {
    res.writeHead(200);
    return res.end(JSON.stringify({
      granted:    true,
      lease_id:   existing.leaseId,
      expires_at: new Date(existing.expiresAt).toISOString(),
      idempotent: true,
      epoch:      _epoch,
    }));
  }

  // Conflict check
  const conflict = _leases.get(entity_key);
  if (conflict && conflict.expiresAt > now) {
    res.writeHead(409);
    return res.end(JSON.stringify({
      granted:    false,
      reason:     'Another device holds the lease',
      code:       'ALREADY_RESERVED',
      held_by:    conflict.deviceId,
      expires_at: new Date(conflict.expiresAt).toISOString(),
    }));
  }

  const leaseId   = crypto.randomUUID();
  const expiresAt = now + LEASE_TTL_MS;
  _leases.set(entity_key, { leaseId, requestId: request_id, deviceId: device_id, expiresAt });

  res.writeHead(201);
  res.end(JSON.stringify({
    granted:    true,
    lease_id:   leaseId,
    expires_at: new Date(expiresAt).toISOString(),
    epoch:      _epoch,
  }));
}

function _handleRelease(body, res) {
  const { entity_key, lease_id, ts, sig } = body;
  const payload = { entity_key, lease_id };
  if (!_verify(payload, ts, sig)) {
    res.writeHead(401);
    return res.end(JSON.stringify({ ok: false, reason: 'Invalid HMAC signature' }));
  }
  const lease = _leases.get(entity_key);
  if (lease && lease.leaseId === lease_id) {
    _leases.delete(entity_key);
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

// ─── Client API (used by non-coordinator peers) ───────────────────────────────

async function _lanPost(url, path, body) {
  const { ts, sig } = _sign(body);
  const res = await fetch(`${url}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ...body, ts, sig }),
    signal:  AbortSignal.timeout(3000),
  });
  return res.json();
}

/**
 * Request a LAN authority lease from the coordinator.
 * Returns { granted, leaseId, expiresAt?, reason?, code? }
 */
async function requestLease({ entityKey, requestId, deviceId }) {
  if (_isCoordinator) {
    // Self-grant (coordinator grants its own requests locally)
    const fake = { entity_key: entityKey, request_id: requestId, device_id: deviceId || _deviceId };
    const { ts, sig } = _sign({ entity_key: entityKey, request_id: requestId, device_id: deviceId || _deviceId });
    return new Promise((resolve) => {
      const res = {
        writeHead() {},
        end(data) { resolve(JSON.parse(data)); },
      };
      _handleReserve({ ...fake, ts, sig }, res);
    });
  }

  if (!_currentCoordinator) {
    return { granted: false, reason: 'No coordinator elected', code: 'NO_COORDINATOR' };
  }

  try {
    return await _lanPost(_currentCoordinator.url, '/api/lan/reserve', {
      entity_key:  entityKey,
      request_id:  requestId,
      device_id:   deviceId || _deviceId,
    });
  } catch (err) {
    return { granted: false, reason: `Coordinator unreachable: ${err.message}`, code: 'COORDINATOR_UNREACHABLE' };
  }
}

/**
 * Release a LAN lease.
 */
async function releaseLease({ entityKey, leaseId }) {
  if (_isCoordinator) {
    const lease = _leases.get(entityKey);
    if (lease && lease.leaseId === leaseId) _leases.delete(entityKey);
    return { ok: true };
  }

  if (!_currentCoordinator) return { ok: false, reason: 'No coordinator' };

  try {
    return await _lanPost(_currentCoordinator.url, '/api/lan/release', { entity_key: entityKey, lease_id: leaseId });
  } catch {
    return { ok: false };
  }
}

// ─── State query ─────────────────────────────────────────────────────────────

function getStatus() {
  return {
    isCoordinator:  _isCoordinator,
    coordinator:    _currentCoordinator,
    epoch:          _epoch,
    livePeers:      livePeers().length,
    leasesHeld:     _isCoordinator ? _leases.size : null,
  };
}

function shutdown() {
  if (_electionTimer) clearTimeout(_electionTimer);
  _stopAuthorityServer();
}

module.exports = {
  init,
  setSharedKey,
  hasSharedKey,
  registerPeer,
  removePeer,
  livePeers,
  requestLease,
  releaseLease,
  getStatus,
  shutdown,
  LAN_AUTH_PORT,
};
