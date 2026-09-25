/**
 * Read invoice timestamps / JSON snapshots reliably across Sequelize
 * underscored models and SQLite TEXT JSON.
 */
import { Op } from 'sequelize';
import { InvoiceItem } from '../models/InvoiceItem.js';

export function parseMaybeJson(value, fallback) {
  let v = value;
  for (let i = 0; i < 3; i += 1) {
    if (v == null || v === '') return fallback;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) {
      v = v.toString('utf8');
      continue;
    }
    if (Array.isArray(v)) return v;
    if (typeof v === 'object' && !(v instanceof Date)) return v;
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return fallback;
      try {
        v = JSON.parse(s);
      } catch {
        return fallback;
      }
      continue;
    }
    return fallback;
  }
  return Array.isArray(v) || (v && typeof v === 'object') ? v : fallback;
}

export function modelValue(row, ...keys) {
  if (!row) return undefined;
  for (const k of keys) {
    if (typeof row.get === 'function') {
      try {
        const v = row.get(k);
        if (v != null && v !== '') return v;
      } catch {
        /* ignore */
      }
    }
    if (row[k] != null && row[k] !== '') return row[k];
    if (row.dataValues && row.dataValues[k] != null && row.dataValues[k] !== '') {
      return row.dataValues[k];
    }
  }
  return undefined;
}

export function parseOccurredAt(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = raw > 1e12 ? raw : raw > 1e9 ? raw * 1000 : NaN;
    const fromNum = new Date(n);
    return Number.isNaN(fromNum.getTime()) ? null : fromNum;
  }
  let s = String(raw).trim();
  if (!s) return null;
  // SQLite / Sequelize: "2026-08-18 10:00:00.000 +00:00"
  if (/^\d{4}-\d{2}-\d{2} /.test(s)) s = s.replace(' ', 'T');
  s = s.replace(/ ([+-]\d{2}:?\d{2})$/, '$1');
  s = s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * SQLite DATETIME is TEXT. Binding a JS Date makes sqlite3 stringify with a
 * space (`2026-08-18 23:59:59 +00:00`). That string is lexicographically *less*
 * than ISO values that use `T`, so POS invoices stored as ISO disappear from
 * range filters in the packaged .exe. Always bind an ISO-with-T upper bound.
 */
export function sqliteOnOrBefore(ymd, field = 'created_at') {
  return { [field]: { [Op.lte]: `${ymd}T23:59:59.999Z` } };
}

/**
 * The date a record's transaction counts toward for Accounts/reporting —
 * NEVER the row's real created_at timestamp when a more specific transaction
 * date is available, since every Sequelize row always has a createdAt and
 * would otherwise win by being checked first. The DATE always comes from the
 * transaction-date field; the TIME always comes from the row's real clock
 * timestamp — never mixed the other way, and never midnight unless no real
 * timestamp exists at all (very old/legacy rows).
 *   1. business_date — invoices, payments, old_gold_receipts, credit_notes,
 *      customer_advances: the active billing day it was recorded under, so
 *      this stays consistent with the "Transaction date" in the header even
 *      when Daily Closing hasn't caught up to the real calendar date yet.
 *   2. purchase_date — purchases.
 *   3. date — expenses, income: the date the user explicitly chose on the
 *      entry form.
 *   (all three above are DATEONLY — no time-of-day of their own — so the
 *   clock time is always spliced in from the row's real paid_at/createdAt.)
 *   4. paid_at / createdAt / created_at — last-resort fallback only, for
 *      record types with none of the above (or a row that predates all of
 *      them), or a manually-entered mode where no real timestamp exists.
 */
