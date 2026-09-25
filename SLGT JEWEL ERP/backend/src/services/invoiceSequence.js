import { QueryTypes } from 'sequelize';
import sequelize, { isLocalMode } from '../db.js';
import { newId } from '../utils.js';
import { InvoiceSequence, Setting, Shop } from '../models/index.js';
import branchConfig from '../config/branchConfig.js';
import { asObject } from './settingsStore.js';
import { getDefaultShopId } from './defaultShop.js';

function padSeq(n) {
  return String(n).padStart(4, '0');
}

function todayParts(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const yy = yyyy.slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return {
    sequenceDate: `${yyyy}${mm}${dd}`,
    datePart: `${yy}${mm}${dd}`,
  };
}

// Delegates to the same branch-config-aware resolver every other module uses.
// This used to independently pick "oldest active shop," which could disagree with
// getDefaultShopId() (branchConfig.shop_id-aware) whenever more than one shop row
// exists — causing invoice/barcode allocation to target a different shop than the
// one products/invoices actually get stored under.
export async function resolveDefaultShopId(transaction) {
  return getDefaultShopId({ transaction });
}

export async function resolveInvoicePrefix(shopId, transaction) {
  const company = await Setting.findOne({ where: { key: 'company' }, transaction });
  // asObject() is required here — SQLite stores JSONB as TEXT, so company.value can be
  // a raw JSON string rather than a parsed object (see settingsStore.js).
  const cv = asObject(company?.value);
  const fromCompany = String(cv.invoice_prefix || cv.prefix || '').trim();
  if (fromCompany) return fromCompany.toUpperCase();

  const shop = await Shop.findByPk(shopId, { transaction });
  if (shop?.invoice_prefix) return String(shop.invoice_prefix).trim().toUpperCase();
  if (shop?.code) return String(shop.code).trim().toUpperCase();
  return 'INV';
}

/**
 * Concurrency-safe invoice number allocation.
 * In local (SQLite) mode: uses per-device lifetime counter, format SSJ-{deviceNum}/{####}.
 * In cloud (PostgreSQL) mode: uses daily counter, format SSJ-{YYMMDD}-{####}.
 */
export async function allocateInvoiceNumber({
  shopId,
  prefix: prefixOverride,
  isHidden = false,
  at = new Date(),
  transaction,
} = {}) {
  if (!transaction) {
    throw new Error('allocateInvoiceNumber requires a Sequelize transaction');
  }

  const resolvedShopId = shopId || (await resolveDefaultShopId(transaction));
  let basePrefix = prefixOverride || (await resolveInvoicePrefix(resolvedShopId, transaction));
  // Hidden bills get their own counter so their numbers never interleave with normal invoices.
  if (isHidden) basePrefix = `${basePrefix}-H`;

  if (isLocalMode()) {
    return allocateLocalInvoiceNumber({ shopId: resolvedShopId, basePrefix, transaction });
  }

  return allocateCloudInvoiceNumber({ shopId: resolvedShopId, basePrefix, at, transaction });
}

/**
 * Local SQLite allocation — per-device lifetime counter.
 * Format: {prefix}-{deviceNum}/{####}  e.g. SSJ-1/0001
 */
