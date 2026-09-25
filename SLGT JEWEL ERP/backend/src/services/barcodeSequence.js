import { QueryTypes } from 'sequelize';
import sequelize, { isLocalMode } from '../db.js';
import { resolveDefaultShopId } from './invoiceSequence.js';

const SEQUENCE_START = 10001;

// Only consider barcodes that actually look like our short auto-generated
// sequence (up to 9 digits, safely inside the INTEGER range) when seeding —
// a long all-digit barcode (EAN/UPC, an imported code, a pasted phone number,
// etc.) is a different numbering scheme entirely and must never be treated
// as "the highest tag number so far" (it previously caused an
// "integer out of range" error trying to seed from a 14-digit value).
const MAX_SEED_DIGITS = 9;
const SERIAL_RE = new RegExp(`^[0-9]{1,${MAX_SEED_DIGITS}}$`);

/**
 * Highest short numeric tag already in use for this shop (or SEQUENCE_START - 1).
 * Checks both `barcode` and `code` — some products (CSV imports, legacy rows)
 * only ever got their serial written into `code`, leaving `barcode` blank/null.
 * Scanning `barcode` alone undercounts the true max and can reissue a number
 * that's already sitting on one of those rows.
 * Uses dialect-safe SQL — Postgres ::bigint / ~ regex break on SQLite.
 */
