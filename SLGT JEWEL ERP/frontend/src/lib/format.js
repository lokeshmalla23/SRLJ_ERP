const inr2 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const inr0 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const number2 = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const number0 = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

/** User-facing rupee amount using Indian lakh/crore grouping. */
export const fmtINR = (n, options = {}) => {
  const value = Number(n);
  const safe = Number.isFinite(value) ? value : 0;
  return options.decimals === 0 ? inr0.format(safe) : inr2.format(safe);
};

/** Grouped money number without a currency symbol (print/input helper). */
export const fmtINRPlain = (n, options = {}) => {
  const value = Number(n);
  const safe = Number.isFinite(value) ? value : 0;
  return options.decimals === 0 ? number0.format(safe) : number2.format(safe);
};

/** Rupee rate shown per gram. */
export const fmtRatePerGram = (n) => `${fmtINR(n, { decimals: 0 })}/g`;

export const fmtNum = (n) =>
  new Intl.NumberFormat("en-IN").format(Number(n || 0));

/** Remove display grouping before calculations/API submission. */
export function parseMoneyInput(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const parsed = Number(String(value).replace(/[₹,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Format a money draft while preserving an entered decimal point and up to 2
 * decimal digits. Returns an empty string for an empty/invalid draft.
 */
export function formatMoneyInput(value, { maximumFractionDigits = 2 } = {}) {
  if (value == null || value === "") return "";
  const raw = String(value).replace(/[₹,\s]/g, "").replace(/[^\d.-]/g, "");
  const negative = raw.startsWith("-");
  const unsigned = raw.replace(/-/g, "");
  const [wholeRaw = "", ...fractionParts] = unsigned.split(".");
  const hasDecimal = unsigned.includes(".");
  const wholeDigits = wholeRaw.replace(/\D/g, "");
  const fraction = fractionParts.join("").replace(/\D/g, "").slice(0, maximumFractionDigits);
  if (!wholeDigits && !hasDecimal) return negative ? "-" : "";
  const grouped = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(
    Number(wholeDigits || 0),
  );
  return `${negative ? "-" : ""}${grouped}${hasDecimal ? `.${fraction}` : ""}`;
}

export const fmtWeight = (n) => `${Number(n || 0).toFixed(3)} g`;

/** "CUST-001" from a customer's per-shop serial_no — falls back to "—" when not yet assigned. */
export const fmtCustomerCode = (serialNo) =>
  serialNo == null ? "—" : `CUST-${String(serialNo).padStart(3, "0")}`;

const COUNT_SUMMARY_KEYS = new Set([
  "active_schemes",
  "total_members",
  "matured_schemes",
  "redeemed_schemes",
  "matched_count",
  "unmatched_count",
  "invoice_count",
  "scheme_count",
  "credit_note_count",
  "cancelled_count",
  "stock_pieces",
  "low_stock_count",
  "expense_count",
  "purchase_count",
  "visit_count",
  "product_count",
  "total_count",
  "total_customers",
  "total_products",
]);

/** True when a summary/column key is a count, not money. */
export function isCountSummaryKey(key) {
  const k = String(key || "");
  if (!k) return false;
  if (COUNT_SUMMARY_KEYS.has(k)) return true;
  if (/_(count|schemes|members|pieces|qty|quantity|invoices|bills|employees|visits|customers|products)$/i.test(k)) return true;
  if (/^(count|pieces|members|invoices|bills)$/i.test(k)) return true;
  return false;
}

/** Summary KPI: counts as numbers; weights as g; money as ₹. */
export function fmtSummaryKpi(key, value) {
  if (value == null) return "—";
  if (typeof value !== "number" || Number.isNaN(value)) return String(value);
  if (isCountSummaryKey(key)) return fmtNum(value);
  const k = String(key || "");
  if (/_(gross|net)$/i.test(k) || /weight/i.test(k)) return fmtWeight(value);
  if (/_pct$/i.test(k) || /percent|margin_pct/i.test(k)) return `${value}%`;
  return fmtINR(value);
}

export const fmtDate = (iso) => {
  if (!iso) return "—";
  const wall = readWallClock(iso);
  if (wall) {
    return `${pad2(wall.day)} ${MONTHS_SHORT[wall.month - 1]} ${wall.year}`;
  }
  const d = parseDateValue(iso);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

// Global "Show Transaction Time" preference (Settings → Billing). Off = every
// fmtDateTime() call anywhere in the app (accounts, reports, statements) falls
// back to a date-only string instead of date+time. A plain module-level flag,
// not React state — fmtDateTime is called from dozens of non-component call
// sites (report row builders, CSV/print exporters) that never render a
// component tree, so a context value wouldn't reach them. DisplayPrefsContext
// is what keeps this in sync with the persisted setting.
let SHOW_TRANSACTION_TIME = true;

/** Called by DisplayPrefsContext once the real setting loads (default true stays until then). */
export function setShowTransactionTime(value) {
  SHOW_TRANSACTION_TIME = value !== false;
}

export function getShowTransactionTime() {
  return SHOW_TRANSACTION_TIME;
}

/** e.g. 03 Aug 2026, 04:41 pm — keeps the stored clock (AM/PM), not a shifted TZ.
 *  Drops the time portion entirely when the "Show Transaction Time" setting is off. */
export const fmtDateTime = (iso) => {
  if (!iso) return "—";
  if (!SHOW_TRANSACTION_TIME) return fmtDate(iso);
  const wall = readWallClock(iso);
  if (wall) {
    const { hour12, mer } = to12Hour(wall.hour);
    return `${pad2(wall.day)} ${MONTHS_SHORT[wall.month - 1]} ${wall.year}, ${pad2(hour12)}:${pad2(wall.minute)} ${mer}`;
  }
  const d = parseDateValue(iso);
  if (!d) return "—";
  const datePart = d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const timePart = d
    .toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/\u202f/g, " ")
    .replace(/\s*(am|pm)/i, (_, mer) => ` ${mer.toLowerCase()}`);
  return `${datePart}, ${timePart}`;
};

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function to12Hour(hour24) {
  const mer = hour24 >= 12 ? "pm" : "am";
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, mer };
}

/** Prefer wall-clock from ISO/Postgres strings so AM/PM matches what was stored. */
function readWallClock(iso) {
  if (iso instanceof Date) {
    if (Number.isNaN(iso.getTime())) return null;
    return {
      year: iso.getFullYear(),
      month: iso.getMonth() + 1,
      day: iso.getDate(),
      hour: iso.getHours(),
      minute: iso.getMinutes(),
    };
  }
  const raw = String(iso || "").trim();
  // DATEONLY (YYYY-MM-DD) — no time component
  const dayOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dayOnly) {
    return {
      year: Number(dayOnly[1]),
      month: Number(dayOnly[2]),
      day: Number(dayOnly[3]),
      hour: 0,
      minute: 0,
    };
  }
  // Full timestamp — parse as a real instant and read it back in local time.
  // A stored UTC value (e.g. "...T05:54:00+00:00") must convert to the
  // equivalent local wall-clock time, not display its raw UTC digits.
  const d = parseDateValue(raw);
  if (!d) return null;
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
  };
}

function parseDateValue(iso) {
  if (iso instanceof Date) {
    return Number.isNaN(iso.getTime()) ? null : iso;
  }
  const raw = String(iso).trim();
  if (!raw) return null;
  const normalized = raw
    .replace(" ", "T")
    .replace(/ ([+-]\d{2}:\d{2})$/, "$1")
    .replace(/ ([+-]\d{2})(\d{2})$/, "$1:$2");
  let d = new Date(normalized);
  if (Number.isNaN(d.getTime())) d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}