/**
 * Customer backup (profiles only) — Settings → Backup & Export.
 *
 * Scope (intentionally narrow — this is the CUSTOMERS module's backup):
 *   - customers   profiles + contact details, GST/PAN/Aadhaar, DOB/anniversary,
 *                 tag, notes, purchase totals, loyalty points, serial_no
 *
 * NOT included: advances/balances, invoices, quotations, orders, schemes,
 * payments, credit notes — those belong to their own modules or to the
 * full-database backup.
 *
 * Matching, because mobile is deliberately NOT unique in this ERP (family
 * members share one number — see `allow_duplicate_mobile` in the customers
 * controller):
 *   1. source id          — same uuid means same record lineage
 *   2. shop + mobile + name (name compared case-insensitively as a fallback)
 * Never mobile alone: that would silently merge two different people.
 *
 * Restore is transactional: either the whole file applies or nothing does.
 * Customers absent from the file are never deleted (update matches, add new).
 */
import { Op } from 'sequelize';
import sequelize from '../db.js';
import { Customer, Shop } from '../models/index.js';
import { newId } from '../utils.js';
import { getDefaultShopId } from './defaultShop.js';
import { appendEventLog } from './eventLogService.js';
import branchConfig from '../config/branchConfig.js';
import { createMatcher } from './backupMatch.js';

export const CUSTOMER_BACKUP_FORMAT = 'slgt-jewel-erp/customer-backup';
export const CUSTOMER_BACKUP_VERSION = 1;

// Customer has no JSONB columns (pan_image/notes/address are plain TEXT), so —
// unlike the inventory backup — there is no SQLite JSONB round-trip to repair.
const COLLECTION_KEYS = ['customers'];

function invalid(message) {
  const err = new Error(message);
  err.code = 'CUSTOMER_BACKUP_INVALID';
  return err;
}

const asArray = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (v == null ? '' : String(v));

// Normalisation mirrors the customers controller exactly, so the restore
// cannot produce a PAN/Aadhaar value the app itself would refuse to save.
const normalizePan = (v) => (v ? str(v).trim().toUpperCase() : '');
const normalizeAadhaar = (v) => (v ? str(v).replace(/\D/g, '') : '');

// ─── Export ──────────────────────────────────────────────────────────────────

export async function buildCustomerBackup() {
  const customers = await Customer.findAll({ order: [['serial_no', 'ASC'], ['created_at', 'ASC']] });

  return {
    format: CUSTOMER_BACKUP_FORMAT,
    version: CUSTOMER_BACKUP_VERSION,
    scope: 'customers',
    exported_at: new Date().toISOString(),
    counts: {
      customers: customers.length,
    },
    customers: customers.map((r) => r.toJSON()),
  };
}

// ─── Import ──────────────────────────────────────────────────────────────────

function normalizePayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalid('The selected file is not a valid customer backup.');
  }
  if (raw.format !== CUSTOMER_BACKUP_FORMAT) {
    throw invalid('The selected file is not a customer backup. Use a file created by "Customer backup" in Settings → Backup & Export.');
  }
  if (!Number.isFinite(Number(raw.version)) || Number(raw.version) > CUSTOMER_BACKUP_VERSION) {
    throw invalid('This customer backup was created by a newer version of the ERP. Update the app first.');
  }
  return { customers: asArray(raw.customers) };
}

/**
 * Restore a customer backup. Updates customers matched by id or by
 * (mobile + name), creates the rest, and never deletes a customer that only
 * exists on the target machine.
 */