async function seedFromExistingBarcodes(shopId, transaction) {
  if (isLocalMode()) {
    const rows = await sequelize.query(
      `SELECT barcode, code FROM products
       WHERE shop_id = :shop_id AND (barcode IS NOT NULL OR code IS NOT NULL)`,
      {
        replacements: { shop_id: shopId },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
    let max = SEQUENCE_START - 1;
    for (const row of rows) {
      for (const value of [row.barcode, row.code]) {
        const raw = String(value || '').trim();
        if (SERIAL_RE.test(raw)) {
          max = Math.max(max, Number(raw));
        }
      }
    }
    return max + 1;
  }

  const seedRows = await sequelize.query(
    `SELECT COALESCE(MAX(tag_value::bigint), :base) AS max_val
     FROM (
       SELECT barcode AS tag_value FROM products
       WHERE shop_id = :shop_id AND barcode ~ '^[0-9]{1,${MAX_SEED_DIGITS}}$'
       UNION ALL
       SELECT code AS tag_value FROM products
       WHERE shop_id = :shop_id AND code ~ '^[0-9]{1,${MAX_SEED_DIGITS}}$'
     ) tags`,
    {
      replacements: { shop_id: shopId, base: SEQUENCE_START - 1 },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  return Number(seedRows?.[0]?.max_val ?? (SEQUENCE_START - 1)) + 1;
}

/**
 * Read-only preview of the next barcode — never writes/increments anything, so
 * opening (or re-opening) the New Product form repeatedly always shows the same
 * number until a product is actually saved. Always recomputed from the real
 * products table, so it stays correct even if the persisted counter lags behind.
 *
 * @returns {string} the barcode that WOULD be allocated next
 */
export async function peekNextBarcodeNumber({ shopId, transaction } = {}) {
  if (!transaction) {
    throw new Error('peekNextBarcodeNumber requires a Sequelize transaction');
  }

  const resolvedShopId = shopId || (await resolveDefaultShopId(transaction));
  const seed = await seedFromExistingBarcodes(resolvedShopId, transaction);

  // barcode_sequences is created lazily by the first real allocation (local mode) —
  // treat "table doesn't exist yet" the same as "no counter row yet".
  let persisted = NaN;
  try {
    const rows = await sequelize.query(
      `SELECT next_value FROM barcode_sequences WHERE shop_id = :shop_id`,
      { replacements: { shop_id: resolvedShopId }, type: QueryTypes.SELECT, transaction },
    );
    persisted = Number(rows?.[0]?.next_value);
  } catch { /* no counter row/table yet — seed alone is authoritative */ }

  return String(Number.isFinite(persisted) ? Math.max(persisted, seed) : seed);
}

/**
 * Concurrency-safe sequential barcode allocation, scoped per shop.
 * Seeds the counter from the highest existing short numeric barcode already
 * in use (so it continues past legacy/manually-entered values instead of
 * risking a collision), falling back to SEQUENCE_START if none exist.
 *
 * @returns {string} the allocated barcode number
 */
export async function allocateBarcodeNumber({ shopId, transaction } = {}) {
  if (!transaction) {
    throw new Error('allocateBarcodeNumber requires a Sequelize transaction');
  }

  const resolvedShopId = shopId || (await resolveDefaultShopId(transaction));
  const seed = await seedFromExistingBarcodes(resolvedShopId, transaction);

  if (isLocalMode()) {
    return allocateLocalBarcodeNumber({ shopId: resolvedShopId, seed, transaction });
  }

  return allocateCloudBarcodeNumber({ shopId: resolvedShopId, seed, transaction });
}

async function ensureLocalSequenceTable(transaction) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS barcode_sequences (
       shop_id TEXT NOT NULL PRIMARY KEY,
       next_value INTEGER NOT NULL DEFAULT 10001,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    { transaction },
  );
}

async function allocateLocalBarcodeNumber({ shopId, seed, transaction }) {
  await ensureLocalSequenceTable(transaction);

  // Ensure the counter row exists (race-safe) — seeded only on first creation.
  await sequelize.query(
    `
    INSERT INTO barcode_sequences (shop_id, next_value, created_at, updated_at)
    VALUES (:shop_id, :seed, datetime('now'), datetime('now'))
    ON CONFLICT (shop_id) DO NOTHING
    `,
    {
      replacements: { shop_id: shopId, seed },
      type: QueryTypes.INSERT,
      transaction,
    },
  );

  // Catch up if an existing counter fell behind real barcodes (restore / gap).
  // If every barcoded product has since been removed, the seed collapses back to
  // SEQUENCE_START — snap the counter back down too instead of leaving it stuck
  // at its old high-water mark forever.
  await sequelize.query(
    `
    UPDATE barcode_sequences
    SET next_value = CASE
        WHEN :seed = ${SEQUENCE_START} THEN :seed
        WHEN next_value < :seed THEN :seed
        ELSE next_value
      END,
        updated_at = datetime('now')
    WHERE shop_id = :shop_id
    `,
    {
      replacements: { shop_id: shopId, seed },
      type: QueryTypes.UPDATE,
      transaction,
    },
  );

  const rows = await sequelize.query(
    `
    UPDATE barcode_sequences
    SET next_value = next_value + 1, updated_at = datetime('now')
    WHERE shop_id = :shop_id
    RETURNING next_value - 1 AS allocated
    `,
    {
      replacements: { shop_id: shopId },
      type: QueryTypes.SELECT,
      transaction,
    },
  );

  const allocated = rows?.[0]?.allocated;
  if (allocated == null) {
    throw new Error('Failed to allocate barcode sequence');
  }
  return String(allocated);
}

async function allocateCloudBarcodeNumber({ shopId, seed, transaction }) {
  await sequelize.query(
    `
    INSERT INTO barcode_sequences (shop_id, next_value, created_at, updated_at)
    VALUES (:shop_id, :seed, NOW(), NOW())
    ON CONFLICT (shop_id) DO NOTHING
    `,
    {
      replacements: { shop_id: shopId, seed },
      type: QueryTypes.INSERT,
      transaction,
    },
  );

  // Catch up if seed is ahead of the stored counter (same restore/gap case as local),
  // and snap back down to SEQUENCE_START once no barcoded product remains at all.
  await sequelize.query(
    `
    UPDATE barcode_sequences
    SET next_value = CASE WHEN :seed = ${SEQUENCE_START} THEN :seed ELSE GREATEST(next_value, :seed) END,
        updated_at = NOW()
    WHERE shop_id = :shop_id
    `,
    {
      replacements: { shop_id: shopId, seed },
      type: QueryTypes.UPDATE,
      transaction,
    },
  );

  const rows = await sequelize.query(
    `
    UPDATE barcode_sequences
    SET next_value = next_value + 1, updated_at = NOW()
    WHERE shop_id = :shop_id
    RETURNING next_value - 1 AS allocated
    `,
    {
      replacements: { shop_id: shopId },
      type: QueryTypes.SELECT,
      transaction,
    },
  );

  const allocated = rows?.[0]?.allocated;
  if (allocated == null) {
    throw new Error('Failed to allocate barcode sequence');
  }
  return String(allocated);
}
