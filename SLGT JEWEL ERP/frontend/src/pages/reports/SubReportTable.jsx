import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import api from "@/lib/api";
import DataTable from "./DataTable";
import ReportViewModal from "./ReportViewModal";
import { sanitizeReportColumns, currencyParticulars } from "@/lib/reportColumns";

/**
 * Lightweight sub-report block used inside the existing tabs (Sales/GST/
 * Customers/Schemes/Purchases) to add a new aggregate section — e.g. "Sales by
 * Employee" — without touching the tab's existing state/behavior. Endpoints
 * used here return small, already-aggregated {data, totals?} payloads, so no
 * on-screen pagination is needed; "View Report" still opens the full
 * print/export modal against the same rows.
 */
export default function SubReportTable({ title, description, endpoint, params = {}, columns, emptyMessage, extra, chart, rowClassName }) {
  const [modalOpen, setModalOpen] = useState(false);
  const visibleColumns = sanitizeReportColumns(columns);
  const query = useQuery({
    queryKey: ["report", endpoint, params],
    queryFn: async () => {
      const { data } = await api.get(endpoint, { params });
      return data;
    },
  });

  const rows = query.data?.data || [];
  const totals = query.data?.totals || null;
  const extraNode = typeof extra === "function" ? extra(rows, query.data) : extra;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3 mt-6">
        <div>
          <h3 className="text-[13px] font-semibold text-[#0A0A0A]">{title}</h3>
          {description && <div className="text-[11.5px] text-[#737373] mt-0.5">{description}</div>}
        </div>
        <button className="btn-secondary !py-1 !text-[11.5px]" onClick={() => setModalOpen(true)}>
          <FileText size={12} strokeWidth={1.5} /> Print Summary
        </button>
      </div>
      {extraNode}
      {typeof chart === "function" && !query.isLoading ? (
        <div className="card mb-4 p-4">{chart(rows, totals)}</div>
      ) : null}
      <DataTable
        columns={visibleColumns}
        rows={rows}
        loading={query.isLoading}
        emptyMessage={emptyMessage || "No data for this period."}
        rowClassName={rowClassName}
      />
      <ReportViewModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        reportName={title}
        columns={visibleColumns}
        rows={rows}
        totals={totals}
        filtersSummary={Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ")}
        summaryParticulars={currencyParticulars(visibleColumns, totals)}
      />
    </div>
  );
}