async function allocateLocalInvoiceNumber({ shopId, basePrefix, transaction }) {
  const deviceNum = branchConfig.device_number || 1;
  const prefix = `${basePrefix}-${deviceNum}`;
  const seqDate = 'device'; // fixed key — no daily reset

  const rowId = newId();
  const seqReplacements = {
    id: rowId,
    shop_id: shopId,
    seq_date: seqDate,
    prefix,
    offset: prefix.length + 2, // skip "PREFIX/" to reach the numeric part
    like_pat: `${prefix}/%`,
  };

  // Create the row if it doesn't exist, initialising from the actual max invoice number.
  // Use ON CONFLICT (not OR IGNORE) so NOT NULL / CHECK failures still surface.
  await sequelize.query(
    `INSERT INTO invoice_sequences (id, shop_id, sequence_date, prefix, next_value, created_at, updated_at)
     VALUES (
       :id, :shop_id, :seq_date, :prefix,
       COALESCE(
         (SELECT MAX(CAST(SUBSTR(invoice_no, :offset) AS INTEGER)) + 1
          FROM invoices WHERE invoice_no LIKE :like_pat),
         1
       ),
       datetime('now'), datetime('now')
     )
     ON CONFLICT(shop_id, sequence_date, prefix) DO NOTHING`,
    { replacements: seqReplacements, type: QueryTypes.INSERT, transaction },
  );

  // Repair an existing row whose next_value has fallen behind actual invoices
  // (e.g. after a DB restore or a migration rollback).
  await sequelize.query(
    `UPDATE invoice_sequences
     SET next_value = MAX(
       next_value,
       COALESCE(
         (SELECT MAX(CAST(SUBSTR(invoice_no, :offset) AS INTEGER)) + 1
          FROM invoices WHERE invoice_no LIKE :like_pat),
         1
       )
     ), updated_at = datetime('now')
     WHERE shop_id = :shop_id AND sequence_date = :seq_date AND prefix = :prefix`,
    { replacements: seqReplacements, type: QueryTypes.UPDATE, transaction },
  );

  const rows = await sequelize.query(
    `UPDATE invoice_sequences
     SET next_value = next_value + 1, updated_at = datetime('now')
     WHERE shop_id = :shop_id AND sequence_date = :seq_date AND prefix = :prefix
     RETURNING next_value - 1 AS allocated`,
    {
      replacements: { shop_id: shopId, seq_date: seqDate, prefix },
      type: QueryTypes.SELECT,
      transaction,
    },
  );

  const allocated = rows?.[0]?.allocated;
  if (allocated == null) throw new Error('Failed to allocate invoice sequence');

  let seq = Number(allocated);
  let invoiceNo = `${prefix}/${padSeq(seq)}`;

  // Self-heal: if this invoice_no already exists (sequence desync after failed reset),
  // find the true max and jump ahead to avoid a unique-constraint collision.
  const existing = await sequelize.query(
    `SELECT 1 FROM invoices WHERE invoice_no = :invoiceNo LIMIT 1`,
    { replacements: { invoiceNo }, type: QueryTypes.SELECT, transaction },
  );
  if (existing.length > 0) {
    const maxRows = await sequelize.query(
      `SELECT COALESCE(MAX(CAST(SUBSTR(invoice_no, :offset) AS INTEGER)), 0) + 1 AS next_seq
       FROM invoices WHERE invoice_no LIKE :like_pat`,
      { replacements: seqReplacements, type: QueryTypes.SELECT, transaction },
    );
    seq = Number(maxRows?.[0]?.next_seq) || seq + 1;
    invoiceNo = `${prefix}/${padSeq(seq)}`;
    await sequelize.query(
      `UPDATE invoice_sequences
       SET next_value = MAX(next_value, :newNext), updated_at = datetime('now')
       WHERE shop_id = :shop_id AND sequence_date = :seq_date AND prefix = :prefix`,
      { replacements: { ...seqReplacements, newNext: seq + 1 }, type: QueryTypes.UPDATE, transaction },
    );
  }

  return {
    invoiceNo,
    sequence: seq,
    sequenceDate: seqDate,
    prefix,
    shopId,
  };
}

/**
 * Cloud PostgreSQL allocation — daily counter.
 * Format: {prefix}-{YYMMDD}-{####}  e.g. SSJ-250729-0001
 */
async function allocateCloudInvoiceNumber({ shopId, basePrefix, at, transaction }) {
  const prefix = basePrefix;
  const { sequenceDate, datePart } = todayParts(at);

  await InvoiceSequence.sequelize.query(
    `INSERT INTO invoice_sequences (id, shop_id, sequence_date, prefix, next_value, created_at, updated_at)
     VALUES (:id, :shop_id, :sequence_date, :prefix, 1, NOW(), NOW())
     ON CONFLICT (shop_id, sequence_date, prefix) DO NOTHING`,
    {
      replacements: {
        id: newId(),
        shop_id: shopId,
        sequence_date: sequenceDate,
        prefix,
      },
      type: QueryTypes.INSERT,
      transaction,
    },
  );

  const rows = await InvoiceSequence.sequelize.query(
    `UPDATE invoice_sequences
     SET next_value = next_value + 1, updated_at = NOW()
     WHERE shop_id = :shop_id AND sequence_date = :sequence_date AND prefix = :prefix
     RETURNING next_value - 1 AS allocated`,
    {
      replacements: { shop_id: shopId, sequence_date: sequenceDate, prefix },
      type: QueryTypes.SELECT,
      transaction,
    },
  );

  const allocated = rows?.[0]?.allocated;
  if (allocated == null) throw new Error('Failed to allocate invoice sequence');

  return {
    invoiceNo: `${prefix}-${datePart}-${padSeq(allocated)}`,
    sequence: Number(allocated),
    sequenceDate,
    prefix,
    shopId,
  };
}

/**
 * After practice rows are purged, LIVE invoice numbers start at 0001.
 * If any LIVE invoice already exists, only TEST-* sequence rows are dropped
 * so we never reuse a live number.
 */
export async function resetInvoiceSequencesAfterGoLive(shopId, { transaction } = {}) {
  if (!shopId) return { reset: false };
  const { Op } = await import('sequelize');
  const { Invoice } = await import('../models/index.js');
  const { FINANCIAL_MODE } = await import('./financialMode.js');

  await InvoiceSequence.destroy({
    where: { shop_id: shopId, prefix: { [Op.like]: 'TEST%' } },
    transaction,
  });

  const liveCount = await Invoice.count({
    where: {
      [Op.and]: [
        { [Op.or]: [{ shop_id: shopId }, { shop_id: null }] },
        {
          [Op.or]: [
            { financial_mode: FINANCIAL_MODE.LIVE },
            { financial_mode: { [Op.is]: null } },
          ],
        },
      ],
    },
    transaction,
  });
  if (liveCount > 0) return { reset: false, liveCount };

  await InvoiceSequence.update(
    { next_value: 1 },
    { where: { shop_id: shopId }, transaction },
  );
  return { reset: true, liveCount: 0 };
}
