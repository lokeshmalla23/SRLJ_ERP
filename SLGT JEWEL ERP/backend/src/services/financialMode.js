/**
 * Shop-scoped financial lifecycle: PRE_ACCOUNTS (test) vs LIVE.
 * Inventory is independent — this module only classifies accounting impact.
 */
import { Op } from 'sequelize';
import { JournalEntry, Setting, Shop } from '../models/index.js';
import { getDefaultShopId } from './defaultShop.js';

export const FINANCIAL_MODE = Object.freeze({
  PRE_ACCOUNTS: 'PRE_ACCOUNTS',
  LIVE: 'LIVE',
});

const SETUP_COMPLETE_KEY = 'erp_opening_setup_complete';

function parseSettingValue(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function setupCompleteKeyForShop(shopId) {
  return shopId ? `${SETUP_COMPLETE_KEY}:${shopId}` : SETUP_COMPLETE_KEY;
}

async function readSetupFlag(shopId, { transaction } = {}) {
  if (shopId) {
    const scoped = await Setting.findOne({
      where: { key: setupCompleteKeyForShop(shopId) },
      transaction,
    });
    if (scoped) return parseSettingValue(scoped.value);
  }
  const row = await Setting.findOne({ where: { key: SETUP_COMPLETE_KEY }, transaction });
  const parsed = parseSettingValue(row?.value);
  if (parsed?.shop_id && shopId && String(parsed.shop_id) !== String(shopId)) return null;
  return parsed;
}

function flagLooksCompleted(flag) {
  if (!flag || typeof flag !== 'object') return false;
  if (String(flag.status || '').toUpperCase() === 'COMPLETED') return true;
  return Boolean(flag.completed_at);
}

/**
 * LIVE only when this shop has actually initialized opening books.
 * A closed business day alone is not go-live (that would guess).
 */
export async function resolveFinancialMode(shopId, { transaction } = {}) {
  const resolvedShopId = shopId || await getDefaultShopId({ transaction }).catch(() => null);
  if (!resolvedShopId) return FINANCIAL_MODE.PRE_ACCOUNTS;

  const flag = await readSetupFlag(resolvedShopId, { transaction });
  if (flagLooksCompleted(flag)) return FINANCIAL_MODE.LIVE;

  const cutover = await JournalEntry.findOne({
    where: { shop_id: resolvedShopId, source_type: 'opening_balance' },
    attributes: ['id'],
    transaction,
  });
  return cutover ? FINANCIAL_MODE.LIVE : FINANCIAL_MODE.PRE_ACCOUNTS;
}

export function isPreAccountsRecord(row) {
  return String(row?.financial_mode || '').toUpperCase() === FINANCIAL_MODE.PRE_ACCOUNTS;
}

export function isLiveFinancialRecord(row) {
  if (!row) return false;
  if (row.is_opening === true || row.is_opening === 1) return true;
  return !isPreAccountsRecord(row);
}

/**
 * Merge into a Sequelize where: drop PRE_ACCOUNTS, keep LIVE and unstamped (null).
 * Null is treated as LIVE so a shop inferred from a closed day is not guessed as TEST.
 */
export function excludePreAccountsWhere(OpLib = Op) {
  return {
    financial_mode: {
      [OpLib.or]: [
        { [OpLib.ne]: FINANCIAL_MODE.PRE_ACCOUNTS },
        { [OpLib.is]: null },
      ],
    },
  };
}

/** Journals: same as domain, plus always keep opening/cutover vouchers. */
export function excludePreAccountsJournalWhere(OpLib = Op) {
  return {
    [OpLib.or]: [
      { is_opening: true },
      { source_type: 'opening_balance' },
      excludePreAccountsWhere(OpLib),
    ],
  };
}

export const liveJournalWhere = excludePreAccountsJournalWhere;
export const liveDomainWhere = excludePreAccountsWhere;

/** Combine Sequelize where fragments with Op.and, dropping empty objects. */
export function andWhere(...parts) {
  const cleaned = parts.filter((p) => p && typeof p === 'object' && Object.keys(p).length > 0);
  if (!cleaned.length) return {};
  if (cleaned.length === 1) return cleaned[0];
  return { [Op.and]: cleaned };
}

/**
 * After go-live, shop-floor lists (POS history, estimations, incomes, expenses)
 * must not include PRE_ACCOUNTS practice rows. While still in TEST MODE, those
 * rows stay visible so practice can continue.
 */
export async function withLiveFinancialRecords(shopId, extra = {}, { transaction } = {}) {
  const mode = await resolveFinancialMode(shopId, { transaction });
  if (mode !== FINANCIAL_MODE.LIVE) return extra && typeof extra === 'object' ? extra : {};
  return andWhere(extra, excludePreAccountsWhere());
}

/**
 * Go-live instant for migration: explicit completed_at, or opening voucher time.
 * Does not invent a date from invoice history.
 */
export async function resolveAccountsGoLiveAt(shopId, { transaction } = {}) {
  const flag = await readSetupFlag(shopId, { transaction });
  const priorCloseOnly = String(flag?.reason || '') === 'prior_closed_day';
  if (!priorCloseOnly && flag?.accounts_go_live_at) return new Date(flag.accounts_go_live_at);
  if (!priorCloseOnly && flagLooksCompleted(flag) && flag.completed_at) {
    return new Date(flag.completed_at);
  }
  const cutover = await JournalEntry.findOne({
    where: { shop_id: shopId, source_type: 'opening_balance' },
    attributes: ['id', 'created_at', 'entry_date'],
    order: [['created_at', 'ASC']],
    transaction,
  });
  if (cutover?.created_at) return new Date(cutover.created_at);
  if (cutover?.entry_date) return new Date(`${cutover.entry_date}T00:00:00`);
  return null;
}

const FINANCIAL_TABLES = [
  'invoices',
  'payments',
  'expenses',
  'purchases',
  'customer_advances',
  'customer_advance_applications',
  'quotations',
  'credit_notes',
  'old_gold_receipts',
  'cashbook_entries',
  'schemes',
  'orders',
];

async function tableHasColumn(sequelize, table, column) {
  const dialect = sequelize.getDialect();
  if (dialect === 'sqlite') {
    const rows = await sequelize.query(`PRAGMA table_info("${table}")`, { type: sequelize.QueryTypes.SELECT });
    return (rows || []).some((r) => r.name === column);
  }
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = :table AND column_name = :column LIMIT 1`,
    { replacements: { table, column } },
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function tableExists(sequelize, table) {
  const dialect = sequelize.getDialect();
  if (dialect === 'sqlite') {
    const rows = await sequelize.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
      { replacements: [table], type: sequelize.QueryTypes.SELECT },
    );
    return rows.length > 0;
  }
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = :table LIMIT 1`,
    { replacements: { table } },
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function inferredPriorCloseOnly(shopId, { transaction } = {}) {
  const flag = await readSetupFlag(shopId, { transaction });
  if (!flagLooksCompleted(flag)) return false;
  if (String(flag.reason || '') !== 'prior_closed_day') return false;
  const cutover = await JournalEntry.findOne({
    where: { shop_id: shopId, source_type: 'opening_balance' },
    attributes: ['id'],
    transaction,
  });
  return !cutover;
}

/**
 * Idempotent: stamp unmarked financial rows. Never converts LIVE ↔ PRE_ACCOUNTS
 * once set. Opening vouchers are always LIVE.
 *
 * Shops with no genuine go-live (no completed_at from setup, no opening voucher)
 * → PRE_ACCOUNTS. Shops whose COMPLETED flag was only inferred from a closed
 * business day are left LIVE (null→LIVE) — we do not guess TEST.
 */
export async function backfillFinancialModes(sequelize) {
  if (!sequelize) return { shops: 0, notes: [] };

  const shops = await Shop.findAll({ attributes: ['id'] }).catch(() => []);
  const shopIds = shops.map((s) => s.id);
  if (!shopIds.length) {
    const fallback = await getDefaultShopId().catch(() => null);
    if (fallback) shopIds.push(fallback);
  }

  const defaultShopId = await getDefaultShopId().catch(() => shopIds[0] || null);
  const notes = [];
  let stampedShops = 0;
  const dialect = sequelize.getDialect();
  const openingPred = dialect === 'postgres'
    ? `(source_type = 'opening_balance' OR is_opening IS TRUE)`
    : `(source_type = 'opening_balance' OR is_opening = 1)`;

  for (const shopId of shopIds) {
    const goLiveAt = await resolveAccountsGoLiveAt(shopId);
    const goLiveIso = goLiveAt ? goLiveAt.toISOString() : null;
    const priorCloseOnly = !goLiveIso && await inferredPriorCloseOnly(shopId);
    const includeNullShop = defaultShopId && String(shopId) === String(defaultShopId);
    const shopPred = includeNullShop
      ? '(shop_id = :shopId OR shop_id IS NULL)'
      : 'shop_id = :shopId';

    if (priorCloseOnly) {
      notes.push({
        shop_id: shopId,
        action: 'stamp_live_no_guess',
        reason: 'COMPLETED inferred from prior closed day without an opening voucher — historical rows left LIVE. Verify manually if any were test/pre-accounts.',
      });
    }

    if (await tableExists(sequelize, 'journal_entries')
        && await tableHasColumn(sequelize, 'journal_entries', 'financial_mode')) {
      await sequelize.query(
        `UPDATE journal_entries SET financial_mode = :live
         WHERE shop_id = :shopId AND financial_mode IS NULL AND ${openingPred}`,
        { replacements: { live: FINANCIAL_MODE.LIVE, shopId } },
      );
      if (goLiveIso) {
        await sequelize.query(
          `UPDATE journal_entries SET financial_mode = :test
           WHERE shop_id = :shopId AND financial_mode IS NULL AND created_at < :goLive`,
          { replacements: { test: FINANCIAL_MODE.PRE_ACCOUNTS, shopId, goLive: goLiveIso } },
        );
        await sequelize.query(
          `UPDATE journal_entries SET financial_mode = :live
           WHERE shop_id = :shopId AND financial_mode IS NULL AND created_at >= :goLive`,
          { replacements: { live: FINANCIAL_MODE.LIVE, shopId, goLive: goLiveIso } },
        );
      } else if (priorCloseOnly) {
        await sequelize.query(
          `UPDATE journal_entries SET financial_mode = :live
           WHERE shop_id = :shopId AND financial_mode IS NULL`,
          { replacements: { live: FINANCIAL_MODE.LIVE, shopId } },
        );
      } else {
        await sequelize.query(
          `UPDATE journal_entries SET financial_mode = :test
           WHERE shop_id = :shopId AND financial_mode IS NULL`,
          { replacements: { test: FINANCIAL_MODE.PRE_ACCOUNTS, shopId } },
        );
      }
    }

    for (const table of FINANCIAL_TABLES) {
      if (!(await tableExists(sequelize, table))) continue;
      if (!(await tableHasColumn(sequelize, table, 'financial_mode'))) continue;
      if (goLiveIso) {
        await sequelize.query(
          `UPDATE ${table} SET financial_mode = :test
           WHERE financial_mode IS NULL AND ${shopPred} AND created_at < :goLive`,
          { replacements: { test: FINANCIAL_MODE.PRE_ACCOUNTS, shopId, goLive: goLiveIso } },
        );
        await sequelize.query(
          `UPDATE ${table} SET financial_mode = :live
           WHERE financial_mode IS NULL AND ${shopPred} AND created_at >= :goLive`,
          { replacements: { live: FINANCIAL_MODE.LIVE, shopId, goLive: goLiveIso } },
        );
      } else if (priorCloseOnly) {
        await sequelize.query(
          `UPDATE ${table} SET financial_mode = :live
           WHERE financial_mode IS NULL AND ${shopPred}`,
          { replacements: { live: FINANCIAL_MODE.LIVE, shopId } },
        );
      } else {
        await sequelize.query(
          `UPDATE ${table} SET financial_mode = :test
           WHERE financial_mode IS NULL AND ${shopPred}`,
          { replacements: { test: FINANCIAL_MODE.PRE_ACCOUNTS, shopId } },
        );
      }
    }
    stampedShops += 1;
  }
  return { shops: stampedShops, notes };
}
