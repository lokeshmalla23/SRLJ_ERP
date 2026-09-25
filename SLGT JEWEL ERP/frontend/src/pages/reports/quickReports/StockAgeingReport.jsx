import { useMemo, useState } from "react";
import { fmtINR, fmtWeight } from "@/lib/format";
import { useFilterOptions } from "../useFilterOptions";
import { FilterBar, FilterMultiSelect } from "../FilterBar";
import QuickReportShell from "../QuickReportShell";

export default function StockAgeingReport({ onBack }) {
  const { categories, counters, metalTypes } = useFilterOptions();
  const [categoryIds, setCategoryIds] = useState([]);
  const [counterIds, setCounterIds] = useState([]);
  const [metalIds, setMetalIds] = useState([]);

  const params = useMemo(() => ({
    category_id: categoryIds.length ? categoryIds.join(",") : undefined,
    counter_id: counterIds.length ? counterIds.join(",") : undefined,
    metal_type_id: metalIds.length ? metalIds.join(",") : undefined,
  }), [categoryIds, counterIds, metalIds]);

  const columns = [
    { key: "category_name", label: "Category" },
    { key: "bucket", label: "Age Bucket" },
    { key: "items", label: "Items", align: "right" },
    { key: "gross_weight", label: "Gross Weight", align: "right", format: "weight", render: (r) => fmtWeight(r.gross_weight) },
    { key: "stone_weight", label: "Stone Weight", align: "right", format: "weight", render: (r) => fmtWeight(r.stone_weight) },
    { key: "net_weight", label: "Net Weight", align: "right", format: "weight", render: (r) => fmtWeight(r.net_weight) },
    { key: "stock_value", label: "Stock Value", align: "right", format: "currency", render: (r) => fmtINR(r.stock_value) },
  ];

  return (
    <QuickReportShell
      title="Stock Ageing"
      description="Inventory ageing analysis by category"
      endpoint="/reports/inventory/stock-ageing"
      params={params}
      columns={columns}
      onBack={onBack}
      emptyMessage="No stock matches these filters."
      filterBar={(
        <FilterBar>
          <FilterMultiSelect label="Category" value={categoryIds} onChange={setCategoryIds} options={categories} />
          <FilterMultiSelect label="Metal" value={metalIds} onChange={setMetalIds} options={metalTypes} />
          <FilterMultiSelect label="Counter" value={counterIds} onChange={setCounterIds} options={counters} />
        </FilterBar>
      )}
    />
  );
}
