import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { fmtDate, fmtCustomerCode } from "@/lib/format";
import ReportViewModal from "@/pages/reports/ReportViewModal";
import {
  AccountsFilterBar,
  AccountsKpiCard,
  daysAgo,
  fmtINR,
  today,
} from "./accountsShared";

function useRange(defaultPreset = "this_month") {
  const currentMonthStart = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  };
  const [preset, setPreset] = useState(defaultPreset);
  const [from, setFrom] = useState(() =>
    defaultPreset === "this_month" ? currentMonthStart() : daysAgo(30),
  );
  const [to, setTo] = useState(today());

  const applyPreset = (id) => {
    setPreset(id);
    if (id === "custom") return;
    const t = today();
    if (id === "today") {
      setFrom(t);
      setTo(t);
    } else if (id === "yesterday") {
      const y = daysAgo(1);
      setFrom(y);
      setTo(y);
    } else if (id === "this_week") {
      setFrom(daysAgo(6));
      setTo(t);
    } else if (id === "this_month") {
      const d = new Date();
      setFrom(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
      setTo(t);
    } else if (id === "last_month") {
      const d = new Date();
      const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const last = new Date(d.getFullYear(), d.getMonth(), 0);
      const ymd = (x) =>
        `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
      setFrom(ymd(first));
      setTo(ymd(last));
    } else if (id === "this_year") {
      setFrom(`${new Date().getFullYear()}-01-01`);
      setTo(t);
    }
  };

  return { preset, from, to, setFrom, setTo, applyPreset };
}

const moneyOrDash = (n) => (Number(n) > 0 ? fmtINR(n) : "—");

const PRINT_COLUMNS = [
  { key: "occurred_at", label: "Date", format: "date" },
  { key: "customer_code", label: "Customer ID" },
  { key: "invoice_no", label: "Invoice No" },
  { key: "description", label: "Description" },
  { key: "debit", label: "Debit", format: "currency", align: "right" },
  { key: "credit", label: "Credit", format: "currency", align: "right" },
  { key: "balance", label: "Balance", format: "currency", align: "right" },
];

const ROW_FILTERS = [
  { id: "all", label: "All" },
  { id: "liquid", label: "Liquid" },
  { id: "non_cash", label: "Non-cash" },
];

function rowInvoiceNo(row) {
  const direct = String(row?.invoice_no || "").trim();
  if (direct) return direct;
  const desc = String(row?.description || "");
  const m = desc.match(/\b[A-Z]{2,}\d*-\d+\/\d+\b/i);
  return m ? m[0] : "";
}

function invoiceRank(no) {
  const m = String(no || "").match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Shop-local calendar day — never UTC ISO prefix, which splits one billing date. */
function statementCalendarDay(row) {
  if (row?.business_day) return String(row.business_day).slice(0, 10);
  const iso = row?.occurred_at;
  if (!iso) return "";
  const s = String(iso).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function recordedTs(row) {
  if (Number.isFinite(Number(row?._recency)) && Number(row._recency) > 0) return Number(row._recency);
  const n = Date.parse(row?.recorded_at || "");
  return Number.isFinite(n) ? n : 0;
}

function decorateRecency(rows) {
  const maxByInvoice = new Map();
  for (const r of rows) {
    const no = rowInvoiceNo(r);
    if (!no) continue;
    const ts = Date.parse(r?.recorded_at || "") || 0;
    maxByInvoice.set(no, Math.max(maxByInvoice.get(no) || 0, ts));
  }
  return rows.map((r) => {
    const no = rowInvoiceNo(r);
    const own = Date.parse(r?.recorded_at || "") || 0;
    return { ...r, _recency: no ? (maxByInvoice.get(no) || own) : own };
  });
}

function compareStatementAsc(a, b) {
  const da = statementCalendarDay(a);
  const db = statementCalendarDay(b);
  if (da !== db) return da.localeCompare(db);
  const ra = recordedTs(a);
  const rb = recordedTs(b);
  if (ra !== rb) return ra - rb;
  const ia = invoiceRank(rowInvoiceNo(a));
  const ib = invoiceRank(rowInvoiceNo(b));
  if (ia !== ib) return ia - ib;
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function orderStatementNewestFirst(rows, opening) {
  const gl = [];
  const rest = [];
  for (const r of rows) {
    if (r?.id === "gl-reconcile" || r?.source_type === "gl_reconciliation") gl.push(r);
    else rest.push(r);
  }
  const decorated = decorateRecency(rest);
  const asc = [...decorated].sort(compareStatementAsc);
  let running = opening;
  const round = (n) => Math.round(n * 100) / 100;
  const dated = asc.map((r) => {
    if (r.affects_liquid_balance !== false && r.settlement_type !== "non_cash") {
      running = round(running + (Number(r.credit) || 0) - (Number(r.debit) || 0));
    }
    return { ...r, balance: running };
  });
  return [...dated.reverse(), ...gl];
}

/** Consecutive rows with the same invoice_no share one Customer ID + Invoice No cell. */
function invoiceGroupSpans(rows) {
  const spans = new Array(rows.length).fill(1);
  let i = 0;
  while (i < rows.length) {
    const no = String(rows[i]?.invoice_no || "").trim();
    if (!no || rows[i]?.isOpening) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < rows.length && String(rows[j]?.invoice_no || "").trim() === no) j += 1;
    spans[i] = j - i;
    for (let k = i + 1; k < j; k += 1) spans[k] = 0;
    i = j;
  }
  return spans;
}

export default function ErpStatementTab({ includeHidden = false }) {
  const range = useRange("this_month");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [rowFilter, setRowFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/accounts/erp-statement", {
        params: {
          from: range.from,
          to: range.to,
          include_hidden: includeHidden ? 1 : undefined,
        },
        timeout: 60000,
      });
      setData(res.data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, includeHidden]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handler = (e) => {
      const t = e.detail?.type;
      if (["invoice:created", "invoice:cancelled", "product:changed", "order:changed", "accounts:opening_saved", "accounts:opening_setup_complete"].includes(t)) load();
    };
    window.addEventListener("realtime", handler);
    return () => window.removeEventListener("realtime", handler);
  }, [load]);

  const tableRows = useMemo(() => {
    const opening = Number(data?.opening_balance) || 0;
    const openingAt = data?.from ? `${data.from}T00:00:00` : null;
    const head = {
      id: "opening",
      occurred_at: openingAt,
      business_day: data?.from || null,
      description: data?.opening_note || "Opening balance",
      debit: 0,
      credit: 0,
      balance: opening,
      isOpening: true,
    };
    const ordered = orderStatementNewestFirst(data?.rows || [], opening);
    return opening !== 0 ? [head, ...ordered] : ordered;
  }, [data]);

  // "Liquid" keeps its existing meaning unchanged: every row that affects the
  // real cash/bank position (which already includes Old Gold Sale/Disposal —
  // that's genuine liquid money). "Non-cash" is a DIFFERENT lens entirely: the
  // Old Gold Stock asset account itself — Old Gold Exchange (gold received)
  // and Old Gold Sale/Disposal (gold given up) both belong there too, even
  // though the sale is *also* shown under Liquid — one transaction can be
  // both "real cash came in" and "gold stock went out" at once.
  const isGoldStockRow = (r) => r.settlement_type === "non_cash" || r.source_type === "old_gold_sale";
  const filteredRows = useMemo(() => {
    if (rowFilter === "all") return tableRows;
    if (rowFilter === "non_cash") return tableRows.filter((r) => !r.isOpening && isGoldStockRow(r));
    // "Liquid": unchanged from before — only old-gold-exchange (non_cash) is
    // excluded; old_gold_sale stays, since it's genuine liquid money.
    return tableRows.filter((r) => r.isOpening || r.settlement_type !== "non_cash");
  }, [tableRows, rowFilter]);

  // Non-cash reclassifies WHICH COLUMN each old-gold row lands in (Old Gold
  // Exchange = Debit, Old Gold Sale/Disposal = Credit) — but the running
  // total keeps the exact same Credit − Debit arithmetic used everywhere
  // else in this statement (All, Liquid). Only the classification flips,
  // not the formula.
  const round = (n) => Math.round(n * 100) / 100;
  const displayRows = useMemo(() => {
    if (rowFilter !== "non_cash") return filteredRows;
    const chron = [...filteredRows].reverse();
    let running = 0;
    const withBalance = chron.map((r) => {
      const isExchange = r.source_type === "old_gold_exchange" || r.source_type === "old_silver_exchange";
      const debit = isExchange ? Number(r.credit) || 0 : Number(r.debit) || 0;
      const credit = isExchange ? Number(r.debit) || 0 : Number(r.credit) || 0;
      running = round(running + credit - debit);
      return { ...r, debit, credit, balance: running };
    });
    return withBalance.reverse();
  }, [filteredRows, rowFilter]);

  const printRows = useMemo(
    () =>
      displayRows.map((r) => ({
        occurred_at: r.business_day || statementCalendarDay(r) || r.occurred_at,
        customer_code: r.isOpening ? "" : fmtCustomerCode(r.customer_serial),
        invoice_no: r.invoice_no || "",
        description: r.description,
        debit: Number(r.debit) > 0 ? r.debit : "",
        credit: Number(r.credit) > 0 ? r.credit : "",
        balance: r.balance,
      })),
    [displayRows],
  );

  const invoiceSpans = useMemo(() => invoiceGroupSpans(displayRows), [displayRows]);

  // "All" and "Liquid" both reflect the TRUE liquid cash/bank position —
  // old-gold-exchange rows are still visible in the row list under "All",
  // but gold value was never part of the real cash balance, so lumping it
  // into "Closing" there would be accounting-wrong either way. "Non-cash"
  // gets its own distinct totals (of just what's shown), same Credit − Debit
  // formula as everywhere else — only which column each row lands in changed.
  const totals = useMemo(() => {
    if (rowFilter === "non_cash") {
      const credit = displayRows.reduce((s, r) => s + (Number(r.credit) || 0), 0);
      const debit = displayRows.reduce((s, r) => s + (Number(r.debit) || 0), 0);
      return { opening: 0, credit: round(credit), debit: round(debit), balance: round(credit - debit) };
    }
    return {
      opening: round(Number(data?.opening_balance) || 0),
      credit: round(Number(data?.total_credit) || 0),
      debit: round(Number(data?.total_debit) || 0),
      balance: round(Number(data?.closing_balance) || 0),
    };
  }, [data, displayRows, rowFilter]);

  const paymentModeClosing = useMemo(() => {
    const mt = data?.mode_totals || {};
    const toNum = (v) => Number(v) || 0;
    const rows = [
      { label: "Cash", value: toNum(mt.cash) },
      { label: "UPI", value: toNum(mt.upi) },
      { label: "Bank", value: toNum(mt.bank) },
      { label: "Cheque", value: toNum(mt.cheque) },
      { label: "Old Gold Exchange", value: toNum(mt.old_gold_exchange) },
      { label: "Old Silver Exchange", value: toNum(mt.old_silver_exchange) },
    ];
    const total = rows.reduce((s, r) => s + r.value, 0);
    return [{
      title: "Total:",
      columns: [
        { key: "label", label: "Mode" },
        { key: "value", label: "Amount", format: "currency", align: "right" },
      ],
      rows,
      totals: { label: "TOTAL", value: total },
    }];
  }, [data]);

  const filtersSummary = data
    ? `Period: ${data.from} to ${data.to} · Opening ${fmtINR(totals.opening)} · Closing ${fmtINR(totals.balance)}`
    : "";

  return (
    <div>
      <AccountsFilterBar
        from={range.from}
        to={range.to}
        preset={range.preset}
        onFrom={(v) => {
          range.setFrom(v);
          range.applyPreset("custom");
        }}
        onTo={(v) => {
          range.setTo(v);
          range.applyPreset("custom");
        }}
        onPreset={range.applyPreset}
        onRefresh={load}
        loading={loading}
      >
        <button
          type="button"
          onClick={() => setReportOpen(true)}
          disabled={!data}
          className="inline-flex items-center gap-1 rounded-[9px] border border-[#315C4A] bg-[#315C4A] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#244A3A] disabled:opacity-50"
        >
          <Printer className="h-3.5 w-3.5" /> Print Preview
        </button>
        <button
          type="button"
          onClick={() => setReportOpen(true)}
          disabled={!data}
          className="inline-flex items-center gap-1 rounded-[9px] border border-[#D2CCBF] bg-[#FFFDF9] px-2.5 py-1.5 text-xs transition hover:border-[#9EB2A6] hover:bg-[#F1F5F1] disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> Download
        </button>
        <div className="inline-flex overflow-hidden rounded-[9px] border border-[#D2CCBF] bg-[#FFFDF9]">
          {ROW_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setRowFilter(f.id)}
              className={`px-2.5 py-1.5 text-xs font-medium ${
                rowFilter === f.id
                  ? "bg-[#315C4A] text-white"
                  : "bg-[#FFFDF9] text-[#59635D] hover:bg-[#F1F5F1]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </AccountsFilterBar>

      {data ? (
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <AccountsKpiCard label="Opening" value={fmtINR(totals.opening)} />
          <AccountsKpiCard label="Total Credit" value={fmtINR(totals.credit)} tone="good" />
          <AccountsKpiCard label="Total Debit" value={fmtINR(totals.debit)} tone="warn" />
          <AccountsKpiCard label="Closing" value={fmtINR(totals.balance)} tone="good" />
        </div>
      ) : null}

      {loading && !data ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-[#D5CFC3] bg-[#FFFDF9] p-10 text-sm text-[#737B76]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading statement…
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)]">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-[#F1EEE7] text-[11px] uppercase tracking-[0.06em] text-[#68716B] shadow-[0_1px_0_#DDD7CA]">
              <tr>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Date</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Customer ID</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Invoice No</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Debit</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Credit</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                  {rowFilter === "non_cash" ? "Old Gold Stock" : "Balance"}
                </th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r, idx) => {
                const span = invoiceSpans[idx];
                const showParty = span > 0;
                return (
                <tr
                  key={r.id}
                  className={`border-t border-[#E6E1D7] hover:bg-[#F7F5EF] ${
                    r.isOpening ? "bg-[#FBF8F1] font-medium" : ""
                  }`}
                >
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[#0A0A0A]">
                    {fmtDate(r.business_day || statementCalendarDay(r) || r.occurred_at)}
                  </td>
                  {showParty ? (
                    <>
                      <td
                        rowSpan={span}
                        className="whitespace-nowrap px-3 py-2 align-middle font-mono text-[#0A0A0A]"
                      >
                        {r.isOpening ? "—" : fmtCustomerCode(r.customer_serial)}
                      </td>
                      <td
                        rowSpan={span}
                        className="whitespace-nowrap px-3 py-2 align-middle font-mono text-[#0A0A0A]"
                      >
                        {r.invoice_no || "—"}
                      </td>
                    </>
                  ) : null}
                  <td className="max-w-[420px] px-3 py-2 whitespace-normal text-[#0A0A0A]">
                    {r.description}
                    {rowFilter !== "non_cash" && r.settlement_type === "non_cash" ? (
                      <span className="ml-2 inline-block rounded-full border border-[#EADFBF] bg-[#FDFBF7] px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-[#B49042]">
                        Non-cash / Gold
                      </span>
                    ) : null}
                    {rowFilter === "non_cash" ? (
                      <span className="ml-2 inline-block rounded-full border border-[#EADFBF] bg-[#FDFBF7] px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-[#B49042]">
                        {r.source_type === "old_gold_sale" ? "Stock out" : "Stock in"}
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#B45309]">
                    {moneyOrDash(r.debit)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#15803D]">
                    {moneyOrDash(r.credit)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-medium text-[#0A0A0A]">
                    {fmtINR(r.balance)}
                  </td>
                </tr>
                );
              })}
              {!displayRows.length && !loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-[#737373]">
                    No transactions in this period
                  </td>
                </tr>
              ) : null}
            </tbody>
            {data ? (
              <tfoot>
                <tr className="border-t-2 border-[#315C4A] bg-[#EEF3EF] font-semibold text-[#24332B]">
                  <td className="px-3 py-2" colSpan={4}>
                    {rowFilter === "non_cash" ? "Old Gold Stock movement" : "Closing balance"} · {displayRows.filter((r) => !r.isOpening).length} transaction{displayRows.filter((r) => !r.isOpening).length === 1 ? "" : "s"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(totals.debit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(totals.credit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(totals.balance)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}

      <ReportViewModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        reportName="ERP Statement"
        columns={PRINT_COLUMNS}
        rows={printRows}
        totals={totals}
        filtersSummary={filtersSummary}
        defaultOrientation="portrait"
        closingTables={paymentModeClosing}
      />
    </div>
  );
}
