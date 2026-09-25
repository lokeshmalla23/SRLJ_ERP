'use strict';
/**
 * Authority State Machine — production desktop behaviour
 *
 * Local Branch Service is the source of truth for billing.
 * "Cloud" optional URL is for remote sync only — its failure must NOT
 * block POS when the local Branch is healthy.
 *
 * States:
 *   CLOUD_COORDINATED — local Branch (or optional remote) health OK
 *   LAN_COORDINATED   — local Branch down, but LAN peer coordinator reachable
 *   ISOLATED          — neither local Branch nor LAN available
 */

const { EventEmitter } = require('events');

const STATES = Object.freeze({
  CLOUD_COORDINATED: 'CLOUD_COORDINATED',
  LAN_COORDINATED:   'LAN_COORDINATED',
  ISOLATED:          'ISOLATED',
  UNKNOWN:           'UNKNOWN',
});

const PROBE_INTERVAL_MS = 10_000;
const LOCAL_TIMEOUT_MS  = 3_000;
const CLOUD_TIMEOUT_MS  = 4_000;
const LAN_TIMEOUT_MS    = 2_000;

class AuthorityStateMachine extends EventEmitter {
  constructor() {
    super();
    this._state       = STATES.UNKNOWN;
    this._db          = null;
    this._localUrl    = 'http://127.0.0.1:8080';
    this._cloudUrl    = null;   // optional remote (Neon/API) — never required for billing
    this._lanPeers    = [];
    this._timer       = null;
    this._shopId      = null;
    this._deviceId    = null;
    this._cloudOk     = false;
    this._localOk     = false;
    this._lanOk       = false;
    this._lastProbe   = null;
    this._coordinator = null;
    // Join-mode PC: set when hostConnector verifies the LAN host
    this._joinHostUrl       = null;
    this._joinHostConnected = false;
  }

  /**
   * @param {{ db, localUrl?: string, cloudUrl?: string|null, shopId?: string|null, deviceId?: string|null }} opts
   */
  init({ db, localUrl, cloudUrl, shopId, deviceId }) {
    this._db       = db;
    this._localUrl = (localUrl || 'http://127.0.0.1:8080').replace(/\/$/, '');
    // Only treat as remote cloud if it is NOT the same as local Branch
    const rawCloud = cloudUrl ? String(cloudUrl).replace(/\/$/, '') : null;
    this._cloudUrl = (rawCloud && rawCloud !== this._localUrl) ? rawCloud : null;
    this._shopId   = shopId   || null;
    this._deviceId = deviceId || null;

    this._ensureTable();
    this._restoreState();
    this._scheduleProbe();
  }

  /** Call when embedded backend becomes ready so we don't stay Isolated. */
  notifyBackendReady(port) {
    if (port) this._localUrl = `http://127.0.0.1:${port}`;
    this._probe().catch(() => {});
  }

  /**
   * Call from main.js when hostConnector reports connected/disconnected on a join PC.
   * Allows authority state to report LAN_COORDINATED when the LAN host is reachable.
   */
  notifyJoinHostState(connected, hostUrl = null) {
    this._joinHostConnected = Boolean(connected);
    this._joinHostUrl = connected && hostUrl ? String(hostUrl).replace(/\/$/, '') : null;
    this._probe().catch(() => {});
  }

  getState() {
    return this._state;
  }

  getDetail() {
    return {
      state:       this._state,
      localOk:     this._localOk,
      cloudOk:     this._cloudOk,
      lanOk:       this._lanOk,
      lastProbe:   this._lastProbe,
      coordinator: this._coordinator,
      peers:       this._lanPeers.length,
    };
  }

  updateLanPeers(peers) {
    this._lanPeers = Array.isArray(peers) ? peers : [];
  }

  /**
   * Billing gate. Local Branch healthy ⇒ always allow (single-shop desktop).
   * Isolated ⇒ all sales saved as Draft Sale (no live billing).
   */
  canTransact(txType = 'any') {
    const state = this._state;

    if (state === STATES.CLOUD_COORDINATED || state === STATES.LAN_COORDINATED) {
      return { allowed: true, state };
    }

    if (state === STATES.ISOLATED) {
      return {
        allowed: false,
        draft: true,
        state,
        reason: 'Host offline — sale saved as draft',
      };
    }

    return {
      allowed: false,
      state,
      reason: 'Checking connection status... Please wait a moment and try again.',
    };
  }

