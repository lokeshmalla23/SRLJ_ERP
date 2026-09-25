/**
 * Authoritative-host write fence with host_term (locked shop-cluster architecture).
 */
import { isBranchMode } from '../config/appMode.js';
import { fenceIfSuperseded } from '../services/recoveryService.js';
import { assertCanWriteAuthoritatively, getClusterPublicStatus } from '../services/clusterService.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Every mutating route that changes shop business state must be listed here. */
const AUTHORITATIVE_PREFIXES = [
  '/api/invoices',
  '/api/purchases',
  '/api/stock',
  '/api/products',
  '/api/quotations',
  '/api/schemes',
  '/api/scheme-plans',
  '/api/accounts',
  '/api/barcodes',
  '/api/vendors',
  '/api/orders',
  '/api/customers',
  '/api/employees',
  '/api/settings',
  '/api/backup',
  '/api/system/backup',
  '/api/system/eod',
  '/api/advances',
  '/api/masters',
  '/api/promotions',
  '/api/catalog',
  '/api/categories',
  '/api/attributes',
  '/api/users',
  '/api/notifications',
  '/api/authority',
];

function isAuthoritativeWrite(req) {
  if (!MUTATING_METHODS.has(req.method)) return false;
  const full = (req.originalUrl || req.url || req.path || '').split('?')[0];
  // Cluster promote/fence/backup must run on the node being promoted (may not be host yet)
  if (full.startsWith('/api/cluster/promote') || full.startsWith('/api/cluster/fence')) return false;
  if (full.startsWith('/api/recovery/promote')) return false;
  // Local replica bootstrap/import must run on the replica itself
  if (full.startsWith('/api/cluster/snapshot/import')) return false;
  if (full.startsWith('/api/cluster/events/apply')) return false;
  if (full.startsWith('/api/cluster/backups/restore')) return false; // restore only on host via settings.manage + assert below
  return AUTHORITATIVE_PREFIXES.some((p) => full === p || full.startsWith(`${p}/`));
}

export async function requireAuthoritativeHost(req, res, next) {
  try {
    if (!isBranchMode()) return next();
    if (!isAuthoritativeWrite(req)) return next();

    const clusterCheck = await assertCanWriteAuthoritatively();
    if (!clusterCheck.ok) {
      return res.status(503).json({
        detail: clusterCheck.detail,
        code: clusterCheck.code,
        host_term: clusterCheck.host_term,
        host_id: clusterCheck.host_id,
        role: clusterCheck.role,
      });
    }

    const fence = await fenceIfSuperseded();
    if (fence.fenced) {
      return res.status(503).json({
        detail:
          'This host was superseded. Stop billing here and rejoin as a replica after recovery promote on the new host.',
        code: 'HOST_FENCED',
        active_hosts: fence.active_hosts,
        action: fence.action,
        host_term: clusterCheck.host_term,
      });
    }

    req.cluster = {
      host_term: clusterCheck.host_term,
      host_id: clusterCheck.host_id,
    };
    return next();
  } catch (err) {
    return next(err);
  }
}

export async function getAuthoritativeWriteStatus() {
  if (!isBranchMode()) {
    return { authoritative: true, fenced: false, role: 'cloud' };
  }
  const cluster = await getClusterPublicStatus();
  const clusterCheck = await assertCanWriteAuthoritatively();
  if (!clusterCheck.ok) {
    return {
      authoritative: false,
      fenced: clusterCheck.code === 'HOST_FENCED',
      role: cluster.role,
      code: clusterCheck.code,
      host_term: cluster.host_term,
      host_id: cluster.host_id,
    };
  }
  const fence = await fenceIfSuperseded();
  if (fence.fenced) {
    return {
      authoritative: false,
      fenced: true,
      role: cluster.role,
      code: 'HOST_FENCED',
      active_hosts: fence.active_hosts,
      host_term: cluster.host_term,
      host_id: cluster.host_id,
    };
  }
  return {
    authoritative: true,
    fenced: false,
    role: cluster.role,
    host_term: cluster.host_term,
    host_id: cluster.host_id,
  };
}

export { AUTHORITATIVE_PREFIXES };
