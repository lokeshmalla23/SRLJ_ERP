import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ArrowLeft, FileText } from "lucide-react";
import api from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { productStatusLabel } from "@/lib/productStatus";
import { FilterBar, FilterInput } from "../FilterBar";
import DataTable from "../DataTable";
import ReportViewModal from "../ReportViewModal";

const PAGE_SIZE = 25;

/**
 * Tag History is search-driven: searching a tag/barcode returns that one
 * item's full (small, unpaginated) event ledger; leaving it blank browses a
 * paginated shop-wide audit log instead. The two response shapes differ
 * enough that this bypasses QuickReportShell's single-shape pagination
 * assumption and talks to the endpoint directly.
 */
export default function TagHistoryReport({ onBack, includeHidden = false }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);

  const query = useQuery({
    queryKey: ["report", "tag-history", search, page, includeHidden],
    queryFn: async () => {
      const params = search
        ? { tag_number: search, include_hidden: includeHidden ? 1 : undefined }
        : { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, include_hidden: includeHidden ? 1 : undefined };
      const { data } = await api.get("/reports/inventory/tag-history", { params });
      return data;
    },
    placeholderData: keepPreviousData,
  });

  const singleTagMode = Boolean(search && query.data?.product);
  const rows = query.data?.data || [];
  const total = query.data?.total ?? rows.length;

  const columns = useMemo(() => (singleTagMode ? [
    {
      key: "type",
      label: "Event",
      exportValue: (r) => (r.type === "movement" ? r.movement_type : `${r.from_status_label || r.from_status || "—"} -> ${r.to_status_label || r.to_status}`),
      render: (r) => (r.type === "movement" ? r.movement_type : `${r.from_status_label || r.from_status || "—"} → ${r.to_status_label || r.to_status}`),
    },
    { key: "reference_type", label: "Reference", render: (r) => r.reference_type || "—" },
    { key: "performed_by", label: "Performed By", render: (r) => r.performed_by || "—" },
    { key: "timestamp", label: "Timestamp", format: "datetime", render: (r) => fmtDateTime(r.timestamp) },
  ] : [
    { key: "tag_number", label: "Tag Number", render: (r) => r.tag_number || "—" },
    { key: "product_name", label: "Product" },
    { key: "action", label: "Action Performed" },
    { key: "from_status", label: "From", render: (r) => r.from_status_label || r.from_status || "—" },
    { key: "to_status", label: "To", render: (r) => r.to_status_label || r.to_status || "—" },
    { key: "performed_by", label: "Performed By", render: (r) => r.performed_by || "—" },
    { key: "timestamp", label: "Timestamp", format: "datetime", render: (r) => fmtDateTime(r.timestamp) },
  ]), [singleTagMode]);

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
            <div className="text-[15px] font-display font-semibold text-[#0A0A0A]">Tag History</div>
            <div className="text-[12px] text-[#737373] mt-0.5">Complete audit history of every tag</div>
          </div>
        </div>
        <button className="btn-secondary" onClick={() => setModalOpen(true)}>
          <FileText size={13} strokeWidth={1.5} /> Print Summary
        </button>
      </div>

      <FilterBar>
        <FilterInput label="Search Tag Number / Barcode" value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Leave blank to browse recent activity" />
        {search && <button className="btn-secondary self-end !py-1.5" onClick={() => { setSearch(""); setPage(1); }}>Clear</button>}
      </FilterBar>

      {singleTagMode && (
        <div className="card mb-4 text-[12.5px]">
          <span className="font-semibold">{query.data.product.name}</span>
          <span className="text-[#737373]"> · Barcode {query.data.product.barcode || "—"} · Status: {query.data.product.status_label || productStatusLabel(query.data.product.status)}</span>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        loading={query.isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        total={singleTagMode ? rows.length : total}
        onPageChange={singleTagMode ? undefined : setPage}
        emptyMessage={search ? "No tag found matching that number/barcode." : "No activity recorded yet."}
      />

      <ReportViewModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        reportName="Tag History"
        columns={columns}
        rows={rows}
        totals={null}
        filtersSummary={search ? `Tag/Barcode: ${search}` : "Recent shop-wide activity"}
      />
    </div>
  );
}
