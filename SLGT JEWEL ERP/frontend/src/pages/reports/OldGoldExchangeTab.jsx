import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, Printer, Download, X, RefreshCw } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { fmtINR, fmtDateTime } from "@/lib/format";
import { SimplePieChart } from "@/components/charts/SimpleCharts";
import { PageLoadingBadge } from "@/components/ui/Skeletons";
import { generateInvoicePrintHTMLAsync, downloadInvoicePdf } from "@/lib/invoicePrint";
import { printHtml } from "@/lib/printHtml";
import ReportViewModal from "./ReportViewModal";

const PAGE_SIZE = 50;
const GOLD_PURITY_SUGGESTIONS = ["24K", "22K", "20K", "18.5K", "18K", "14K", "916", "750"];
const SILVER_PURITY_SUGGESTIONS = ["999", "925", "900", "800", "70%"];
const STATUS_LABEL = { exchanged: "Exchanged", returned_to_customer: "Returned to Customer" };
const EMPTY_SUMMARY = {
  total_weight: 0,
  total_value: 0,
  this_month_weight: 0,
  this_month_value: 0,
  total_weight_by_purity: [],
  this_month_weight_by_purity: [],
};

function WeightByPurityCard({ label, items }) {
  const list = (items || []).filter((x) => Number(x.weight) > 0);
  return (
    <div className="rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] p-3.5 shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
      <div className="text-[11px] text-[#737373] uppercase tracking-wide">{label}</div>
      {list.length === 0 ? (
        <div className="text-lg font-semibold tabular-nums mt-0.5">0.000 g</div>
      ) : (
        <div className="mt-1.5 space-y-0.5">
          {list.map((x) => (
            <div key={x.purity} className="flex items-baseline justify-between gap-2 text-[13px] tabular-nums">
              <span className="text-[#525252] font-medium">{x.purity}</span>
              <span className="font-semibold text-[#0A0A0A]">{Number(x.weight).toFixed(3)} g</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
const EMPTY_FILTERS = { from: "", to: "", customer: "", phone: "", purity: "", status: "", invoice_no: "" };

/** "03 Aug 2026, 04:41 pm" -> { date: "03 Aug 2026", time: "04:41 pm" } */
function splitDateTime(iso) {
  const full = fmtDateTime(iso);
  if (!full || full === "—") return { date: "—", time: "—" };
  const idx = full.indexOf(",");
  if (idx === -1) return { date: full, time: "—" };
  return { date: full.slice(0, idx), time: full.slice(idx + 1).trim() };
}

function Card({ label, value }) {
  return (
    <div className="rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] p-3.5 shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
      <div className="text-[11px] text-[#737373] uppercase tracking-wide">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

export default function OldGoldExchangeTab({ includeHidden = false, metal = "gold" }) {
  const isSilver = metal === "silver";
  const title = isSilver ? "Old Silver Exchange" : "Old Gold Exchange";
  const PURITY_SUGGESTIONS = isSilver ? SILVER_PURITY_SUGGESTIONS : GOLD_PURITY_SUGGESTIONS;
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [company, setCompany] = useState({});
  const [viewRow, setViewRow] = useState(null);
  const [busyRowId, setBusyRowId] = useState(null);
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [summaryRows, setSummaryRows] = useState([]);
  const [summaryPurity, setSummaryPurity] = useState([]);
  const [printBusy, setPrintBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/reports/old-gold/exchange", {
      params: {
        from: filters.from || undefined,
        to: filters.to || undefined,
        customer: filters.customer || undefined,
        phone: filters.phone || undefined,
        purity: filters.purity || undefined,
        status: filters.status || undefined,
        invoice_no: filters.invoice_no || undefined,
        metal: isSilver ? "silver" : "gold",
        include_hidden: includeHidden ? 1 : undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      },
    })
      .then(({ data }) => setReport(data))
      .catch((e) => toast.error(formatApiError(e)))
      .finally(() => setLoading(false));
  }, [filters, page, includeHidden, isSilver]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get("/settings/company").then(({ data }) => setCompany(data || {})).catch(() => {});
  }, []);

  const setFilter = (k, v) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };
  const clearFilters = () => { setPage(1); setFilters(EMPTY_FILTERS); };

  const rows = report?.data || [];
  const total = report?.total || 0;
  const summary = report?.summary || EMPTY_SUMMARY;
  const pieData = (report?.purity_distribution || []).map((r) => ({ name: r.purity, value: r.weight }));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchInvoice = async (invoiceId) => {
    const { data } = await api.get(`/invoices/${invoiceId}`);
    return data;
  };

  const transactionAt = (row) => row?.invoice_at || row?.created_at;

  const filtersSummary = [
    filters.from ? `From: ${filters.from}` : null,
    filters.to ? `To: ${filters.to}` : null,
    filters.customer ? `Customer: ${filters.customer}` : null,
    filters.phone ? `Phone: ${filters.phone}` : null,
    filters.purity ? `Purity: ${filters.purity}` : null,
    filters.status ? `Status: ${filters.status}` : null,
    filters.invoice_no ? `Invoice: ${filters.invoice_no}` : null,
  ].filter(Boolean).join(" · ") || "None";

  const openPrintSummary = async () => {
    setPrintBusy(true);
    try {
      const { data } = await api.get("/reports/old-gold/exchange", {
        params: {
          from: filters.from || undefined,
          to: filters.to || undefined,
          customer: filters.customer || undefined,
          phone: filters.phone || undefined,
          purity: filters.purity || undefined,
          status: filters.status || undefined,
          invoice_no: filters.invoice_no || undefined,
          metal: isSilver ? "silver" : "gold",
          limit: 2000,
          offset: 0,
        },
      });
      setSummaryRows(data.data || []);
      setSummaryPurity(data.purity_totals || []);
      setSummaryModalOpen(true);
    } catch (err) {
      toast.error(formatApiError(err) || "Failed to prepare print summary");
    } finally {
      setPrintBusy(false);
    }
  };

  const ogPrintColumns = [
    { key: "invoice_no", label: "Invoice Number", printWidth: "12%" },
    { key: "customer_name", label: "Customer Name", printWidth: "16%" },
    { key: "customer_phone", label: "Phone Number", printWidth: "12%" },
    { key: "weight_g", label: "Weight", format: "weight", align: "right", printWidth: "10%" },
    { key: "purity", label: "Purity", printWidth: "8%" },
    { key: "rate", label: "Rate/g", format: "currency", align: "right", printWidth: "10%" },
    { key: "value", label: "Value", format: "currency", align: "right", printWidth: "12%" },
    { key: "status", label: "Status", printWidth: "10%", exportValue: (r) => STATUS_LABEL[r.status] || r.status },
    { key: "invoice_date", label: "Date", format: "date", printWidth: "10%", exportValue: (r) => transactionAt(r) },
    { key: "invoice_time", label: "Time", printWidth: "10%", exportValue: (r) => splitDateTime(transactionAt(r)).time },
  ];

  const purityClosing = (() => {
    const rows = (summaryPurity || []).map((p, i) => ({
      sno: i + 1,
      purity: p.purity,
      total_weight: p.total_weight,
      total_value: p.total_value,
    }));
    const totalWeight = rows.reduce((s, r) => s + (Number(r.total_weight) || 0), 0);
    const totalValue = rows.reduce((s, r) => s + (Number(r.total_value) || 0), 0);
    return [{
      title: "Total:",
      columns: [
        { key: "sno", label: "S.No", align: "right" },
        { key: "purity", label: "Purity" },
        { key: "total_weight", label: "Total Weight", format: "weight", align: "right" },
        { key: "total_value", label: "Total Value", format: "currency", align: "right" },
      ],
      rows,
      totals: rows.length ? {
        sno: "",
        purity: "TOTAL",
        total_weight: Math.round(totalWeight * 1000) / 1000,
        total_value: totalValue,
      } : null,
    }];
  })();

  const withRowBusy = async (row, fn) => {
    if (!row.invoice_id) return toast.error("No invoice linked to this record");
    setBusyRowId(row.id);
    try {
      await fn();
    } catch (err) {
      toast.error(formatApiError(err) || "Something went wrong");
    } finally {
      setBusyRowId(null);
    }
  };

  const handlePrint = (row) => withRowBusy(row, async () => {
    const invoice = await fetchInvoice(row.invoice_id);
    const html = await generateInvoicePrintHTMLAsync(invoice, company, "print");
    await printHtml(html);
  });

  const handleDownload = (row) => withRowBusy(row, async () => {
    const invoice = await fetchInvoice(row.invoice_id);
    await downloadInvoicePdf(invoice, company);
  });

  return (
    <div className="space-y-4">
      {/* Dashboard cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <WeightByPurityCard label="Total Weight" items={summary.total_weight_by_purity} />
        <WeightByPurityCard label="This Month Weight" items={summary.this_month_weight_by_purity} />
        <Card label="Total Exchange Value" value={fmtINR(summary.total_value)} />
        <Card label="This Month Exchange Value" value={fmtINR(summary.this_month_value)} />
      </div>

      {/* Purity distribution */}
      <div className="rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] p-3.5 shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
        <div className="text-xs font-semibold uppercase text-[#737373] mb-1">Purity Distribution (active exchanged gold)</div>
        <SimplePieChart data={pieData} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[#D8D2C6] bg-[#FBF8F1] p-3.5 shadow-[0_1px_2px_rgba(38,52,43,0.04)] [&_.btn-secondary]:!rounded-[9px] [&_.btn-secondary]:!border-[#D2CCBF] [&_.btn-secondary]:!bg-[#FFFDF9] [&_.input]:!rounded-[9px] [&_.input]:!border-[#CFC8BB] [&_.input]:focus:!border-[#3D6B5B] [&_.input]:focus:!shadow-[0_0_0_3px_rgba(61,107,91,0.10)]">
        <Field label="Date From">
          <input type="date" className="input" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} />
        </Field>
        <Field label="Date To">
          <input type="date" className="input" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} />
        </Field>
        <Field label="Customer">
          <input className="input" placeholder="Customer name" value={filters.customer} onChange={(e) => setFilter("customer", e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className="input" placeholder="Phone number" value={filters.phone} onChange={(e) => setFilter("phone", e.target.value)} />
        </Field>
        <Field label="Purity">
          <input className="input" list="og-exchange-purity-options" placeholder="Any" value={filters.purity} onChange={(e) => setFilter("purity", e.target.value)} />
          <datalist id="og-exchange-purity-options">
            {PURITY_SUGGESTIONS.map((p) => <option key={p} value={p} />)}
          </datalist>
        </Field>
        <Field label="Status">
          <select className="input" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
            <option value="">All</option>
            <option value="exchanged">Exchanged</option>
            <option value="returned_to_customer">Returned to Customer</option>
          </select>
        </Field>
        <Field label="Invoice Number">
          <input className="input" placeholder="Invoice no." value={filters.invoice_no} onChange={(e) => setFilter("invoice_no", e.target.value)} />
        </Field>
        <button type="button" className="btn-secondary text-xs" onClick={clearFilters}>Clear</button>
        <button type="button" className="btn-secondary text-xs" onClick={load} disabled={loading}>
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
        <div className="ml-auto">
          <button
            type="button"
            className="btn-secondary !py-1 !text-[11.5px]"
            onClick={openPrintSummary}
            disabled={printBusy || total === 0}
          >
            <Download size={12} strokeWidth={1.5} /> {printBusy ? "Preparing…" : "Print Summary"}
          </button>
        </div>
      </div>

      {loading ? <PageLoadingBadge /> : null}

      {/* Table */}
      <div className="overflow-x-auto overflow-hidden rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)]">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="bg-[#F1EEE7] text-left text-[12px] text-[#737373]">
              <th className="px-3 py-2">Invoice Number</th>
              <th className="px-3 py-2">Customer Name</th>
              <th className="px-3 py-2">Phone Number</th>
              <th className="px-3 py-2 text-right">Weight</th>
              <th className="px-3 py-2">Purity</th>
              <th className="px-3 py-2 text-right">Rate/g</th>
              <th className="px-3 py-2 text-right">Value</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-[#a3a3a3]">No old gold exchange records found.</td>
              </tr>
            ) : rows.map((r) => {
              const { date, time } = splitDateTime(transactionAt(r));
              const busy = busyRowId === r.id;
              return (
                <tr key={r.id} className="border-t" style={{ borderColor: "#D8D2C6" }}>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.invoice_no || "—"}</td>
                  <td className="px-3 py-2">{r.customer_name || "—"}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.customer_phone || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.weight_g.toFixed(3)} g</td>
                  <td className="px-3 py-2">{r.purity || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtINR(r.rate, { decimals: 0 })}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtINR(r.value)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${r.status === "exchanged" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[12px]">{date}</td>
                  <td className="px-3 py-2 text-[12px]">{time}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <button type="button" title="View" onClick={() => setViewRow(r)} className="text-[#737373] hover:text-[#0A0A0A]">
                        <Eye size={14} strokeWidth={1.5} />
                      </button>
                      <button type="button" title="Print" disabled={busy} onClick={() => handlePrint(r)} className="text-[#737373] hover:text-[#0A0A0A] disabled:opacity-40">
                        <Printer size={14} strokeWidth={1.5} />
                      </button>
                      <button type="button" title="Download" disabled={busy} onClick={() => handleDownload(r)} className="text-[#737373] hover:text-[#0A0A0A] disabled:opacity-40">
                        <Download size={14} strokeWidth={1.5} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-[12px] text-[#737373]">
          <div>Page {page} of {totalPages} · {total} record{total === 1 ? "" : "s"}</div>
          <div className="flex items-center gap-1.5">
            <button className="btn-secondary !py-1 !px-2" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
            <button className="btn-secondary !py-1 !px-2" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}

      {viewRow && (
        <ViewModal
          row={viewRow}
          onClose={() => setViewRow(null)}
          onPrint={() => handlePrint(viewRow)}
          onDownload={() => handleDownload(viewRow)}
          busy={busyRowId === viewRow.id}
        />
      )}

      <ReportViewModal
        open={summaryModalOpen}
        onClose={() => setSummaryModalOpen(false)}
        reportName={title}
        columns={ogPrintColumns}
        rows={summaryRows}
        totals={null}
        filtersSummary={filtersSummary}
        defaultOrientation="landscape"
        closingTables={purityClosing}
      />
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.06em] text-[#a3a3a3] mb-1">{label}</span>
      {children}
    </label>
  );
}

function ViewModal({ row, onClose, onPrint, onDownload, busy }) {
  const { date, time } = splitDateTime(row.invoice_at || row.created_at);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C2621]/50 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_22px_60px_rgba(20,31,25,0.22)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#DDD7CA] bg-[#FBF8F1] px-5 py-4">
          <div className="text-[15px] font-semibold text-[#0A0A0A]">{title}</div>
          <button onClick={onClose} className="text-[#a3a3a3] hover:text-[#0A0A0A]"><X size={18} strokeWidth={1.5} /></button>
        </div>
        <div className="p-5 space-y-2 text-[13px]">
          <Row label="Invoice Number" value={row.invoice_no || "—"} />
          <Row label="Invoice Serial No." value={row.invoice_serial ?? "—"} />
          <Row label="Customer" value={row.customer_name || "—"} />
          <Row label="Phone" value={row.customer_phone || "—"} />
          <Row label="Weight" value={`${row.weight_g.toFixed(3)} g`} />
          <Row label="Purity" value={row.purity || "—"} />
          <Row label="Rate/g" value={fmtINR(row.rate)} />
          <Row label="Exchange Value" value={fmtINR(row.value)} bold />
          <Row label="Status" value={STATUS_LABEL[row.status] || row.status} />
          <Row label="Date" value={date} />
          <Row label="Time" value={time} />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#DDD7CA] bg-[#FBF8F1] p-4 [&_.btn-primary]:!rounded-[9px] [&_.btn-primary]:!border-[#315C4A] [&_.btn-primary]:!bg-[#315C4A] [&_.btn-secondary]:!rounded-[9px] [&_.btn-secondary]:!border-[#D2CCBF] [&_.btn-secondary]:!bg-white">
          <button className="btn-secondary flex items-center gap-1.5" disabled={busy || !row.invoice_id} onClick={onDownload}>
            <Download size={13} strokeWidth={1.5} /> Download
          </button>
          <button className="btn-primary flex items-center gap-1.5" disabled={busy || !row.invoice_id} onClick={onPrint}>
            <Printer size={13} strokeWidth={1.5} /> Print
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[#737373]">{label}</span>
      <span className={bold ? "font-semibold text-[#0A0A0A]" : "text-[#0A0A0A]"}>{value}</span>
    </div>
  );
}
