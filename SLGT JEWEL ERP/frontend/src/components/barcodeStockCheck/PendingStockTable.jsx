import { fmtWeight } from "@/lib/format";
import EmptyState from "@/components/common/EmptyState";
import { PackageSearch, ChevronLeft, ChevronRight } from "lucide-react";

const STATUS_META = {
  pending: { label: "Pending", cls: "chip chip-warning" },
  in_progress: { label: "In Progress", cls: "chip chip-gold" },
  completed: { label: "Completed", cls: "chip chip-success" },
};

export default function PendingStockTable({ data, loading, page, onPageChange }) {
  const items = data?.items || [];
  const total = data?.total || 0;
  const pageSize = data?.page_size || 50;
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);

  if (!loading && items.length === 0) {
    return (
      <EmptyState
        title="Nothing pending"
        description="No barcoded stock matches the current filters."
        icon={PackageSearch}
      />
    );
  }

  return (
    <div>
      <div className="table-shell overflow-x-auto !rounded-[10px] !border-[#E2E7E2] shadow-[0_1px_2px_rgba(23,56,42,0.04)]">
        <table className="w-full">
          <thead>
            <tr className="table-head-row">
              <th className="table-th">Barcode</th>
              <th className="table-th">Item</th>
              <th className="table-th">Category</th>
              <th className="table-th">Purity</th>
              <th className="table-th text-right">Expected</th>
              <th className="table-th text-right">Scanned</th>
              <th className="table-th text-right">Pending</th>
              <th className="table-th text-right">Gross Wt</th>
              <th className="table-th text-right">Net Wt</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr><td colSpan={10} className="table-td text-center text-[#89928C] py-8">Loading…</td></tr>
            ) : (
              items.map((r) => {
                const meta = STATUS_META[r.status] || STATUS_META.pending;
                return (
                  <tr key={r.barcode} className="table-row">
                    <td className="table-td font-mono text-[12.5px]">{r.barcode}</td>
                    <td className="table-td">
                      <div className="text-[13px] font-medium text-[#17201C]">{r.item_name || "—"}</div>
                      <div className="text-[11px] text-[#6F7772]">{r.subcategory_name || r.counter_name || ""}</div>
                    </td>
                    <td className="table-td text-[12.5px] text-[#4E5A53]">{r.category_name || "—"}</td>
                    <td className="table-td text-[12.5px] text-[#4E5A53]">{r.purity_name || "—"}</td>
                    <td className="table-td text-right font-mono text-[12.5px]">{r.expected_quantity}</td>
                    <td className="table-td text-right font-mono text-[12.5px]">{r.scanned_quantity}</td>
                    <td className="table-td text-right font-mono text-[12.5px]">{r.pending_quantity}</td>
                    <td className="table-td text-right font-mono text-[12.5px]">{fmtWeight(r.gross_weight)}</td>
                    <td className="table-td text-right font-mono text-[12.5px]">{fmtWeight(r.net_weight)}</td>
                    <td className="table-td">
                      <span className={meta.cls}>{meta.label}</span>
                      {r.over_scanned && <span className="chip chip-danger ml-1.5 text-[10px]">Discrepancy</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between mt-3 px-3 py-2 rounded-[10px] border border-[#E2E7E2] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(23,56,42,0.04)]">
          <div className="text-[11.5px] text-[#6F7772]">
            {total} barcode{total !== 1 ? "s" : ""} · page {page} of {pageCount}
          </div>
          <div className="flex items-center gap-1.5">
            <button className="btn-secondary !px-2 !py-1.5" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              <ChevronLeft size={14} strokeWidth={1.5} />
            </button>
            <button className="btn-secondary !px-2 !py-1.5" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
              <ChevronRight size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
