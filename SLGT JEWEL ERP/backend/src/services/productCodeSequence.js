import { QueryTypes, Op } from 'sequelize';
import sequelize, { isLocalMode } from '../db.js';
import { Product, Category } from '../models/index.js';
import { getDefaultShopId } from './defaultShop.js';

const PREFIX_FALLBACK = {
  RINGS: 'RNG',
  NECKLACES: 'NCK',
  EARRINGS: 'EAR',
  BANGLES: 'BNG',
  CHAINS: 'CHN',
  ANKLETS: 'ANK',
  PENDANTS: 'PND',
  'JEWELLERY SETS': 'SET',
  'KIDS JEWELLERY': 'KID',
  BRACELETS: 'BRC',
};

export function normalizePrefix(raw) {
  const clean = String(raw || 'PRD').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return clean || 'PRD';
}

export function formatProductCode(prefix, seq) {
  return `${normalizePrefix(prefix)}-${String(seq).padStart(4, '0')}`;
}

export async function resolveCategoryPrefix(categoryId, { transaction } = {}) {
  if (!categoryId) return 'PRD';
  let cat = await Category.findByPk(categoryId, { transaction });
  if (!cat) return 'PRD';
  if (cat.parent_id) {
    const parent = await Category.findByPk(cat.parent_id, { transaction });
    if (parent) cat = parent;
  }
  if (cat.code_prefix) return normalizePrefix(cat.code_prefix);
  const key = String(cat.name || '').trim().toUpperCase();
  if (PREFIX_FALLBACK[key]) return PREFIX_FALLBACK[key];
  const letters = key.replace(/[^A-Z]/g, '').slice(0, 3);
  return normalizePrefix(letters || 'PRD');
}

async function maxExistingSeq(shopId, prefix, transaction) {
  const pfx = normalizePrefix(prefix);
  const rows = await Product.findAll({
    attributes: ['code'],
    where: {
      [Op.or]: [
        { shop_id: shopId },
        { shop_id: null },
      ],
      code: { [Op.like]: `${pfx}-%` },
    },
    transaction,
  });
  let max = 0;
  const re = new RegExp(`^${pfx}-(\\d+)$`, 'i');
  for (const row of rows) {
    const m = String(row.code || '').match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
  }
  return max;
}

async function ensureSequenceTable(transaction) {
  if (isLocalMode()) {
    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS product_code_sequences (
         shop_id TEXT NOT NULL,
         prefix TEXT NOT NULL,
         next_value INTEGER NOT NULL DEFAULT 1,
         updated_at TEXT NOT NULL DEFAULT (datetime('now')),
         PRIMARY KEY (shop_id, prefix)
       )`,
      { transaction },
    );
  } else {
    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS product_code_sequences (
         shop_id VARCHAR(64) NOT NULL,
         prefix VARCHAR(16) NOT NULL,
         next_value INTEGER NOT NULL DEFAULT 1,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         PRIMARY KEY (shop_id, prefix)
       )`,
      { transaction },
    );
  }
}

