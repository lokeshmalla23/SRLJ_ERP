/**
 * Mirrors backend/src/utils/invoiceRead.js's invoiceOccurredAt() — keep these
 * two in sync. The DATE always comes from the record's transaction-date
 * field (business_date / purchase_date / date); the TIME always comes from
 * the record's real clock timestamp (paid_at / createdAt / created_at) —
 * never mixed the other way, and never midnight unless no real timestamp
 * exists at all. This is what keeps the same transaction showing the same
 * date and time everywhere in the app (POS, reports, receipts, hidden bills).
 */

function pick(record, ...keys) {
  if (!record) return undefined;
  for (const k of keys) {
    const v = record[k];
    if (v != null && v !== "") return v;
  }
  return undefined;
}

function parseOccurredAt(raw) {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const n = raw > 1e12 ? raw : raw > 1e9 ? raw * 1000 : NaN;
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  let s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2} /.test(s)) s = s.replace(" ", "T");
  s = s.replace(/ ([+-]\d{2}:?\d{2})$/, "$1");
  s = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function invoiceOccurredAt(record) {
  const anchorDate = pick(record, "business_date", "purchase_date", "date");
  const realTime = parseOccurredAt(pick(record, "paid_at", "createdAt", "created_at"));
  if (anchorDate) {
    const ymd = String(anchorDate).slice(0, 10);
    if (realTime) {
      const hh = String(realTime.getHours()).padStart(2, "0");
      const mm = String(realTime.getMinutes()).padStart(2, "0");
      const ss = String(realTime.getSeconds()).padStart(2, "0");
      const ms = String(realTime.getMilliseconds()).padStart(3, "0");
      const combined = new Date(`${ymd}T${hh}:${mm}:${ss}.${ms}`);
      if (!Number.isNaN(combined.getTime())) return combined;
    }
    return parseOccurredAt(anchorDate);
  }
  return realTime;
}

function transactionDay(record) {
  const anchor = pick(record, "business_date", "purchase_date", "date");
  if (anchor) return String(anchor).slice(0, 10);
  const d = invoiceOccurredAt(record);
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Latest transaction date first (POS / estimation / customer bill history).
 *  Within the same business day, highest invoice number wins — spliced
 *  clock time would put SSJ-1/0001 above 0002 when 0002 was saved later
 *  on a pinned transaction date. */
export function sortByOccurredAtDesc(rows = []) {
  return [...rows].sort((a, b) => {
    const db = transactionDay(b);
    const da = transactionDay(a);
    if (db !== da) return db.localeCompare(da);
    const nb = String(b.invoice_no || b.quote_no || "");
    const na = String(a.invoice_no || a.quote_no || "");
    if (nb !== na) return nb.localeCompare(na, undefined, { numeric: true });
    const tb = parseOccurredAt(pick(b, "createdAt", "created_at"))?.getTime() || 0;
    const ta = parseOccurredAt(pick(a, "createdAt", "created_at"))?.getTime() || 0;
    return tb - ta;
  });
}

/** Latest invoice number first (sales registers — not clock created_at). */
export function sortByInvoiceNoDesc(rows = []) {
  return [...rows].sort((a, b) =>
    String(b.invoice_no || b.quote_no || "").localeCompare(
      String(a.invoice_no || a.quote_no || ""),
      undefined,
      { numeric: true },
    ),
  );
}
