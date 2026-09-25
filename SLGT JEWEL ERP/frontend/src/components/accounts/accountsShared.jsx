import { useMemo, useState } from "react";
import { Loader2, Download, Printer } from "lucide-react";
import { exportReportCsv, exportReportExcel } from "@/lib/reportExport";
import { buildReportPrintHTML } from "@/lib/reportPrint";
import { renderReportCell, sanitizeReportColumns } from "@/lib/reportColumns";
import { fmtINR } from "@/lib/format";

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export { fmtINR };
export { fmtSummaryKpi, fmtNum as fmtCount, isCountSummaryKey, fmtDateTime } from "@/lib/format";

export const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

/** Current local clock time as HH:MM — default for a new Expense/Income's time field. */
export const currentTimeHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** "10 Sep 2026, 14:30" when a time is recorded, else just the date. */
export const fmtDateTimeParts = (dateStr, timeStr) =>
  timeStr ? `${fmtDate(dateStr)}, ${timeStr}` : fmtDate(dateStr);

/** Payment types used across Expenses / Income entry forms in Accounts. */
export const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
];

const ymd = (x) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

/**
 * The from/to for a given preset id — the ONE place this is computed, so the
 * highlighted preset button and the actual fetched range can never disagree
 * (they used to: the initial state only special-cased "this_month" and
 * silently fell back to a 30-day window for every other preset, including
 * "today", while the button still showed "Today" as selected).
 */
function rangeForPreset(id) {
  const t = today();
  if (id === "today") return { from: t, to: t };
  if (id === "yesterday") {
    const y = daysAgo(1);
    return { from: y, to: y };
  }
  if (id === "this_week") return { from: daysAgo(6), to: t };
  if (id === "this_month") {
    const d = new Date();
    return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, to: t };
  }
  if (id === "last_month") {
    const d = new Date();
    const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const last = new Date(d.getFullYear(), d.getMonth(), 0);
    return { from: ymd(first), to: ymd(last) };
  }
  if (id === "this_year") return { from: `${new Date().getFullYear()}-01-01`, to: t };
  // "custom" (or anything unrecognized) — no computed range; caller keeps
  // whatever from/to is already set.
  return null;
}

/**
 * Shared from/to + quick-preset date range state, used by any Accounts tab
 * that needs its own independent period filter (ERP Statement, Info tab
 * sections). Each caller owns its own instance, so e.g. two sections on the
 * same screen can be on different periods at once.
 */
export function useAccountsDateRange(defaultPreset = "this_month") {
  const [preset, setPreset] = useState(defaultPreset);
  const initial = rangeForPreset(defaultPreset) || { from: daysAgo(30), to: today() };
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  const applyPreset = (id) => {
    setPreset(id);
    const range = rangeForPreset(id);
    if (!range) return;
    setFrom(range.from);
    setTo(range.to);
  };

  return { preset, from, to, setFrom, setTo, applyPreset };
}

export const DATE_PRESETS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "this_week", label: "This Week" },
  { id: "this_month", label: "This Month" },
  { id: "last_month", label: "Last Month" },
  { id: "this_year", label: "This Year" },
  { id: "custom", label: "Custom" },
];

