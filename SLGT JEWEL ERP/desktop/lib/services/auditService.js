'use strict';
/**
 * Append-only audit log writer.
 * Writes to local SQLite audit_events table. Failures are logged but never thrown —
 * an audit failure must never block a business operation.
 *
 * Usage:
 *   audit.log(db, { action, entityType, entityId, userId, reason, meta })
 *   audit.log(db, { action: 'invoice.create', entityType: 'invoice', entityId: inv.id, userId: user.id })
 */

const { randomUUID } = require('crypto');

let _deviceId = null;
let _shopId   = null;

function init({ deviceId, shopId }) {
  _deviceId = deviceId || null;
  _shopId   = shopId   || null;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} opts
 * @param {string}  opts.action       — e.g. 'invoice.create', 'auth.login', 'product.update'
 * @param {string} [opts.entityType]  — e.g. 'invoice', 'product', 'user'
 * @param {string} [opts.entityId]
 * @param {string} [opts.userId]
 * @param {string} [opts.requestId]
 * @param {string} [opts.reason]      — operator-supplied reason for void/adjustment
 * @param {object} [opts.meta]        — arbitrary extra context (will be JSON-stringified)
 */
function log(db, {
  action,
  entityType = null,
  entityId   = null,
  userId     = null,
  requestId  = null,
  reason     = null,
  meta       = {},
} = {}) {
  if (!db || !action) return;
  try {
    const backendShape = db.prepare(
      `SELECT 1 FROM pragma_table_info('audit_events') WHERE name = 'seq'`,
    ).get();
    if (backendShape) return;

    // Prefer schema with request_id; fall back if older SQLite DBs lack the column.
    try {
      db.prepare(`
        INSERT INTO audit_events
          (id, shop_id, device_id, user_id, action, entity_type, entity_id,
           request_id, reason, metadata_json, created_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        randomUUID(),
        _shopId,
        _deviceId,
        userId,
        action,
        entityType,
        entityId,
        requestId,
        reason,
        JSON.stringify(meta),
      );
    } catch (colErr) {
      if (!String(colErr.message || '').includes('request_id') && !String(colErr.message || '').includes('metadata_json')) {
        throw colErr;
      }
      try {
        db.prepare(`
          INSERT INTO audit_events
            (id, shop_id, device_id, user_id, action, entity_type, entity_id,
             reason, metadata_json, created_at)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          randomUUID(),
          _shopId,
          _deviceId,
          userId,
          action,
          entityType,
          entityId,
          reason,
          JSON.stringify({ ...meta, request_id: requestId || undefined }),
        );
      } catch (legacyErr) {
        // Shared SQLite may be the backend audit_events shape (seq/hash, no metadata_json).
        if (!String(legacyErr.message || '').includes('no column named')) throw legacyErr;
        db.prepare(`
          INSERT INTO audit_events
            (id, shop_id, device_id, user_id, action, entity_type, entity_id, reason, created_at)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          randomUUID(),
          _shopId,
          _deviceId,
          userId,
          action,
          entityType,
          entityId,
          reason,
        );
      }
    }
  } catch (err) {
    console.warn('[auditService] Failed to write audit event:', action, err.message);
  }
}

/**
 * Query recent audit events (for the system health screen).
 * @param {import('better-sqlite3').Database} db
 * @param {{ limit?: number, action?: string, entityType?: string, entityId?: string }} opts
 */
function query(db, { limit = 100, action, entityType, entityId } = {}) {
  if (!db) return [];
  try {
    const conditions = [];
    const params     = [];
    if (action)     { conditions.push("action = ?");      params.push(action);     }
    if (entityType) { conditions.push("entity_type = ?"); params.push(entityType); }
    if (entityId)   { conditions.push("entity_id = ?");   params.push(entityId);   }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return db.prepare(`
      SELECT * FROM audit_events ${where}
      ORDER BY created_at DESC LIMIT ?
    `).all(...params, limit);
  } catch (err) {
    console.error('[auditService] query failed:', err.message);
    return [];
  }
}

module.exports = { init, log, query };
