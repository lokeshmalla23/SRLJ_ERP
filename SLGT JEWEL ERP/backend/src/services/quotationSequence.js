/**
 * Estimation / quotation numbers.
 *
 * LIVE:  QT-{year}-{seq}        e.g. QT-2026-001
 * TEST:  TEST-QT-{year}-{seq}   e.g. TEST-QT-2026-001
 *
 * Next number is max seq in that series + 1, then skip any quote_no already
 * stored (practice leftovers, soft-deletes, other shops). Unique is global.
 */
import { Quotation } from '../models/index.js';
import sequelize, { likeOp } from '../db.js';
import { FINANCIAL_MODE } from './financialMode.js';

export const QUOTE_SEQ_PAD = 3;
export const MAX_QUOTE_NO_ATTEMPTS = 8;

export function quoteNoPrefix({ testMode = false, year = new Date().getFullYear() } = {}) {
  const y = Number(year) || new Date().getFullYear();
  return testMode ? `TEST-QT-${y}-` : `QT-${y}-`;
}

export function parseQuoteSeq(quoteNo, prefix) {
  const raw = String(quoteNo || '');
  if (!prefix || !raw.startsWith(prefix)) return null;
  const rest = raw.slice(prefix.length);
  if (!/^\d+$/.test(rest)) return null;
  return parseInt(rest, 10);
}

export function formatQuoteNo(prefix, seq) {
  return `${prefix}${String(seq).padStart(QUOTE_SEQ_PAD, '0')}`;
}

/** Walk from maxSeriesSeq+1 until a value is not in takenSeqs. */
export function nextFreeQuoteSeq(maxSeriesSeq, takenSeqs) {
  let next = Math.max(0, Number(maxSeriesSeq) || 0) + 1;
  const taken = takenSeqs instanceof Set ? takenSeqs : new Set(takenSeqs || []);
  while (taken.has(next)) next += 1;
  return next;
}

export function isQuoteNoUniqueError(err) {
  if (!err) return false;
  if (err.name === 'SequelizeUniqueConstraintError') {
    const fields = err.fields || {};
    if (Object.prototype.hasOwnProperty.call(fields, 'quote_no')) return true;
    const idx = String(err.parent?.constraint || err.index || '');
    if (/quote_no/i.test(idx)) return true;
  }
  const msg = String(err.parent?.message || err.message || '');
  return /quotations_quote_no/i.test(msg) || /unique.*quote_no/i.test(msg);
}

function isSeriesRow(row, { testMode }) {
  if (testMode) return true;
  return String(row?.financial_mode || '').toUpperCase() !== FINANCIAL_MODE.PRE_ACCOUNTS;
}

/**
 * Allocate the next unused quote_no for TEST or LIVE.
 * Counts the series from LIVE (or all TEST-QT) rows; skips any taken number.
 */
export async function allocateQuoteNumber({
  testMode = false,
  year = new Date().getFullYear(),
  transaction,
} = {}) {
  const t = transaction || null;
  const prefix = quoteNoPrefix({ testMode, year });
  const rows = await Quotation.findAll({
    attributes: ['quote_no', 'financial_mode'],
    where: { quote_no: { [likeOp]: `${prefix}%` } },
    transaction: t,
    raw: true,
  });

  const taken = new Set();
  let maxSeriesSeq = 0;
  for (const row of rows || []) {
    const seq = parseQuoteSeq(row.quote_no, prefix);
    if (seq == null) continue;
    taken.add(seq);
    if (isSeriesRow(row, { testMode }) && seq > maxSeriesSeq) maxSeriesSeq = seq;
  }

  const next = nextFreeQuoteSeq(maxSeriesSeq, taken);
  return formatQuoteNo(prefix, next);
}

/**
 * SQLite aborts the current transaction on a unique violation, so retries
 * must use a fresh transaction (caller rolls back, then calls this again).
 */
export async function withQuoteNoRetry(work, { attempts = MAX_QUOTE_NO_ATTEMPTS } = {}) {
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    const t = await sequelize.transaction();
    try {
      const result = await work(t);
      await t.commit();
      return result;
    } catch (err) {
      await t.rollback().catch(() => {});
      lastErr = err;
      if (!isQuoteNoUniqueError(err) || i >= attempts) throw err;
    }
  }
  throw lastErr;
}
