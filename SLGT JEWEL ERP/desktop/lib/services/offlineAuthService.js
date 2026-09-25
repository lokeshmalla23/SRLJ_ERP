'use strict';
/**
 * Offline authentication service.
 *
 * When the cloud API is unreachable, the desktop app falls back to locally-cached
 * user credentials stored in the SQLite `users` table. Password hashes are
 * bcrypt-compatible and validated with the `bcryptjs` library (pure-JS, no native build).
 *
 * Cache policy:
 * - On every successful online login, the cloud pushes the user's hashed credential
 *   to this device via the sync channel (or via explicit cache-on-login IPC).
 * - Cached credentials are valid for OFFLINE_TTL_HOURS after the last successful
 *   online login recorded in `users.updated_at`.
 * - Disabled / inactive users are always rejected even offline.
 * - After a successful offline login the result is marked in the audit log.
 */

const bcrypt = require('bcryptjs');

  const OFFLINE_TTL_HOURS = 720; // 30 days — revalidated on successful online login

/**
 * Cache a user credential after successful online login.
 * Called by the IPC handler after the cloud returns a valid session.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ id, shop_id, email, name, role, permissions, active, password_hash }} userObj
 */
function cacheCredential(db, userObj) {
  if (!db || !userObj?.id) return;
  try {
    db.prepare(`
      INSERT INTO users
        (id, shop_id, email, name, role, permissions, active, password_hash, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        email           = excluded.email,
        name            = excluded.name,
        role            = excluded.role,
        permissions = excluded.permissions,
        active          = excluded.active,
        password_hash   = excluded.password_hash,
        updated_at      = datetime('now')
    `).run(
      userObj.id,
      userObj.shop_id || null,
      (userObj.email || '').toLowerCase().trim(),
      userObj.name || '',
      userObj.role || 'staff',
      JSON.stringify(userObj.permissions || {}),
      userObj.active ? 1 : 0,
      userObj.password_hash || null,
    );
  } catch (err) {
    console.error('[offlineAuth] cacheCredential failed:', err.message);
  }
}

/**
 * Attempt offline login using cached SQLite credentials.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} email
 * @param {string} password
 * @returns {{ ok: true, user: object, offlineMode: true } | { ok: false, reason: string }}
 */
async function loginOffline(db, email, password) {
  if (!db)       return { ok: false, reason: 'Local database not ready' };
  if (!email)    return { ok: false, reason: 'Email required' };
  if (!password) return { ok: false, reason: 'Password required' };

  let row;
  try {
    row = db.prepare(
      'SELECT * FROM users WHERE email = ? COLLATE NOCASE'
    ).get(email.toLowerCase().trim());
  } catch (err) {
    return { ok: false, reason: 'Credential lookup failed' };
  }

  if (!row) return { ok: false, reason: 'Invalid email or password' };
  if (!row.active) return { ok: false, reason: 'Account is inactive' };
  if (!row.password_hash) return { ok: false, reason: 'No offline credential cached — please connect to the network and log in once first' };

  // Check staleness
  if (row.updated_at) {
    const cachedAt = new Date(row.updated_at + 'Z').getTime();
    const ageHours = (Date.now() - cachedAt) / (1000 * 60 * 60);
    if (ageHours > OFFLINE_TTL_HOURS) {
      return {
        ok: false,
        reason: `Offline credential expired (last online login was ${Math.round(ageHours)} hours ago). Please reconnect and log in to re-validate.`,
      };
    }
  }

  let valid;
  try {
    valid = await bcrypt.compare(password, row.password_hash);
  } catch {
    return { ok: false, reason: 'Credential verification failed' };
  }

  if (!valid) return { ok: false, reason: 'Invalid email or password' };

  let permissions;
  try { permissions = JSON.parse(row.permissions || '{}'); } catch { permissions = {}; }

  return {
    ok: true,
    offlineMode: true,
    user: {
      id:          row.id,
      shop_id:     row.shop_id,
      email:       row.email,
      name:        row.name,
      role:        row.role,
      permissions,
      active:      Boolean(row.active),
    },
  };
}

module.exports = { cacheCredential, loginOffline, OFFLINE_TTL_HOURS };
