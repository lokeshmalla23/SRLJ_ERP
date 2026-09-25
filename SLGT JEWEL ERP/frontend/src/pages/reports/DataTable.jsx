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
        <div className="h-64 shimmer rounded-md" />
      </div>
    );
  }

  return (
    <div>
      <div className="table-shell overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="table-head-row">
              {visibleColumns.map((c) => (
                <th key={c.key} className={`table-th ${c.align === "right" ? "text-right" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="table-td text-center text-[#737373] py-10">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr
                  key={row.id ?? idx}
                  className={`table-row ${onRowClick ? "cursor-pointer hover:bg-[#FAFAFA]" : ""} ${typeof rowClassName === "function" ? rowClassName(row, idx) : (rowClassName || "")}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {visibleColumns.map((c) => (
                    <td key={c.key} className={`table-td ${c.align === "right" ? "text-right tabular-nums" : ""}`}>
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
        <div className="flex items-center justify-between mt-3 text-[12px] text-[#737373]">
          <div>
            Page {page} of {totalPages} · {total} record{total === 1 ? "" : "s"}
          </div>
          <div className="flex items-center gap-1.5">
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
