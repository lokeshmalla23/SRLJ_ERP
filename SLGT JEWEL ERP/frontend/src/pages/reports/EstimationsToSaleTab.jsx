import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, RefreshCw } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { fmtINR, fmtDateTime } from "@/lib/format";
import { PageLoadingBadge } from "@/components/ui/Skeletons";
import ReportViewModal from "./ReportViewModal";

const PAGE_SIZE = 50;
const EMPTY_FILTERS = { from: "", to: "", q: "" };

/** "03 Aug 2026, 04:41 pm" -> { date: "03 Aug 2026", time: "04:41 pm" } */
function splitDateTime(iso) {
  const full = fmtDateTime(iso);
  if (!full || full === "—") return { date: "—", time: "—" };
  const idx = full.indexOf(",");
  if (idx === -1) return { date: full, time: "—" };
  return { date: full.slice(0, idx), time: full.slice(idx + 1).trim() };
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.06em] text-[#a3a3a3] mb-1">{label}</span>
      {children}
    </label>
  );
}

export default function EstimationsToSaleTab() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [summaryRows, setSummaryRows] = useState([]);
  const [printBusy, setPrintBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/reports/sales/estimations-to-sale", {
      params: {
        from: filters.from || undefined,
        to: filters.to || undefined,
        q: filters.q || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      },
    })
      .then(({ data }) => setReport(data))
      .catch((e) => toast.error(formatApiError(e)))
      .finally(() => setLoading(false));
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (k, v) => { setPage(1); setFilters((f) => ({ ...f, [k]: v })); };
  const clearFilters = () => { setPage(1); setFilters(EMPTY_FILTERS); };

  const rows = report?.data || [];
  const total = report?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filtersSummary = [
    filters.from ? `From: ${filters.from}` : null,
    filters.to ? `To: ${filters.to}` : null,
    filters.q ? `Search: ${filters.q}` : null,
  ].filter(Boolean).join(" · ") || "None";

  const openPrintSummary = async () => {
    setPrintBusy(true);
    try {
      const { data } = await api.get("/reports/sales/estimations-to-sale", {
        params: {
          from: filters.from || undefined,
          to: filters.to || undefined,
          q: filters.q || undefined,
          limit: 2000,
          offset: 0,
        },
      });
      setSummaryRows(data.data || []);
      setSummaryModalOpen(true);
    } catch (err) {
      toast.error(formatApiError(err) || "Failed to prepare print summary");
    } finally {
      setPrintBusy(false);
    }
  };

  const printColumns = [
    { key: "quote_no", label: "Estimation No", printWidth: "14%" },
    { key: "invoice_no", label: "Invoice No", printWidth: "14%" },
    { key: "customer_name", label: "Customer Name", printWidth: "22%" },
    { key: "customer_mobile", label: "Mobile", printWidth: "14%" },
    { key: "grand_total", label: "Amount", format: "currency", align: "right", printWidth: "14%" },
    { key: "converted_date", label: "Date", printWidth: "11%", exportValue: (r) => splitDateTime(r.converted_at).date },
    { key: "converted_time", label: "Time", printWidth: "11%", exportValue: (r) => splitDateTime(r.converted_at).time },
  ];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[#D8D2C6] bg-[#FBF8F1] p-3.5 shadow-[0_1px_2px_rgba(38,52,43,0.04)] [&_.btn-secondary]:!rounded-[9px] [&_.btn-secondary]:!border-[#D2CCBF] [&_.btn-secondary]:!bg-[#FFFDF9] [&_.input]:!rounded-[9px] [&_.input]:!border-[#CFC8BB] [&_.input]:focus:!border-[#3D6B5B] [&_.input]:focus:!shadow-[0_0_0_3px_rgba(61,107,91,0.10)]">
        <Field label="Date From">
          <input type="date" className="input" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} />
        </Field>
        <Field label="Date To">
          <input type="date" className="input" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} />
        </Field>
        <Field label="Search">
          <input
            className="input"
            placeholder="Estimation no, invoice no, customer or mobile"
            value={filters.q}
            onChange={(e) => setFilter("q", e.target.value)}
          />
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
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="bg-[#F1EEE7] text-left text-[12px] text-[#737373]">
              <th className="px-3 py-2">Estimation No</th>
              <th className="px-3 py-2">Invoice No</th>
              <th className="px-3 py-2">Customer Name</th>
              <th className="px-3 py-2">Mobile</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[#a3a3a3]">No converted estimations found.</td>
              </tr>
            ) : rows.map((r) => {
              const { date, time } = splitDateTime(r.converted_at);
              return (
                <tr key={r.quotation_id} className="border-t" style={{ borderColor: "#D8D2C6" }}>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.quote_no || "—"}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.invoice_no || "—"}</td>
                  <td className="px-3 py-2">{r.customer_name || "—"}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{r.customer_mobile || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtINR(r.grand_total)}</td>
                  <td className="px-3 py-2 text-[12px]">{date}</td>
                  <td className="px-3 py-2 text-[12px]">{time}</td>
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

      <ReportViewModal
        open={summaryModalOpen}
        onClose={() => setSummaryModalOpen(false)}
        reportName="Estimations to Sale"
        columns={printColumns}
        rows={summaryRows}
        totals={null}
        filtersSummary={filtersSummary}
        defaultOrientation="landscape"
      />
    </div>
  );
}
