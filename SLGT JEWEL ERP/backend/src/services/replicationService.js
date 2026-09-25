/**
 * LAN replication: pull events after watermark, apply on replicas, ACK critical.
 */
import { EventLog } from '../models/index.js';
import { ensureClusterState, getClusterPublicStatus, observePeerHostTerm } from './clusterService.js';
import { recordReplicaAck } from './eventLogService.js';
import { applyDomainEvent } from './domainEventApply.js';
import sequelize from '../db.js';
import { Op } from 'sequelize';

export async function pullEventsForReplica({ afterSeq = 0, limit = 200, peerHostTerm = null, peerHostId = null } = {}) {
  const cluster = await ensureClusterState();
  if (!cluster) throw Object.assign(new Error('Cluster not ready'), { status: 503 });

  if (peerHostTerm != null) {
    await observePeerHostTerm({ hostId: peerHostId, hostTerm: peerHostTerm });
  }

  const events = await EventLog.findAll({
    where: {
      shop_id: cluster.shop_id,
      seq: { [Op.gt]: Number(afterSeq) || 0 },
    },
    order: [['seq', 'ASC']],
    limit: Math.min(Number(limit) || 200, 1000),
  });

  return {
    shop_id: cluster.shop_id,
    host_id: cluster.host_id,
    host_term: cluster.host_term,
    events: events.map((e) => e.toJSON()),
    latest_seq: events.length
      ? Number(events[events.length - 1].seq)
      : Number(cluster.event_watermark || 0),
  };
}

export async function ackEvents({ deviceId, seqs = [] }) {
  const cluster = await ensureClusterState();
  if (!cluster) throw Object.assign(new Error('Cluster not ready'), { status: 503 });
  const results = [];
  for (const seq of seqs) {
    const ack = await recordReplicaAck({
      shop_id: cluster.shop_id,
      eventSeq: Number(seq),
      deviceId: deviceId || cluster.node_id,
    });
    results.push({ seq: Number(seq), id: ack.id });
  }
  if (seqs.length && cluster.role === 'replica') {
    const maxSeq = Math.max(...seqs.map(Number));
    if (maxSeq > Number(cluster.event_watermark || 0)) {
      await cluster.update({ event_watermark: maxSeq });
    }
  }
  return { acked: results.length, host_term: cluster.host_term };
}

export async function applyPulledEvents(events, { hostId, hostTerm }) {
  const cluster = await ensureClusterState();
  if (!cluster) return { applied: 0 };

  await observePeerHostTerm({ hostId, hostTerm });

  let applied = 0;
  let maxSeq = Number(cluster.event_watermark || 0);
  const criticalSeqs = [];

  await sequelize.transaction(async (transaction) => {
    for (const ev of events || []) {
      const seq = Number(ev.seq);
      if (seq <= maxSeq) continue;

      const existing = await EventLog.findOne({
        where: { shop_id: ev.shop_id || cluster.shop_id, seq },
        transaction,
      });
      if (!existing) {
        await EventLog.create({
          id: ev.id,
          seq,
          shop_id: ev.shop_id || cluster.shop_id,
          host_term: ev.host_term,
          event_type: ev.event_type,
          entity_type: ev.entity_type,
          entity_id: ev.entity_id,
          operation_id: ev.operation_id,
          origin_device_id: ev.origin_device_id,
          user_id: ev.user_id,
          critical: Boolean(ev.critical),
          payload: ev.payload || {},
          created_at: ev.created_at || new Date(),
        }, { transaction });
      }

      await applyDomainEvent(ev, { transaction });

      maxSeq = seq;
      applied += 1;
      if (ev.critical) criticalSeqs.push(seq);
    }

    if (maxSeq > Number(cluster.event_watermark || 0)) {
      await cluster.update({
        event_watermark: maxSeq,
        host_id: hostId || cluster.host_id,
        host_term: hostTerm != null ? hostTerm : cluster.host_term,
        role: 'replica',
      }, { transaction });
    }
  });

  return { applied, watermark: maxSeq, critical_seqs: criticalSeqs };
}

export async function getReplicationStatus() {
  const status = await getClusterPublicStatus();
  return {
    ...status,
    mode: status.role === 'active_host' ? 'host' : 'replica',
    note: 'Replicas pull /api/cluster/events, apply locally, ACK critical seqs to host',
  };
}

export async function getPromoteEligibility() {
  const status = await getClusterPublicStatus();
  let latest = Number(status.event_watermark || 0);
  try {
    const row = await EventLog.max('seq', { where: { shop_id: status.shop_id } });
    if (row != null) latest = Number(row);
  } catch { /* */ }

  const lag = Math.max(0, latest - Number(status.event_watermark || 0));
  const reasons = [];
  if (status.fenced) reasons.push('Node is fenced');
  if (status.role === 'active_host') reasons.push('Already active host');
  if (lag > 0) reasons.push(`${lag} events behind`);

  return {
    eligible: status.role !== 'active_host' && !status.fenced && lag === 0,
    recommended: status.role !== 'active_host' && !status.fenced && lag === 0,
    lag,
    watermark: status.event_watermark,
    latest_seq: latest,
    integrity: 'ok',
    reasons: status.role === 'active_host' ? ['Already active host'] : reasons,
  };
}