export function invoiceOccurredAt(inv) {
  const anchorDate = modelValue(inv, 'business_date', 'purchase_date', 'date');
  const realTime = parseOccurredAt(modelValue(inv, 'paid_at', 'createdAt', 'created_at'));
  if (anchorDate) {
    const ymd = String(anchorDate).slice(0, 10);
    if (realTime) {
      const hh = String(realTime.getHours()).padStart(2, '0');
      const mm = String(realTime.getMinutes()).padStart(2, '0');
      const ss = String(realTime.getSeconds()).padStart(2, '0');
      const ms = String(realTime.getMilliseconds()).padStart(3, '0');
      // No timezone designator here on purpose — parsed as local time, same
      // as realTime's own wall-clock reading, so the time-of-day carries over
      // unchanged while the calendar date comes from the anchor date field.
      const combined = new Date(`${ymd}T${hh}:${mm}:${ss}.${ms}`);
      if (!Number.isNaN(combined.getTime())) return combined;
    }
    return parseOccurredAt(anchorDate);
  }
  return realTime;
}

/**
 * Persist a row on the shop's Transaction date, keeping the real clock only
 * for hours:minutes. POS / estimates / income / expense / purchases must not
 * store the wall-calendar day when Daily Closing is behind.
 */
export function stampOnTransactionDate(businessDate, clock = new Date()) {
  if (!businessDate) {
    if (clock instanceof Date) return Number.isNaN(clock.getTime()) ? new Date() : clock;
    return parseOccurredAt(clock) || new Date();
  }
  return invoiceOccurredAt({
    business_date: businessDate,
    created_at: clock,
  }) || (clock instanceof Date ? clock : new Date());
}

export function stampOnTransactionDateIso(businessDate, clock = new Date()) {
  const d = stampOnTransactionDate(businessDate, clock);
  return d instanceof Date ? d.toISOString() : String(d);
}

/**
 * Transaction date with NO time-of-day at all — unlike stampOnTransactionDate
 * (which keeps the real clock's hours:minutes), this always lands on
 * midnight of the given business date. For events like cancelling/returning
 * a bill, where only the day it happened should ever be stored or shown —
 * never the exact moment.
 */
export function dateOnlyStamp(businessDate) {
  if (!businessDate) return new Date();
  const ymd = String(businessDate).slice(0, 10);
  const d = new Date(`${ymd}T00:00:00.000`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function invoiceItemsOf(inv) {
  if (Array.isArray(inv?._hydratedItems)) return inv._hydratedItems;
  const parsed = parseMaybeJson(modelValue(inv, 'items'), []);
  return Array.isArray(parsed) ? parsed : [];
}

export function invoicePaymentsOf(inv) {
  const parsed = parseMaybeJson(modelValue(inv, 'payments'), []);
  return Array.isArray(parsed) ? parsed : [];
}

export function shopScope(shopId) {
  if (!shopId) return {};
  return { [Op.or]: [{ shop_id: shopId }, { shop_id: null }] };
}

/**
 * When Invoice.items JSON is empty, rebuild lines from invoice_items.snapshot_json.
 */
export async function hydrateInvoiceItems(invoices) {
  const list = invoices || [];
  const need = [];
  for (const inv of list) {
    const fromJson = parseMaybeJson(modelValue(inv, 'items'), []);
    if (Array.isArray(fromJson) && fromJson.length) {
      inv._hydratedItems = fromJson;
    } else {
      inv._hydratedItems = [];
      if (inv.id) need.push(inv.id);
    }
  }
  if (!need.length) return;

  let lines = [];
  try {
    lines = await InvoiceItem.findAll({ where: { invoice_id: { [Op.in]: need } } });
  } catch {
    return;
  }
  const byInv = new Map();
  for (const l of lines) {
    const snap = parseMaybeJson(modelValue(l, 'snapshot_json'), null);
    const row = snap && typeof snap === 'object' && !Array.isArray(snap)
      ? snap
      : {
        name: l.description,
        product_id: l.product_id,
        quantity: l.quantity,
        gross_weight: l.gross_weight,
        net_weight: l.net_weight,
        hsn_code: l.hsn_code,
        is_pure_metal: /pure/i.test(String(l.description || l.hsn_code || '')),
        line_type: /pure/i.test(String(l.description || '')) ? 'pure_metal' : undefined,
      };
    const arr = byInv.get(l.invoice_id) || [];
    arr.push(row);
    byInv.set(l.invoice_id, arr);
  }
  for (const inv of list) {
    if (inv._hydratedItems?.length) continue;
    inv._hydratedItems = byInv.get(inv.id) || [];
  }
}
