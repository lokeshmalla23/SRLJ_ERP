'use strict';
/**
 * Desktop authority client — wraps unique-tag pre-commit reservation against the cloud API.
 *
 * Usage:
 *   const { granted, leaseId, cleanup } = await authorityClient.acquire({ entityId, requestId });
 *   if (!granted) throw new Error(reason);
 *   try {
 *     // ...SQLite commit...
 *     await authorityClient.commit(leaseId);
 *   } catch {
 *     await cleanup(); // release lease on failure
 *     throw;
 *   }
 */

let _cloudUrl  = null;
let _shopId    = null;
let _deviceId  = null;
let _authToken = null;

function init({ cloudUrl, shopId, deviceId, getAuthToken }) {
  _cloudUrl     = cloudUrl   || null;
  _shopId       = shopId     || null;
  _deviceId     = deviceId   || null;
  _getAuthToken = getAuthToken || (() => _authToken);
}

function setAuthToken(token) {
  _authToken = token;
}

let _getAuthToken = () => _authToken;

async function _post(path, body) {
  if (!_cloudUrl) throw new Error('Cloud URL not configured');
  const token = _getAuthToken();
  const res = await fetch(`${_cloudUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/**
 * Acquire an exclusive lease for a unique-tag entity.
 * Returns { granted, leaseId, expiresAt, reason, cleanup }
 *
 * `cleanup` must be called on any error path to release the lease.
 */
async function acquire({ entityType = 'product', entityId, requestId, deviceId }) {
  if (!_cloudUrl) {
    return { granted: false, reason: 'Cloud not configured — cannot acquire authority' };
  }

  let leaseId;
  const cleanup = async () => {
    if (leaseId) {
      await release(leaseId).catch((e) => console.warn('[authorityClient] release failed:', e.message));
    }
  };

  try {
    const { ok, data } = await _post('/api/authority/reserve', {
      entity_type: entityType,
      entity_id:   entityId,
      request_id:  requestId,
      device_id:   deviceId || _deviceId,
    });

    if (!ok || !data.granted) {
      return {
        granted: false,
        reason:  data.reason || data.detail || 'Reservation rejected by cloud',
        code:    data.code   || 'REJECTED',
        cleanup: async () => {},
      };
    }

    leaseId = data.lease_id;
    return {
      granted:   true,
      leaseId,
      expiresAt: data.expires_at,
      cleanup,
    };
  } catch (err) {
    return {
      granted: false,
      reason:  `Cloud authority unreachable: ${err.message}`,
      code:    'CLOUD_UNREACHABLE',
      cleanup: async () => {},
    };
  }
}

/**
 * Mark a lease as committed after the SQLite write has succeeded.
 */
async function commit(leaseId) {
  if (!leaseId || !_cloudUrl) return;
  try {
    await _post('/api/authority/commit', { lease_id: leaseId });
  } catch (err) {
    console.warn('[authorityClient] commit failed (non-fatal):', err.message);
  }
}

/**
 * Release a lease (on cancel, crash, or error).
 */
async function release(leaseId) {
  if (!leaseId || !_cloudUrl) return;
  try {
    await _post('/api/authority/release', { lease_id: leaseId });
  } catch (err) {
    console.warn('[authorityClient] release failed (non-fatal):', err.message);
  }
}

module.exports = { init, setAuthToken, acquire, commit, release };
