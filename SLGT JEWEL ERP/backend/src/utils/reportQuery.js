import { Op, Sequelize } from 'sequelize';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 25;

/** Standard limit/offset parsing shared by every /api/reports/* list endpoint. */
export function parsePagination(query = {}, { maxLimit = MAX_LIMIT, defaultLimit = DEFAULT_LIMIT } = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}

/** `{ total, data }` shape matching the existing GET /api/purchases contract. */
export function paginatedResult(count, rows) {
  return { total: count, data: rows };
}

/**
 * Accepts both `from`/`to` and `from_date`/`to_date` query param spellings
 * (the two conventions already in use across the codebase) so new report
 * endpoints never fall into the from_date/from param-name mismatch that
 * silently broke date filtering on the old Purchases report tab.
 */
export function parseDateRange(query = {}, { field = 'created_at' } = {}) {
  const from = query.from ?? query.from_date ?? null;
  const to = query.to ?? query.to_date ?? null;
  if (!from && !to) return {};

  const range = {};
  if (from) range[Op.gte] = new Date(from);
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    range[Op.lte] = end;
  }
  return { [field]: range };
}

/**
 * Same idea as parseDateRange, but for Invoice-like models that carry a
 * business_date (the active billing day a sale counts toward — see
 * dailyClosingService.js getActiveBillingDate). Filters by business_date
 * first, falling back to created_at only for older rows that predate that
 * column — otherwise a report scoped to "today's business day" silently
 * excludes sales made before Daily Closing caught up to the real calendar
 * date, since created_at (the real timestamp) can land on a different day
 * than business_date.
 */
export function invoiceDateRangeWhere(query = {}) {
  const from = query.from ?? query.from_date ?? null;
  const to = query.to ?? query.to_date ?? null;
  if (!from && !to) return {};

  const businessRange = {};
  if (from) businessRange[Op.gte] = from;
  if (to) businessRange[Op.lte] = to;

  const createdRange = {};
  if (from) createdRange[Op.gte] = new Date(from);
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    createdRange[Op.lte] = end;
  }

  return {
    [Op.or]: [
      { business_date: businessRange },
      { business_date: null, created_at: createdRange },
    ],
  };
}

/**
 * POS / estimation / customer bill history: newest transaction date at the
 * top, then the most recently saved row that day. `created_at` alone puts
 * back-dated bills above later business-day bills.
 */
export function newestTransactionFirstOrder() {
  return [
    [Sequelize.literal('COALESCE(business_date, date(created_at))'), 'DESC'],
    ['created_at', 'DESC'],
  ];
}

/**
 * Sales registers: highest invoice number first. Date/clock timestamps
 * are a last resort only — a later bill (SSJ-1/0008) can have an earlier
 * created_at than SSJ-1/0007 when the business day is pinned.
 */
export function newestInvoiceFirstOrder() {
  return [
    ['invoice_no', 'DESC'],
    ['created_at', 'DESC'],
  ];
}

export function compareInvoiceNoDesc(a, b) {
  return String(b || '').localeCompare(String(a || ''), undefined, { numeric: true, sensitivity: 'base' });
}

export function sortRowsByInvoiceNoDesc(rows = []) {
  return [...rows].sort((a, b) => compareInvoiceNoDesc(a?.invoice_no, b?.invoice_no));
}

function rowInvoiceNo(row) {
  const direct = String(row?.invoice_no || '').trim();
  if (direct) return direct;
  const desc = String(row?.description || '');
  const m = desc.match(/\b[A-Z]{2,}\d*-\d+\/\d+\b/i);
  return m ? m[0] : '';
}

function invoiceNoRank(no) {
  const m = String(no || '').match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

function recordedTs(row) {
  if (Number.isFinite(Number(row?._recency)) && Number(row._recency) > 0) return Number(row._recency);
  const n = Date.parse(row?.recorded_at || '');
  return Number.isFinite(n) ? n : 0;
}

/**
 * Same invoice (sale + old-gold lines) shares the latest recorded time so
 * those rows stay together. A scheme payment saved after that bill then
 * sorts above the whole invoice group.
 */
export function decorateErpStatementRecency(rows = []) {
  const maxByInvoice = new Map();
  for (const e of rows) {
    const no = rowInvoiceNo(e);
    if (!no) continue;
    const ts = Date.parse(e?.recorded_at || '') || 0;
    maxByInvoice.set(no, Math.max(maxByInvoice.get(no) || 0, ts));
  }
  for (const e of rows) {
    const no = rowInvoiceNo(e);
    const own = Date.parse(e?.recorded_at || '') || 0;
    e._recency = no ? (maxByInvoice.get(no) || own) : own;
  }
  return rows;
}

/**
 * Shop-local calendar day (YYYY-MM-DD). Never use ISO `.slice(0, 10)` —
 * `2026-09-18T20:00:00.000Z` is still 19 Sep in IST, and slicing UTC would
 * park SSJ-1/0008 under the previous day while 0007 stays on the 19th.
 */
export function calendarDayFromValue(isoOrDay) {
  if (!isoOrDay) return '';
  if (isoOrDay instanceof Date) {
    if (Number.isNaN(isoOrDay.getTime())) return '';
    const y = isoOrDay.getFullYear();
    const m = String(isoOrDay.getMonth() + 1).padStart(2, '0');
    const d = String(isoOrDay.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(isoOrDay).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return calendarDayFromValue(d);
}

function statementDay(row) {
  if (row?.business_day) return String(row.business_day).slice(0, 10);
  return calendarDayFromValue(row?.occurred_at);
}

/**
 * Oldest calendar day first, then oldest recorded transaction. Time-of-day
 * on the business date is ignored for grouping — recency is when the row
 * was actually saved (POS created_at, scheme collect time). Newest-first
 * reverse then puts a scheme payment collected after a bill above that bill,
 * and SSJ-1/0009 above 0008.
 */
export function compareErpStatementAsc(a, b) {
  const da = statementDay(a);
  const db = statementDay(b);
  if (da !== db) return da.localeCompare(db);
  const ra = recordedTs(a);
  const rb = recordedTs(b);
  if (ra !== rb) return ra - rb;
  const ia = invoiceNoRank(rowInvoiceNo(a));
  const ib = invoiceNoRank(rowInvoiceNo(b));
  if (ia !== ib) return ia - ib;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}