async function readSeqNext(shopId, prefix, transaction) {
  const rows = await sequelize.query(
    `SELECT next_value FROM product_code_sequences WHERE shop_id = :shop_id AND prefix = :prefix`,
    {
      replacements: { shop_id: shopId, prefix },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  return rows?.[0]?.next_value != null ? Number(rows[0].next_value) : null;
}

/**
 * Peek next code without consuming (form preview).
 */
export async function peekNextProductCode({ shopId, prefix, categoryId, transaction } = {}) {
  const resolvedShopId = shopId || (await getDefaultShopId({ transaction }));
  const pfx = categoryId
    ? await resolveCategoryPrefix(categoryId, { transaction })
    : normalizePrefix(prefix);
  await ensureSequenceTable(transaction);
  const maxProd = await maxExistingSeq(resolvedShopId, pfx, transaction);
  const seqNext = (await readSeqNext(resolvedShopId, pfx, transaction)) || 1;
  // Empty catalog → always preview from 0001 (matches allocate snap-back).
  const next = maxProd === 0 ? 1 : Math.max(maxProd + 1, seqNext);
  return { prefix: pfx, sequence: next, code: formatProductCode(pfx, next) };
}

/**
 * Allocate next product code atomically.
 * Format: {PREFIX}-{####}  e.g. RNG-0001, CHN-0012
 */
export async function allocateProductCode({ shopId, prefix, categoryId, transaction } = {}) {
  if (!transaction) throw new Error('allocateProductCode requires a transaction');

  const resolvedShopId = shopId || (await getDefaultShopId({ transaction }));
  const pfx = categoryId
    ? await resolveCategoryPrefix(categoryId, { transaction })
    : normalizePrefix(prefix);

  await ensureSequenceTable(transaction);
  const maxProd = await maxExistingSeq(resolvedShopId, pfx, transaction);
  const floor = Math.max(1, maxProd + 1);

  if (isLocalMode()) {
    await sequelize.query(
      `INSERT OR IGNORE INTO product_code_sequences (shop_id, prefix, next_value, updated_at)
       VALUES (:shop_id, :prefix, :floor, datetime('now'))`,
      {
        replacements: { shop_id: resolvedShopId, prefix: pfx, floor },
        type: QueryTypes.INSERT,
        transaction,
      },
    );
    // Catch up when products are ahead; snap back to 1 when catalog is empty.
    await sequelize.query(
      `UPDATE product_code_sequences
       SET next_value = CASE
             WHEN :floor = 1 THEN 1
             WHEN next_value < :floor THEN :floor
             ELSE next_value
           END,
           updated_at = datetime('now')
       WHERE shop_id = :shop_id AND prefix = :prefix`,
      {
        replacements: { shop_id: resolvedShopId, prefix: pfx, floor },
        type: QueryTypes.UPDATE,
        transaction,
      },
    );
    const current = await readSeqNext(resolvedShopId, pfx, transaction);
    const allocated = Number(current || floor);
    await sequelize.query(
      `UPDATE product_code_sequences
       SET next_value = :next, updated_at = datetime('now')
       WHERE shop_id = :shop_id AND prefix = :prefix`,
      {
        replacements: {
          shop_id: resolvedShopId,
          prefix: pfx,
          next: allocated + 1,
        },
        type: QueryTypes.UPDATE,
        transaction,
      },
    );
    return { prefix: pfx, sequence: allocated, code: formatProductCode(pfx, allocated) };
  }

  await sequelize.query(
    `INSERT INTO product_code_sequences (shop_id, prefix, next_value, updated_at)
     VALUES (:shop_id, :prefix, :floor, NOW())
     ON CONFLICT (shop_id, prefix) DO NOTHING`,
    {
      replacements: { shop_id: resolvedShopId, prefix: pfx, floor },
      type: QueryTypes.INSERT,
      transaction,
    },
  );
  await sequelize.query(
    `UPDATE product_code_sequences
     SET next_value = CASE
           WHEN :floor = 1 THEN 1
           WHEN next_value < :floor THEN :floor
           ELSE next_value
         END,
         updated_at = NOW()
     WHERE shop_id = :shop_id AND prefix = :prefix`,
    {
      replacements: { shop_id: resolvedShopId, prefix: pfx, floor },
      type: QueryTypes.UPDATE,
      transaction,
    },
  );
  const rows = await sequelize.query(
    `UPDATE product_code_sequences
     SET next_value = next_value + 1, updated_at = NOW()
     WHERE shop_id = :shop_id AND prefix = :prefix
     RETURNING next_value - 1 AS allocated`,
    {
      replacements: { shop_id: resolvedShopId, prefix: pfx },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  const allocated = Number(rows?.[0]?.allocated);
  if (!allocated) throw new Error('Failed to allocate product code');
  return { prefix: pfx, sequence: allocated, code: formatProductCode(pfx, allocated) };
}

/** Temp/auto codes that should be replaced with a real sequential code on create. */
export function isPlaceholderProductCode(code) {
  if (!code || !String(code).trim()) return true;
  if (/^[A-Z0-9]+-\d{8}-\d+$/i.test(code)) return true; // old RNG-20250729-4821
  if (/^PRD(-\d+)?$/i.test(code)) return true;
  return false;
}
