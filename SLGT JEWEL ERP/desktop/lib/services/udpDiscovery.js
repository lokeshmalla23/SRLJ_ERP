'use strict';
/**
 * UDP LAN Discovery — Phase 5/6 wiring
 *
 * Broadcasts this device's presence on the LAN every HEARTBEAT_MS using UDP broadcast.
 * All devices on the same subnet and shop see each other without configuration.
 *
 * Protocol: UDP on port 41779
 * Message format: JSON { type: 'announce', shopId, deviceId, url, epoch, ts }
 *
 * Security: messages are filtered by shopId — cross-shop announcements are ignored.
 * HMAC message auth is handled by lanCoordinator before granting leases.
 */

const dgram  = require('dgram');
const os     = require('os');

function subnetBroadcasts() {
  const nets = os.networkInterfaces();
  const broadcasts = new Set(['255.255.255.255']);
  for (const list of Object.values(nets || {})) {
    for (const n of list || []) {
      if (n.family !== 'IPv4' || n.internal) continue;
      try {
        const ip   = n.address.split('.').map(Number);
        const mask = n.netmask.split('.').map(Number);
        const bcast = ip.map((b, i) => (b | (~mask[i] & 0xff))).join('.');
        broadcasts.add(bcast);
      } catch { /* */ }
    }
  }
  return [...broadcasts];
}

const DISCOVERY_PORT  = 41779;
const AUTH_PORT       = 41780;
const HEARTBEAT_MS    = 5_000;
const PEER_STALE_MS   = 30_000;

let _socket      = null;
let _hbTimer     = null;
let _staleTimer  = null;
let _deviceId    = null;
let _shopId      = null;
let _selfUrl     = null;

// coordinator ref — set by init
let _lanCoordinator = null;

// peer tracking: Map<deviceId, { deviceId, url, shopId, lastSeen }>
const _seen = new Map();

function _getSelfUrl() {
  // Use first non-internal IPv4 address if available
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return `http://${iface.address}:${AUTH_PORT}`;
      }
    }
  }
  return `http://127.0.0.1:${AUTH_PORT}`;
}

function _buildAnnouncement() {
  return JSON.stringify({
    type:     'announce',
    shopId:   _shopId,
    deviceId: _deviceId,
    url:      _selfUrl,
    ts:       Date.now(),
  });
}

function _broadcast() {
  if (!_socket) return;
  const msg = Buffer.from(_buildAnnouncement());
  for (const bcast of subnetBroadcasts()) {
    _socket.send(msg, 0, msg.length, DISCOVERY_PORT, bcast, (err) => {
      if (err) console.warn('[udpDiscovery] broadcast error:', err.message);
    });
  }
}

function _onMessage(msg, rinfo) {
  let parsed;
  try { parsed = JSON.parse(msg.toString('utf8')); } catch { return; }

  if (parsed.type !== 'announce') return;
  if (parsed.shopId !== _shopId) return;          // cross-shop — ignore
  if (parsed.deviceId === _deviceId) return;      // self — ignore
  if (!parsed.url || !parsed.deviceId) return;

  const isNew = !_seen.has(parsed.deviceId);
  _seen.set(parsed.deviceId, {
    deviceId: parsed.deviceId,
    url:      parsed.url,
    shopId:   parsed.shopId,
    lastSeen: Date.now(),
  });

  if (isNew && _lanCoordinator) {
    console.log(`[udpDiscovery] New peer: ${parsed.deviceId} at ${parsed.url}`);
    _lanCoordinator.registerPeer({ deviceId: parsed.deviceId, url: parsed.url });
  } else if (_lanCoordinator) {
    // Refresh last-seen (lanCoordinator tracks its own timer)
    _lanCoordinator.registerPeer({ deviceId: parsed.deviceId, url: parsed.url });
  }
}

function _pruneStale() {
  const cutoff = Date.now() - PEER_STALE_MS;
  for (const [id, peer] of _seen) {
    if (peer.lastSeen < cutoff) {
      _seen.delete(id);
      if (_lanCoordinator) {
        console.log(`[udpDiscovery] Peer timed out: ${id}`);
        _lanCoordinator.removePeer(id);
      }
    }
  }
}

/**
 * Start UDP discovery.
 * @param {object} opts
 * @param {string} opts.deviceId
 * @param {string} opts.shopId
 * @param {object} opts.lanCoordinator — the lanCoordinator module
 * @param {string} [opts.selfUrl]      — override self URL (for tests)
 */
function start({ deviceId, shopId, lanCoordinator, selfUrl }) {
  if (_socket) return; // already started

  _deviceId       = deviceId;
  _shopId         = shopId;
  _lanCoordinator = lanCoordinator;
  _selfUrl        = selfUrl || _getSelfUrl();

  _socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  _socket.on('error', (err) => {
    console.error('[udpDiscovery] Socket error:', err.message);
    _socket = null;
  });

  _socket.on('message', _onMessage);

  _socket.bind(DISCOVERY_PORT, () => {
    try {
      _socket.setBroadcast(true);
    } catch (e) {
      console.warn('[udpDiscovery] setBroadcast failed:', e.message);
    }
    console.log(`[udpDiscovery] Listening on UDP :${DISCOVERY_PORT} — selfUrl: ${_selfUrl}`);
    _broadcast(); // announce immediately on bind
  });

  // Heartbeat
  _hbTimer = setInterval(_broadcast, HEARTBEAT_MS);
  _hbTimer.unref?.();

  // Prune stale peers every 10s
  _staleTimer = setInterval(_pruneStale, 10_000);
  _staleTimer.unref?.();
}

function stop() {
  if (_hbTimer)    { clearInterval(_hbTimer);    _hbTimer    = null; }
  if (_staleTimer) { clearInterval(_staleTimer); _staleTimer = null; }
  if (_socket) {
    _socket.close();
    _socket = null;
  }
}

function getKnownPeers() {
  return [..._seen.values()];
}

module.exports = { start, stop, getKnownPeers, DISCOVERY_PORT, AUTH_PORT };