export async function restoreCustomerBackup(rawPayload, { userId = null } = {}) {
  const data = normalizePayload(rawPayload);
  const defaultShopId = await getDefaultShopId();

  // Source shops that still exist here keep their id; anything else (fresh
  // install, different machine) is remapped onto the default shop.
  const sourceShopIds = new Set(data.customers.map((r) => r.shop_id).filter(Boolean));
  const knownShops = sourceShopIds.size
    ? new Set((await Shop.findAll({ where: { id: { [Op.in]: [...sourceShopIds] } } })).map((s) => s.id))
    : new Set();
  const resolveShop = (sid) => (sid && knownShops.has(sid) ? sid : defaultShopId);

  const summary = {
    customers: 0,
    created: 0,
    updated: 0,
    skipped: 0,
  };
  const skipReasons = {};

  await sequelize.transaction(async (transaction) => {
    const existing = await Customer.findAll({ transaction });
    const byId = new Map(existing.map((c) => [c.id, c]));
    const claimedIds = new Set();
    const claim = (row) => {
      claimedIds.add(row.id);
      return row;
    };

    // Natural key — mobile + name, never mobile alone (see header).
    const matchNatural = createMatcher(
      existing,
      (c) => [c.shop_id, c.mobile, c.name],
      (shopId, mobile, name) => `${shopId}|${mobile || ''}|${name || ''}`,
      (shopId, mobile, name) => `${shopId}|${str(mobile).trim()}|${str(name).trim().toLowerCase()}`,
    );

    // serial_no is the per-shop "CUST-001" staff quote back to customers.
    // Numbers already owned by rows on this machine are never handed out
    // twice; how a *new* number is chosen is decided by the serial plan below.
    const claimedSerials = new Set(
      existing
        .filter((c) => c.serial_no != null)
        .map((c) => `${c.shop_id}|${c.serial_no}`),
    );

    const noteSkip = (reason) => {
      summary.skipped += 1;
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
    };

    // Pass 1 — same uuid means the same record lineage; the file wins.
    const resolved = data.customers.map((src) => ({
      src,
      shopId: resolveShop(src.shop_id),
      target: null,
    }));
    for (const item of resolved) {
      if (item.src.id && byId.has(item.src.id) && !claimedIds.has(item.src.id)) {
        item.target = claim(byId.get(item.src.id));
      }
    }
    // Pass 2 — mobile + name for customers that arrive under a new id.
    for (const item of resolved) {
      if (item.target) continue;
      const hit = matchNatural(item.shopId, item.src.mobile, item.src.name);
      if (hit && !claimedIds.has(hit.id)) item.target = claim(hit);
    }

    // Serial plan — decided BEFORE any write, and only for rows that will
    // actually be created (an update keeps its target's existing number).
    //
    // Claiming the source numbers up front matters: the export sorts
    // serial_no ASC, so a file that contains a few rows with no serial number
    // puts them FIRST. Assigning lazily in file order would let those rows
    // take numbers 1, 2, 3 … and shift every real customer's CUST-001 code.
    const nextSerialByShop = new Map();
    for (const c of existing) {
      if (c.serial_no == null) continue;
      const n = Number(c.serial_no) + 1;
      if (n > (nextSerialByShop.get(c.shop_id) ?? 0)) nextSerialByShop.set(c.shop_id, n);
    }
    for (const item of resolved) {
      item.serialNo = null;
      if (item.target) continue;
      const n = Number(item.src.serial_no);
      if (item.src.serial_no == null || item.src.serial_no === '' || !Number.isFinite(n)) continue;
      const key = `${item.shopId}|${n}`;
      if (claimedSerials.has(key)) continue;
      claimedSerials.add(key);
      item.serialNo = n;
      if (n + 1 > (nextSerialByShop.get(item.shopId) ?? 0)) nextSerialByShop.set(item.shopId, n + 1);
    }

    for (const item of resolved) {
      const { src, shopId } = item;
      let target = item.target;
      summary.customers += 1;

      try {
        const name = str(src.name).trim();
        const mobile = str(src.mobile).trim();
        if (!name || !mobile) {
          noteSkip('missing name or mobile');
          continue;
        }

        const pan = normalizePan(src.pan_number);
        const aadhaar = normalizeAadhaar(src.aadhaar_number);

        // Preserve the app's uniqueness invariants for PAN / Aadhaar: the UI
        // refuses to save a duplicate, so restoring must not create one either.
        // (Mobile needs no such check — it is explicitly allowed to repeat.)
        let conflict = null;
        for (const [field, value] of [['pan_number', pan], ['aadhaar_number', aadhaar]]) {
          if (!value) continue;
          const where = { shop_id: shopId, [field]: value, deleted_at: null };
          if (target) where.id = { [Op.ne]: target.id };
          const clash = await Customer.findOne({ where, transaction });
          if (clash) {
            conflict = field === 'pan_number' ? 'duplicate PAN' : 'duplicate Aadhaar';
            break;
          }
        }
        if (conflict) {
          noteSkip(conflict);
          continue;
        }

        const payload = {
          name,
          mobile,
          email: src.email ?? null,
          address: src.address ?? null,
          gst_number: src.gst_number ?? null,
          pan_number: pan || null,
          pan_image: src.pan_image ?? null,
          aadhaar_number: aadhaar || null,
          dob: src.dob ?? null,
          anniversary: src.anniversary ?? null,
          tag: src.tag || 'regular',
          notes: src.notes ?? null,
          total_purchases: src.total_purchases ?? 0,
          loyalty_points: src.loyalty_points ?? 0,
          shop_id: shopId,
          version: src.version ?? 1,
          deleted_at: src.deleted_at ?? null,
          origin_device_id: src.origin_device_id ?? null,
        };

        if (target) {
          // serial_no is deliberately NOT in the update payload — it is this
          // shop's own running number and must not be renumbered under it.
          await target.update(payload, { transaction });
          summary.updated += 1;
        } else {
          // A number from the plan when the source had one; otherwise the next
          // free number for this shop — never one the plan already handed out.
          let serial = item.serialNo;
          if (serial == null) {
            const next = (nextSerialByShop.get(shopId) ?? 0) + 1;
            nextSerialByShop.set(shopId, next);
            serial = next;
            claimedSerials.add(`${shopId}|${serial}`);
          }

          const id = src.id && !claimedIds.has(src.id) ? src.id : newId();
          // eslint-disable-next-line no-await-in-loop
          await Customer.create({
            id,
            serial_no: serial,
            ...payload,
            created_at: src.created_at ? new Date(src.created_at) : undefined,
          }, { transaction });
          claimedIds.add(id);
          summary.created += 1;
        }
      } catch (err) {
        err.message = `Customer "${src.name || src.mobile || src.id}" — ${err.message}`;
        err.code = 'CUSTOMER_BACKUP_RESTORE_FAILED';
        throw err;
      }
    }
  });

  summary.skip_reasons = skipReasons;

  // Its own transaction: the restore has already committed, and a cluster
  // event-log hiccup must never fail a completed restore. (appendEventLog
  // refuses to run without a transaction.)
  try {
    await sequelize.transaction((t) => appendEventLog({
      eventType: 'CUSTOMER_BACKUP_RESTORED',
      entityType: 'customer',
      originDeviceId: branchConfig.device_id,
      userId,
      critical: true,
      payload: { ...summary },
      transaction: t,
    }));
  } catch { /* cluster event log is optional — never fail a completed restore */ }

  return summary;
}
