'use strict';
/**
 * HostConnector — three orthogonal connection state machines for replica PCs.
 *
 * STATE 1 — HOST CONNECTION (finding the owner PC on the LAN)
 *   cold_start → checking_last_known → connected
 *             ↘ discovering → verifying → connected
 *                                       ↘ not_found
 *   connected → reconnecting → connected | not_found
 *
 * STATE 2 — DEVICE AUTH (is this PC registered on the host?)
 *   unknown → checking → paired | not_paired | revoked
 *
 * STATE 3 — EMPLOYEE AUTH (is an employee signed in?)
 *   signed_out ↔ signed_in
 *
 * The three states are independent: host connection can succeed while device
 * is not yet paired; device can be paired while no employee is signed in.
 *
 * Host selection: rinfo.address (actual UDP source) is the PRIMARY candidate;
 * payload addresses[] are secondary fallbacks. Authoritative host is chosen by
 * highest cluster host_term (Raft-style), not latency.
 */

const { EventEmitter } = require('events');
const dgram = require('dgram');
const os    = require('os');

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

const DISCOVERY_PORT = 41779;
const MAGIC          = 'JEWELLERY_CRM_BRANCH_V1';

// ── Error codes ──────────────────────────────────────────────────────────────
const ERR = Object.freeze({
  HOST_NOT_FOUND:         'HOST_NOT_FOUND',
  HOST_UNREACHABLE:       'HOST_UNREACHABLE',
  CONNECTION_TIMEOUT:     'CONNECTION_TIMEOUT',
  WRONG_SHOP:             'WRONG_SHOP',
  DEVICE_NOT_PAIRED:      'DEVICE_NOT_PAIRED',
  PAIRING_CODE_INVALID:   'PAIRING_CODE_INVALID',
  PAIRING_CODE_EXPIRED:   'PAIRING_CODE_EXPIRED',
  DEVICE_REVOKED:         'DEVICE_REVOKED',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  SYNC_FAILED:            'SYNC_FAILED',
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function filterSecondaryAddresses(addresses, rinfoAddress) {
  return (addresses || []).filter((a) => {
    if (!a || typeof a !== 'string') return false;
    if (a === rinfoAddress)           return false; // already primary
    if (a.startsWith('127.'))         return false; // loopback
    if (a.startsWith('169.254.'))     return false; // link-local
    if (a === '0.0.0.0')             return false;
    return true;
  });
}

function buildCandidateUrls(candidate) {
  const port = candidate.api_port || 8080;
  const urls = [];
  if (candidate.rinfo_address && !candidate.rinfo_address.startsWith('127.')) {
    urls.push(`http://${candidate.rinfo_address}:${port}`);
  }
  for (const a of candidate.secondary_addresses || []) {
    const u = `http://${a}:${port}`;
    if (!urls.includes(u)) urls.push(u);
  }
  return urls;
}

// ── HostConnector ─────────────────────────────────────────────────────────────

class HostConnector extends EventEmitter {
  /**
   * @param {{
   *   loadConfig: () => object,
   *   saveConfig: (patch: object) => void,
   *   deviceCredentials: { load: () => object|null, save: (d: object) => void, clear: () => void },
   * }} opts
   */
  constructor({ loadConfig, saveConfig, deviceCredentials }) {
    super();
    this._loadConfig        = loadConfig;
    this._saveConfig        = saveConfig;
    this._deviceCredentials = deviceCredentials;

    // Three independent states
    this._hostState     = 'cold_start';
    this._deviceState   = 'unknown';
    this._employeeState = 'signed_out';

    // Derived
    this._hostUrl    = null;
    this._hostInfo   = null; // { shop_id, shop_name, device_id, device_name, host_term, latency }
    this._errorCode  = null;

    this._keepaliveTimer = null;
    this._started        = false;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getState() {
    let cfg = {};
    try { cfg = this._loadConfig?.() || {}; } catch { /* */ }
    const isHost = !(cfg.mode === 'join' || cfg.role === 'replica' || cfg.role === 'client');
    return {
      host:     this._hostState,
      device:   this._deviceState,
      employee: this._employeeState,
      host_url: this._hostUrl,
      host_info: this._hostInfo ? {
        shop_id:     this._hostInfo.shop_id,
        shop_name:   this._hostInfo.shop_name,
        device_name: this._hostInfo.device_name,
        host_term:   this._hostInfo.host_term,
        latency_ms:  this._hostInfo.latency,
      } : null,
      error: this._errorCode,
      mode: cfg.mode || (isHost ? 'host' : 'join'),
      role: cfg.role || (isHost ? 'active_host' : 'replica'),
      is_host: isHost,
    };
  }

  /** Start connection flow. Called once after local backend is ready. */
  async start() {
    if (this._started) return;
    this._started = true;
    await this._run();
  }

  /** Manually retry after HOST_NOT_FOUND. */
  async retry() {
    this._stopKeepalive();
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    this._retryCount = 0;
    this._errorCode  = null;
    this._started    = false;
    await this.start();
  }

  /** Called from main.js when the local backend reports a host URL override. */
  setHostUrl(url) {
    if (url && url !== this._hostUrl) {
      this._hostUrl = url;
      this._saveConfig({ last_known_host_url: url });
    }
  }

  /** Called from main.js after successful Host approval / credential claim. */
  onPairingComplete({ shop_id, device_id, device_identifier, device_number, device_token }) {
    const identifier = device_identifier || device_id;
    this._deviceCredentials.save({
      shop_id,
      device_id: device_id || identifier,
      device_identifier: identifier,
      device_number,
      device_token: device_token || null,
      paired_at: new Date().toISOString(),
    });
    this._deviceId = identifier;
    this._shopId = shop_id || this._shopId;
    this._setDeviceState('paired');
  }

  /** Clear credentials after revoke. */
  onDeviceRevoked() {
    this._deviceCredentials.clear();
    this._setDeviceState('revoked');
  }

  /** Called from main.js when an employee signs in successfully. */
  onEmployeeSignedIn() {
    this._setEmployeeState('signed_in');
  }

  /** Called from main.js when an employee signs out. */
  onEmployeeSignedOut() {
    this._setEmployeeState('signed_out');
  }

  // ── State setters ──────────────────────────────────────────────────────────

  _setHostState(s)     { if (s !== this._hostState)     { this._hostState = s;     this._emit(); } }
  _setDeviceState(s)   { if (s !== this._deviceState)   { this._deviceState = s;   this._emit(); } }
  _setEmployeeState(s) { if (s !== this._employeeState) { this._employeeState = s; this._emit(); } }

  _emit() {
    this.emit('state', this.getState());
  }

  // ── Main flow ──────────────────────────────────────────────────────────────

  async _run() {
    const cfg   = this._loadConfig();
    const creds = this._deviceCredentials.load();

    // Determine expected shop identity
    this._shopId   = creds?.shop_id   || cfg.shop_id   || null;
    this._deviceId = creds?.device_identifier || creds?.device_id || cfg.device_id || null;

    if (!this._shopId) {
      // First run — no pairing info. Discover host then show pairing UI.
      this._setDeviceState('not_paired');
      this._setHostState('discovering');
      await this._discover();
      return;
    }

    // Returning device — try last known URL first
    const lastUrl = cfg.last_known_host_url;
    if (lastUrl) {
      this._setHostState('checking_last_known');
      const ok = await this._connectTo(lastUrl, { timeoutMs: 2500 });
      if (ok) return;
    }

    // Discovery fallback
    this._setHostState('discovering');
    await this._discover();
  }

  // ── Discovery ──────────────────────────────────────────────────────────────

  async _discover() {
    this._setHostState('discovering');
    const candidates = await this._udpDiscover({ timeoutMs: 6000 });

    if (!candidates.length) {
      this._errorCode = ERR.HOST_NOT_FOUND;
      this._setHostState('not_found');
      this._scheduleRetry();
      return;
    }

    this._setHostState('verifying');
    const winner = await this._verifyCandidates(candidates);

    if (!winner) {
      this._errorCode = ERR.HOST_UNREACHABLE;
      this._setHostState('not_found');
      this._scheduleRetry();
      return;
    }

    await this._onHostVerified(winner.url, winner.info);
  }

  /** Auto-retry discovery after not_found — backs off from 15s to 60s. */
  _scheduleRetry() {
    if (this._retryTimer) return; // already scheduled
    const delay = Math.min((this._retryCount || 0) * 15_000 + 15_000, 60_000);
    this._retryCount = (this._retryCount || 0) + 1;
    this._retryTimer = setTimeout(async () => {
      this._retryTimer = null;
      // Only retry if still in not_found — user might have manually triggered retry
      if (this._hostState === 'not_found') {
        await this._discover();
      }
    }, delay);
    this._retryTimer.unref?.();
  }

  // ── Verification ───────────────────────────────────────────────────────────

  /**
   * Probe all candidates in parallel, collect verified results, then select
   * the authoritative host by highest host_term (Raft leadership term).
   * Tie-break by lowest latency.
   */
  async _verifyCandidates(candidates) {
    const verified = [];

    await Promise.allSettled(candidates.map(async (c) => {
      const urls = buildCandidateUrls(c);
      for (const url of urls) {
        const info = await this._verifyUrl(url).catch(() => null);
        if (info) {
          verified.push({ url, info });
          break; // first passing URL for this candidate is enough
        }
      }
    }));

    if (!verified.length) return null;

    // Prefer same shop if we have a shopId (WRONG_SHOP candidates already null)
    const pool = this._shopId
      ? (verified.filter(v => v.info.shop_id === this._shopId).length
          ? verified.filter(v => v.info.shop_id === this._shopId)
          : verified)
      : verified;

    // Authoritative = highest host_term → tie-break lowest latency
    pool.sort((a, b) =>
      (b.info.host_term - a.info.host_term) || (a.info.latency - b.info.latency)
    );

    return pool[0];
  }

  /**
   * Verify a single URL by calling /api/health.
   * Returns host info on success, null on any failure.
   */
  async _verifyUrl(url, { timeoutMs = 2000 } = {}) {
    const t0  = Date.now();
    let res;
    try {
      res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      // ETIMEDOUT → timeout, ECONNREFUSED → unreachable — both null
      return null;
    }
    if (!res.ok) return null;

    const body = await res.json().catch(() => null);
    if (!body) return null;

    // Must be Jewellery CRM
    const svc = String(body.service || '');
    if (!svc.includes('ERP') && !svc.includes('CRM') && !svc.includes('Branch')) return null;

    // Must be active host with database ready
    if (body.role !== 'active_host') return null;
    if (!body.ready)                  return null;

    // Wrong shop — not an error we propagate here, just skip
    if (this._shopId && body.shop_id && body.shop_id !== this._shopId) return null;

    return {
      shop_id:     body.shop_id    || null,
      shop_name:   body.shop_name  || null,
      device_id:   body.device_id  || null,
      device_name: body.device_name || 'Owner PC',
      host_term:   body.cluster?.host_term ?? 0,
      schema_version: body.schema_version || null,
      latency:     Date.now() - t0,
    };
  }

  // ── Connect to a known URL ─────────────────────────────────────────────────

  async _connectTo(url, opts = {}) {
    try {
      const info = await this._verifyUrl(url, opts);
      if (info) {
        await this._onHostVerified(url, info);
        return true;
      }
    } catch { /* */ }
    return false;
  }

  // ── Host verified → update state ───────────────────────────────────────────

  async _onHostVerified(url, info) {
    this._hostUrl  = url;
    this._hostInfo = info;
    this._errorCode = null;
    // Clear retry backoff — we're connected now
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    this._retryCount = 0;
    this._setHostState('connected');

    // Persist verified URL and host identity for next startup
    this._saveConfig({
      last_known_host_url:       url,
      last_known_host_device_id: info.device_id,
      last_known_host_term:      info.host_term || 0,
    });

    // ── Device auth state ─────────────────────────────────────────────────
    this._setDeviceState('checking');
    const creds = this._deviceCredentials.load();

    try {
      // Prefer live Host authority over local credential alone
      const deviceIdentifier = this._deviceId
        || creds?.device_id
        || this._loadConfig()?.device_id
        || null;
      if (deviceIdentifier) {
        const statusRes = await fetch(
          `${url}/api/devices/join-status?device_identifier=${encodeURIComponent(deviceIdentifier)}`,
          { signal: AbortSignal.timeout(3500) },
        );
        if (statusRes.ok) {
          const st = await statusRes.json();
          if (st.status === 'revoked') {
            this._deviceCredentials.clear();
            this._setDeviceState('revoked');
            this._startKeepalive();
            return;
          }
          if (st.status === 'declined') {
            this._setDeviceState('not_paired');
            this._startKeepalive();
            return;
          }
          if (st.status === 'pending') {
            this._setDeviceState('not_paired');
            this._startKeepalive();
            return;
          }
          if (st.status === 'active' || st.status === 'approved') {
            // Host already allowed this PC — never send them back to approval.
            this._setDeviceState('paired');
            if (!creds?.shop_id || creds.shop_id !== info.shop_id) {
              this._deviceCredentials.save({
                shop_id: info.shop_id,
                device_id: st.device_id || deviceIdentifier,
                device_identifier: deviceIdentifier,
              });
            }
            this._startKeepalive();
            return;
          }
        }
      }
    } catch { /* fall through to credential check */ }

    if (creds?.shop_id && creds.shop_id === info.shop_id) {
      // Migration: existing paired clients remain APPROVED without re-approval
      this._setDeviceState('paired');
    } else if (this._shopId && this._shopId === info.shop_id) {
      this._setDeviceState('paired');
    } else {
      this._setDeviceState('not_paired');
    }

    this._startKeepalive();
  }

  // ── Keepalive ──────────────────────────────────────────────────────────────

  _startKeepalive() {
    this._stopKeepalive();
    let failures = 0;

    this._keepaliveTimer = setInterval(async () => {
      try {
        const headers = {};
        if (this._deviceId) headers['X-Device-Id'] = this._deviceId;
        // Prefer device heartbeat when paired — detects DEVICE_REVOKED
        const url = this._deviceId
          ? `${this._hostUrl}/api/devices/heartbeat`
          : `${this._hostUrl}/api/health`;
        const res = await fetch(url, {
          method: this._deviceId ? 'POST' : 'GET',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: this._deviceId ? JSON.stringify({ device_id: this._deviceId }) : undefined,
          signal: AbortSignal.timeout(3000),
        });
        if (res.status === 403) {
          const body = await res.json().catch(() => ({}));
          if (body?.code === 'DEVICE_REVOKED') {
            this._stopKeepalive();
            this._errorCode = ERR.DEVICE_REVOKED;
            // Clear credentials and cached host so the rejoin flow starts clean
            try { this._deviceCredentials?.clear?.(); } catch { /* */ }
            this._saveConfig({
              last_known_host_url:       null,
              last_known_host_device_id: null,
              last_known_host_term:      null,
            });
            this._deviceId = null;
            this._shopId   = null; // prevent in-memory shop match from auto-re-pairing
            this._setDeviceState('revoked');
            this._setHostState('not_found');
            return;
          }
        }
        if (res.ok) { failures = 0; return; }
      } catch { /* */ }

      failures++;
      if (failures >= 2) {
        this._stopKeepalive();
        this._setHostState('reconnecting');
        this._recover();
      }
    }, 12_000);

    this._keepaliveTimer.unref?.();
  }

  _stopKeepalive() {
    if (this._keepaliveTimer) {
      clearInterval(this._keepaliveTimer);
      this._keepaliveTimer = null;
    }
  }

  // ── Recovery after keepalive failure ──────────────────────────────────────

  async _recover() {
    const cfg = this._loadConfig();
    // Try cached URL first (may have just had a brief blip)
    const ok = await this._connectTo(cfg.last_known_host_url || this._hostUrl, { timeoutMs: 4000 });
    if (ok) return;
    // Full rediscovery
    await this._discover();
  }

  // ── UDP discovery ─────────────────────────────────────────────────────────

  /**
   * Send a broadcast probe and collect replies from active_host devices.
   * rinfo.address (actual UDP source) is stored as primary candidate address.
   */
  _udpDiscover({ timeoutMs = 4000 } = {}) {
    return new Promise((resolve) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      const found  = new Map(); // device_id → candidate

      const finish = () => {
        try { socket.close(); } catch { /* */ }
        resolve([...found.values()]);
      };

      const timer = setTimeout(finish, timeoutMs);

      socket.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString('utf8'));
          if (data?.magic !== MAGIC)            return;
          if (data.role    !== 'active_host')   return;
          if (data.join_ready)                  return;

          const key = data.device_id || `${rinfo.address}:${data.api_port}`;

          // Merge with any existing entry (multiple packets may arrive)
          const existing = found.get(key) || {};
          found.set(key, {
            device_id:           data.device_id  || existing.device_id,
            shop_id:             data.shop_id    || existing.shop_id,
            api_port:            data.api_port   || existing.api_port || 8080,
            device_name:         data.device_name || existing.device_name,
            rinfo_address:       rinfo.address,   // always update — latest packet wins
            secondary_addresses: filterSecondaryAddresses(data.addresses || [], rinfo.address),
            host_term:           data.host_term ?? existing.host_term ?? 0,
          });
        } catch { /* */ }
      });

      socket.bind(DISCOVERY_PORT, () => {
        try { socket.setBroadcast(true); } catch { /* */ }
        const probe = Buffer.from(
          JSON.stringify({ type: 'discover', magic: MAGIC }), 'utf8'
        );
        for (const bcast of subnetBroadcasts()) {
          socket.send(probe, DISCOVERY_PORT, bcast);
        }
      });

      socket.on('error', () => {
        clearTimeout(timer);
        finish();
      });
    });
  }
}

module.exports = { HostConnector, ERR };
