/**
 * LAN replica catch-up: pull event_log from HOST, apply on LOCAL replica API, ACK critical to host.
 * WebSocket push: host sends { type: 'sync', seq } → client calls tick() immediately.
 * Falls back to 15s polling when WebSocket is disconnected; 60s verification when connected.
 */
const WebSocket = require('ws');

class LanReplicaSync {
  constructor() {
    this._timer = null;
    this._ws = null;
    this._wsConnected = false;
    this._wsReconnectTimer = null;
    this._hostUrl = null;
    this._localUrl = null;
    this._watermark = 0;
  }

  init({ hostUrl, localUrl, getToken, getWatermark, setWatermark }) {
    this._hostUrl = hostUrl;
    this._localUrl = localUrl || 'http://127.0.0.1:8080';
    this._getToken = getToken;
    this._getWatermark = getWatermark;
    this._setWatermark = setWatermark;
  }

  start(intervalMs = 15000) {
    this.stop();
    this._connectWebSocket();
    this._scheduleInterval();
    this.tick().catch(() => {});
  }

  _scheduleInterval() {
    if (this._timer) clearInterval(this._timer);
    const ms = this._wsConnected ? 60000 : 15000;
    this._timer = setInterval(() => {
      this.tick().catch((e) => console.warn('[lanReplicaSync]', e.message));
    }, ms);
  }

  _connectWebSocket() {
    if (!this._hostUrl) return;
    if (this._wsReconnectTimer) {
      clearTimeout(this._wsReconnectTimer);
      this._wsReconnectTimer = null;
    }
    const wsUrl = this._hostUrl.replace(/^https?:\/\//, (m) => m.startsWith('https') ? 'wss://' : 'ws://').replace(/\/$/, '') + '/ws';
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      console.warn('[lanReplicaSync] ws connect error:', e.message);
      this._scheduleReconnect();
      return;
    }
    this._ws = ws;

    ws.on('open', () => {
      this._wsConnected = true;
      console.log('[lanReplicaSync] WebSocket connected', wsUrl);
      this._scheduleInterval();
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'sync') {
          this.tick().catch((e) => console.warn('[lanReplicaSync] tick error:', e.message));
        }
      } catch { /* ignore malformed */ }
    });

    ws.on('close', () => {
      this._wsConnected = false;
      this._ws = null;
      console.warn('[lanReplicaSync] WebSocket disconnected — falling back to 15s polling');
      this._scheduleInterval();
      this._scheduleReconnect();
    });

    ws.on('error', (e) => {
      console.warn('[lanReplicaSync] WebSocket error:', e.message);
    });
  }

  _scheduleReconnect() {
    if (this._wsReconnectTimer) return;
    this._wsReconnectTimer = setTimeout(() => {
      this._wsReconnectTimer = null;
      if (this._hostUrl) this._connectWebSocket();
    }, 5000);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    if (this._wsReconnectTimer) clearTimeout(this._wsReconnectTimer);
    this._wsReconnectTimer = null;
    if (this._ws) {
      this._ws.removeAllListeners();
      try { this._ws.close(); } catch { /* */ }
      this._ws = null;
    }
    this._wsConnected = false;
  }

  async tick() {
    if (!this._hostUrl || !this._getToken) return;
    const token = await this._getToken();
    if (!token || token === '__offline__' || String(token).startsWith('offline.')) return;

    const after = this._getWatermark ? Number(this._getWatermark() || 0) : this._watermark;
    const host = this._hostUrl.replace(/\/$/, '');
    const local = this._localUrl.replace(/\/$/, '');

    const res = await fetch(`${host}/api/cluster/events?after_seq=${after}&limit=200`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`pull events HTTP ${res.status}`);
    const data = await res.json();
    if (!data.events?.length) return;

    // Apply on LOCAL replica service (domain upsert)
    const applyRes = await fetch(`${local}/api/cluster/events/apply`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        events: data.events,
        host_id: data.host_id,
        host_term: data.host_term,
      }),
    });
    if (!applyRes.ok) throw new Error(`apply events HTTP ${applyRes.status}`);
    const applied = await applyRes.json();

    // ACK critical seqs to HOST so host sale ACK wait can complete
    if (applied.critical_seqs?.length) {
      await fetch(`${host}/api/cluster/events/ack`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ seqs: applied.critical_seqs }),
      }).catch(() => {});
    }

    this._watermark = applied.watermark || data.latest_seq;
    if (this._setWatermark) this._setWatermark(this._watermark);
    if (applied.applied > 0) {
      console.log(`[lanReplicaSync] applied ${applied.applied} → watermark ${this._watermark}`);
    }

    await this._promotePendingDrafts().catch((e) => {
      console.warn('[lanReplicaSync] draft promotion error:', e.message);
    });
  }

  async _promotePendingDrafts() {
    if (!this._getToken) return;
    const token = await this._getToken();
    if (!token || token === '__offline__' || String(token).startsWith('offline.')) return;

    const local = (this._localUrl || 'http://127.0.0.1:8080').replace(/\/$/, '');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const listRes = await fetch(`${local}/api/draft-sales`, { headers });
    if (!listRes.ok) return;

    const drafts = await listRes.json();
    const pending = Array.isArray(drafts) ? drafts.filter((d) => d.status === 'pending') : [];

    for (const draft of pending) {
      try {
        const promoteRes = await fetch(`${local}/api/draft-sales/${draft.id}/promote`, {
          method: 'POST',
          headers,
          body: JSON.stringify({}),
        });
        const body = await promoteRes.json().catch(() => ({}));
        if (promoteRes.ok) {
          console.log(`[lanReplicaSync] draft ${draft.id} promoted → invoice ${body.invoice?.invoice_no || body.invoice?.id}`);
        } else {
          console.warn(`[lanReplicaSync] draft ${draft.id} conflict: ${body.conflict_reason || body.detail}`);
        }
      } catch (e) {
        console.warn(`[lanReplicaSync] draft ${draft.id} promote error:`, e.message);
      }
    }
  }
}

module.exports = { LanReplicaSync };
