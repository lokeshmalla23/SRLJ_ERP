import { fmtDate, fmtDateTime, fmtINR, isCountSummaryKey } from "@/lib/format";

/** Internal DB keys — never show in Reports / Accounts tables or exports. */
const HIDDEN_REPORT_KEYS = new Set([
  "id",
  "uuid",
  "shop_id",
  "journal_entry_id",
  "invoice_id",
  "product_id",
  "parent_id",
]);

/** Keys ending with these suffixes stay visible (not treated as internal IDs). */
const VISIBLE_ID_LIKE_SUFFIXES = [
  "_no",
  "_code",
];

export function isHiddenReportColumn(key) {
  const k = String(key || "").trim();
  if (!k) return true;
  if (HIDDEN_REPORT_KEYS.has(k)) return true;
  if (/_uuid$/i.test(k)) return true;
  if (/_id$/i.test(k)) {
    return !VISIBLE_ID_LIKE_SUFFIXES.some((s) => k.endsWith(s));
  }
  return false;
}

/** Column def may set `forceShow: true` to intentionally surface an id-like key. */
export function sanitizeReportColumns(columns) {
  return (columns || [])
    .filter((c) => c?.key && !c.hidden && (c.forceShow || !isHiddenReportColumn(c.key)))
    .map((c) => ({ ...c, format: c.format || inferReportColumnFormat(c.key) }));
}

export function inferReportColumnFormat(key) {
  const k = String(key || "");
  if (isCountSummaryKey(k)) return undefined;
  if (isHiddenReportColumn(k)) return undefined;
  if (/(_name|_no|_code|_type|_mode|_status|_phone|_mobile|_email)$/i.test(k)) return undefined;
  if (/name|status|mode|phone|mobile|email|invoice_no|barcode|voucher_no|po_number/i.test(k)) return undefined;
  if (/(^|_)(amount|total|balance|debit|credit|paid|due|value|gst_amount|cgst|sgst|igst|price|expense|revenue|subtotal|discount|sales|taxable|cash|upi|bank|old_metal|old_silver)(_|$)/i.test(k)) {
    return "currency";
  }
  if (shouldUseDateTimeFormat(k)) return "datetime";
  if (/date/i.test(k)) return "date";
  return undefined;
}

export function shouldUseDateTimeFormat(key) {
  const k = String(key || "");
  return /^(first|last)_purchase$|_purchase_at$|_at$|^timestamp$|^datetime$|^time_added$|^created_at$|^updated_at$|^paid_at$|^occurred_at$|^booked_at$|^closed_at$|^redeemed_at$|^sent_at$|^approved_at$|^last_seen_at$|^last_sync_at$/i.test(k);
}

export function inferColumnsFromRow(sample, { max = 10 } = {}) {
  const skipObjects = new Set(["items", "payments", "notes", "lines"]);
  return Object.keys(sample || {})
    .filter((k) => !skipObjects.has(k) && !isHiddenReportColumn(k) && typeof sample[k] !== "object")
    .slice(0, max)
    .map((k) => ({
      key: k,
      label: humanizeColumnLabel(k),
      format: inferReportColumnFormat(k),
    }));
}

export function humanizeColumnLabel(key) {
  return String(key || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function currencyParticulars(columns, totals) {
  if (!totals) return null;
  const rows = (columns || [])
    .filter((c) => c.format === "currency" && totals[c.key] != null)
    .map((c) => ({ particular: c.label, total: totals[c.key] }));
  return rows.length ? rows : null;
}

export function sumNumericKeys(rows, keys) {
  const totals = {};
  for (const key of keys) {
    totals[key] = (rows || []).reduce((s, r) => s + (Number(r[key]) || 0), 0);
  }
  return totals;
}

export function renderReportCell(col, row) {
  const raw = col.exportValue ? col.exportValue(row) : row[col.key];
  if (raw == null || raw === "") return "—";
  if (col.format === "currency") return fmtINR(raw);
  if (col.format === "datetime") return fmtDateTime(raw);
  if (col.format === "date") return fmtDate(raw);
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  return String(raw);
}
