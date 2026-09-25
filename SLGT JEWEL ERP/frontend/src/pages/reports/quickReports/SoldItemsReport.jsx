import { useMemo, useState } from "react";
import { fmtINR, fmtDateTime } from "@/lib/format";
import { FilterBar, FilterInput, FilterMultiSelect } from "../FilterBar";
import QuickReportShell from "../QuickReportShell";
import { useFilterOptions } from "../useFilterOptions";

const localYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localYmd(d); };
const todayStr = () => localYmd(new Date());

export default function SoldItemsReport({ onBack, includeHidden = false }) {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayStr());
  const [categoryIds, setCategoryIds] = useState([]);
  const [subcategoryIds, setSubcategoryIds] = useState([]);
  const [metalIds, setMetalIds] = useState([]);
  const { categories, subcategoriesFor, metalTypes } = useFilterOptions();
  const subcategoryOptions = categoryIds.length
    ? categoryIds.flatMap((id) => subcategoriesFor(id))
    : [];

  const params = useMemo(() => ({
    from,
    to,
    category_id: categoryIds.length ? categoryIds.join(",") : undefined,
    subcategory_id: subcategoryIds.length ? subcategoryIds.join(",") : undefined,
    metal_type_id: metalIds.length ? metalIds.join(",") : undefined,
    include_hidden: includeHidden ? 1 : undefined,
  }), [from, to, categoryIds, subcategoryIds, metalIds, includeHidden]);

  const columns = [
    { key: "sno", label: "S.No", align: "right" },
    { key: "tag_no", label: "Tag No.", render: (r) => r.tag_no || "—" },
    { key: "category_name", label: "Category", render: (r) => r.category_name || "—" },
    { key: "subcategory_name", label: "Sub-category", render: (r) => r.subcategory_name || "—" },
    { key: "sold_at", label: "Sold Date & Time", render: (r) => fmtDateTime(r.sold_at) },
    { key: "sold_price", label: "Sold Price", align: "right", format: "currency", render: (r) => fmtINR(r.sold_price) },
  ];

  return (
    <QuickReportShell
      title="Sold Stock Info"
      description="Every tag sold in the selected period, with sale date and price"
      endpoint="/reports/inventory/sold-items"
      params={params}
      columns={columns}
      onBack={onBack}
      emptyMessage="No items sold in this period."
      filterBar={(
        <FilterBar>
          <FilterInput label="From" type="date" value={from} onChange={setFrom} />
          <FilterInput label="To" type="date" value={to} onChange={setTo} />
          <FilterMultiSelect
            label="Category"
            value={categoryIds}
            onChange={(next) => {
              setCategoryIds(next);
              const allowed = new Set(next.flatMap((id) => subcategoriesFor(id)).map((c) => c.id));
              setSubcategoryIds((prev) => prev.filter((id) => allowed.has(id)));
            }}
            options={categories}
          />
          <FilterMultiSelect
            label="Sub-category"
            value={subcategoryIds}
            onChange={setSubcategoryIds}
            options={subcategoryOptions}
          />
          <FilterMultiSelect label="Metal" value={metalIds} onChange={setMetalIds} options={metalTypes} />
        </FilterBar>
      )}
    />
  );
}