export function AccountsKpiCard({ label, value, sub, tone = "default" }) {
  const toneCls =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50/60"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50/60"
        : tone === "bad"
          ? "border-red-200 bg-red-50/60"
          : "border-[#EADFBF] bg-white";
  return (
    <div className={`rounded-xl border p-3.5 shadow-sm ${toneCls}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-[#737373]">{label}</div>
      <div className="mt-1 text-lg font-semibold text-[#0A0A0A] tabular-nums">{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-[#737373]">{sub}</div> : null}
    </div>
  );
}

export function AccountsFilterBar({
  from,
  to,
  preset,
  onFrom,
  onTo,
  onPreset,
  onRefresh,
  loading,
  children,
  exportRows,
  exportColumns,
  exportTitle,
}) {
  const cols = exportColumns || [];
  const print = () => {
    if (!exportRows?.length || !cols.length) return;
    const html = buildReportPrintHTML({
      title: exportTitle || "Accounts Report",
      columns: cols,
      rows: exportRows,
      filtersSummary: from && to ? `${from} → ${to}` : "",
    });
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
      w.focus();
      w.print();
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-[#EADFBF] bg-[#FDFBF7] p-3">
      <div className="flex flex-wrap gap-1">
        {DATE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPreset?.(p.id)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              preset === p.id
                ? "bg-[#B49042] text-white"
                : "bg-white text-[#525252] border border-[#E5E7EB]"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label className="text-[11px] text-[#737373]">
        From
        <input
          type="date"
          value={from}
          onChange={(e) => onFrom?.(e.target.value)}
          className="ml-1 rounded border border-[#E5E7EB] bg-white px-2 py-1 text-xs"
        />
      </label>
      <label className="text-[11px] text-[#737373]">
        To
        <input
          type="date"
          value={to}
          onChange={(e) => onTo?.(e.target.value)}
          className="ml-1 rounded border border-[#E5E7EB] bg-white px-2 py-1 text-xs"
        />
      </label>
      {children}
      <button
        type="button"
        onClick={onRefresh}
        className="inline-flex items-center gap-1 rounded-lg bg-[#0A0A0A] px-3 py-1.5 text-xs font-medium text-white"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        Refresh
      </button>
      {exportRows?.length && cols.length ? (
        <>
          <button
            type="button"
            onClick={() =>
              exportReportCsv({ title: exportTitle || "accounts", columns: cols, rows: exportRows })
            }
            className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          <button
            type="button"
            onClick={() =>
              exportReportExcel({ title: exportTitle || "accounts", columns: cols, rows: exportRows })
            }
            className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs"
          >
            <Download className="h-3.5 w-3.5" /> Excel
          </button>
          <button
            type="button"
            onClick={print}
            className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs"
          >
            <Printer className="h-3.5 w-3.5" /> Print
          </button>
        </>
      ) : null}
    </div>
  );
}

export function AccountsTable({ columns, rows, empty = "No records" }) {
  const cols = useMemo(() => sanitizeReportColumns(columns || []), [columns]);
  if (!rows?.length) {
    return (
      <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-white p-8 text-center text-sm text-[#737373]">
        {empty}
      </div>
    );
  }
  return (
    <div className="overflow-auto rounded-xl border border-[#E5E7EB] bg-white">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-[#F9FAFB] text-[11px] uppercase tracking-wide text-[#737373]">
          <tr>
            {cols.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-3 py-2 font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i} className="border-t border-[#F3F4F6] hover:bg-[#FDFBF7]">
              {cols.map((c) => (
                <td key={c.key} className="whitespace-nowrap px-3 py-2 text-[#0A0A0A] tabular-nums">
                  {c.render ? c.render(r) : renderReportCell(c, r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const ACCOUNTS_NAV_GROUPS = [
  {
    id: "overview",
    label: "Overview",
    items: [
      { id: "opening-setup", label: "Opening Setup", hint: "One-time go-live balances (do this first)" },
      { id: "dashboard", label: "Dashboard", hint: "KPIs & today" },
    ],
  },
  {
    id: "ops",
    label: "Daily ops",
    items: [
      { id: "daily-closing", label: "Day Closing" },
      { id: "day-book", label: "Day Book" },
      { id: "info", label: "Info", hint: "Liquid totals, inventory, pure metal & old gold at a glance" },
    ],
  },
  {
    id: "sales-ar",
    label: "Sales & receivables",
    items: [
      { id: "sales", label: "Sales Accounts" },
      { id: "receivables", label: "Customer Receivables" },
      { id: "receipts", label: "Receipts" },
      { id: "customer-ledger", label: "Customer Ledger" },
      { id: "employee-sales", label: "Employee Sales" },
      { id: "income", label: "Income" },
    ],
  },
  {
    id: "purchases-ap",
    label: "Purchases & payables",
    items: [
      { id: "purchases", label: "Purchase Accounts" },
      { id: "payables", label: "Vendor Payables" },
      { id: "payments", label: "Payments" },
      { id: "vendor-ledger", label: "Vendor Ledger" },
      { id: "expenses", label: "Expenses" },
    ],
  },
  {
    id: "cash-bank",
    label: "Cash & bank",
    items: [
      { id: "cash-book", label: "Cash Book" },
      { id: "bank-book", label: "Bank Book" },
      { id: "reconciliation", label: "Bank Reconciliation" },
    ],
  },
  {
    id: "transfers",
    label: "Transfer payments",
    items: [
      { id: "transfer-payments", label: "Transfer payments", hint: "Move money between Cash, Bank, UPI & Card" },
    ],
  },
  {
    id: "hidden-data",
    label: "Hidden Data",
    items: [
      {
        id: "hidden-data",
        label: "Hidden Data",
        hint: "Hidden-bill cash, bank, UPI, card and old gold — owner view only",
      },
    ],
  },
  {
    id: "metal-tax",
    label: "Metal, schemes & tax",
    items: [
      { id: "metal", label: "Gold / Metal" },
      { id: "schemes", label: "Scheme Accounts" },
      { id: "gst", label: "GST / Tax" },
    ],
  },
  {
    id: "statements",
    label: "Statements & control",
    items: [
      { id: "erp-statement", label: "ERP Statement", hint: "Passbook of every ERP transaction" },
      { id: "statements", label: "P&L / Balance Sheet / TB" },
      { id: "audit", label: "Audit Trail" },
      { id: "integrity", label: "Integrity / Cutover" },
    ],
  },
];

export const OPENING_SETUP_SECTION = "opening-setup";

/** Opening Setup stays visible so the COMPLETED / PENDING status can be reviewed.
 * Hidden Data is owner-only and appears only after hidden bills are unlocked.
 * `isVisible(level, id)` applies the Application Management section-visibility
 * toggle (level: "category" | "item") on top of the hidden-data filter. */
export function filterAccountsNavGroups(groups, { includeHidden = false, isVisible = () => true } = {}) {
  return (groups || [])
    .filter((g) => (includeHidden || g.id !== "hidden-data") && isVisible("category", g.id))
    .map((g) => ({
      ...g,
      items: (g.items || []).filter((i) => (includeHidden || i.id !== "hidden-data") && isVisible("item", i.id)),
    }))
    // A category whose items were all individually hidden shouldn't render an empty tab.
    .filter((g) => g.items.length > 0);
}

export const ACCOUNTS_NAV = ACCOUNTS_NAV_GROUPS.flatMap((g) => g.items);

export function sectionMeta(sectionId) {
  for (const g of ACCOUNTS_NAV_GROUPS) {
    const item = g.items.find((i) => i.id === sectionId);
    if (item) return { ...item, group: g.label, groupId: g.id };
  }
  return { id: sectionId, label: sectionId, group: "Accounts", groupId: "overview" };
}
