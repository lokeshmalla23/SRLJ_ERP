import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText, Search } from "lucide-react";
import api from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { productStatusLabel } from "@/lib/productStatus";
import { FilterBar, FilterInput } from "../FilterBar";
import DataTable from "../DataTable";
import ReportViewModal from "../ReportViewModal";

const columns = [
  { key: "stage", label: "Movement Type" },
  { key: "from", label: "From", render: (r) => r.from || "—" },
  { key: "to", label: "To", render: (r) => r.to || "—" },
  { key: "employee", label: "Employee", render: (r) => r.employee || "—" },
  { key: "date", label: "Date", format: "datetime", render: (r) => fmtDateTime(r.date) },
  { key: "remarks", label: "Remarks", render: (r) => r.remarks || "—" },
];

/** Requires a specific tag/barcode — the lifecycle view is inherently per-item. */
export default function ItemMovementReport({ onBack, includeHidden = false }) {
  const [tag, setTag] = useState("");
  const [searched, setSearched] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const query = useQuery({
    queryKey: ["report", "item-movement", searched, includeHidden],
    queryFn: async () => {
      const { data } = await api.get("/reports/inventory/item-movement", {
        params: { tag_number: searched, include_hidden: includeHidden ? 1 : undefined },
      });
      return data;
    },
    enabled: Boolean(searched),
  });

  const rows = query.data?.data || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="text-[#737373] hover:text-[#0A0A0A]">
              <ArrowLeft size={16} strokeWidth={1.5} />
            </button>
          )}
          <div>
            <div className="text-[15px] font-display font-semibold text-[#0A0A0A]">Item Movement</div>
            <div className="text-[12px] text-[#737373] mt-0.5">Track the lifecycle of a jewellery item</div>
          </div>
        </div>
        {searched && (
          <button className="btn-secondary" onClick={() => setModalOpen(true)}>
            <FileText size={13} strokeWidth={1.5} /> Print Summary
          </button>
        )}
      </div>

      <FilterBar>
        <FilterInput label="Tag Number / Barcode" value={tag} onChange={setTag} placeholder="Enter a tag number or barcode" />
        <button className="btn-primary self-end !py-1.5" onClick={() => setSearched(tag)} disabled={!tag}>
          <Search size={13} strokeWidth={1.5} /> Trace
        </button>
      </FilterBar>

      {!searched ? (
        <div className="card text-center py-12 text-[#737373] text-[13px]">
          Enter a tag number or barcode above to trace its full lifecycle.
        </div>
      ) : query.isError ? (
        <div className="card text-center py-12 text-[#991B1B] text-[13px]">
          No item found matching "{searched}".
        </div>
      ) : (
        <>
          {query.data?.product && (
            <div className="card mb-4 text-[12.5px]">
              <span className="font-semibold">{query.data.product.name}</span>
              <span className="text-[#737373]"> · Barcode {query.data.product.barcode || "—"} · Current status: {query.data.product.status_label || productStatusLabel(query.data.product.status)}</span>
            </div>
          )}
          <DataTable columns={columns} rows={rows} loading={query.isLoading} emptyMessage="No movement recorded for this item yet." />
        </>
      )}

      <ReportViewModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        reportName="Item Movement"
        columns={columns}
        rows={rows}
        totals={null}
        filtersSummary={`Tag/Barcode: ${searched}`}
      />
    </div>
  );
}