  shutdown() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _ensureTable() {
    if (!this._db) return;
    const hasIdCol = this._db.prepare(
      `SELECT 1 FROM pragma_table_info('coordination_state') WHERE name = 'id'`
    ).get();
    if (!hasIdCol) {
      this._db.exec(`DROP TABLE IF EXISTS coordination_state`);
    }
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS coordination_state (
        id          TEXT PRIMARY KEY DEFAULT 'singleton',
        state       TEXT NOT NULL DEFAULT 'UNKNOWN',
        cloud_ok    INTEGER NOT NULL DEFAULT 0,
        lan_ok      INTEGER NOT NULL DEFAULT 0,
        coordinator TEXT,
        last_probe  TEXT,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this._db.prepare(`
      INSERT OR IGNORE INTO coordination_state (id, state) VALUES ('singleton', 'UNKNOWN')
    `).run();
  }

  _restoreState() {
    if (!this._db) return;
    const row = this._db.prepare(
      `SELECT state, cloud_ok, lan_ok, coordinator, last_probe FROM coordination_state WHERE id = 'singleton'`
    ).get();
    if (row) {
      this._cloudOk     = Boolean(row.cloud_ok);
      this._lanOk       = Boolean(row.lan_ok);
      this._lastProbe   = row.last_probe;
      this._coordinator = row.coordinator ? JSON.parse(row.coordinator) : null;
      this._state = STATES.UNKNOWN;
    }
  }

  _persistState() {
    if (!this._db) return;
    this._db.prepare(`
      UPDATE coordination_state SET
        state       = ?,
        cloud_ok    = ?,
        lan_ok      = ?,
        coordinator = ?,
        last_probe  = ?,
        updated_at  = datetime('now')
      WHERE id = 'singleton'
    `).run(
      this._state,
      this._cloudOk ? 1 : 0,
      this._lanOk   ? 1 : 0,
      this._coordinator ? JSON.stringify(this._coordinator) : null,
      this._lastProbe,
    );
  }

  _scheduleProbe() {
    this._probe().catch(() => {});
    this._timer = setInterval(() => {
      this._probe().catch(() => {});
    }, PROBE_INTERVAL_MS);
    this._timer.unref?.();
  }

  async _probe() {
    const [localOk, remoteOk, lanResult, joinHostOk] = await Promise.all([
      this._probeUrl(this._localUrl, LOCAL_TIMEOUT_MS),
      this._cloudUrl ? this._probeUrl(this._cloudUrl, CLOUD_TIMEOUT_MS) : Promise.resolve(false),
      this._probeLan(),
      this._joinHostUrl ? this._probeUrl(this._joinHostUrl, LOCAL_TIMEOUT_MS).catch(() => false) : Promise.resolve(false),
    ]);

    this._localOk     = localOk;
    this._cloudOk     = remoteOk || localOk;
    this._lanOk       = lanResult.ok || joinHostOk;
    this._coordinator = lanResult.coordinator || null;
    this._lastProbe   = new Date().toISOString();

    let newState;
    if (localOk || remoteOk) {
      newState = STATES.CLOUD_COORDINATED;
    } else if (lanResult.ok || joinHostOk) {
      newState = STATES.LAN_COORDINATED;
    } else {
      newState = STATES.ISOLATED;
    }

    const changed = newState !== this._state;
    this._state = newState;
    this._persistState();

    if (changed) {
      this.emit('stateChange', { state: newState, detail: this.getDetail() });
    }
  }

  async _probeUrl(baseUrl, timeoutMs) {
    if (!baseUrl) return false;
    try {
      const res = await fetch(
        `${baseUrl}/api/health`,
        { signal: AbortSignal.timeout(timeoutMs) },
      );
      if (!res.ok) return false;
      const data = await res.json().catch(() => ({}));
      // Prefer ready/billing when present; fall back to legacy status/service
      if (data?.ready === false) return false;
      if (data?.billing_allowed === false) return false;
      return Boolean(data?.status === 'ok' || data?.service || data?.ready === true);
    } catch {
      return false;
    }
  }

  async _probeLan() {
    if (!this._lanPeers || this._lanPeers.length === 0) {
      return { ok: false };
    }
    for (const peer of this._lanPeers) {
      try {
        // LAN authority server only exposes POST /api/lan/health
        const res = await fetch(
          `${peer.url}/api/lan/health`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            signal: AbortSignal.timeout(LAN_TIMEOUT_MS),
          },
        );
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data?.ok === false) continue;
          return {
            ok: true,
            coordinator: {
              url:      peer.url,
              deviceId: peer.deviceId || data?.coordinator,
              epoch:    data?.epoch || 1,
            },
          };
        }
      } catch {
        // try next peer
      }
    }
    return { ok: false };
  }
}

const authorityState = new AuthorityStateMachine();

module.exports = { authorityState, STATES };
