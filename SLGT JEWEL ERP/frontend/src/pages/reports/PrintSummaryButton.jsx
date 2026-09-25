import { useState } from "react";
import { Download } from "lucide-react";
import ReportViewModal from "./ReportViewModal";

/**
 * Shared Print Summary control used by report tables. Opens the same
 * ReportViewModal / buildReportPrintHTML path as Sales Workspace.
 */
export default function PrintSummaryButton({
  reportName,
  columns,
  rows,
  totals = null,
  filtersSummary = "",
  defaultOrientation = "portrait",
  summaryParticulars = null,
  closingTables = [],
  disabled = false,
  allowEmpty = false,
  className = "btn-secondary !rounded-[9px] !border-[#D2CCBF] !bg-[#FFFDF9] !py-1 !text-[11.5px] hover:!border-[#9EB2A6] hover:!bg-[#F1F5F1]",
}) {
  const [open, setOpen] = useState(false);
  const empty = !rows?.length;

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled || (empty && !allowEmpty)}
        onClick={() => setOpen(true)}
      >
        <Download size={12} strokeWidth={1.5} /> Print Summary
      </button>
      <ReportViewModal
        open={open}
        onClose={() => setOpen(false)}
        reportName={reportName}
        columns={columns}
        rows={rows || []}
        totals={totals}
        filtersSummary={filtersSummary}
        defaultOrientation={defaultOrientation}
        summaryParticulars={summaryParticulars}
        closingTables={closingTables}
      />
    </>
  );
}
