import { useMemo, useState } from "react";
import { fmtINR, fmtWeight } from "@/lib/format";
import { useFilterOptions } from "../useFilterOptions";
import { FilterBar, FilterMultiSelect } from "../FilterBar";
import QuickReportShell from "../QuickReportShell";

const STATUS_OPTIONS = [
  { value: "available", label: "Available" },
  { value: "on_display", label: "On Display" },
];

export default function CategoryStockReport({ onBack }) {
  const { categories, counters, purities, metalTypes } = useFilterOptions();
  const [categoryIds, setCategoryIds] = useState([]);
  const [metalIds, setMetalIds] = useState([]);
  const [counterIds, setCounterIds] = useState([]);
  const [purityIds, setPurityIds] = useState([]);
  const [statuses, setStatuses] = useState([]);

  const params = useMemo(() => ({
    category_id: categoryIds.length ? categoryIds.join(",") : undefined,
    metal_type_id: metalIds.length ? metalIds.join(",") : undefined,
    counter_id: counterIds.length ? counterIds.join(",") : undefined,
    purity_id: purityIds.length ? purityIds.join(",") : undefined,
    status: statuses.length ? statuses.join(",") : undefined,
  }), [categoryIds, metalIds, counterIds, purityIds, statuses]);

  const columns = [
    { key: "category_name", label: "Category" },
    { key: "items", label: "Total Items", align: "right" },
    { key: "pieces", label: "Pieces", align: "right" },
    { key: "gross_weight", label: "Gross Weight", align: "right", format: "weight", render: (r) => fmtWeight(r.gross_weight) },
    { key: "stone_weight", label: "Stone Weight", align: "right", format: "weight", render: (r) => fmtWeight(r.stone_weight) },
    { key: "net_weight", label: "Net Weight", align: "right", format: "weight", render: (r) => fmtWeight(r.net_weight) },
    { key: "stock_value", label: "Stock Value", align: "right", format: "currency", render: (r) => fmtINR(r.stock_value) },
  ];

  return (
    <QuickReportShell
      title="Category Stock"
      description="Category-wise stock summary"
      endpoint="/reports/inventory/category-stock"
      params={params}
      columns={columns}
      onBack={onBack}
      emptyMessage="No stock matches these filters."
      filterBar={(
        <FilterBar>
          <FilterMultiSelect label="Category" value={categoryIds} onChange={setCategoryIds} options={categories} />
          <FilterMultiSelect label="Metal" value={metalIds} onChange={setMetalIds} options={metalTypes} />
          <FilterMultiSelect label="Counter" value={counterIds} onChange={setCounterIds} options={counters} />
          <FilterMultiSelect label="Purity" value={purityIds} onChange={setPurityIds} options={purities} />
          <FilterMultiSelect label="Status" value={statuses} onChange={setStatuses} options={STATUS_OPTIONS} />
        </FilterBar>
      )}
    />
  );
}
