import { useState } from "react";
import { ArrowLeft, FileText } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { fmtINR, fmtWeight } from "@/lib/format";
import { useReportData } from "./useReportData";
import DataTable from "./DataTable";
import ReportViewModal from "./ReportViewModal";
import { currencyParticulars } from "@/lib/reportColumns";

const EXPORT_LIMIT = 200;

function formatTotalCell(column, value) {
  if (value == null) return "";
  if (column.format === "currency") return fmtINR(value);
  if (column.format === "weight") return fmtWeight(value);
  return value;
}

/**
 * Shared shell every Quick Report view composes from: on-screen table is kept
 * snappy with normal server-side pagination (useReportData), while "View
 * Report" fetches a fuller (up to EXPORT_LIMIT rows) same-filter snapshot for
 * printing/exporting — the backend caps list endpoints at 200 rows per call,
 * so that's the practical ceiling for a single generated document.
 */
export default function QuickReportShell({
  title,
  description,
  endpoint,
  params = {},
  columns,
  onBack,
  filterBar,
  emptyMessage,
  buildTotals,
  rowKey,
  exportLimit = EXPORT_LIMIT,
  defaultOrientation = "portrait",
  /** Optional render prop: (extra) => ReactNode, rendered below the table.
   *  `extra` is the full raw API response for the current page/filters, so a
   *  report can surface fields the generic table/footer don't (e.g. a
   *  category-wise breakdown) without the shell needing to know about them. */
  afterTable,
}) {
  const { rows, total, totals, extra, loading, page, setPage, pageSize } = useReportData(endpoint, params);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalRows, setModalRows] = useState([]);
  const [modalTotals, setModalTotals] = useState(null);
  const [preparing, setPreparing] = useState(false);

  const openReport = async () => {
    setPreparing(true);
    try {
      const { data } = await api.get(endpoint, { params: { ...params, limit: exportLimit, offset: 0 } });
      setModalRows(data.data || []);
      setModalTotals(data.totals || (buildTotals ? buildTotals(data.data || []) : null));
      setModalOpen(true);
    } catch {
      toast.error("Failed to prepare report");
    } finally {
      setPreparing(false);
    }
  };

  const filtersSummary = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
    .join(" · ");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#DED8CC] pb-3">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-[#D8D2C6] bg-[#FFFDF9] text-[#5E6861] transition hover:border-[#9EB2A6] hover:bg-[#F1F5F1] hover:text-[#315C4A]">
              <ArrowLeft size={16} strokeWidth={1.5} />
            </button>
          )}
          <div>
            <div className="font-display text-[15px] font-semibold tracking-[-0.01em] text-[#24332B]">{title}</div>
            {description && <div className="text-[12px] text-[#737373] mt-0.5">{description}</div>}
          </div>
        </div>
        <button className="btn-secondary !rounded-[9px] !border-[#D2CCBF] !bg-[#FFFDF9] hover:!border-[#9EB2A6] hover:!bg-[#F1F5F1]" onClick={openReport} disabled={preparing}>
          <FileText size={13} strokeWidth={1.5} /> {preparing ? "Preparing…" : "Print Summary"}
        </button>
      </div>

      {filterBar}

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        emptyMessage={emptyMessage}
        rowKey={rowKey}
        footer={totals ? (
          <tr className="table-row bg-[#F1EEE7] font-semibold">
            {columns.map((c, i) => (
              <td key={c.key} className={`table-td ${c.align === "right" ? "text-right tabular-nums" : ""}`}>
                {i === 0 ? "TOTAL" : formatTotalCell(c, totals[c.key])}
              </td>
            ))}
          </tr>
        ) : null}
      />

      {afterTable ? afterTable(extra) : null}

      <ReportViewModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        reportName={title}
        columns={columns}
        rows={modalRows}
        totals={modalTotals}
        filtersSummary={filtersSummary}
        defaultOrientation={defaultOrientation}
        summaryParticulars={currencyParticulars(columns, modalTotals)}
      />
    </div>
  );
}
