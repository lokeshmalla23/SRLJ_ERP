import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageLoadingBadge } from "@/components/ui/Skeletons";
import { renderReportCell, sanitizeReportColumns } from "@/lib/reportColumns";

/**
 * Reusable, server-side-paginated report table. Every Quick Report / enhanced
 * tab table renders through this instead of hand-rolling its own <table>.
 *
 * columns: [{ key, label, align: 'left'|'right', render?: (row) => node }]
 */
export default function DataTable({
  columns,
  rows,
  loading = false,
  page = 1,
  pageSize = 25,
  total = 0,
  onPageChange,
  emptyMessage = "No data found.",
  onRowClick,
  rowClassName,
  footer,
}) {
  const visibleColumns = sanitizeReportColumns(columns);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (loading) {
    return (
      <div className="space-y-3">
        <PageLoadingBadge />
        <div className="h-64 rounded-xl border border-[#E1DBD0] shimmer" />
      </div>
    );
  }

  return (
    <div>
      <div className="table-shell overflow-x-auto !rounded-xl !border-[#D8D2C6] shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)]">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="table-head-row !bg-[#F1EEE7] !border-[#DDD7CA]">
              {visibleColumns.map((c) => (
                <th key={c.key} className={`table-th !text-[#6C746F] ${c.align === "right" ? "text-right" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="table-td !border-[#E6E1D7] py-10 text-center text-[#747B76]">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr
                  key={row.id ?? idx}
                  className={`table-row ${onRowClick ? "cursor-pointer hover:bg-[#F7F5EF]" : ""} ${typeof rowClassName === "function" ? rowClassName(row, idx) : (rowClassName || "")}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {visibleColumns.map((c) => (
                    <td key={c.key} className={`table-td !border-[#E6E1D7] ${c.align === "right" ? "text-right tabular-nums" : ""}`}>
                      {c.render ? c.render(row, idx, { page, pageSize }) : renderReportCell(c, row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>

      {onPageChange && total > pageSize && (
        <div className="mt-3 flex items-center justify-between text-[12px] text-[#6F7772]">
          <div>
            Page {page} of {totalPages} · {total} record{total === 1 ? "" : "s"}
          </div>
          <div className="flex items-center gap-1.5 [&_.btn-secondary]:!rounded-[9px] [&_.btn-secondary]:!border-[#D2CCBF] [&_.btn-secondary]:!bg-[#FFFDF9] [&_.btn-secondary]:hover:!border-[#9EB2A6] [&_.btn-secondary]:hover:!bg-[#F1F5F1]">
            <button
              className="btn-secondary !py-1 !px-2"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft size={14} strokeWidth={1.5} />
            </button>
            <button
              className="btn-secondary !py-1 !px-2"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
