/**
 * Durable ordered event log + operation idempotency ledger.
 */
import { EventLog, OperationLedger, ReplicaAck } from '../models/index.js';
import { newId } from '../utils.js';
import { ensureClusterState } from './clusterService.js';
import { broadcast } from './wsServer.js';
import sequelize from '../db.js';

const CRITICAL_TYPES = new Set([
  'INVOICE_CREATED',
  'INVOICE_VOIDED',
  'PAYMENT_RECEIVED',
  'ITEM_SOLD',
  'STOCK_ADJUSTED',
  'REFUND_CREATED',
  'RETURN_CREATED',
  'SCHEME_PAYMENT',
]);

export function isCriticalEventType(eventType) {
  return CRITICAL_TYPES.has(eventType);
}

/**
 * Append event in the same Sequelize transaction as the business COMMIT.
 */
export async function appendEventLog({
  eventType,
  entityType = null,
  entityId = null,
  operationId = null,
  payload = {},
  originDeviceId = null,
  userId = null,
  critical = null,
  transaction,
}) {
  if (!transaction) throw new Error('appendEventLog requires transaction');
  const cluster = await ensureClusterState();
  if (!cluster) return null; // cloud / uninitialized — skip LAN event log

  const [[row]] = await sequelize.query(
    `SELECT COALESCE(MAX(seq), 0) AS max_seq FROM event_log WHERE shop_id = :shopId`,
    { replacements: { shopId: cluster.shop_id }, transaction }
  );
  const nextSeq = Number(row?.max_seq || 0) + 1;
  const isCritical = critical == null ? isCriticalEventType(eventType) : Boolean(critical);

  const event = await EventLog.create({
    id: newId(),
    seq: nextSeq,
    shop_id: cluster.shop_id,
    host_term: cluster.host_term,
    event_type: eventType,
    entity_type: entityType,
    entity_id: entityId,
    operation_id: operationId,
    origin_device_id: originDeviceId || cluster.node_id,
    user_id: userId,
    critical: isCritical,
    payload,
  }, { transaction });

  await cluster.update({ event_watermark: nextSeq }, { transaction });
  try { broadcast({ type: 'sync', seq: nextSeq }); } catch { /* ws not available */ }
  return event;
}

export async function findOperation(operationId) {
  if (!operationId) return null;
  try {
    return await OperationLedger.findByPk(operationId);
  } catch {
    return null; // table may not exist until migration
  }
}

export async function recordOperation({
  operationId,
  operationType,
  entityType = null,
  entityId = null,
  result = {},
  deviceId = null,
  userId = null,
  transaction,
}) {
  if (!operationId) return null;
  const cluster = await ensureClusterState();
  if (!cluster) return null;
  try {
    return await OperationLedger.create({
      operation_id: operationId,
      shop_id: cluster.shop_id,
      operation_type: operationType,
      entity_type: entityType,
      entity_id: entityId,
      host_term: cluster.host_term,
      result,
      device_id: deviceId,
      user_id: userId,
    }, { transaction });
  } catch (err) {
    console.warn('recordOperation skipped:', err.message);
    return null;
  }
}

export async function getEventsAfter(shopId, afterSeq, { limit = 200 } = {}) {
  const { Op } = await import('sequelize');
  return EventLog.findAll({
    where: {
      shop_id: shopId,
      seq: { [Op.gt]: Number(afterSeq) || 0 },
    },
    order: [['seq', 'ASC']],
    limit: Math.min(Number(limit) || 200, 1000),
  });
}

export async function recordReplicaAck({ shopId, eventSeq, deviceId }) {
  const existing = await ReplicaAck.findOne({
    where: { shop_id: shopId, event_seq: eventSeq, device_id: deviceId },
  });
  if (existing) return existing;
  return ReplicaAck.create({
    id: newId(),
    shop_id: shopId,
    event_seq: eventSeq,
    device_id: deviceId,
    acked_at: new Date(),
  });
}

export async function countReplicaAcks(shopId, eventSeq) {
  return ReplicaAck.count({ where: { shop_id: shopId, event_seq: eventSeq } });
}

/**
 * Wait briefly for at least one replica ACK on a critical event.
 * Returns { acked, replica_count, warning }.
 */
export async function awaitCriticalReplicaAck(shopId, eventSeq, {
  timeoutMs = 2500,
  pollMs = 200,
} = {}) {
  const { Device } = await import('../models/index.js');
  const { Op } = await import('sequelize');
  const { ensureClusterState: ensure } = await import('./clusterService.js');
  const cluster = await ensure();
  const replicas = await Device.count({
    where: {
      shop_id: shopId,
      status: 'active',
      role: { [Op.in]: ['client', 'recovery', 'replica'] },
    },
  });
  const onlineReplicas = Math.max(0, replicas);

  if (onlineReplicas === 0) {
    return {
      acked: false,
      replica_count: 0,
      warning: 'Running without replica protection — prioritize a local encrypted backup.',
    };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const n = await countReplicaAcks(shopId, eventSeq);
    if (n >= 1) {
      return { acked: true, replica_count: n, warning: null };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return {
    acked: false,
    replica_count: 0,
    warning: 'Replica ACK timeout — sale committed on host; replicas may catch up shortly.',
    host_term: cluster?.host_term,
  };
}
