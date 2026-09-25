/**
 * Hash-chained audit trail.
 */
import crypto from 'crypto';
import { AuditEvent } from '../models/index.js';
import { ensureClusterState } from './clusterService.js';
import { newId } from '../utils.js';
import sequelize from '../db.js';

function computeHash({ previousHash, seq, shopId, action, entityId, payload }) {
  const body = JSON.stringify({
    previousHash: previousHash || '',
    seq,
    shopId,
    action,
    entityId: entityId || '',
    payload,
  });
  return crypto.createHash('sha256').update(body).digest('hex');
}

export async function appendAuditEvent({
  eventType,
  action,
  entityType = null,
  entityId = null,
  userId = null,
  deviceId = null,
  oldValue = null,
  newValue = null,
  reason = null,
  transaction = null,
}) {
  const cluster = await ensureClusterState();
  const shopId = cluster?.shop_id;
  if (!shopId) return null;

  const run = async (t) => {
    const [[row]] = await sequelize.query(
      `SELECT COALESCE(MAX(seq), 0) AS max_seq, (
         SELECT hash FROM audit_events WHERE shop_id = :shopId ORDER BY seq DESC LIMIT 1
       ) AS prev_hash
       FROM audit_events WHERE shop_id = :shopId`,
      { replacements: { shopId }, transaction: t }
    );
    const seq = Number(row?.max_seq || 0) + 1;
    const previousHash = row?.prev_hash || null;
    const hash = computeHash({
      previousHash,
      seq,
      shopId,
      action,
      entityId,
      payload: { oldValue, newValue, reason, eventType },
    });

    return AuditEvent.create({
      id: newId(),
      seq,
      shop_id: shopId,
      event_type: eventType,
      entity_type: entityType,
      entity_id: entityId,
      user_id: userId,
      device_id: deviceId || cluster?.node_id,
      host_term: cluster?.host_term,
      action,
      old_value: oldValue,
      new_value: newValue,
      reason,
      previous_hash: previousHash,
      hash,
    }, { transaction: t });
  };

  if (transaction) return run(transaction);
  return sequelize.transaction(run);
}

export async function verifyAuditChain(shopId, { limit = 5000 } = {}) {
  const rows = await AuditEvent.findAll({
    where: { shop_id: shopId },
    order: [['seq', 'ASC']],
    limit,
  });
  let prev = null;
  for (const r of rows) {
    if ((r.previous_hash || null) !== prev) {
      return { ok: false, broken_at: r.seq, detail: 'previous_hash mismatch' };
    }
    const expected = computeHash({
      previousHash: r.previous_hash,
      seq: Number(r.seq),
      shopId: r.shop_id,
      action: r.action,
      entityId: r.entity_id,
      payload: {
        oldValue: r.old_value,
        newValue: r.new_value,
        reason: r.reason,
        eventType: r.event_type,
      },
    });
    if (expected !== r.hash) {
      return { ok: false, broken_at: r.seq, detail: 'hash mismatch' };
    }
    prev = r.hash;
  }
  return { ok: true, checked: rows.length };
}

export async function listAuditEvents({
  shopId,
  limit = 50,
  offset = 0,
  entityType = null,
  action = null,
} = {}) {
  const where = {};
  if (shopId) where.shop_id = shopId;
  if (entityType) where.entity_type = entityType;
  if (action) where.action = action;
  const { rows, count } = await AuditEvent.findAndCountAll({
    where,
    order: [['seq', 'DESC']],
    limit: Math.min(Number(limit) || 50, 200),
    offset: Number(offset) || 0,
  });
  return { total: count, data: rows };
}
